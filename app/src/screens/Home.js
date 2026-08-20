const React = require("react");
const { View, Text, Pressable, ScrollView } = require("react-native");
const { C, S } = require("../theme");
const { stats, forecast, streakOf, todayMins, dayKey, GOAL_MIN } = require("../logic");

// The dashboard, reduced to what is worth reading on a phone before a commute: how much is due,
// whether the habit is alive, and one button. The full analytics live on the desktop, where there
// is room for them.
function Home({ deck, onStart, busy, error, onRetry }) {
  const now = Date.now();
  const s = stats(deck.words, now);
  const days = forecast(deck.words, now);
  const peak = Math.max(1, ...days);
  const mins = todayMins(deck.immLog ?? {}, now);
  const reviewStreak = streakOf(deck.log ?? {}, now);
  const doneToday = (deck.log ?? {})[dayKey(now)] ?? 0;

  if (error) {
    return (
      <ScrollView style={S.screen} contentContainerStyle={S.pad}>
        <Text style={S.h1}>連不上雲端</Text>
        <Text style={[S.sub, { marginTop: 8, lineHeight: 20 }]}>{error}</Text>
        <Pressable style={[S.btn, { marginTop: 16 }]} onPress={onRetry}>
          <Text style={S.btnText}>重試</Text>
        </Pressable>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={S.screen} contentContainerStyle={S.pad}>
      <Text style={S.h1}>記憶固化</Text>
      <Text style={S.sub}>
        {s.due ? `今天有 ${s.due} 個詞彙需要複習` : deck.words.length ? "今天沒有待複習的詞彙" : "詞彙庫是空的"}
      </Text>

      <View style={[S.card, { marginTop: 16, borderColor: C.blue, borderWidth: 2 }]}>
        <View style={S.row}>
          <Text style={[S.label, { color: C.blue }]}>今日</Text>
          <Text style={S.label}>🔥 連續複習 {reviewStreak} 天</Text>
        </View>
        <View style={[S.row, { marginTop: 10, alignItems: "flex-end" }]}>
          <View>
            <Text style={S.big}>{doneToday}</Text>
            <Text style={S.sub}>已複習詞彙</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={[S.big, { fontSize: 20, color: C.dim }]}>
              {mins} / {GOAL_MIN}
            </Text>
            <Text style={S.sub}>今日沉浸分鐘（桌機記錄）</Text>
          </View>
        </View>
      </View>

      <Pressable
        style={[S.btn, s.due ? S.primary : { opacity: 0.5 }, { marginBottom: 16 }]}
        onPress={onStart}
        disabled={!s.due || busy}
      >
        <Text style={[S.btnText, s.due && S.primaryText, { fontSize: 16 }]}>
          {s.due ? `開始複習 (${s.due})` : "今天沒有待複習"}
        </Text>
      </Pressable>

      <View style={S.card}>
        <Text style={S.label}>⚡ 記憶效能</Text>
        <View style={[S.row, { marginTop: 10 }]}>
          <View>
            <Text style={S.big}>{s.predicted === null ? "—" : `${s.predicted}%`}</Text>
            <Text style={S.sub}>預測記憶率</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={[S.big, { fontSize: 20 }]}>{s.correct === null ? "—" : `${s.correct}%`}</Text>
            <Text style={S.sub}>歷史答對率</Text>
          </View>
        </View>
        <View style={[S.row, { marginTop: 14 }]}>
          <Text style={S.sub}>學習中 {s.learning}</Text>
          <Text style={S.sub}>已掌握 {s.known}</Text>
          <Text style={S.sub}>總計 {s.learning + s.known}</Text>
        </View>
      </View>

      <View style={S.card}>
        <Text style={S.label}>🌱 未來五天</Text>
        <View style={{ flexDirection: "row", alignItems: "flex-end", height: 84, marginTop: 12 }}>
          {days.map((n, i) => (
            <View key={i} style={{ flex: 1, alignItems: "center" }}>
              <Text style={[S.sub, { fontSize: 11 }]}>{n || ""}</Text>
              <View
                style={{
                  width: "70%",
                  height: Math.max(2, (n / peak) * 52),
                  backgroundColor: C.green,
                  borderRadius: 3,
                  marginTop: 4,
                }}
              />
              <Text style={[S.sub, { fontSize: 11, marginTop: 4 }]}>
                {"日一二三四五六"[new Date(now + (i + 1) * 86400000).getDay()]}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

module.exports = Home;
