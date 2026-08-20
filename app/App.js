import React, { useState, useEffect, useRef, useCallback } from "react";
import { View, Text, Pressable, ActivityIndicator, AppState } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { C, S } from "./src/theme";
import { loadSettings } from "./src/store";
import { enableDaily } from "./src/notify";
import { pull, push } from "./src/cloud";
import { buildQueue, schedule, dayKey } from "./src/logic";
import Home from "./src/screens/Home";
import Card from "./src/screens/Card";
import Immerse from "./src/screens/Immerse";
import Library from "./src/screens/Library";
import Stats from "./src/screens/Stats";
import Settings from "./src/screens/Settings";

const RELEARN_GAP = 4; // a missed card comes back a few cards later, as on the desktop

export default function App() {
  const [cfg, setCfg] = useState(null);
  const [deck, setDeck] = useState(null); // the folded deck: every device's files merged
  const [ownLog, setOwnLog] = useState({}); // THIS device's review counts, never the folded total
  const [ownSha, setOwnSha] = useState(null);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState(null);
  const [tab, setTab] = useState("review");
  const [session, setSession] = useState(null);
  const [recall, setRecall] = useState(false);

  // The AppState listener fires outside the render cycle, where captured state would be whatever
  // it was when the effect ran. A ref carries the current values to it.
  const live = useRef({});
  live.current = { cfg, deck, ownLog, ownSha };
  const dirty = useRef(false);

  const sync = useCallback(async (c) => {
    if (!c?.repo || !c?.token) return setBusy(false);
    setBusy(true);
    setErr(null);
    try {
      const r = await pull(c.repo, c.token, c.deviceId);
      setDeck(r.deck);
      setOwnLog(r.own?.log ?? {});
      setOwnSha(r.ownSha);
    } catch (e) {
      setErr(String(e?.message ?? e));
    }
    setBusy(false);
  }, []);

  useEffect(() => {
    loadSettings().then((c) => {
      setCfg(c);
      sync(c);
      // Re-arm on every launch. An OS-held schedule can vanish — a reinstall, a permission
      // revoked and restored, an aggressive battery optimiser — and a reminder that silently
      // stopped firing is indistinguishable from one that was never set.
      if (c.remind != null) enableDaily(c.remind).catch(() => {});
    });
  }, [sync]);

  // One upload per session rather than one per card. The deck is the cloud's to keep, but a
  // commit per grade would mean seventy commits and seventy full-file uploads for one commute,
  // each needing signal — which is the one thing a commute does not have.
  const pushNow = useCallback(async () => {
    const { cfg: c, deck: d, ownLog: log, ownSha: sha } = live.current;
    if (!dirty.current || !c?.repo || !c?.token || !d) return;
    dirty.current = false;
    try {
      // words and log only. `marks` is derived from the rows when folding, and the counters this
      // device does not produce must stay out of its file or the fold would count them twice.
      const next = await push(c.repo, c.token, c.deviceId, { words: d.words, log }, sha);
      setOwnSha(next);
    } catch (e) {
      dirty.current = true; // still pending: try again on the next chance rather than losing it
      setErr(String(e?.message ?? e));
    }
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => s !== "active" && pushNow());
    return () => sub.remove();
  }, [pushNow]);

  const applyRow = (row) => {
    setDeck((d) => ({ ...d, words: d.words.map((w) => (w.id === row.id ? row : w)) }));
    dirty.current = true;
  };

  const bumpLog = (now) => setOwnLog((l) => ({ ...l, [dayKey(now)]: (l[dayKey(now)] ?? 0) + 1 }));

  // Promoting or demoting from the library. `knownAt` is dropped on a demotion rather than left
  // behind — a word demoted back to 學習中 is no longer mastered and must not linger in the
  // weekly count. undefined survives JSON.stringify as an absent key, which is what we want.
  const setStatus = (w, how) => {
    const now = Date.now();
    const suspended = how === "known";
    applyRow({ ...w, suspended, knownAt: suspended ? now : undefined, updatedAt: now });
  };

  // A word met on the phone enters the deck in exactly the shape content.js writes on the
  // desktop, so the merge sees one kind of row and the review card finds every field where it
  // expects it. Unmarking is deliberately not offered here: removing a word needs a tombstone to
  // survive the merge, and switching between 學習中 and 已掌握 covers what a phone is for.
  const markWord = (item, how) => {
    const now = Date.now();
    const id = item.word.toLowerCase();
    setDeck((d) => {
      const at = d.words.findIndex((w) => w.id === id);
      const row = {
        addedAt: now, // kept by the spread below if the word is already known
        ...(at >= 0 ? d.words[at] : {}),
        id,
        word: item.word,
        context: item.context,
        contextZh: item.contextZh,
        senses: item.senses,
        sentence: item.sentence,
        zh: item.zh,
        videoId: item.videoId,
        title: item.title,
        t: item.t,
        suspended: how === "known",
        knownAt: how === "known" ? now : undefined,
        updatedAt: now,
      };
      return {
        ...d,
        words: at >= 0 ? d.words.map((w, i) => (i === at ? row : w)) : [...d.words, row],
        marks: { ...d.marks, [id]: how },
      };
    });
    dirty.current = true;
  };

  const start = () => {
    const queue = buildQueue(deck.words);
    if (queue.length) setSession({ queue, i: 0, mastered: 0, relearned: [] });
  };

  const finish = () => {
    setSession(null);
    pushNow();
  };

  const advance = (s) => (s.i + 1 >= s.queue.length ? finish() : setSession({ ...s, i: s.i + 1 }));

  const grade = (q) => {
    const now = Date.now();
    const card = session.queue[session.i];
    const row = { ...card, ...schedule(card, q, now), updatedAt: now };
    applyRow(row);
    bumpLog(now);

    const s = { ...session };
    // Ending a session having only ever failed a card is the one thing spacing cannot repair, so
    // a miss comes back once more before the session ends. Its long-term schedule is already
    // written and stays untouched — the retry is about not walking away from a miss.
    if (q < 3 && !s.relearned.includes(row.id)) {
      s.relearned = [...s.relearned, row.id];
      s.queue = [...s.queue];
      s.queue.splice(Math.min(s.queue.length, s.i + 1 + RELEARN_GAP), 0, row);
    }
    advance(s);
  };

  const master = () => {
    const now = Date.now();
    const card = session.queue[session.i];
    applyRow({ ...card, suspended: true, knownAt: now, updatedAt: now });
    // Drop any relearn copy still ahead: the word is known, it should not come back.
    const queue = session.queue.filter((w, k) => k <= session.i || w.id !== card.id);
    advance({ ...session, queue, mastered: session.mastered + 1 });
  };

  // Skipping is not answering wrong: the card goes to the back and keeps its schedule.
  const skip = () => {
    const queue = [...session.queue];
    const [card] = queue.splice(session.i, 1);
    queue.push(card);
    setSession({ ...session, queue });
  };

  const settingsScreen = (status) => (
    <Settings
      cfg={cfg ?? { deviceId: "…" }}
      onSaved={(c) => {
        setCfg(c);
        sync(c);
      }}
      onSync={() => sync(cfg)}
      status={status}
      busy={busy}
    />
  );

  const body = () => {
    if (busy && !deck && !err) return <Loading />;
    if (!cfg?.repo || !cfg?.token) return settingsScreen("尚未連結");
    if (tab === "settings") {
      return settingsScreen(
        err ? `錯誤：${err}` : deck ? `已連結，${deck.words.length} 個詞彙` : "尚未載入",
      );
    }
    if (!deck) return <Loading error={err} onRetry={() => sync(cfg)} />;
    if (tab === "immerse") return <Immerse cfg={cfg} marks={deck.marks} onMark={markWord} />;
    if (tab === "library") return <Library deck={deck} onStatus={setStatus} />;
    if (tab === "stats") return <Stats deck={deck} />;
    if (session) {
      const card = session.queue[session.i];
      return (
        <Card
          key={`${card.id}:${session.i}`} // a new card must start with its answer hidden again
          card={card}
          index={session.i}
          total={session.queue.length}
          mastered={session.mastered}
          recall={recall}
          onRecall={setRecall}
          onGrade={grade}
          onMaster={master}
          onSkip={skip}
          onQuit={finish}
        />
      );
    }
    return <Home deck={deck} onStart={start} busy={busy} error={err} onRetry={() => sync(cfg)} />;
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={S.screen} edges={["top", "bottom"]}>
        <StatusBar style="dark" />
        {body()}
        {!session && cfg?.repo && cfg?.token && <Tabs tab={tab} setTab={setTab} />}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function Loading({ error, onRetry }) {
  return (
    <View style={[S.screen, { alignItems: "center", justifyContent: "center", padding: 24 }]}>
      {error ? (
        <>
          <Text style={[S.sub, { textAlign: "center", lineHeight: 20 }]}>{error}</Text>
          <Pressable style={[S.btn, { marginTop: 16 }]} onPress={onRetry}>
            <Text style={S.btnText}>重試</Text>
          </Pressable>
        </>
      ) : (
        <ActivityIndicator color={C.dim} />
      )}
    </View>
  );
}

function Tabs({ tab, setTab }) {
  return (
    <View
      style={{
        flexDirection: "row",
        borderTopWidth: 1,
        borderTopColor: C.line,
        backgroundColor: C.card,
      }}
    >
      {[
        ["immerse", "沉浸"],
        ["review", "記憶固化"],
        ["library", "詞彙庫"],
        ["stats", "數據"],
        ["settings", "設定"],
      ].map(([id, label]) => (
        <Pressable
          key={id}
          style={{ flex: 1, paddingVertical: 12, alignItems: "center" }}
          onPress={() => setTab(id)}
        >
          <Text
            style={{
              fontSize: 13,
              color: tab === id ? C.text : C.dim,
              fontWeight: tab === id ? "600" : "400",
            }}
          >
            {label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
