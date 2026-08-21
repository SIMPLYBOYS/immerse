importScripts("merge.js", "prompts.js"); // kept separate so node — and the phone app — can load them

// All network calls live here: a service worker with host_permissions is exempt from CORS,
// a content script is not. Set the key in the options page, or setKey("sk-ant-...") from here.

globalThis.setKey = (apiKey) => chrome.storage.local.set({ apiKey });

// Toolbar icon opens the review page — the one screen that isn't tied to a video.
chrome.action.onClicked.addListener(() =>
  chrome.tabs.create({ url: chrome.runtime.getURL("review.html") }),
);

const JOBS = {
  phrases: (m) => claude(PHRASE_SYSTEM, m.text, 1000, "phrases"),
  pos: (m) => claude(POS_SYSTEM, m.text, 4000, "pos"),
  // Sync messages from the options page. Interactive token on the button paths: it only pops an
  // auth window on first grant and is silent forever after.
  "sync-connect": () => syncNow(true),
  "sync-now": () => syncNow(true),
  "sync-restore": () => restore(),
  "sync-off": () => setSync({ on: false }).then(() => ({ ok: true })),
  // The immersion clock is one counter that several tabs increment at once. A content script
  // doing its own read-modify-write meant two tabs flushing together read the same total and
  // wrote it back twice, losing one tab's seconds every 15s. The worker owns it now, and chains
  // the writes so its own concurrent callers cannot race either.
  imm: (m) => addImmersion(m),
  "tx-save": (m) => saveTx(m.tx),
};

// Each link resolves whatever happens. `chain.then(fn)` on a REJECTED promise never runs fn and
// hands back the same old rejection forever, so a single failed write — a quota error, a worker
// torn down mid-write — would silently stop the clock for good rather than for one flush. That
// is exactly how this counter died once already.
let immChain = Promise.resolve();
const addImmersion = (m) =>
  (immChain = immChain.then(async () => {
    try {
      const delta = Number(m.delta) || 0;
      if (delta <= 0) return { ok: true };
      const r = await chrome.storage.local.get(["immersion", "immLog", "immByVideo"]);
      const immLog = r.immLog ?? {};
      const immByVideo = r.immByVideo ?? {};
      immLog[m.day] = (immLog[m.day] ?? 0) + delta;
      // Per-video too, so "words per hour" can be answered for one video and not just overall.
      if (m.videoId) immByVideo[m.videoId] = (immByVideo[m.videoId] ?? 0) + delta;
      await chrome.storage.local.set({ immersion: (r.immersion ?? 0) + delta, immLog, immByVideo });
      return { ok: true };
    } catch (e) {
      console.warn("[immerse] immersion flush failed", e);
      return { ok: false, error: String(e?.message ?? e) };
    }
  }));

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  const job =
    JOBS[msg.type]?.(msg) ??
    claude(SYSTEM, `Sentence: ${msg.sentence}\nWord: ${msg.word}`, 700, "explain");
  job
    .then((r) => respond(typeof r === "string" ? { text: r } : r))
    .catch((e) => respond({ error: String(e.message || e) }));
  return true; // keep the channel open for the async respond
});

// ---- cloud sync (GitHub active / Google Drive dormant) ------------------------------------------
// Learning data only — the API key and the sync token never leave the machine. Each device owns
// one file and writes nothing else, so a conflict is not resolved but structurally impossible;
// merge.js folds the files on the way in. Upload is automatic (30s after a change settles) and
// download every five minutes, so two devices converge without anyone pressing anything.
const SYNC_KEYS = ["words", "marks", "log", "immLog", "immByVideo", "immersion", "deleted"];
const SYNC_FILE = "immerse-deck.json";

const token = (interactive) =>
  new Promise((ok, no) =>
    chrome.identity.getAuthToken({ interactive }, (t) =>
      chrome.runtime.lastError || !t
        ? no(new Error(chrome.runtime.lastError?.message ?? "拿不到授權"))
        : ok(t),
    ),
  );

async function drive(path, { method = "GET", body, type, tok } = {}) {
  const r = await fetch(`https://www.googleapis.com${path}`, {
    method,
    headers: { authorization: `Bearer ${tok}`, ...(type ? { "content-type": type } : {}) },
    body,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error?.message ?? `HTTP ${r.status}`);
  return data;
}

// drive.file scope only sees files this app created, so a name search cannot hit anything else.
async function fileId(tok) {
  const { sync = {} } = await chrome.storage.local.get("sync");
  if (sync.fileId) return sync.fileId;
  const q = encodeURIComponent(`name='${SYNC_FILE}' and trashed=false`);
  const found = await drive(`/drive/v3/files?q=${q}&fields=files(id)`, { tok });
  if (found.files?.[0]) return found.files[0].id;
  const made = await drive("/drive/v3/files", {
    method: "POST",
    type: "application/json",
    tok,
    body: JSON.stringify({ name: SYNC_FILE }),
  });
  return made.id;
}

async function setSync(patch) {
  const { sync = {} } = await chrome.storage.local.get("sync");
  await chrome.storage.local.set({ sync: { ...sync, ...patch } });
}

// Two interchangeable backends behind one switch. GitHub is active because GCP's console blocked
// the Drive consent-screen setup at every turn; the Drive path is finished and tested — flip
// BACKEND to "drive" (and finish docs/drive-sync.md's setup) to return to it.
const BACKEND = "github";
const syncNow = (interactive = false) =>
  BACKEND === "drive" ? drivePush(interactive) : ghPush(interactive);
const restore = () => (BACKEND === "drive" ? driveRestore() : ghRestore());

const snapshot = async () => {
  const data = await chrome.storage.local.get(SYNC_KEYS);
  data.deleted = pruneDeleted(data.deleted);
  return JSON.stringify({ v: 2, at: Date.now(), dev: await deviceId(), ...data });
};

// Rows only. The counters in a folded snapshot are everyone's added together, and these keys are
// exactly what this device pushes as ITS OWN contribution — writing the merged total here would
// hand back every other device's minutes as if we had watched them, and the error would double on
// every sync rather than settle. Other devices' tallies live in `cloud`, added only for display.
const applyRows = async (snap) => {
  if (!Array.isArray(snap.words)) throw new Error("雲端檔案裡沒有 deck");
  await chrome.storage.local.set({
    words: snap.words,
    marks: snap.marks ?? {},
    deleted: snap.deleted ?? {},
  });
  return snap.words.length;
};

async function drivePush(interactive = false) {
  try {
    const { sync = {} } = await chrome.storage.local.get("sync");
    if (!sync.on && !interactive) return { ok: false }; // never auto-run before the user opts in
    const tok = await token(interactive);
    const id = await fileId(tok);
    await drive(`/upload/drive/v3/files/${id}?uploadType=media`, {
      method: "PATCH",
      type: "application/json",
      tok,
      body: await snapshot(),
    });
    await setSync({ on: true, fileId: id, lastPush: Date.now(), lastError: null });
    return { ok: true };
  } catch (e) {
    await setSync({ lastError: String(e.message ?? e) });
    return { ok: false, error: String(e.message ?? e) };
  }
}

async function driveRestore() {
  try {
    const tok = await token(true);
    const id = await fileId(tok);
    const snap = await drive(`/drive/v3/files/${id}?alt=media`, { tok });
    const n = await applyRows(snap);
    await setSync({ on: true, fileId: id, lastError: null });
    return { ok: true, words: n };
  } catch (e) {
    return { ok: false, error: String(e.message ?? e) };
  }
}

// ---- GitHub backend ------------------------------------------------------------------------
// A private repo + fine-grained PAT (Contents read/write on that one repo). No OAuth consent
// screen, no GCP — and every upload is a commit, so the deck gets version history for free.
// The token, like the API key, lives only in local storage and is never part of the snapshot.
// One file per device, folded together on read: a device only ever writes its own file, so two
// writers can never overwrite each other and no locking or conflict resolution is needed on the
// way out. `immerse-deck.json` from the single-writer era does not match this pattern and is left
// alone as a backup — folding it in would double-count its counters against this device's file.
const GH_FILE = async () => `deck-${await deviceId()}.json`;
const DECK_RE = /^deck-.+\.json$/;

async function deviceId() {
  const { deviceId: id } = await chrome.storage.local.get("deviceId");
  if (id) return id;
  const made = `ext-${crypto.randomUUID().slice(0, 8)}`;
  await chrome.storage.local.set({ deviceId: made });
  return made;
}

const ghCfg = async () => {
  const { ghToken, ghRepo } = await chrome.storage.local.get(["ghToken", "ghRepo"]);
  if (!ghToken || !ghRepo) throw new Error("先在選項頁填 GitHub repo 與 token");
  return { ghToken, ghRepo };
};

// btoa is latin1-only; the deck is full of Chinese. Bytes first, then chunked to stay under
// the argument-spread limit.
const b64 = (s) => {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

async function gh(path, { method = "GET", body, token: t } = {}) {
  const r = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${t}`,
      accept: "application/vnd.github+json",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body,
  });
  if (r.status === 404) return null;
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.message ?? `HTTP ${r.status}`);
  return data;
}

// The file's current sha, from the ROOT DIRECTORY listing — never from GET-file, whose JSON form
// errors once the file passes 1MB. null when the repo is empty or the file doesn't exist yet.
const ghList = async (repo, t) => (await gh(`/repos/${repo}/contents/`, { token: t })) ?? [];

// Unlike a root-only lookup, this finds a file inside a folder too — transcripts live in tx/.
async function shaOf(repo, token, name) {
  const cut = name.lastIndexOf("/");
  const listing = (await gh(`/repos/${repo}/contents/${cut < 0 ? "" : name.slice(0, cut)}`, { token })) ?? [];
  const base = name.slice(cut + 1);
  return listing.find?.((f) => f.name === base)?.sha;
}

// Write one file, creating or replacing it. The deck and the transcripts share this: both need
// the same "send the sha of what you are replacing" dance, and a stale sha is recoverable by
// simply asking the directory what the current one is.
async function ghPut(repo, token, name, body, sha) {
  const content = b64(body);
  const put = (s) =>
    gh(`/repos/${repo}/contents/${name}`, {
      method: "PUT",
      token,
      body: JSON.stringify({
        message: `sync ${new Date().toISOString()}`,
        content,
        ...(s ? { sha: s } : {}),
      }),
    });
  try {
    return await put(sha ?? (await shaOf(repo, token, name)));
  } catch {
    return await put(await shaOf(repo, token, name));
  }
}

// A transcript is content, not per-device state: one file per video, written once, never merged
// and never summed. It goes straight to the repo instead of through chrome.storage because a few
// dozen of them would eat the 10MB local quota the deck already lives in. `txIndex` is a small
// local note of what this device has pushed, so re-watching a video costs nothing.
async function saveTx(tx) {
  try {
    if (!tx?.videoId || !tx.sentences?.length) return { ok: false, error: "沒有逐字稿" };
    const { sync = {}, txIndex = {}, txIndexAt } = await chrome.storage.local.get([
      "sync",
      "txIndex",
      "txIndexAt",
    ]);
    if (!sync.on) return { ok: false, error: "同步未啟用" };
    const { ghToken, ghRepo } = await ghCfg();
    if (txIndex[tx.videoId]?.v === tx.v) {
      // Nothing new to upload — but the index may never have been written (it was added after
      // some transcripts already existed) or may have been deleted. Publish it once so the phone
      // can see what is already there, rather than waiting for the next unseen video.
      if (!txIndexAt) {
        await ghPut(ghRepo, ghToken, "tx/index.json", JSON.stringify(txIndex));
        await chrome.storage.local.set({ txIndexAt: Date.now() });
      }
      return { ok: true, skipped: true };
    }
    await ghPut(ghRepo, ghToken, `tx/${tx.videoId}.json`, JSON.stringify(tx));
    txIndex[tx.videoId] = { title: tx.title, at: tx.at, n: tx.sentences.length, v: tx.v };
    await chrome.storage.local.set({ txIndex });
    // An index beside the transcripts, so the phone can list what is available with one request
    // instead of downloading every transcript just to read its title. Only this device writes it.
    await ghPut(ghRepo, ghToken, "tx/index.json", JSON.stringify(txIndex));
    await chrome.storage.local.set({ txIndexAt: Date.now() });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

async function ghPush(interactive = false) {
  try {
    const { sync = {} } = await chrome.storage.local.get("sync");
    if (!sync.on && !interactive) return { ok: false }; // never auto-run before the user opts in
    const { ghToken, ghRepo } = await ghCfg();
    const name = await GH_FILE();
    // A stale cached sha on OUR OWN file only ever means a manual edit or a reinstall, since no
    // other device writes it — and ghPut recovers from that by re-reading the directory.
    const r = await ghPut(ghRepo, ghToken, name, await snapshot(), sync.sha);
    await setSync({ on: true, sha: r.content.sha, lastPush: Date.now(), lastError: null });
    return { ok: true };
  } catch (e) {
    await setSync({ lastError: String(e.message ?? e) });
    return { ok: false, error: String(e.message ?? e) };
  }
}

async function ghRestore() {
  try {
    const { ghToken, ghRepo } = await ghCfg();
    const mine = await GH_FILE();
    const files = (await ghList(ghRepo, ghToken)).filter((f) => DECK_RE.test(f.name));
    if (!files.length) throw new Error("雲端還沒有 deck 檔");
    let own = null; // this device's own file, needed to tell our contribution from everyone's
    // Raw media type: works at any file size, unlike the JSON form.
    const snaps = await Promise.all(
      files.map(async (f) => {
        const r = await fetch(`https://api.github.com/repos/${ghRepo}/contents/${f.name}`, {
          headers: { authorization: `Bearer ${ghToken}`, accept: "application/vnd.github.raw+json" },
        });
        if (!r.ok) return null; // one unreadable device file must not sink the restore
        try {
          const snap = JSON.parse(await r.text());
          if (f.name === mine) own = snap;
          return snap;
        } catch {
          return null;
        }
      }),
    );
    // Local rows join the fold as one more snapshot, so anything marked since the last push is
    // merged rather than overwritten — a pull must never cost work that has not been uploaded.
    const local = await chrome.storage.local.get(["words", "deleted"]);
    const folded = foldSnapshots([
      ...snaps.filter(Boolean),
      { words: local.words ?? [], deleted: local.deleted ?? {} },
    ]);
    const n = await applyRows(folded);
    await chrome.storage.local.set({
      cloud: {
        log: diffCounts(folded.log, own?.log),
        immLog: diffCounts(folded.immLog, own?.immLog),
        immByVideo: diffCounts(folded.immByVideo, own?.immByVideo),
        immersion: Math.max(0, (folded.immersion ?? 0) - (own?.immersion ?? 0)),
      },
    });
    await setSync({ on: true, lastError: null, devices: files.length });
    return { ok: true, words: n, devices: files.length };
  } catch (e) {
    return { ok: false, error: String(e.message ?? e) };
  }
}

// Push after changes settle. A one-shot alarm survives the worker being killed between the write
// burst and the upload — a setTimeout would die with the worker. 30s coalesces a whole review
// session's writes into one upload.
// The immersion counters change every 15 seconds while a video plays. Uploading on THEIR
// account meant a commit every 15s — about 120 full-file uploads for one half-hour video. Only
// the learning data schedules a push; the counters ride along on the next one, and a review
// session bumps `log`, so they are never stale for long.
const PUSH_TRIGGERS = ["words", "marks", "log", "deleted"];
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== "local" || !PUSH_TRIGGERS.some((k) => ch[k])) return;
  chrome.storage.local.get("sync").then(({ sync }) => {
    if (sync?.on) chrome.alarms.create("im-push", { delayInMinutes: 0.5 });
  });
});
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "im-push") return syncNow();
  if (a.name === "im-pull") return pullIfOn();
});

// The other half of the loop. Uploading on its own only ever made this device's work visible
// elsewhere; without a matching pull, a word marked on the phone sat in the repo until somebody
// remembered to press 從雲端還原. A pull is safe to run unattended now that it merges local rows
// into the fold instead of overwriting them, and leaves this device's own counters alone.
async function pullIfOn() {
  const { sync } = await chrome.storage.local.get("sync");
  if (!sync?.on) return;
  await restore();
}
chrome.alarms.create("im-pull", { periodInMinutes: 5 });

// Tokens are recorded here; the money is worked out in options.js, where the price table lives.
// Keeping prices out of this file means a model change can't leave a stale rate behind in two
// places — the teardown's "LLM pricing treadmill" is a real risk, not a hypothetical one.
async function meter(kind, usage) {
  if (!usage) return;
  const store = (await chrome.storage.local.get("usage")).usage ?? {};
  const k = (store.kinds ??= {});
  const t = (k[kind] ??= { calls: 0, in: 0, out: 0 });
  t.calls += 1;
  t.in += usage.input_tokens ?? 0; // no prompt caching in use, so the cache fields are always 0
  t.out += usage.output_tokens ?? 0;
  store.model = MODEL;
  store.since ??= Date.now();
  await chrome.storage.local.set({ usage: store });
}

async function claude(system, user, maxTokens, kind) {
  const { apiKey } = await chrome.storage.local.get("apiKey");
  if (!apiKey) throw new Error("no API key — set one in the extension options");
  // MV3 idle-kills this worker after ~30s without extension-API activity, and awaiting a fetch
  // does not count as activity. A long generation — pos tags a whole transcript — can outlive
  // that; death mid-fetch closes every open message channel at once ("the message channel closed
  // before a response was received", for phrases AND pos together). Any extension API call
  // resets the timer, so tick one while the request is in flight.
  const beat = setInterval(chrome.runtime.getPlatformInfo, 20_000);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        // Required for browser-originated calls, which includes an extension worker.
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens, // deliberately short; Haiku 4.5 rejects output_config.effort
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.error?.message ?? `HTTP ${r.status}`);
    meter(kind, data.usage); // deliberately not awaited: metering must never delay the answer
    return data.content?.find((b) => b.type === "text")?.text || "(no reply)";
  } finally {
    clearInterval(beat);
  }
}
