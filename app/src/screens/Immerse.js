const React = require("react");
const { useState, useEffect, useMemo, useRef, useCallback } = React;
const {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  ScrollView,
  ActivityIndicator,
  Switch,
} = require("react-native");
const YoutubePlayer = require("react-native-youtube-iframe").default;
const Speech = require("expo-speech");
const { C, S, POS } = require("../theme");
const { splitPhrases, posOf, parseReply, WORD } = require("../logic");
const { listTx, getTx } = require("../cloud");
const { explain } = require("../ai");

// Watching, not just reading. The video plays, the line being spoken lights up and scrolls
// itself, tapping a line jumps the player there, tapping a word explains it in that context.
//
// The transcript comes from the desktop extension — the phone cannot fetch YouTube's captions
// itself (its player is unreachable inside a mobile WebView). Everything else is here.

// A YouTube id is 11 characters. Anything else pasted is a URL in one of several shapes, so pull
// the id out of whatever arrives rather than making someone edit it by hand.
function idOf(input) {
  const s = String(input ?? "").trim();
  const m =
    s.match(/[?&]v=([A-Za-z0-9_-]{11})/) ||
    s.match(/youtu\.be\/([A-Za-z0-9_-]{11})/) ||
    s.match(/\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})/) ||
    s.match(/^([A-Za-z0-9_-]{11})$/);
  return m ? m[1] : null;
}

function Immerse({ cfg, marks, onMark }) {
  const [index, setIndex] = useState({});
  const [input, setInput] = useState("");
  const [err, setErr] = useState(null);
  const [tx, setTx] = useState(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(() => {
    if (!cfg?.repo || !cfg?.token) return;
    listTx(cfg.repo, cfg.token)
      .then(setIndex)
      .catch((e) => setErr(String(e?.message ?? e)));
  }, [cfg]);

  useEffect(refresh, [refresh]);

  const open = async (videoId) => {
    setLoading(true);
    setErr(null);
    try {
      setTx(await getTx(cfg.repo, cfg.token, videoId));
    } catch {
      // On-device capture was ruled out — YouTube only hands captions to its own player, and that
      // player cannot be reached inside a mobile WebView. The desktop, legitimately watching, is
      // the only place a transcript can come from, so point there.
      setErr("這支影片還沒有逐字稿。先在桌機用瀏覽器看一次（開著字幕），擴充會自動存進雲端，手機就能用了。");
    }
    setLoading(false);
  };

  if (tx) return <Watch tx={tx} cfg={cfg} marks={marks} onMark={onMark} onBack={() => setTx(null)} />;

  const items = Object.entries(index ?? {}).sort((a, b) => (b[1].at ?? 0) - (a[1].at ?? 0));

  return (
    <View style={S.screen}>
      <View style={[S.pad, { paddingBottom: 4 }]}>
        <Text style={S.h1}>沉浸</Text>
        <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
          <TextInput
            style={[S.input, { flex: 1 }]}
            value={input}
            onChangeText={setInput}
            placeholder="貼上 YouTube 網址或影片 ID"
            placeholderTextColor="#bbb"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable
            style={[S.btn, S.primary, { paddingHorizontal: 18 }]}
            onPress={() => {
              const id = idOf(input);
              if (!id) return setErr("看不懂這個網址或 ID");
              open(id);
            }}
          >
            <Text style={[S.btnText, S.primaryText]}>開啟</Text>
          </Pressable>
        </View>
        {err && <Text style={[S.sub, { marginTop: 8, color: C.amber, lineHeight: 18 }]}>{err}</Text>}
        {loading && <ActivityIndicator color={C.dim} style={{ marginTop: 12 }} />}
      </View>

      <FlatList
        data={items}
        keyExtractor={([id]) => id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
        ListHeaderComponent={
          items.length ? <Text style={[S.sub, { marginBottom: 8 }]}>桌機看過的影片</Text> : null
        }
        ListEmptyComponent={
          !loading ? (
            <Text style={[S.sub, { lineHeight: 20 }]}>
              還沒有逐字稿。在桌機上開一支有字幕的影片，擴充會自動把它存進雲端。
            </Text>
          ) : null
        }
        renderItem={({ item: [id, meta] }) => (
          <Pressable style={[S.card, { marginBottom: 8 }]} onPress={() => open(id)}>
            <Text style={{ fontSize: 15, fontWeight: "600", color: C.text }} numberOfLines={2}>
              {meta.title || id}
            </Text>
            <Text style={[S.sub, { marginTop: 4 }]}>
              {meta.n ? `${meta.n} 句 · ` : ""}
              {meta.at ? new Date(meta.at).toLocaleDateString() : id}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}

function Watch({ tx, cfg, marks, onMark, onBack }) {
  const [playing, setPlaying] = useState(true);
  const [at, setAt] = useState(0); // seconds, polled from the player
  const [zhOn, setZhOn] = useState(false);
  const [follow, setFollow] = useState(true);
  const [sel, setSel] = useState(null);
  const [perr, setPerr] = useState(null);
  const player = useRef(null);
  const list = useRef(null);
  const cache = useRef(new Map()); // word|sentence → promise, so re-tapping never bills twice

  // Which line is being spoken. Every sentence carries a start and an end, so this is a lookup
  // rather than a guess — the same one the desktop uses for A/S/D.
  const cur = useMemo(
    () => tx.sentences.findIndex((s) => at >= s.start && at < s.end),
    [at, tx.sentences],
  );

  // Twice a second keeps the highlight honest without interrogating the player constantly.
  useEffect(() => {
    if (!playing) return;
    const iv = setInterval(async () => {
      try {
        const t = await player.current?.getCurrentTime();
        if (typeof t === "number") setAt(t);
      } catch {
        // not ready yet, or gone — the next tick will do
      }
    }, 500);
    return () => clearInterval(iv);
  }, [playing]);

  // Keep the spoken line on screen, unless the reader has taken the wheel by scrolling.
  useEffect(() => {
    if (!follow || cur < 0) return;
    try {
      list.current?.scrollToIndex({ index: cur, viewPosition: 0.35, animated: true });
    } catch {
      // scrollToIndex throws for a row that has not been measured; the next update catches up
    }
  }, [cur, follow]);

  const seek = (sec) => {
    player.current?.seekTo(Math.max(0, sec), true);
    setAt(sec);
    setPlaying(true);
  };

  const tap = (word, sentence, start) => {
    const key = `${word}|${sentence}`;
    setSel({
      word, sentence, done: false, senses: [], context: "",
      videoId: tx.videoId, title: tx.title, t: start,
    });
    let job = cache.current.get(key);
    if (!job) {
      job = explain(cfg.apiKey, word, sentence)
        .then(parseReply)
        .catch((e) => {
          cache.current.delete(key); // an error must not be cached, or a retry never retries
          return parseReply(String(e?.message ?? e));
        });
      cache.current.set(key, job);
    }
    job.then((parsed) =>
      setSel((c) => (c && c.word === word && c.sentence === sentence ? { ...c, ...parsed, done: true } : c)),
    );
  };

  return (
    <View style={S.screen}>
      <View style={[S.row, { paddingHorizontal: 16, paddingVertical: 8 }]}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={[S.sub, { fontSize: 15 }]}>‹ 返回</Text>
        </Pressable>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Text style={[S.sub, { fontSize: 12 }]}>跟隨</Text>
          <Switch value={follow} onValueChange={setFollow} />
          <Text style={[S.sub, { fontSize: 12, marginLeft: 8 }]}>中文</Text>
          <Switch value={zhOn} onValueChange={setZhOn} />
        </View>
      </View>

      <YoutubePlayer
        ref={player}
        height={200}
        play={playing}
        videoId={tx.videoId}
        initialPlayerParams={{ modestbranding: true, rel: false }}
        onChangeState={(s) => {
          if (s === "playing") setPlaying(true);
          if (s === "paused" || s === "ended") setPlaying(false);
        }}
        onError={(e) => setPerr(String(e))}
      />
      {perr && (
        <Text style={[S.sub, { paddingHorizontal: 16, color: C.amber, lineHeight: 18 }]}>
          播放器錯誤 {perr} — 逐字稿仍可閱讀、點字與朗讀。
        </Text>
      )}

      <FlatList
        ref={list}
        data={tx.sentences}
        keyExtractor={(_, i) => String(i)}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        onScrollBeginDrag={() => setFollow(false)} // taking the wheel turns off autopilot
        onScrollToIndexFailed={() => {}}
        renderItem={({ item, index }) => (
          <Line
            s={item}
            on={index === cur}
            zh={zhOn ? tx.zh?.[index] : null}
            phrases={tx.phrases ?? []}
            pos={tx.pos ?? {}}
            marks={marks}
            onWord={(w, sent) => tap(w, sent, item.start)}
            onSeek={() => seek(item.start)}
          />
        )}
      />

      {sel && <Sheet item={sel} marks={marks} onMark={onMark} onClose={() => setSel(null)} />}
    </View>
  );
}

function Line({ s, on, zh, phrases, pos, marks, onWord, onSeek }) {
  // splitPhrases marks the stretches that are known expressions, so a phrasal verb stays one
  // tappable unit instead of two words that each mean something else.
  const runs = useMemo(() => splitPhrases(s.text, phrases), [s.text, phrases]);
  return (
    <View
      style={{
        marginBottom: 10,
        padding: 10,
        borderRadius: 10,
        backgroundColor: on ? "#eef3ff" : "transparent",
        borderLeftWidth: 3,
        borderLeftColor: on ? C.blue : "transparent",
      }}
    >
      <Text style={{ fontSize: 17, lineHeight: 30, color: C.text }}>
        {runs.map((run, i) =>
          run.phrase ? (
            <Word key={i} display={run.text} word={run.text} isPhrase {...{ pos, marks, onWord, sentence: s.text }} />
          ) : (
            run.text.split(/(\s+)/).map((tok, j) => {
              const w = tok.match(WORD);
              return w ? (
                <Word key={`${i}-${j}`} display={tok} word={w[0]} {...{ pos, marks, onWord, sentence: s.text }} />
              ) : (
                <Text key={`${i}-${j}`}>{tok}</Text>
              );
            })
          ),
        )}
      </Text>
      {zh ? <Text style={[S.sub, { marginTop: 4, fontSize: 14 }]}>{zh}</Text> : null}
      <View style={{ flexDirection: "row", gap: 16, marginTop: 6 }}>
        <Pressable onPress={onSeek} hitSlop={8}>
          <Text style={{ fontSize: 12, color: C.blue }}>▶ 從這句播</Text>
        </Pressable>
        <Pressable onPress={() => Speech.speak(s.text, { language: "en-US" })} hitSlop={8}>
          <Text style={[S.sub, { fontSize: 12 }]}>🔊 朗讀</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Word({ display, word, isPhrase, pos, marks, onWord, sentence }) {
  const how = marks?.[word.toLowerCase()];
  const p = posOf(word, pos);
  return (
    <Text
      onPress={() => onWord(word, sentence)}
      suppressHighlighting
      style={{
        color: p ? POS[p] ?? C.text : C.text,
        ...(isPhrase ? { backgroundColor: "#fff6d6" } : null),
        ...(how
          ? { textDecorationLine: "underline", textDecorationColor: how === "known" ? C.green : C.blue }
          : null),
      }}
    >
      {display}
    </Text>
  );
}

// The explanation, and the only place a word enters the deck. Tapping a word is curiosity;
// pressing 學習中 is the commitment — the same rule the extension follows.
function Sheet({ item, marks, onMark, onClose }) {
  const how = marks?.[item.word.toLowerCase()];
  return (
    <View
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        maxHeight: "58%",
        backgroundColor: C.card,
        borderTopWidth: 1,
        borderTopColor: C.line,
        padding: 16,
        elevation: 8,
      }}
    >
      <View style={S.row}>
        <Text style={{ fontSize: 20, fontWeight: "700", color: C.text, flex: 1 }}>{item.word}</Text>
        <Pressable onPress={() => Speech.speak(item.word, { language: "en-US" })} hitSlop={10}>
          <Text style={{ fontSize: 16 }}>🔊</Text>
        </Pressable>
        <Pressable onPress={onClose} hitSlop={10} style={{ marginLeft: 16 }}>
          <Text style={[S.sub, { fontSize: 16 }]}>✕</Text>
        </Pressable>
      </View>

      <ScrollView style={{ marginTop: 10 }}>
        {!item.done ? (
          <ActivityIndicator color={C.dim} style={{ marginVertical: 20 }} />
        ) : (
          <>
            {item.contextZh ? (
              <Text style={{ fontSize: 15, color: C.text, lineHeight: 23 }}>{item.contextZh}</Text>
            ) : null}
            {item.context ? (
              <Text style={[S.sub, { marginTop: 8, lineHeight: 19 }]}>{item.context}</Text>
            ) : null}
            {(item.senses ?? []).map((s, i) => (
              <View
                key={i}
                style={{ borderLeftWidth: 2, borderLeftColor: C.line, paddingLeft: 10, marginTop: 12 }}
              >
                <Text style={{ fontSize: 10, color: POS.prep, textTransform: "uppercase" }}>{s.pos}</Text>
                <Text style={{ fontSize: 14, color: C.text, marginTop: 2 }}>{s.gloss}</Text>
                {s.example ? <Text style={[S.sub, { fontSize: 12, marginTop: 3 }]}>{s.example}</Text> : null}
                {s.zh ? <Text style={[S.sub, { fontSize: 12 }]}>{s.zh}</Text> : null}
              </View>
            ))}
          </>
        )}
      </ScrollView>

      <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
        {[
          ["learning", "學習中"],
          ["known", "已掌握"],
        ].map(([k, label]) => (
          <Pressable
            key={k}
            style={[S.btn, { flex: 1, paddingVertical: 10 }, how === k && S.primary]}
            onPress={() => onMark(item, k)}
          >
            <Text style={[S.btnText, { fontSize: 14 }, how === k && S.primaryText]}>{label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

module.exports = Immerse;
