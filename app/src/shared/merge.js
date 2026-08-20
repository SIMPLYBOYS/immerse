// Folding many device snapshots into one deck.
//
// Every device writes only its own file and never touches anyone else's, so there is nothing to
// conflict over and no lock to take — the reconciliation happens on the way in, here. Two kinds
// of data need two different rules:
//
//   rows (words)     — per-word facts. The newest `updatedAt` wins; a stamp is written by every
//                      site that touches a row, so "newest" is well defined across devices.
//   counters (log,   — per-device tallies. Each file holds only that device's own count, so the
//   immLog, …)         merge is a sum. That is what makes a re-push idempotent: pushing the same
//                      file twice cannot inflate a total, because it replaces rather than adds.
//
// `marks` is deliberately NOT merged — it is derived from the merged rows. One source of truth
// beats two that can drift apart.
function foldSnapshots(snaps) {
  const rows = new Map();
  const deleted = {};
  const counters = { log: {}, immLog: {}, immByVideo: {} };
  let immersion = 0;

  for (const s of snaps) {
    if (!s || typeof s !== "object") continue; // an unreadable file must not sink the whole restore
    for (const [id, at] of Object.entries(s.deleted ?? {})) {
      if (at > (deleted[id] ?? 0)) deleted[id] = at;
    }
    for (const w of s.words ?? []) {
      if (!w?.id) continue;
      const cur = rows.get(w.id);
      if (!cur || (w.updatedAt ?? 0) > (cur.updatedAt ?? 0)) rows.set(w.id, w);
    }
    for (const k of ["log", "immLog", "immByVideo"]) {
      for (const [key, n] of Object.entries(s[k] ?? {})) {
        counters[k][key] = (counters[k][key] ?? 0) + (Number(n) || 0);
      }
    }
    immersion += Number(s.immersion) || 0;
  }

  // Tombstones: without them a delete cannot survive a merge, because the device that still has
  // the row would simply hand it back. A deletion outranks any edit older than itself; an edit
  // NEWER than the deletion revives the word, which is exactly what re-marking it in a video means.
  const words = [...rows.values()].filter((w) => (deleted[w.id] ?? 0) <= (w.updatedAt ?? 0));
  const marks = Object.fromEntries(words.map((w) => [w.id, w.suspended ? "known" : "learning"]));
  return { words, marks, ...counters, immersion, deleted };
}

// Counter arithmetic, kept here beside the fold that makes it necessary.
//
// A device must push only the seconds and reviews IT produced. The fold sums, so a device that
// wrote the merged total back into its own file would have every other device's contribution
// counted twice on the next pull, four times on the one after — the error compounds rather than
// settling. So a device keeps its own tallies, stores everyone else's separately, and adds the
// two only when something is displayed.
const sumCounts = (a = {}, b = {}) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + (Number(v) || 0);
  return out;
};

// folded − ours = everyone else's. Clamped at zero: a fold taken before our last push can leave
// a key looking negative, which would then be subtracted from a later display.
const diffCounts = (folded = {}, mine = {}) => {
  const out = {};
  for (const [k, v] of Object.entries(folded)) {
    const n = (Number(v) || 0) - (Number(mine[k]) || 0);
    if (n > 0) out[k] = n;
  }
  return out;
};

// Tombstones are only needed until every device has seen them. Keeping them forever would grow
// the file without bound; keeping them too briefly resurrects deletions on a device that was
// offline the whole time.
// ponytail: 90 days, no per-device acknowledgement. A device offline for a season is not a case
// this tool has.
const pruneDeleted = (deleted = {}, now = Date.now(), days = 90) =>
  Object.fromEntries(Object.entries(deleted).filter(([, at]) => at > now - days * 86400000));

if (typeof module !== "undefined")
  module.exports = { foldSnapshots, pruneDeleted, sumCounts, diffCounts };
