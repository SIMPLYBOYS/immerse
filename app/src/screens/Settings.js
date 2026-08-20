const React = require("react");
const { useState } = React;
const { View, Text, TextInput, Pressable, ScrollView, Switch } = require("react-native");
const { C, S } = require("../theme");
const { saveSettings, saveReminder } = require("../store");
const { enableDaily, disableDaily } = require("../notify");
const { testAccess } = require("../cloud");

const hh = (h) => `${String(h).padStart(2, "0")}:00`;

// The whole configuration surface: which private repo holds the deck, and a token that may touch
// only that repo. Setup lives in docs/github-sync.md; this screen deliberately explains the same
// thing in two lines rather than assuming the doc was read on a phone.
function Settings({ cfg, onSaved, onSync, status, busy }) {
  const [repo, setRepo] = useState(cfg.repo ?? "");
  const [token, setToken] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [msg, setMsg] = useState("");
  const [on, setOn] = useState(cfg.remind != null);
  const [hour, setHour] = useState(cfg.remind ?? 21);
  const [nmsg, setNmsg] = useState("");
  const [tmsg, setTmsg] = useState("");

  // The OS owns the schedule, so every change re-arms it from scratch rather than trusting that
  // what we asked for last time is still there.
  const applyReminder = async (nextOn, nextHour) => {
    setOn(nextOn);
    setHour(nextHour);
    if (!nextOn) {
      const off = await disableDaily();
      await saveReminder(null);
      return setNmsg(off.ok ? "已關閉" : off.error);
    }
    const r = await enableDaily(nextHour);
    if (!r.ok) {
      setOn(false);
      return setNmsg(r.error);
    }
    await saveReminder(nextHour);
    setNmsg(`每天 ${hh(nextHour)} 提醒`);
  };

  const save = async () => {
    if (!repo.trim()) return setMsg("先填 repo");
    await saveSettings({ repo, token, apiKey });
    // Never keep a credential in component state longer than the save takes.
    setToken("");
    setApiKey("");
    setMsg("已儲存");
    // Same cleaning as the store, or this session would keep using the raw pasted value.
    const clean = (x) => String(x ?? "").replace(/\s+/g, "");
    onSaved({
      ...cfg,
      repo: clean(repo),
      ...(clean(token) ? { token: clean(token) } : {}),
      ...(clean(apiKey) ? { apiKey: clean(apiKey) } : {}),
    });
  };

  return (
    <ScrollView style={S.screen} contentContainerStyle={S.pad}>
      <Text style={S.h1}>設定</Text>
      <Text style={S.sub}>詞彙庫存在你自己的 private repo，這台裝置只寫自己的檔案。</Text>

      <View style={[S.card, { marginTop: 16 }]}>
        <Text style={S.label}>Private repo</Text>
        <TextInput
          style={[S.input, { marginTop: 6 }]}
          value={repo}
          onChangeText={setRepo}
          placeholder="SIMPLYBOYS/immerse-data"
          placeholderTextColor="#bbb"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Text style={[S.label, { marginTop: 14 }]}>
          Fine-grained token（只需該 repo 的 Contents 讀寫）
        </Text>
        <TextInput
          style={[S.input, { marginTop: 6 }]}
          value={token}
          onChangeText={setToken}
          placeholder={cfg.token ? "已儲存 — 輸入新的才會取代" : "github_pat_..."}
          placeholderTextColor="#bbb"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />

        <Text style={[S.label, { marginTop: 14 }]}>Anthropic API key（沉浸時點字解釋用）</Text>
        <TextInput
          style={[S.input, { marginTop: 6 }]}
          value={apiKey}
          onChangeText={setApiKey}
          placeholder={cfg.apiKey ? "已儲存 — 輸入新的才會取代" : "sk-ant-..."}
          placeholderTextColor="#bbb"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />

        <Pressable style={[S.btn, S.primary, { marginTop: 14 }]} onPress={save}>
          <Text style={[S.btnText, S.primaryText]}>儲存</Text>
        </Pressable>
        <Pressable
          style={[S.btn, { marginTop: 8 }]}
          onPress={async () => {
            setTmsg("測試中…");
            // The saved values, not what is typed — the boxes are blank on every visit, and the
            // question being asked is whether what is STORED works.
            const r = await testAccess(repo.trim() || cfg.repo, cfg.token);
            setTmsg(r.msg);
          }}
        >
          <Text style={S.btnText}>測試連線</Text>
        </Pressable>
        {msg ? <Text style={[S.sub, { marginTop: 8 }]}>{msg}</Text> : null}
        {tmsg ? <Text style={[S.sub, { marginTop: 6, lineHeight: 18 }]}>{tmsg}</Text> : null}
        <Text style={[S.sub, { marginTop: 6, fontSize: 11 }]}>
          目前存的 token：{cfg.token ? `…${String(cfg.token).slice(-6)}` : "（無）"}
        </Text>
      </View>

      <View style={S.card}>
        <View style={S.row}>
          <Text style={S.label}>每日複習提醒</Text>
          <Switch value={on} onValueChange={(v) => applyReminder(v, hour)} />
        </View>
        {on && (
          <View style={[S.row, { marginTop: 12 }]}>
            <Pressable
              style={[S.btn, { paddingVertical: 8, paddingHorizontal: 18 }]}
              onPress={() => applyReminder(true, (hour + 23) % 24)}
            >
              <Text style={S.btnText}>◀</Text>
            </Pressable>
            <Text style={[S.big, { fontSize: 26 }]}>{hh(hour)}</Text>
            <Pressable
              style={[S.btn, { paddingVertical: 8, paddingHorizontal: 18 }]}
              onPress={() => applyReminder(true, (hour + 1) % 24)}
            >
              <Text style={S.btnText}>▶</Text>
            </Pressable>
          </View>
        )}
        <Text style={[S.sub, { marginTop: 10, lineHeight: 18 }]}>
          {nmsg ? `${nmsg}\n` : ""}
          晚上提醒最合拍：到期時間本來就貼齊凌晨 4 點的日界，複習完睡一覺正是這條曲線假設的節奏。
        </Text>
      </View>

      <View style={S.card}>
        <Text style={S.label}>同步</Text>
        <Text style={[S.sub, { marginTop: 6 }]}>{status}</Text>
        <Pressable
          style={[S.btn, { marginTop: 12 }, busy && { opacity: 0.5 }]}
          onPress={onSync}
          disabled={busy}
        >
          <Text style={S.btnText}>{busy ? "同步中…" : "重新從雲端載入"}</Text>
        </Pressable>
        <Text style={[S.sub, { marginTop: 10, lineHeight: 18 }]}>
          這台裝置的檔名：deck-app-{cfg.deviceId}.json{"\n"}
          複習結果會在離開複習或切到背景時上傳，一場一個 commit。
        </Text>
      </View>
    </ScrollView>
  );
}

module.exports = Settings;
