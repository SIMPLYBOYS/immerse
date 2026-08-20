// All network calls live here: a service worker with host_permissions is exempt from CORS,
// a content script is not. Set the key in the options page, or setKey("sk-ant-...") from here.

const MODEL = "claude-haiku-4-5";
const SYSTEM = `You explain English vocabulary to an advanced learner who reads technical English \
fluently but misses idioms, phrasal verbs, and slang.

The sentence is auto-transcribed speech, so names and technical terms are often mis-heard. If the \
word looks like a garbled version of something else, say what it most likely was and explain that. \
Never ask a question back — nobody is there to answer it; make your best call and say so.

Reply in exactly this shape and nothing else:

CONTEXT: what the word means in THIS sentence. At most 3 short sentences, under 50 words. If it \
belongs to an idiom or phrasal verb, name the whole expression and explain that instead — that is \
usually the part worth learning.
CONTEXT_ZH: the same explanation in 繁體中文, one line. Not a word-for-word translation of the \
English line — write it the way you would explain it to a Chinese speaker.
ZH: the whole given sentence translated into 繁體中文, one line.
SENSE: <pos> | <繁體中文語意> | <short English example sentence> | <該例句的繁體中文翻譯>

Give 2 to 4 SENSE lines covering the word's main uses across English, most common first — not only \
the use in this sentence. <pos> is one of: n. v. adj. adv. prep. pron. phr.

No preamble, no restating the sentence, no numbering, no markdown, no blank lines.`;

const PHRASE_SYSTEM = `From an English transcript, list only the multi-word expressions whose \
meaning an advanced learner could NOT work out from the individual words: phrasal verbs, idioms, \
fixed expressions, slang.

Include: "grew into", "ran into", "figure out", "on the fly", "up and running".
Exclude ordinary word sequences that mean exactly what they say — "handles model downloads", \
"click download", "run the model" — and anything that looking up one word already solves.

List the expression itself, never its object or complement: "grew into", not "grew into the \
foundation".

Copy each one character for character as it appears in the transcript, keeping the inflected form \
actually used — "grew into" if that is what the speaker said, never the dictionary form "grow \
into". The text is matched back against the transcript, so a normalised form is discarded.

Include an expression whenever a learner could plausibly misread it; leave out the ones you are \
confident are transparent. Do not aim for a particular count either way.

One per line. Nothing else: no numbering, no bullets, no commentary, no blank lines, no markdown. \
At most 15 lines.`;

const POS_SYSTEM = `Tag the verbs, nouns and adjectives in an English transcript.

List EVERY distinct one that appears. This is an exhaustive labelling task, not a \
selection task — do not pick out the interesting ones, and do not stop early. Include the \
inflected form exactly as it appears in the text, on its own line: if the transcript says "sees", \
"models" and "running", those are the three lines — not "see", "model", "run".

One per line: the word, a single space, then one of verb, noun, adj. Lowercase the word. Use the \
sense it carries in this transcript — if "run" is used as a verb here, tag it verb even though it \
can be a noun elsewhere, and tag "local" in "a local model" adj rather than noun.

Skip adverbs, proper names, and anything that is not clearly one of the three. Nothing else: no \
numbering, no commentary, no markdown, no blank lines.`;

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
};

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
// A one-way mirror for now: this extension is the only writer, so the whole snapshot is pushed
// and restore is a manual, explicit pull on the options page. The learning data only — the API
// key never leaves the machine. Every word row already carries `updatedAt`, so when a phone app
// becomes a second writer the upgrade path is per-row merging plus a conditional write.
// ponytail: no conflict guard yet — single writer by construction.
const SYNC_KEYS = ["words", "marks", "log", "immLog", "immByVideo", "immersion"];
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
  return JSON.stringify({ v: 1, at: Date.now(), ...data });
};

const applySnapshot = async (snap) => {
  if (!Array.isArray(snap.words)) throw new Error("雲端檔案裡沒有 deck");
  const picked = {};
  for (const k of SYNC_KEYS) if (snap[k] !== undefined) picked[k] = snap[k];
  await chrome.storage.local.set(picked);
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
    const n = await applySnapshot(snap);
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
const GH_FILE = "immerse-deck.json";

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
const ghSha = async (repo, t) =>
  (await gh(`/repos/${repo}/contents/`, { token: t }))?.find?.((f) => f.name === GH_FILE)?.sha;

async function ghPush(interactive = false) {
  try {
    const { sync = {} } = await chrome.storage.local.get("sync");
    if (!sync.on && !interactive) return { ok: false }; // never auto-run before the user opts in
    const { ghToken, ghRepo } = await ghCfg();
    const url = `/repos/${ghRepo}/contents/${GH_FILE}`;
    const content = b64(await snapshot());
    const put = (sha) =>
      gh(url, {
        method: "PUT",
        token: ghToken,
        body: JSON.stringify({
          message: `sync ${new Date().toISOString()}`,
          content,
          ...(sha ? { sha } : {}),
        }),
      });
    let r;
    try {
      r = await put(sync.sha ?? (await ghSha(ghRepo, ghToken)));
    } catch {
      // Stale sha (409/422): refresh from the directory listing and retry once.
      r = await put(await ghSha(ghRepo, ghToken));
    }
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
    // Raw media type: works at any file size, unlike the JSON form.
    const r = await fetch(`https://api.github.com/repos/${ghRepo}/contents/${GH_FILE}`, {
      headers: { authorization: `Bearer ${ghToken}`, accept: "application/vnd.github.raw+json" },
    });
    if (!r.ok) throw new Error(r.status === 404 ? "雲端還沒有 deck 檔" : `HTTP ${r.status}`);
    const n = await applySnapshot(JSON.parse(await r.text()));
    await setSync({ on: true, lastError: null });
    return { ok: true, words: n };
  } catch (e) {
    return { ok: false, error: String(e.message ?? e) };
  }
}

// Push after changes settle. A one-shot alarm survives the worker being killed between the write
// burst and the upload — a setTimeout would die with the worker. 30s coalesces a whole review
// session's writes into one upload.
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== "local" || !SYNC_KEYS.some((k) => ch[k])) return;
  chrome.storage.local.get("sync").then(({ sync }) => {
    if (sync?.on) chrome.alarms.create("im-push", { delayInMinutes: 0.5 });
  });
});
chrome.alarms.onAlarm.addListener((a) => a.name === "im-push" && syncNow());

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
