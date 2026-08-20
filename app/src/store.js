const SecureStore = require("expo-secure-store");

// Settings, not data. The deck itself lives in the repo by design, but three small values have to
// survive a restart: the repo name, the token, and this device's id. The id especially — without
// it every launch would mint a new one, write a fresh deck-app-<id>.json, and leave the repo
// filling up with orphan files that the fold would keep adding to the totals.
// SecureStore rather than AsyncStorage because one of the three is a credential, and it is one
// dependency instead of two. iOS rejects values much above 2KB; all three are tiny.
const KEYS = { repo: "im_repo", token: "im_token", device: "im_device", remind: "im_remind",
  apiKey: "im_apikey" };

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
  const [repo, token, existing, remind, apiKey] = await Promise.all([
    get(KEYS.repo),
    get(KEYS.token),
    get(KEYS.device),
    get(KEYS.remind),
    get(KEYS.apiKey),
  ]);
  let deviceId = existing;
  if (!deviceId) {
    deviceId = mintId();
    await SecureStore.setItemAsync(KEYS.device, deviceId);
  }
  // null means off. Stored as a string because SecureStore only holds strings.
  const hour = remind === null || remind === "off" ? null : Number(remind);
  return { repo: clean(repo), token: clean(token), apiKey: clean(apiKey), deviceId,
    remind: Number.isFinite(hour) ? hour : null };
}

const saveReminder = (hour) =>
  SecureStore.setItemAsync(KEYS.remind, hour === null ? "off" : String(hour));

async function saveSettings({ repo, token, apiKey }) {
  if (repo != null) await SecureStore.setItemAsync(KEYS.repo, clean(repo));
  // An empty box means "leave the saved secret alone", never "erase it" — the fields render blank
  // on every visit, so treating blank as a delete would wipe them on any unrelated save.
  if (clean(token)) await SecureStore.setItemAsync(KEYS.token, clean(token));
  if (clean(apiKey)) await SecureStore.setItemAsync(KEYS.apiKey, clean(apiKey));
}

module.exports = { loadSettings, saveSettings, saveReminder };
