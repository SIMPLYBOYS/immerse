const React = require("react");
const { useState, useMemo } = React;
const { View, Text, TextInput, Pressable, FlatList, Linking } = require("react-native");
const { C, S } = require("../theme");
const { searchWords, filterWords, dueLabel, groupWords, dayKey } = require("../logic");

const FILTERS = [
  ["all", "全部"],
  ["learning", "學習中"],
  ["known", "已掌握"],
];

// The only screen that shows the words themselves rather than counts. A deck runs to hundreds of
// rows, so it is a FlatList over a pre-flattened array — a ScrollView holding every card would
// build all of them on every keystroke of the search box.
function Library({ deck, onStatus }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [openId, setOpenId] = useState(null);

  const rows = useMemo(() => {
    const shown = searchWords(filterWords(deck.words, status), q);
    const out = [];
    for (const g of groupWords(shown, dayKey)) {
      out.push({ type: "head", key: `h:${g.key}`, label: g.label, n: g.items.length });
      for (const w of g.items) out.push({ type: "word", key: w.id, w });
    }
    return out;
  }, [deck.words, status, q]);

  const shownCount = rows.filter((r) => r.type === "word").length;

  return (
    <View style={S.screen}>
      <View style={[S.pad, { paddingBottom: 8 }]}>
        <Text style={S.h1}>詞彙庫</Text>
        <Text style={S.sub}>
          共 {deck.words.length} 個詞彙
          {shownCount === deck.words.length ? "" : `，符合 ${shownCount} 個`}
        </Text>
        <TextInput
          style={[S.input, { marginTop: 12 }]}
          value={q}
          onChangeText={setQ}
          placeholder="搜尋單字、解釋、句子或影片…"
          placeholderTextColor="#bbb"
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
        <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
          {FILTERS.map(([id, label]) => (
            <Pressable
              key={id}
              onPress={() => setStatus(id)}
              style={[
                S.btn,
                { paddingVertical: 7, paddingHorizontal: 14 },
                status === id && S.primary,
              ]}
            >
              <Text style={[S.btnText, { fontSize: 13 }, status === id && S.primaryText]}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
        keyboardDismissMode="on-drag"
        ListEmptyComponent={<Text style={S.sub}>沒有符合的詞彙。</Text>}
        renderItem={({ item }) =>
          item.type === "head" ? (
            <View style={[S.row, { marginTop: 14, marginBottom: 6 }]}>
              <Text style={S.sub}>{item.label}</Text>
              <Text style={S.sub}>{item.n} 個詞彙</Text>
            </View>
          ) : (
            <Row
              w={item.w}
              open={openId === item.w.id}
              onToggle={() => setOpenId(openId === item.w.id ? null : item.w.id)}
              onStatus={onStatus}
            />
          )
        }
      />
    </View>
  );
}

function Row({ w, open, onToggle, onStatus }) {
  const url = w.videoId ? `https://youtu.be/${w.videoId}?t=${Math.floor(w.t ?? 0)}` : null;
  return (
    <Pressable onPress={onToggle} style={[S.card, { marginBottom: 8, padding: 14 }]}>
      <View style={S.row}>
        <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
          <View
            style={{
              width: 16,
              height: 16,
              borderRadius: 8,
              borderWidth: 2,
              marginRight: 10,
              borderColor: w.suspended ? C.green : "#e5a33d",
              backgroundColor: w.suspended ? "#e9f7ee" : "transparent",
            }}
          />
          <Text style={{ fontSize: 15, fontWeight: "600", color: C.text, flexShrink: 1 }}>
            {w.word}
          </Text>
        </View>
        <Text style={[S.sub, { fontSize: 11 }]}>{dueLabel(w)}</Text>
      </View>

      {(w.contextZh || w.context) && (
        <Text style={[S.sub, { marginTop: 6, color: "#555" }]} numberOfLines={open ? 0 : 2}>
          {w.contextZh || w.context}
        </Text>
      )}

      {open && (
        <View style={{ marginTop: 10 }}>
          {w.contextZh && w.context ? (
            <Text style={[S.sub, { fontSize: 12 }]}>{w.context}</Text>
          ) : null}
          {(w.senses ?? []).map((s, i) => (
            <View
              key={i}
              style={{ borderLeftWidth: 2, borderLeftColor: C.line, paddingLeft: 10, marginTop: 10 }}
            >
              <Text style={{ fontSize: 10, color: "#ff7ab6", textTransform: "uppercase" }}>
                {s.pos}
              </Text>
              <Text style={{ fontSize: 14, color: C.text, marginTop: 2 }}>{s.gloss}</Text>
              {s.example ? <Text style={[S.sub, { fontSize: 12, marginTop: 3 }]}>{s.example}</Text> : null}
              {s.zh ? <Text style={[S.sub, { fontSize: 12 }]}>{s.zh}</Text> : null}
            </View>
          ))}
          {w.sentence ? (
            <Text style={[S.sub, { fontSize: 12, fontStyle: "italic", marginTop: 10 }]}>
              「{w.sentence}」
            </Text>
          ) : null}
          {url && (
            <Pressable onPress={() => Linking.openURL(url)} style={{ marginTop: 8 }}>
              <Text style={{ color: C.blue, fontSize: 12 }} numberOfLines={1}>
                ▶ {w.title || w.videoId}
              </Text>
            </Pressable>
          )}

          <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
            {[
              ["learning", "學習中"],
              ["known", "已掌握"],
            ].map(([how, label]) => {
              const on = (w.suspended ? "known" : "learning") === how;
              return (
                <Pressable
                  key={how}
                  onPress={() => onStatus(w, how)}
                  style={[S.btn, { flex: 1, paddingVertical: 8 }, on && S.primary]}
                >
                  <Text style={[S.btnText, { fontSize: 13 }, on && S.primaryText]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
          {/* ponytail: no delete here. Removing a word needs a tombstone to survive the merge,
              and an irreversible tap on a phone is a poor trade for a cleanup that the desktop
              does better — 單字負債 lives there. Demoting to 學習中 or 已掌握 covers the rest. */}
        </View>
      )}
    </Pressable>
  );
}

module.exports = Library;
