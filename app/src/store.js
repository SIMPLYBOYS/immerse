const SecureStore = require("expo-secure-store");

// Settings, not data. The deck itself lives in the repo by design, but three small values have to
// survive a restart: the repo name, the token, and this device's id. The id especially — without
// it every launch would mint a new one, write a fresh deck-app-<id>.json, and leave the repo
// filling up with orphan files that the fold would keep adding to the totals.
// SecureStore rather than AsyncStorage because one of the three is a credential, and it is one
// dependency instead of two. iOS rejects values much above 2KB; all three are tiny.
const KEYS = { repo: "im_repo", token: "im_token", device: "im_device", remind: "im_remind" };

const get = (k) => SecureStore.getItemAsync(k).catch(() => null);

// No crypto.randomUUID: Hermes does not reliably ship it. Eight base-36 characters is ~2.8
// trillion possibilities, against a population of "this person's phones".
const mintId = () => Math.random().toString(36).slice(2, 10);

async function loadSettings() {
  const [repo, token, existing, remind] = await Promise.all([
    get(KEYS.repo),
    get(KEYS.token),
    get(KEYS.device),
    get(KEYS.remind),
  ]);
  let deviceId = existing;
  if (!deviceId) {
    deviceId = mintId();
    await SecureStore.setItemAsync(KEYS.device, deviceId);
  }
  // null means off. Stored as a string because SecureStore only holds strings.
  const hour = remind === null || remind === "off" ? null : Number(remind);
  return { repo: repo ?? "", token: token ?? "", deviceId, remind: Number.isFinite(hour) ? hour : null };
}

const saveReminder = (hour) =>
  SecureStore.setItemAsync(KEYS.remind, hour === null ? "off" : String(hour));

async function saveSettings({ repo, token }) {
  if (repo != null) await SecureStore.setItemAsync(KEYS.repo, repo.trim());
  // An empty box means "leave the saved token alone", never "erase it" — the field renders blank
  // on every visit, so treating blank as a delete would wipe the token on any unrelated save.
  if (token) await SecureStore.setItemAsync(KEYS.token, token.trim());
}

module.exports = { loadSettings, saveSettings, saveReminder };
