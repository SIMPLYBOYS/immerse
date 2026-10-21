// Advanced shadowing (跟讀): play a chunk, say it back from memory with the text hidden, then
// check and mark the words that did not come out. Pure functions only — the screen owns the
// player and the clock, this owns the arithmetic — so node can test it without React Native.

// The stretch of video one attempt covers: `n` sentences starting at `i`, clamped to the
// transcript. Merging the next sentence is just n + 1.
function chunkOf(sentences, i, n) {
  const a = Math.max(0, Math.min(i, sentences.length - 1));
  const b = Math.max(a, Math.min(a + Math.max(1, n) - 1, sentences.length - 1));
  return { i: a, n: b - a + 1, start: sentences[a].start, end: sentences[b].end };
}

// How many sentences a chunk starting at `i` should take so it is worth shadowing: at least
// `min` words, or whatever is left of the transcript. "Yeah." or "Thank you for having us." on its
// own is not a sentence anyone practises — it was being merged by hand nearly every time.
const MIN_WORDS = 6;
const wordsIn = (text) => String(text ?? "").split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
function autoN(sentences, i, min = MIN_WORDS) {
  let n = 0;
  let words = 0;
  while (i + n < sentences.length && (n === 0 || words < min)) {
    words += wordsIn(sentences[i + n].text);
    n += 1;
  }
  return Math.max(1, n);
}

// One attempt, written once and never edited — which is what lets the fold merge these by id
// alone, with no "newest wins" rule to get wrong. `missed` keeps the words themselves, not
// positions, because the point of the record is the list of words that would not come out.
function shadowRow({ videoId, i, n, words, missed, sec, now = Date.now() }) {
  return {
    id: `${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    at: now,
    videoId,
    i,
    n,
    words,
    missed,
    full: missed.length === 0,
    sec: Math.max(0, Math.round(sec)),
  };
}

// What the stats page shows. `best` is the longest chunk (in words) reproduced with nothing
// missed — the number the zeroStudy video calls a rough reading of one's level. `missedTop` is
// the gap between understanding and producing, made concrete: words heard often enough to be
// shadowed, that still did not come out.
function shadowStats(shadows, now, dayKey) {
  const today = dayKey(now);
  const rows = Array.isArray(shadows) ? shadows : [];
  const tally = new Map();
  let todayN = 0;
  let sec = 0;
  let best = 0;
  for (const r of rows) {
    if (dayKey(r.at) === today) todayN += 1;
    sec += Number(r.sec) || 0;
    if (r.full && r.words > best) best = r.words;
    for (const w of r.missed ?? []) {
      const k = String(w).toLowerCase();
      tally.set(k, (tally.get(k) ?? 0) + 1);
    }
  }
  const missedTop = [...tally.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([word, count]) => ({ word, count }));
  return { today: todayN, total: rows.length, sec, best, missedTop };
}

if (typeof module !== "undefined") module.exports = { chunkOf, autoN, shadowRow, shadowStats, MIN_WORDS };
