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
  Linking,
  Alert,
  useWindowDimensions,
  PanResponder,
} = require("react-native");
const YoutubePlayer = require("react-native-youtube-iframe").default;
const Speech = require("expo-speech");
const { C, S, POS } = require("../theme");
const { splitPhrases, posOf, parseReply, spokenIdx, WORD } = require("../logic");
const { listTx, getTx } = require("../cloud");
const { loadHidden, hideVideo, loadSplit, saveSplit } = require("../store");
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

const mmss = (t) =>
  `${Math.floor((t ?? 0) / 60)}:${String(Math.floor((t ?? 0) % 60)).padStart(2, "0")}`;

// The player's own error codes. The first two are the uploader's decision — embedding is switched
// off for that video, so it will not play inside ANY app, ours or anyone else's — and the rest
// are the video or the device being unavailable. All of them mean the same thing here: no video,
// so the transcript carries the session alone and the video opens in YouTube instead.
const PLAYER_ERR = {
  embed_not_allowed: "這支影片的擁有者關閉了嵌入播放",
  not_embeddable: "這支影片的擁有者關閉了嵌入播放",
  video_not_found: "找不到這支影片（可能已刪除或設為私人）",
  html5_error: "這台裝置無法播放這支影片",
};

// Minutes for the day's total on the picker, where the number is a record and seconds would be
// noise. The counter inside a session uses mmss instead: there it is feedback for something
// happening right now, and one that sits still for a whole minute reads as a broken clock.
const mins = (sec) => {
  const m = Math.floor((sec ?? 0) / 60);
  return m >= 60 ? `${Math.floor(m / 60)} 時 ${m % 60} 分` : `${m} 分`;
};

function Immerse({ cfg, marks, onMark, onImmersion, todaySec }) {
  const [index, setIndex] = useState({});
  const [input, setInput] = useState("");
  const [err, setErr] = useState(null);
  const [tx, setTx] = useState(null);
  const [loading, setLoading] = useState(false);
  const [hidden, setHidden] = useState(null); // null until the phone has been read

  useEffect(() => {
    loadHidden().then(setHidden);
  }, []);

  // Struck off this phone's list, not deleted from the repo — so it can always be opened again by
  // pasting the id above, which is why there is no separate undo.
  const hide = (id, title) =>
    Alert.alert("移除這支影片？", `${title}\n\n只從這支手機的清單移除，逐字稿還在雲端。之後貼上網址或影片 ID 就能再開。`, [
      { text: "取消", style: "cancel" },
      {
        text: "移除",
        style: "destructive",
        // The card only leaves the screen once the phone has actually recorded it. Hiding first
        // and writing afterwards would show a removal that silently undoes itself on next launch.
        onPress: () =>
          hideVideo(id)
            .then(setHidden)
            .catch((e) =>
              Alert.alert("沒有移除成功", `這支手機存不起來，所以卡片留著。\n\n${e?.message ?? e}`),
            ),
      },
    ]);

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

  if (tx)
    return (
      <Watch
        tx={tx}
        cfg={cfg}
        marks={marks}
        onMark={onMark}
        onImmersion={onImmersion}
        todaySec={todaySec}
        onBack={() => setTx(null)}
      />
    );

  const gone = new Set(hidden ?? []);
  const all = Object.entries(index ?? {});
  const items = all
    .filter(([id]) => !gone.has(id))
    .sort((a, b) => (b[1].at ?? 0) - (a[1].at ?? 0));

  return (
    <View style={S.screen}>
      <View style={[S.pad, { paddingBottom: 4 }]}>
        <View style={S.row}>
          <Text style={S.h1}>沉浸</Text>
          <Text style={[S.sub, { fontSize: 13 }]}>⏱ 今日 {mins(todaySec)}</Text>
        </View>
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
          loading ? null : all.length ? (
            // Everything there is has been struck off — saying "there are no transcripts" here
            // would be a lie, and would hide the way back.
            <Text style={[S.sub, { lineHeight: 20 }]}>
              清單上的 {all.length} 支都移除了。貼上網址或影片 ID 就能再開啟。
            </Text>
          ) : (
            <Text style={[S.sub, { lineHeight: 20 }]}>
              還沒有逐字稿。在桌機上開一支有字幕的影片，擴充會自動把它存進雲端。
            </Text>
          )
        }
        renderItem={({ item: [id, meta] }) => (
          <Pressable style={[S.card, S.row, { marginBottom: 8 }]} onPress={() => open(id)}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: "600", color: C.text }} numberOfLines={2}>
                {meta.title || id}
              </Text>
              <Text style={[S.sub, { marginTop: 4 }]}>
                {meta.n ? `${meta.n} 句 · ` : ""}
                {meta.at ? new Date(meta.at).toLocaleDateString() : id}
              </Text>
            </View>
            {/* Its own press target, and a generous one: a mis-tap here costs the card, and the
                card sitting under it opens a video. */}
            <Pressable onPress={() => hide(id, meta.title || id)} hitSlop={14} style={{ paddingLeft: 12 }}>
              <Text style={{ fontSize: 17, color: C.dim }}>✕</Text>
            </Pressable>
          </Pressable>
        )}
      />
    </View>
  );
}

// Far enough either way to be worth dragging, never so far that the other column disappears.
const SPLIT = 0.6;
const clampSplit = (r) => Math.min(0.78, Math.max(0.3, r));

function Watch({ tx, cfg, marks, onMark, onImmersion, todaySec, onBack }) {
  // What the player was asked to do and what it is actually doing are two different facts, and
  // one flag standing for both is what let the immersion clock bank seconds for a video nobody
  // was watching: mobile browsers routinely refuse autoplay, and when they do the video sits
  // still and no state event ever arrives to correct the assumption.
  const [want, setWant] = useState(true); // the request — autoplay on open
  const [playing, setPlaying] = useState(false); // the report — everything timed keys off this
  const [cur, setCur] = useState(-1); // the line being spoken, NOT the raw clock
  const [zhOn, setZhOn] = useState(false);
  const [follow, setFollow] = useState(true);
  const [sel, setSel] = useState(null);
  const [perr, setPerr] = useState(null);
  const player = useRef(null);
  const list = useRef(null);

  // Turned sideways the screen is short and wide, so stacking the player above the transcript
  // would leave a couple of lines visible under it. Side by side, the video gets a column and the
  // reading gets the rest — and the video is sized from that column rather than pinned at 200,
  // which is also what makes it bigger in portrait than the fixed height was.
  const { width, height } = useWindowDimensions();
  const land = width > height;

  // Where the divider sits, as a fraction of the width. Half the screen made the video no bigger
  // than it is in portrait, which defeats the point of turning the phone over; 0.6 fills the
  // height a typical handset has sideways. It is draggable because the trade-off — a bigger
  // picture against more lines of transcript — is not one answer for everybody.
  const [ratio, setRatio] = useState(SPLIT);
  const ratioRef = useRef(SPLIT);
  const grabbed = useRef(SPLIT);
  const widthRef = useRef(width);
  ratioRef.current = ratio;
  widthRef.current = width;

  useEffect(() => {
    loadSplit(SPLIT).then((r) => setRatio(clampSplit(r)));
  }, []);

  const drag = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => (grabbed.current = ratioRef.current),
      onPanResponderMove: (_, g) => {
        const next = clampSplit(grabbed.current + g.dx / (widthRef.current || 1));
        // Both columns re-lay-out on every accepted move, so ignore the sub-pixel ones.
        if (Math.abs(next - ratioRef.current) > 0.005) setRatio(next);
      },
      // Only on release: a write per frame would be hundreds of them for one drag.
      onPanResponderRelease: () => saveSplit(ratioRef.current).catch(() => {}),
    }),
  ).current;

  const colW = land ? Math.round(width * ratio) : width;
  // Dragged far enough, 16:9 of the column would be taller than the screen. Give back width
  // instead of height: a player told to be wide and short letterboxes itself, and the reader
  // ends up with black bars where the picture was supposed to get bigger.
  const playerW = Math.min(colW, Math.round((height * 0.78 * 16) / 9));
  const playerH = Math.round((playerW * 9) / 16);
  const cache = useRef(new Map()); // word|sentence → promise, so re-tapping never bills twice



  // Immersion is time the video actually ran. Banked every fifteen seconds rather than every
  // second: each hand-off re-renders the whole transcript list, and a counter nobody is watching
  // does not deserve that. `banked` only exists so the header can move before the hand-off.
  const pending = useRef(0);
  const [banked, setBanked] = useState(0);
  useEffect(() => {
    if (!playing) return;
    const iv = setInterval(() => {
      pending.current += 1;
      setBanked((b) => b + 1);
      if (pending.current >= 15) {
        onImmersion?.(pending.current, tx.videoId);
        pending.current = 0;
        setBanked(0);
      }
    }, 1000);
    return () => clearInterval(iv);
  }, [playing, onImmersion, tx.videoId]);

  // Leaving mid-count must not throw the seconds away.
  useEffect(
    () => () => {
      if (pending.current > 0) onImmersion?.(pending.current, tx.videoId);
      pending.current = 0;
    },
    [onImmersion, tx.videoId],
  );

  // Twice a second keeps the highlight honest without interrogating the player constantly.
  useEffect(() => {
    if (!playing) return;
    const iv = setInterval(async () => {
      try {
        const t = await player.current?.getCurrentTime();
        if (typeof t !== "number") return;
        // Which line is being spoken — a lookup, not a guess, because every sentence carries a
        // start and an end. Storing the raw clock instead re-rendered the entire transcript twice
        // a second; with the Chinese lines switched on there was enough work in each pass for the
        // list to visibly jitter. The index only changes once a line, so the list only redraws
        // once a line.
        const i = tx.sentences.findIndex((s) => t >= s.start && t < s.end);
        setCur((c) => (c === i ? c : i));
      } catch {
        // not ready yet, or gone — the next tick will do
      }
    }, 500);
    return () => clearInterval(iv);
  }, [playing, tx.sentences]);

  // Keep the spoken line on screen, unless the reader has taken the wheel by scrolling.
  useEffect(() => {
    if (!follow || cur < 0) return;
    try {
      list.current?.scrollToIndex({ index: cur, viewPosition: 0.35, animated: true });
    } catch {
      // scrollToIndex throws for a row that has not been measured; the next update catches up
    }
  }, [cur, follow]);

  const openInYouTube = (sec = 0) =>
    Linking.openURL(`https://youtu.be/${tx.videoId}?t=${Math.floor(Math.max(0, sec))}`);

  const seek = (sec) => {
    // No embedded player: the gesture still means "play from here", it just has to happen in the
    // YouTube app. Seeking a player that never loaded would be a tap that does nothing.
    if (perr) return openInYouTube(sec);
    player.current?.seekTo(Math.max(0, sec), true);
    setCur(tx.sentences.findIndex((s) => sec >= s.start && sec < s.end));
    setWant(true); // ask; the clock starts when the player says it started
  };

  // Explaining one word or a circled phrase. Kept as one function because both are the same
  // request — a phrase is just a longer "word" — cached by word|sentence so re-tapping never
  // bills twice.
  const explainSel = (word, sentence, start) => {
    const key = `${word}|${sentence}`;
    // Merge, never replace: the selection range lives in this same object, and rebuilding it from
    // scratch here silently dropped the range — which is why the expand handles never appeared.
    setSel((c) => ({
      ...(c ?? {}),
      word, sentence, videoId: tx.videoId, title: tx.title, t: start,
      done: false, pending: false, senses: [], context: "", contextZh: "",
    }));
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

  // Every sentence's tappable tokens, computed once. A phrase circled by the user is a range of
  // these; the model's own phrases are already single tokens (splitPhrases boxed them).
  const lineTokens = useMemo(
    () => tx.sentences.map((s) => tokenize(s.text, tx.phrases ?? [])),
    [tx],
  );

  // 圈選片語 on a phone: tap a word, then grow the selection outwards one word at a time with
  // the ◀ ▶ handles. Dragging is not available here — that gesture belongs to the scrolling
  // list — and hunting for a second endpoint by tapping was worse than either. Handles are
  // precise on a small screen and cost nothing to undo.
  //
  // Expanding does NOT re-ask the model. Each press would otherwise be another paid call while
  // the reader is still deciding where the phrase ends; the lookup waits for 查詢.
  const wordsOf = (line, from, to) =>
    lineTokens[line]
      .filter((x) => x.t === "w" && x.idx >= from && x.idx <= to)
      .map((x) => x.word)
      .join(" ");

  const lastIdx = (line) => {
    const ws = lineTokens[line].filter((x) => x.t === "w");
    return ws.length ? ws[ws.length - 1].idx : 0;
  };

  const onWordPress = (line, idx, word) => {
    const s = tx.sentences[line];
    setSel({ range: { line, from: idx, to: idx } }); // the range first, the explanation merges in
    explainSel(word, s.text, s.start);
  };

  // side: "L" | "R", step: -1 shrinks, +1 grows
  const expand = (side, step) => {
    setSel((c) => {
      if (!c?.range) return c;
      const { line, from, to } = c.range;
      const next =
        side === "L"
          ? { line, from: Math.max(0, Math.min(to, from - step)), to }
          : { line, from, to: Math.max(from, Math.min(lastIdx(line), to + step)) };
      if (next.from === from && next.to === to) return c;
      const phrase = wordsOf(line, next.from, next.to);
      // The explanation on screen belongs to the old selection, so it is cleared rather than
      // left to be read as if it described the new one.
      return { ...c, word: phrase, range: next, done: false, senses: [], context: "", contextZh: "", pending: true };
    });
  };

  const lookup = () => {
    if (!sel?.range) return;
    const s = tx.sentences[sel.range.line];
    explainSel(sel.word, s.text, s.start);
  };

  return (
    <View style={S.screen}>
      <View style={[S.row, { paddingHorizontal: 16, paddingVertical: 8 }]}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={[S.sub, { fontSize: 15 }]}>‹ 返回</Text>
        </Pressable>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          {/* The dot says whether the clock beside it is running. Labelled too, because bare
              m:ss beside a transcript full of m:ss timestamps would read as the playback
              position rather than as time immersed. */}
          <View
            style={{
              width: 8, height: 8, borderRadius: 4, marginRight: 2,
              backgroundColor: playing ? "#e5484d" : C.dim,
            }}
          />
          <Text style={[S.sub, { fontSize: 12, marginRight: 8 }]}>今日 {mmss(todaySec + banked)}</Text>
          <Text style={[S.sub, { fontSize: 12 }]}>跟隨</Text>
          <Switch value={follow} onValueChange={setFollow} />
          <Text style={[S.sub, { fontSize: 12, marginLeft: 8 }]}>中文</Text>
          <Switch value={zhOn} onValueChange={setZhOn} />
        </View>
      </View>

      <View style={{ flex: 1, flexDirection: land ? "row" : "column" }}>
        <View style={land ? { width: colW } : null}>
          <View style={{ alignItems: "center" }}>
            <YoutubePlayer
              ref={player}
              height={playerH}
              width={playerW}
              play={want}
              videoId={tx.videoId}
              initialPlayerParams={{ modestbranding: true, rel: false }}
              onChangeState={(s) => {
                // Keep the request in step with reality — started from the player's own button,
                // the request must agree, or a later render could hand it a stale play={false}.
                if (s === "playing") {
                  setPlaying(true);
                  setWant(true);
                }
                // Paused from the player's own controls: stop asking, or the next render would
                // hand it play={true} again and fight the person who just pressed pause.
                if (s === "paused" || s === "ended") {
                  setPlaying(false);
                  setWant(false);
                }
              }}
              onError={(e) => {
                setPerr(String(e));
                setPlaying(false); // nothing is playing, so the immersion clock must not keep counting
                setWant(false);
              }}
            />
          </View>
          {perr && (
            <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
              <Text style={{ color: C.amber, fontSize: 13, lineHeight: 19 }}>
                {PLAYER_ERR[perr] ?? `播放器錯誤：${perr}`}
              </Text>
              <Text style={[S.sub, { marginTop: 4, lineHeight: 18 }]}>
                逐字稿仍可閱讀、點字查詢、標生字。點任一行會用 YouTube 開啟那一刻。
              </Text>
              <Pressable style={[S.btn, { marginTop: 10, paddingVertical: 8 }]} onPress={() => openInYouTube(0)}>
                <Text style={S.btnText}>在 YouTube 開啟</Text>
              </Pressable>
            </View>
          )}
        </View>

        {land && (
          // Wider than it looks: the grip is 8pt of line in a 22pt target, because a divider that
          // has to be hit exactly is a divider nobody moves.
          <View
            {...drag.panHandlers}
            style={{ width: 22, alignItems: "center", justifyContent: "center" }}
          >
            <View style={{ width: 4, height: 44, borderRadius: 2, backgroundColor: C.line }} />
          </View>
        )}

        <View style={{ flex: 1 }}>
          <FlatList
            ref={list}
            data={tx.sentences}
            keyExtractor={(_, i) => String(i)}
            contentContainerStyle={{ padding: 16, paddingBottom: zhOn ? 120 : 40 }}
            onScrollBeginDrag={() => setFollow(false)} // taking the wheel turns off autopilot
            onScrollToIndexFailed={() => {}}
            renderItem={({ item, index }) => (
              <Line
                tokens={lineTokens[index]}
                lineIndex={index}
                sentence={item}
                on={index === cur}
                player={player}
                playing={playing}
                pos={tx.pos ?? {}}
                marks={marks}
                range={sel?.range && sel.range.line === index ? sel.range : null}
                onWordPress={onWordPress}
                onSeek={() => seek(item.start)}
              />
            )}
          />

          {zhOn && !perr && <ZhBar cues={tx.zhCues ?? []} player={player} playing={playing} />}
        </View>
      </View>

      {sel && (
        <Sheet
          item={sel}
          marks={marks}
          onMark={onMark}
          onExpand={expand}
          onLookup={lookup}
          onClose={() => setSel(null)}
        />
      )}
    </View>
  );
}

// The translated line for the moment being played.
//
// Not "the translation of this sentence" — that pairing was tried three times and is not
// obtainable from this data: a translated cue straddles English sentence boundaries, its length
// is not proportional to the English it replaces, and the track runs behind the English one, so
// every split was a guess that showed up as blank lines and mismatched text. Asked against the
// clock instead, there is nothing to guess: whatever cue is playing IS the translation of what
// is being said.
//
// It polls the player itself and keeps its own state so that a new cue redraws this one line and
// not the whole transcript — holding the clock in the screen above is what made the list jitter.
function ZhBar({ cues, player, playing }) {
  const [i, setI] = useState(-1);

  useEffect(() => {
    if (!playing || !cues.length) return;
    const iv = setInterval(async () => {
      try {
        const t = await player.current?.getCurrentTime();
        if (typeof t !== "number") return;
        const n = cues.findIndex((c) => t >= c.start && t < c.end);
        setI((c) => (c === n ? c : n));
      } catch {
        // not ready yet, or gone — the next tick will do
      }
    }, 500);
    return () => clearInterval(iv);
  }, [playing, cues, player]);

  return (
    // Floated over the transcript rather than stacked above it. A cue is 13 characters at the
    // median but 5% run past three lines, and a bar in the layout would shove the whole list up
    // and down as it resized — the jitter this screen just got rid of. Over the top it can be as
    // tall as the line needs without moving anything, and nothing gets cut off.
    <View
      style={{
        position: "absolute", left: 0, right: 0, bottom: 0,
        paddingHorizontal: 16, paddingVertical: 10,
        backgroundColor: "rgba(255,255,255,0.96)", borderTopWidth: 1, borderTopColor: "#e5e7eb",
      }}
      pointerEvents="none"
    >
      <Text style={{ fontSize: 15, lineHeight: 22, color: cues.length ? C.text : C.dim }}>
        {cues.length ? cues[i]?.text ?? "" : "這份逐字稿沒有中文軌（舊版）。在桌機重開一次這支影片就會補上。"}
      </Text>
    </View>
  );
}

function Line({ tokens, lineIndex, sentence, on, player, playing, pos, marks, range, onWordPress, onSeek }) {
  const [spoken, setSpoken] = useState(-1);

  // Only the line being spoken keeps a clock, and it holds the result itself — so a word lighting
  // up four times a second redraws this one row instead of the whole transcript. That is the same
  // reason the screen above tracks a line index rather than the raw seconds.
  useEffect(() => {
    if (!on) {
      setSpoken(-1);
      return;
    }
    if (!playing) return; // paused: leave the last word lit, so the eye keeps its place
    const iv = setInterval(async () => {
      try {
        const t = await player.current?.getCurrentTime();
        if (typeof t !== "number") return;
        const n = spokenIdx(tokens, sentence, t);
        setSpoken((c) => (c === n ? c : n));
      } catch {
        // not ready yet, or gone — the next tick will do
      }
    }, 250);
    return () => clearInterval(iv);
  }, [on, playing, tokens, sentence, player]);

  return (
    // Tapping anywhere that is not a word seeks the player to this line. The words keep their own
    // taps, so the gesture only lands here in the gaps — which is exactly where a reader aiming
    // at "this bit" would press anyway.
    <Pressable
      onPress={onSeek}
      style={{
        flexDirection: "row",
        marginBottom: 10,
        padding: 10,
        borderRadius: 10,
        backgroundColor: on ? "#eef3ff" : "transparent",
        borderLeftWidth: 3,
        borderLeftColor: on ? C.blue : "transparent",
      }}
    >
      {/* The moment this line is spoken, so a place in the video can be found by eye. */}
      <Text style={{ width: 42, fontSize: 11, color: on ? C.blue : C.dim, paddingTop: 7 }}>
        {mmss(sentence.start)}
      </Text>
      <View style={{ flex: 1 }}>
      <Text style={{ fontSize: 17, lineHeight: 30, color: C.text }}>
        {tokens.map((tk, i) =>
          tk.t === "txt" ? (
            <Text key={i}>{tk.display}</Text>
          ) : (
            <Word
              key={i}
              display={tk.display}
              word={tk.word}
              isPhrase={tk.isPhrase}
              pos={pos}
              how={marks?.[tk.word.toLowerCase()]}
              picked={!!range && tk.idx >= range.from && tk.idx <= range.to}
              spoken={tk.idx === spoken}
              onPress={() => onWordPress(lineIndex, tk.idx, tk.word)}
            />
          ),
        )}
      </Text>
      </View>
    </Pressable>
  );
}

function Word({ display, word, isPhrase, pos, how, picked, spoken, onPress }) {
  const p = posOf(word, pos);
  return (
    <Text
      onPress={onPress}
      suppressHighlighting
      style={{
        color: p ? POS[p] ?? C.text : C.text,
        ...(picked
          ? { backgroundColor: "#fc0", color: "#000" }
          : spoken
            ? { backgroundColor: "#dbeafe", fontWeight: "700" }
            : isPhrase
              ? { backgroundColor: "#fff6d6" }
              : null),
        ...(how
          ? { textDecorationLine: "underline", textDecorationColor: how === "known" ? C.green : C.blue }
          : null),
      }}
    >
      {display}
    </Text>
  );
}

// Flattens a sentence into render tokens: whitespace/punctuation as plain text, each tappable
// word (or model phrase) numbered so a circled range can be rebuilt from two endpoints.
function tokenize(text, phrases) {
  const out = [];
  let idx = 0;
  let at = 0; // character offset into the sentence — what turns a clock reading into a word
  for (const run of splitPhrases(text, phrases)) {
    if (run.phrase) {
      out.push({ t: "w", word: run.text, display: run.text, isPhrase: true, idx: idx++, at });
      at += run.text.length;
      continue;
    }
    for (const tok of run.text.split(/(\s+)/)) {
      if (!tok) continue;
      const w = tok.match(WORD);
      if (w) out.push({ t: "w", word: w[0], display: tok, isPhrase: false, idx: idx++, at });
      else out.push({ t: "txt", display: tok });
      at += tok.length;
    }
  }
  return out;
}

function Handle({ label, onPress, dim }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: C.line,
        backgroundColor: dim ? "transparent" : "#fff6d6",
      }}
    >
      <Text style={{ fontSize: 13, color: dim ? C.dim : C.text }}>{label}</Text>
    </Pressable>
  );
}

// The explanation, and the only place a word enters the deck. Tapping a word is curiosity;
// pressing 學習中 is the commitment — the same rule the extension follows.
function Sheet({ item, marks, onMark, onExpand, onLookup, onClose }) {
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

      {/* Grow or shrink the selection a word at a time from either end. The matching words light
          up in the transcript above, so the range is visible where it actually lives rather than
          only as text in here. */}
      {item.range && (
        <View style={[S.row, { marginTop: 10 }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={[S.sub, { fontSize: 11 }]}>左</Text>
            <Handle label="◀" onPress={() => onExpand("L", 1)} />
            <Handle label="▶" onPress={() => onExpand("L", -1)} dim />
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Handle label="◀" onPress={() => onExpand("R", -1)} dim />
            <Handle label="▶" onPress={() => onExpand("R", 1)} />
            <Text style={[S.sub, { fontSize: 11 }]}>右</Text>
          </View>
        </View>
      )}

      <ScrollView style={{ marginTop: 10 }}>
        {item.pending ? (
          <Pressable style={[S.btn, S.primary, { marginVertical: 12 }]} onPress={onLookup}>
            <Text style={[S.btnText, S.primaryText]}>查詢「{item.word}」</Text>
          </Pressable>
        ) : !item.done ? (
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
            style={[S.btn, { flex: 1, paddingVertical: 10 }, how === k && S.primary, item.pending && { opacity: 0.4 }]}
            disabled={item.pending} // an unlooked-up phrase would enter the deck as an empty card
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
