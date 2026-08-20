const React = require("react");
const { useState } = React;
const { View, Text, Pressable, ScrollView, Linking, Switch } = require("react-native");
const { C, S } = require("../theme");
const { markTarget } = require("../logic");

const mmss = (t) =>
  t == null ? "" : `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

// One card. Deliberately the same shape as the desktop card: the sentence does the retrieving,
// the headword can be blanked, and the answer only appears when asked for. Nothing here decides
// scheduling — grading is handed up so the curve stays in the shared review.js.
function Card({ card, index, total, mastered, recall, onRecall, onGrade, onMaster, onSkip, onQuit }) {
  const [shown, setShown] = useState(false);
  const [zh, setZh] = useState(false);
  const url = card.videoId
    ? `https://youtu.be/${card.videoId}?t=${Math.floor(card.t ?? 0)}`
    : null;

  return (
    <View style={S.screen}>
      <ScrollView contentContainerStyle={[S.pad, { paddingBottom: 24 }]}>
        <View style={S.row}>
          <Text style={[S.sub, { flex: 1 }]} numberOfLines={1}>
            {card.title ?? card.videoId ?? ""} {card.t != null ? mmss(card.t) : ""}
          </Text>
          <Pressable onPress={onQuit} hitSlop={12}>
            <Text style={[S.sub, { fontSize: 15 }]}>✕</Text>
          </Pressable>
        </View>

        <View style={[S.row, { marginTop: 8 }]}>
          <Text style={S.sub}>
            {index + 1} / {total}
          </Text>
          {mastered > 0 && (
            <Text
              style={{
                fontSize: 12,
                color: C.greenDark,
                backgroundColor: "#e9f7ee",
                borderRadius: 999,
                paddingHorizontal: 10,
                paddingVertical: 3,
              }}
            >
              ✓ 已掌握 +{mastered}
            </Text>
          )}
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text style={[S.sub, { marginRight: 6 }]}>主動回憶</Text>
            <Switch value={recall} onValueChange={onRecall} />
          </View>
        </View>

        <Text style={{ fontSize: 32, fontWeight: "700", textAlign: "center", marginTop: 32, color: C.text }}>
          {recall && !shown ? "____" : card.word}
        </Text>

        <Text style={{ fontSize: 17, lineHeight: 30, textAlign: "center", marginTop: 24, color: "#444" }}>
          {markTarget(card.sentence ?? "", card.word).map((r, i) =>
            r.hit ? (
              <Text
                key={i}
                style={{ color: C.blue, fontWeight: "600", backgroundColor: "#e8efff" }}
              >
                {r.text}
              </Text>
            ) : (
              <Text key={i}>{r.text}</Text>
            ),
          )}
        </Text>

        {card.zh ? (
          zh ? (
            <Text style={[S.sub, { textAlign: "center", marginTop: 14, fontSize: 15 }]}>{card.zh}</Text>
          ) : (
            <Pressable onPress={() => setZh(true)} style={{ marginTop: 14 }}>
              <Text style={[S.sub, { textAlign: "center", textDecorationLine: "underline" }]}>
                顯示翻譯
              </Text>
            </Pressable>
          )
        ) : null}

        {shown && (
          <View style={{ marginTop: 24, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 18 }}>
            {card.contextZh ? <Text style={{ fontSize: 16, color: C.text, lineHeight: 24 }}>{card.contextZh}</Text> : null}
            {card.context ? (
              <Text style={[S.sub, { marginTop: 8, lineHeight: 20 }]}>{card.context}</Text>
            ) : null}
            {(card.senses ?? []).map((s, i) => (
              <View key={i} style={{ borderLeftWidth: 2, borderLeftColor: C.line, paddingLeft: 10, marginTop: 14 }}>
                <Text style={{ fontSize: 11, color: "#ff7ab6", textTransform: "uppercase" }}>{s.pos}</Text>
                <Text style={{ fontSize: 15, color: C.text, marginTop: 2 }}>{s.gloss}</Text>
                {s.example ? <Text style={[S.sub, { marginTop: 4 }]}>{s.example}</Text> : null}
                {s.zh ? <Text style={[S.sub, { fontSize: 12 }]}>{s.zh}</Text> : null}
              </View>
            ))}
            {url && (
              <Pressable onPress={() => Linking.openURL(url)} style={{ marginTop: 16 }}>
                <Text style={{ color: C.blue, fontSize: 14 }}>▶ 回到影片那一刻</Text>
              </Pressable>
            )}
          </View>
        )}
      </ScrollView>

      <View style={{ padding: 16, borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.card }}>
        {!shown ? (
          <Pressable style={[S.btn, S.primary]} onPress={() => setShown(true)}>
            <Text style={[S.btnText, S.primaryText]}>顯示解釋</Text>
          </Pressable>
        ) : (
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Pressable
              style={[S.btn, { flex: 1, borderColor: "#eccac4" }]}
              onPress={() => onGrade(0)}
            >
              <Text style={[S.btnText, { color: C.red }]}>再來一次</Text>
            </Pressable>
            <Pressable style={[S.btn, { flex: 1 }]} onPress={() => onGrade(4)}>
              <Text style={S.btnText}>記住了</Text>
            </Pressable>
          </View>
        )}
        <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
          <Pressable style={[S.btn, { flex: 1, borderColor: "#cde5d5", paddingVertical: 9 }]} onPress={onMaster}>
            <Text style={[S.btnText, { color: C.greenDark, fontSize: 13 }]}>已掌握</Text>
          </Pressable>
          <Pressable style={[S.btn, { flex: 1, paddingVertical: 9 }]} onPress={onSkip}>
            <Text style={[S.btnText, { color: C.dim, fontSize: 13 }]}>跳過</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

module.exports = Card;
