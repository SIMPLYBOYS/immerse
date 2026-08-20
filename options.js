// USD per million tokens, keyed by model id. If bg.js switches model and this table doesn't know
// the new one, the UI says so rather than quoting a stale price at you.
const PRICES = { "claude-haiku-4-5": { in: 1.0, out: 5.0 } };

const totals = (usage) =>
  Object.values(usage?.kinds ?? {}).reduce(
    (a, t) => ({ calls: a.calls + t.calls, in: a.in + t.in, out: a.out + t.out }),
    { calls: 0, in: 0, out: 0 },
  );

// null means "no price on file for this model" — not "free".
function costOf(tokens, model) {
  const p = PRICES[model];
  return p ? (tokens.in / 1e6) * p.in + (tokens.out / 1e6) * p.out : null;
}

const money = (n) => (n === null ? "—" : n < 0.01 ? `< $0.01` : `$${n.toFixed(2)}`);

// One quoting rule, applied to every cell: wrap in quotes, double any quote inside. That covers
// the commas, quotes and newlines that turn up in AI explanations and would otherwise shift every
// later column by one.
const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(",")).join("\n");

const rowsFor = (words) =>
  words.map((w) => [
    w.word,
    w.contextZh ?? "",
    w.context ?? "",
    (w.senses ?? []).map((s) => `${s.pos} ${s.gloss}｜${s.example ?? ""}｜${s.zh ?? ""}`).join("\n"),
    w.sentence ?? "",
    // Deep link straight back to the moment it was said — the reason to review in context.
    w.videoId ? `https://youtu.be/${w.videoId}?t=${Math.floor(w.t ?? 0)}` : "",
  ]);

function wire() {
  const key = document.getElementById("key");
  const msg = document.getElementById("msg");
  const count = document.getElementById("count");

  const LABEL = { explain: "點字解釋", phrases: "片語掃描", pos: "詞性標註" };

  function paintUsage(usage = {}) {
    const rows = Object.entries(usage.kinds ?? {});
    const sum = totals(usage);
    document.getElementById("model").textContent = usage.model ?? "—";
    document.getElementById("since").textContent = usage.since
      ? new Date(usage.since).toLocaleDateString()
      : "—";
    const body = document.getElementById("usage");
    body.replaceChildren(
      ...rows.map(([kind, t]) => {
        const tr = document.createElement("tr");
        for (const v of [
          LABEL[kind] ?? kind,
          t.calls,
          t.in.toLocaleString(),
          t.out.toLocaleString(),
          money(costOf(t, usage.model)),
        ]) {
          const td = document.createElement("td");
          td.textContent = v;
          tr.appendChild(td);
        }
        return tr;
      }),
    );
    const tr = document.createElement("tr");
    tr.className = "sum";
    for (const v of [
      "合計",
      sum.calls,
      sum.in.toLocaleString(),
      sum.out.toLocaleString(),
      money(costOf(sum, usage.model)),
    ]) {
      const td = document.createElement("td");
      td.textContent = v;
      tr.appendChild(td);
    }
    if (rows.length) body.appendChild(tr);
    document.getElementById("nomodel").hidden = !usage.model || !!PRICES[usage.model];
  }

  chrome.storage.local.get(["apiKey", "words", "usage"]).then(({ apiKey, words = [], usage }) => {
    if (apiKey) key.placeholder = `saved (…${apiKey.slice(-4)}) — type a new one to replace`;
    count.textContent = `${words.length} saved`;
    paintUsage(usage);
  });

  document.getElementById("resetUsage").addEventListener("click", async () => {
    await chrome.storage.local.remove("usage");
    paintUsage({});
  });

  document.getElementById("f").addEventListener("submit", async (e) => {
    e.preventDefault();
    const value = clean(key.value);
    if (!value) return (msg.textContent = "enter a key first"); // don't wipe a saved key
    await chrome.storage.local.set({ apiKey: value });
    key.value = "";
    key.placeholder = `saved (…${value.slice(-4)}) — type a new one to replace`;
    msg.textContent = "saved";
    setTimeout(() => (msg.textContent = ""), 1500);
  });

  // --- cloud sync (GitHub) ---
  const ghRepo = document.getElementById("ghRepo");
  const ghToken = document.getElementById("ghToken");
  const ghMsg = document.getElementById("ghMsg");
  chrome.storage.local.get(["ghRepo", "ghToken"]).then((r) => {
    if (r.ghRepo) ghRepo.value = r.ghRepo;
    if (r.ghToken) ghToken.placeholder = `saved (…${r.ghToken.slice(-4)}) — type a new one to replace`;
  });
  // Whitespace anywhere, not just at the ends: a credential copied out of a wrapped line carries
  // a newline in its middle, which trim() leaves in place and the HTTP layer later rejects with
  // "Unexpected char 0x0d in authorization value" — a failure that reads like a bad token.
  const clean = (x) => String(x ?? "").replace(/\s+/g, "");
  document.getElementById("gh").addEventListener("submit", async (e) => {
    e.preventDefault();
    const patch = {};
    if (clean(ghRepo.value)) patch.ghRepo = clean(ghRepo.value);
    if (clean(ghToken.value)) patch.ghToken = clean(ghToken.value); // empty must not wipe a saved token
    if (!Object.keys(patch).length) return (ghMsg.textContent = "先填 repo 或 token");
    await chrome.storage.local.set(patch);
    if (patch.ghToken) {
      ghToken.value = "";
      ghToken.placeholder = `saved (…${patch.ghToken.slice(-4)}) — type a new one to replace`;
    }
    ghMsg.textContent = "saved";
    setTimeout(() => (ghMsg.textContent = ""), 1500);
  });

  const sMsg = document.getElementById("syncStatus");
  const send = (type) => new Promise((ok) => chrome.runtime.sendMessage({ type }, ok));
  function paintSync(sync = {}) {
    const when = sync.lastPush ? new Date(sync.lastPush).toLocaleString() : "—";
    sMsg.textContent = sync.on
      ? `已連結，上次上傳：${when}${sync.lastError ? `（上次錯誤：${sync.lastError}）` : ""}`
      : sync.lastError
        ? `未啟用（${sync.lastError}）`
        : "未連結。";
    document.getElementById("syncConnect").hidden = !!sync.on;
    for (const id of ["syncNow", "syncRestore", "syncOff"])
      document.getElementById(id).hidden = !sync.on;
  }
  chrome.storage.local.get("sync").then(({ sync }) => paintSync(sync));
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === "local" && ch.sync) paintSync(ch.sync.newValue);
  });
  document.getElementById("syncConnect").addEventListener("click", async () => {
    sMsg.textContent = "連結中…";
    const r = await send("sync-connect");
    if (!r?.ok) sMsg.textContent = `連結失敗：${r?.error ?? "未知錯誤"}`;
  });
  document.getElementById("syncNow").addEventListener("click", () => send("sync-now"));
  document.getElementById("syncRestore").addEventListener("click", async () => {
    // Restore overwrites local data — the one destructive act on this page, so it asks first.
    if (!confirm("用雲端的 deck 覆蓋本機資料？本機未上傳的變更會遺失。")) return;
    const r = await send("sync-restore");
    if (!r?.ok) sMsg.textContent = `還原失敗：${r?.error ?? "未知錯誤"}`;
  });
  document.getElementById("syncOff").addEventListener("click", () => send("sync-off"));

  document.getElementById("export").addEventListener("click", async () => {
    const { words = [] } = await chrome.storage.local.get("words");
    if (!words.length) return (count.textContent = "nothing saved yet");
    // ﻿ so Excel reads it as UTF-8; Anki is fine either way.
    const blob = new Blob(["﻿" + toCsv(rowsFor(words))], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `immerse-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
}

if (typeof document !== "undefined") wire();
if (typeof module !== "undefined") module.exports = { toCsv, rowsFor, totals, costOf, money };
