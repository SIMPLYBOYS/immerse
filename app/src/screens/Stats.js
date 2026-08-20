const React = require("react");
const { useState, useMemo } = React;
const { View, Text, Pressable, ScrollView } = require("react-native");
const { C, S } = require("../theme");
const {
  dayKeys,
  dayKey,
  seriesOf,
  efficiencyOf,
  activeDaysOf,
  addedPerDay,
  topVideos,
  leeches,
  heatLevel,
  HEAT,
} = require("../logic");

const RANGES = [
  [7, "本週"],
  [30, "月"],
  [90, "季"],
];
const METRICS = [
  ["imm", "沉浸分鐘"],
  ["words", "新增詞彙"],
  ["rev", "複習次數"],
];
const HEAT_WEEKS = 17; // about four months — as much as a phone can show without pinching

function Stats({ deck }) {
  const [span, setSpan] = useState(30);
  const [metric, setMetric] = useState("imm");
  const now = Date.now();

  const view = useMemo(() => {
    const keys = dayKeys(span, now);
    const immLog = deck.immLog ?? {};
    const log = deck.log ?? {};
    const added = addedPerDay(deck.words, dayKey);
    const immSec = seriesOf(immLog, keys).reduce((a, b) => a + b, 0);
    const inRange = seriesOf(added, keys).reduce((a, b) => a + b, 0);
    const series =
      metric === "imm"
        ? seriesOf(immLog, keys).map((s) => Math.round(s / 60))
        : metric === "words"
          ? seriesOf(added, keys)
          : seriesOf(log, keys);
    return {
      keys,
      series,
      // null, not 0: "no immersion recorded" is unknown efficiency, not zero efficiency.
      eff: efficiencyOf(inRange, immSec),
      avgMin: Math.round(immSec / 60 / span),
      active: activeDaysOf(immLog, keys),
      videos: topVideos(deck.words, deck.immByVideo ?? {}, 5),
      stuck: leeches(deck.words, 3, 6),
    };
  }, [deck, span, metric, now]);

  const peak = Math.max(1, ...view.series);

  return (
    <ScrollView style={S.screen} contentContainerStyle={S.pad}>
      <Text style={S.h1}>數據分析</Text>
      <Text style={S.sub}>沉浸與複習的實際軌跡，資料由桌機與這台裝置共同累積。</Text>

      <View style={{ flexDirection: "row", gap: 8, marginTop: 14, marginBottom: 14 }}>
        {RANGES.map(([d, label]) => (
          <Pressable
            key={d}
            onPress={() => setSpan(d)}
            style={[S.btn, { paddingVertical: 7, paddingHorizontal: 16 }, span === d && S.primary]}
          >
            <Text style={[S.btnText, { fontSize: 13 }, span === d && S.primaryText]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={{ flexDirection: "row", gap: 10 }}>
        <Stat label="字／每小時沉浸" value={view.eff === null ? "—" : view.eff} />
        <Stat label="分鐘／每天平均" value={view.avgMin} />
        <Stat label="天有紀錄" value={view.active} />
      </View>

      <View style={S.card}>
        <View style={{ flexDirection: "row", gap: 6, marginBottom: 12 }}>
          {METRICS.map(([id, label]) => (
            <Pressable
              key={id}
              onPress={() => setMetric(id)}
              style={[S.btn, { paddingVertical: 6, paddingHorizontal: 10 }, metric === id && S.primary]}
            >
              <Text style={[S.btnText, { fontSize: 12 }, metric === id && S.primaryText]}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={{ flexDirection: "row", alignItems: "flex-end", height: 120, gap: 2 }}>
          {view.series.map((n, i) => (
            <View
              key={i}
              style={{
                flex: 1,
                height: Math.max(2, (n / peak) * 120),
                backgroundColor: n > 0 ? C.blue : C.line,
                borderRadius: 2,
              }}
            />
          ))}
        </View>
        <View style={[S.row, { marginTop: 6 }]}>
          <Text style={[S.sub, { fontSize: 11 }]}>{span} 天前</Text>
          <Text style={[S.sub, { fontSize: 11 }]}>峰值 {peak}</Text>
          <Text style={[S.sub, { fontSize: 11 }]}>今天</Text>
        </View>
      </View>

      <View style={S.card}>
        <Text style={S.label}>沉浸習慣</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12 }}>
          <Heat immLog={deck.immLog ?? {}} now={now} />
        </ScrollView>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 3, marginTop: 10 }}>
          <Text style={[S.sub, { fontSize: 10 }]}>少</Text>
          {HEAT.map((c) => (
            <View key={c} style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: c }} />
          ))}
          <Text style={[S.sub, { fontSize: 10 }]}>多</Text>
        </View>
      </View>

      <View style={S.card}>
        <Text style={S.label}>這些影片學最多</Text>
        {view.videos.length === 0 && <Text style={[S.sub, { marginTop: 8 }]}>還沒有資料。</Text>}
        {view.videos.map((g) => (
          <View key={g.id} style={{ marginTop: 12 }}>
            <Text style={{ fontSize: 13, fontWeight: "600", color: C.text }} numberOfLines={1}>
              {g.title}
            </Text>
            <View style={{ height: 5, borderRadius: 3, backgroundColor: "#eee", marginTop: 6 }}>
              <View
                style={{
                  height: 5,
                  borderRadius: 3,
                  backgroundColor: C.green,
                  width: `${(g.known / Math.max(1, g.total)) * 100}%`,
                }}
              />
            </View>
            <View style={[S.row, { marginTop: 4 }]}>
              <Text style={[S.sub, { fontSize: 11 }]}>
                {g.known} 已掌握 · {g.learning} 學習中
              </Text>
              <Text style={[S.sub, { fontSize: 11 }]}>
                {g.perHour === null ? "—" : `${g.perHour} 字/小時`}
              </Text>
            </View>
          </View>
        ))}
      </View>

      <View style={S.card}>
        <Text style={S.label}>⚠️ 頑固詞彙</Text>
        <Text style={[S.sub, { fontSize: 11, marginTop: 4 }]}>複習時反覆忘記的詞</Text>
        {view.stuck.length === 0 && (
          <Text style={[S.sub, { marginTop: 10 }]}>沒有反覆忘記的詞——維持得不錯。</Text>
        )}
        {view.stuck.map((w) => (
          <View
            key={w.id}
            style={[
              S.row,
              { backgroundColor: "#fff7ed", borderRadius: 8, padding: 9, marginTop: 8 },
            ]}
          >
            <Text style={{ fontSize: 13, color: C.text, flex: 1 }} numberOfLines={1}>
              {w.word}
            </Text>
            <Text style={{ fontSize: 11, color: C.amber }}>忘記 {w.lapses} 次</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function Stat({ label, value }) {
  return (
    <View style={[S.card, { flex: 1, padding: 12 }]}>
      <Text style={[S.big, { fontSize: 22 }]}>{value}</Text>
      <Text style={[S.sub, { fontSize: 10, marginTop: 2 }]}>{label}</Text>
    </View>
  );
}

// Columns are weeks, rows are weekdays — the shape everyone already reads at a glance. The grid
// starts on the Sunday of the first week so the rows line up with real weekdays.
function Heat({ immLog, now }) {
  const start = new Date(now - (HEAT_WEEKS * 7 - 1) * 86400000);
  start.setDate(start.getDate() - start.getDay());
  const weeks = [];
  for (let w = 0; w < HEAT_WEEKS; w++) {
    const col = [];
    for (let d = 0; d < 7; d++) {
      const t = start.getTime() + (w * 7 + d) * 86400000;
      col.push(t > now ? null : Math.round((immLog[dayKey(t)] ?? 0) / 60));
    }
    weeks.push(col);
  }
  return (
    <View style={{ flexDirection: "row", gap: 3 }}>
      {weeks.map((col, i) => (
        <View key={i} style={{ gap: 3 }}>
          {col.map((mins, d) => (
            <View
              key={d}
              style={{
                width: 11,
                height: 11,
                borderRadius: 2,
                backgroundColor: mins === null ? "transparent" : HEAT[heatLevel(mins)],
              }}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

module.exports = Stats;
