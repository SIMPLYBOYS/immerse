const SecureStore = require("expo-secure-store");

// Settings, not data. The deck itself lives in the repo by design, but three small values have to
// survive a restart: the repo name, the token, and this device's id. The id especially — without
// it every launch would mint a new one, write a fresh deck-app-<id>.json, and leave the repo
// filling up with orphan files that the fold would keep adding to the totals.
// SecureStore rather than AsyncStorage because one of the three is a credential, and it is one
// dependency instead of two. iOS rejects values much above 2KB; all three are tiny.
const KEYS = { repo: "im_repo", token: "im_token", device: "im_device", remind: "im_remind",
  apiKey: "im_apikey", hidden: "im_hidden", split: "im_split", recall: "im_recall" };

const get = (k) => SecureStore.getItemAsync(k).catch(() => null);

// Paste sources wrap. An email, a note app, a terminal that hard-wrapped the line — any of them
// can drop a \r or a newline INTO the middle of a long credential, where trim() cannot reach it.
// It then travels all the way to the HTTP layer and fails there as "Unexpected char 0x0d in
// authorization value", which reads like a server rejection and is not one. None of these values
// may contain whitespace at all, so remove every last bit of it — on the way in and on the way
// out, so a value already stored broken repairs itself without being re-typed.
const clean = (s) => String(s ?? "").replace(/\s+/g, "");

// No crypto.randomUUID: Hermes does not reliably ship it. Eight base-36 characters is ~2.8
// trillion possibilities, against a population of "this person's phones".
const mintId = () => Math.random().toString(36).slice(2, 10);

async function loadSettings() {
  const [repo, token, existing, remind, apiKey, recall] = await Promise.all([
    get(KEYS.repo),
    get(KEYS.token),
    get(KEYS.device),
    get(KEYS.remind),
    get(KEYS.apiKey),
    get(KEYS.recall),
  ]);
  let deviceId = existing;
  if (!deviceId) {
    deviceId = mintId();
    await SecureStore.setItemAsync(KEYS.device, deviceId);
  }
  // null means off. Stored as a string because SecureStore only holds strings.
  const hour = remind === null || remind === "off" ? null : Number(remind);
  return { repo: clean(repo), token: clean(token), apiKey: clean(apiKey), deviceId,
    remind: Number.isFinite(hour) ? hour : null, recall: recall === "on" };
}

const saveRecall = (on) => SecureStore.setItemAsync(KEYS.recall, on ? "on" : "off");

const saveReminder = (hour) =>
  SecureStore.setItemAsync(KEYS.remind, hour === null ? "off" : String(hour));

async function saveSettings({ repo, token, apiKey }) {
  if (repo != null) await SecureStore.setItemAsync(KEYS.repo, clean(repo));
  // An empty box means "leave the saved secret alone", never "erase it" — the fields render blank
  // on every visit, so treating blank as a delete would wipe them on any unrelated save.
  if (clean(token)) await SecureStore.setItemAsync(KEYS.token, clean(token));
  if (clean(apiKey)) await SecureStore.setItemAsync(KEYS.apiKey, clean(apiKey));
}

// Videos struck off the list — held here and not in the repo on purpose. The extension rewrites
// tx/index.json wholesale from its own local index every time it saves a transcript, so an entry
// deleted from the cloud comes back on the desktop's next upload; the file would already be gone,
// leaving a card that errors when tapped. Hiding is per-phone, which is where the wish to hide
// something lives anyway. Ids are 11 characters, so the 2KB ceiling holds a few hundred.
async function loadHidden() {
  try {
    const list = JSON.parse(await get(KEYS.hidden));
    return Array.isArray(list) ? list : [];
  } catch {
    return []; // unset, or written by a version that stored something else
  }
}

// Re-read before writing rather than merging into whatever the screen is holding. A read that
// failed at launch hands back an empty list, and writing the screen's state over the top of that
// would erase every earlier removal to record one new id. Throws if the write fails, so the
// caller can decline to hide something it could not actually remember.
async function hideVideo(id) {
  const next = [...new Set([...(await loadHidden()), id])];
  await SecureStore.setItemAsync(KEYS.hidden, JSON.stringify(next));
  return next;
}

// How much of a sideways screen the video column takes. Remembered because the right answer
// depends on the phone and on how much of the transcript someone wants to see at once, and
// re-dragging it at the start of every video would be its own annoyance.
async function loadSplit(fallback) {
  const n = Number(await get(KEYS.split));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const saveSplit = (r) => SecureStore.setItemAsync(KEYS.split, String(r));

module.exports = { loadSettings, saveSettings, saveReminder, saveRecall, loadHidden, hideVideo,
  loadSplit, saveSplit };
