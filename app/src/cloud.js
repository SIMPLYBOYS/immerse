// The app's half of the sync: same private repo, same deck-<device>.json convention, same merge
// rules as the extension — see docs/github-sync.md. The extension's copy lives in bg.js and talks
// to chrome.storage; this one is plain fetch so it can run on a phone.
//
// The app is a SECOND writer, which is the whole reason the per-device scheme exists: it writes
// only deck-app-<id>.json and never touches the extension's file, so no upload can lose the
// other device's work.

const { foldSnapshots } = require("../../merge.js");

const API = "https://api.github.com";
const DECK_RE = /^deck-.+\.json$/;

// GitHub wants base64, the deck is full of Chinese, and neither btoa nor TextEncoder can be
// relied on across React Native runtimes (Hermes ships neither consistently). Hand-rolling the
// UTF-8 and base64 steps is ~20 lines, has no dependency, and is exercised by `node test.js`.
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function utf8Bytes(s) {
  const out = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.codePointAt(i);
    if (c > 0xffff) i++; // a surrogate pair is one code point but two UTF-16 units
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

function b64(str) {
  const b = utf8Bytes(str);
  let out = "";
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    out +=
      B64[(n >> 18) & 63] +
      B64[(n >> 12) & 63] +
      (i + 1 < b.length ? B64[(n >> 6) & 63] : "=") +
      (i + 2 < b.length ? B64[n & 63] : "=");
  }
  return out;
}

async function gh(path, { token, method = "GET", body, accept } = {}) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: accept ?? "application/vnd.github+json",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body,
  });
  if (r.status === 404) return null;
  if (!r.ok) {
    const msg = await r.json().catch(() => ({}));
    throw new Error(msg.message ?? `HTTP ${r.status}`);
  }
  return r;
}

const listing = async (repo, token) => (await gh(`/repos/${repo}/contents/`, { token }))?.json() ?? [];

const ownName = (deviceId) => `deck-app-${deviceId}.json`;

// Every device file, folded into one deck — plus this device's own file, kept separate.
// That separation is not tidiness, it is correctness: folding SUMS the counters, so if this
// device pushed back the folded total as its own contribution, every other device's minutes and
// reviews would be counted twice on the next pull, and again the time after that.
// Raw media type rather than the JSON form: the JSON one errors above 1MB, which a deck of a few
// thousand words will pass.
async function pull(repo, token, deviceId) {
  const files = (await listing(repo, token)).filter((f) => DECK_RE.test(f.name));
  const mine = ownName(deviceId);
  const snaps = [];
  let own = null;
  for (const f of files) {
    try {
      const r = await gh(`/repos/${repo}/contents/${f.name}`, {
        token,
        accept: "application/vnd.github.raw+json",
      });
      if (!r) continue;
      const snap = JSON.parse(await r.text());
      snaps.push(snap);
      if (f.name === mine) own = snap;
    } catch {
      // One unreadable device file must not sink the whole pull.
    }
  }
  return {
    deck: foldSnapshots(snaps),
    own, // this device's own contribution, so a push can rewrite it without double-counting
    ownSha: files.find((f) => f.name === mine)?.sha,
    devices: files.length,
  };
}

// Writes this device's file and nothing else. `sha` is the copy being replaced: only this device
// writes this file, so a mismatch just means our cached sha is stale — refresh and retry once.
async function push(repo, token, deviceId, data, sha) {
  const name = ownName(deviceId);
  const content = b64(JSON.stringify({ v: 2, at: Date.now(), dev: `app-${deviceId}`, ...data }));
  const put = (s) =>
    gh(`/repos/${repo}/contents/${name}`, {
      token,
      method: "PUT",
      body: JSON.stringify({
        message: `sync ${new Date().toISOString()}`,
        content,
        ...(s ? { sha: s } : {}),
      }),
    });
  const fresh = async () => (await listing(repo, token)).find((f) => f.name === name)?.sha;
  let r;
  try {
    r = await put(sha ?? (await fresh()));
  } catch {
    r = await put(await fresh());
  }
  return (await r.json()).content.sha;
}

module.exports = { pull, push, b64, utf8Bytes, DECK_RE };
