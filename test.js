const assert = require("assert");
const { toSentences, splitPhrases, posOf, parseReply, markRate, zhFor, cueUrl, CLAUSE } = require("./content.js");

// --- parseReply ---
const reply = parseReply(`CONTEXT: "Grew into" means developed into something larger.
CONTEXT_ZH: 「grew into」在這裡是「發展成為」的意思。
ZH: 它從一個業餘專案發展成基礎。
SENSE: v. | 發展成為 | It grew into a giant. | 它發展成一家巨頭。
SENSE: v. | 長大到穿得下 | He grew into his brother's coat. | 他長大到穿得下他哥的外套。`);
assert.equal(reply.context, '"Grew into" means developed into something larger.');
// CONTEXT_ZH must not be eaten by the shorter CONTEXT prefix
assert.equal(reply.contextZh, "「grew into」在這裡是「發展成為」的意思。");
assert.equal(reply.zh, "它從一個業餘專案發展成基礎。");
assert.equal(reply.senses.length, 2);
assert.deepEqual(reply.senses[0], {
  pos: "v.",
  gloss: "發展成為",
  example: "It grew into a giant.",
  zh: "它發展成一家巨頭。",
});
// a malformed SENSE line is dropped, not rendered half-built
assert.equal(parseReply("CONTEXT: x\nSENSE: v.").senses.length, 0);
// a reply that ignored the format entirely still shows up as plain text
assert.equal(parseReply("just a sentence").context, "just a sentence");
const { toCsv, rowsFor, totals, costOf, money } = require("./options.js");
const { schedule, stats, forecast, isDue, recallOf, buildQueue, streakOf, byVideo, markTarget,
  todayMins, masteredSince, addedSince, dayKeys, dayKey, dueAt, debtOf, GOAL_MIN } = require("./review.js");
const { heatLevel, seriesOf, efficiencyOf, activeDaysOf, addedPerDay, topVideos, leeches } =
  require("./analytics.js");
const { searchWords, filterWords, dueLabel, groupWords } = require("./library.js");
const { foldSnapshots, pruneDeleted, sumCounts, diffCounts } = require("./merge.js");
const { b64 } = require("./app/src/cloud.js");

// --- SM-2 ---
const T0 = 1_700_000_000_000;
const DAY = 86400000;

// Dues land on the 4am day boundary: a word reviewed tonight is due after sleep, on the next
// study day — not at the same wall-clock hour tomorrow, which a morning session would keep
// missing by ~10 hours every round.
assert.equal(new Date(dueAt(T0, 1)).getHours(), 4);
assert.notEqual(dayKey(dueAt(T0, 1)), dayKey(T0)); // never due again on the day it was reviewed
assert.ok(dueAt(T0, 1) > T0);

// first correct answer → 1 day, second → 6, then interval * ease
let c = schedule({}, 4, T0);
assert.equal(c.interval, 1);
assert.equal(c.due, dueAt(T0, 1));
c = schedule(c, 4, T0);
assert.equal(c.interval, 6);
c = schedule(c, 4, T0);
assert.equal(c.interval, Math.round(6 * c.ease));

// forgetting resets the streak and schedules for tomorrow, counts a lapse, and — because the
// two-grade UI's success delta is exactly zero — carries the only per-card difficulty signal:
// each lapse lowers ease, so a word you keep forgetting grows its intervals more slowly
const lapsed = schedule({ reps: 5, interval: 40, ease: 2.5 }, 0, T0);
assert.equal(lapsed.reps, 0);
assert.equal(lapsed.interval, 1);
assert.equal(lapsed.lapses, 1);
assert.equal(lapsed.ease, 2.3);
assert.equal(schedule({ ease: 1.35 }, 0, T0).ease, 1.3); // penalty respects the floor
// ...and the ease actually bites: the post-lapse growth is slower than a fresh card's
assert.ok(Math.round(6 * lapsed.ease) < Math.round(6 * 2.5));

// ease can never fall below 1.3, however many times it is failed
let bad = { ease: 1.4, reps: 3, interval: 10 };
for (let i = 0; i < 10; i++) bad = schedule(bad, 3, T0);
assert.ok(bad.ease >= 1.3);

// marking IS the first study event, so a word marked today surfaces tomorrow, not immediately —
// the same one-sleep principle every later review follows
assert.equal(isDue({ addedAt: T0 }, T0), false);
assert.equal(isDue({ addedAt: T0 - DAY }, T0), true); // marked yesterday: today's queue has it
assert.equal(isDue({}, T0), true); // legacy rows without a stamp stay available
assert.equal(isDue({ due: T0 + DAY }, T0), false);
// 已掌握 suspends: it stays in the library but is never scheduled, even when overdue
assert.equal(isDue({ suspended: true, due: T0 - DAY }, T0), false);

assert.deepEqual(
  stats([{}, { due: T0 - 1 }, { suspended: true, due: T0 - 1 }, { due: T0 + 9 * DAY }], T0),
  { predicted: null, learning: 3, known: 1, due: 2, correct: null }, // nothing scheduled yet
);
// the two rates answer different questions and must not be conflated
assert.equal(stats([{ reviews: 10, lapses: 2 }], T0).correct, 80); // historical hit rate
assert.equal(stats([{ due: T0, interval: 6 }], T0).predicted, 90); // still-recallable right now
// a card with a due date but no interval cannot be estimated — it must be left out of the
// average, not counted as 0%, or one legacy row reads as "you have forgotten everything"
assert.equal(stats([{ due: T0, interval: 6 }, { due: T0 }], T0).predicted, 90);

// --- recallOf: the forgetting curve the review order is built on ---
// a card sitting exactly on its due date is ~90% recallable, by construction
assert.equal(Math.round(recallOf({ due: T0, interval: 6 }, T0) * 100), 90);
// two days late on a two-day interval has decayed far more than two days late on a sixty-day one
assert.ok(
  recallOf({ due: T0 - 2 * DAY, interval: 2 }, T0) < recallOf({ due: T0 - 2 * DAY, interval: 60 }, T0),
);
// reviewed a day ago on a six-day interval: still nearly certain, but not certain
assert.equal(Math.round(recallOf({ due: T0 + 5 * DAY, interval: 6 }, T0) * 100), 98);
// the curve is clamped: no arrangement of dates may report better than certainty
assert.equal(recallOf({ due: T0 + 10 * DAY, interval: 1 }, T0), 1);
assert.equal(recallOf({}, T0), 0); // never scheduled — nothing to recall yet

// --- buildQueue: the fix for "every session starts with the same words" ---
const deck = [
  { id: "new1" },
  { id: "new2" },
  { id: "urgent", due: T0 - 5 * DAY, interval: 1 },
  { id: "mild", due: T0 - 1 * DAY, interval: 30 },
  { id: "later", due: T0 + 5 * DAY, interval: 10 },
  { id: "sus", suspended: true },
];
deck.push({ id: "fresh", addedAt: T0 }); // marked minutes ago
const q = buildQueue(deck, T0, () => 0.5).map((w) => w.id);
assert.ok(!q.includes("later") && !q.includes("sus")); // not due / suspended never queue
assert.ok(!q.includes("fresh")); // today's marks wait for tomorrow's session
assert.equal(q[0], "urgent"); // most decayed first, not insertion order
assert.ok(q.indexOf("mild") < q.length); // reviews all present
assert.equal(q.length, 4);
// new words are interleaved, not all bunched at one end
assert.ok(q.indexOf("new1") > 0 || q.indexOf("new2") > 0);

// --- streak ---
const today = new Date(T0);
const key = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const yesterday = new Date(T0 - DAY);
const twoAgo = new Date(T0 - 2 * DAY);
assert.equal(streakOf({ [key(today)]: 3, [key(yesterday)]: 1 }, T0), 2);
// not having studied yet today must not zero a streak that is still alive
assert.equal(streakOf({ [key(yesterday)]: 1, [key(twoAgo)]: 1 }, T0), 2);
assert.equal(streakOf({}, T0), 0);

// --- daily immersion goal ---
const G = GOAL_MIN * 60;
// the streak counts days that reached the goal, and a short day breaks it
assert.equal(streakOf({ [key(today)]: G, [key(yesterday)]: G }, T0, G), 2);
assert.equal(streakOf({ [key(today)]: G, [key(yesterday)]: 60 }, T0, G), 1);
// not having reached today's goal yet must not zero a streak that is still alive
assert.equal(streakOf({ [key(yesterday)]: G, [key(twoAgo)]: G }, T0, G), 2);

assert.equal(todayMins({ [key(today)]: 1830 }, T0), 30); // seconds → whole minutes
assert.equal(todayMins({}, T0), 0);

// --- 單字負債: marked long ago, never reviewed once — candidates for cleanup ---
assert.deepEqual(
  debtOf(
    [
      { id: "a", addedAt: T0 - 40 * DAY }, // old and never reviewed: debt
      { id: "b", addedAt: T0 - 40 * DAY, reviews: 3 }, // has been reviewed: earning its keep
      { id: "c", addedAt: T0 - 40 * DAY, suspended: true }, // mastered: not owed anything
      { id: "d", addedAt: T0 - 5 * DAY }, // too recent to call
      { id: "e" }, // earliest schema, no stamp: age unknown, but still never reviewed → debt
    ],
    T0,
  ).map((w) => w.id),
  ["a", "e"],
);

assert.equal(
  masteredSince(
    [
      { suspended: true, knownAt: T0 - DAY },
      { suspended: true, knownAt: T0 - 30 * DAY }, // mastered, but before the window
      { knownAt: T0 - DAY }, // demoted back to 學習中: stamp alone must not count
      {},
    ],
    T0 - 7 * DAY,
  ),
  1,
);
// words added before the field existed have no addedAt, so they count as older than any window
assert.equal(addedSince([{ addedAt: T0 - DAY }, { addedAt: T0 - 30 * DAY }, {}], T0 - 7 * DAY), 1);

assert.deepEqual(
  byVideo([{ videoId: "a", title: "A" }, { videoId: "b" }, { videoId: "a", title: "A" }]).map(
    (g) => [g.title, g.words.length],
  ),
  [["A", 2], ["b", 1]], // biggest group first; missing title falls back to the id
);
assert.deepEqual(
  forecast([{ due: T0 + 0.5 * DAY }, { due: T0 + 4.5 * DAY }, { suspended: true, due: T0 + 0.5 * DAY }], T0),
  [1, 0, 0, 0, 1],
);

// --- CSV export: an unescaped quote or comma silently shifts every later column ---
assert.equal(toCsv([["a", "b"]]), '"a","b"');
assert.equal(toCsv([['say "hi"', "x"]]), '"say ""hi""","x"');
assert.equal(toCsv([["a, b", "c\nd"]]), '"a, b","c\nd"'); // commas and newlines survive quoting
assert.equal(toCsv([[null, undefined]]), '"",""'); // a word saved before its explanation landed

assert.deepEqual(
  rowsFor([
    {
      word: "grew into",
      contextZh: "中文解釋…",
      context: "means…",
      senses: [{ pos: "v.", gloss: "發展成為", example: "It grew into a giant.", zh: "它發展成巨頭。" }],
      sentence: "It grew into…",
      videoId: "abc",
      t: 30.25,
    },
  ]),
  [
    [
      "grew into",
      "中文解釋…",
      "means…",
      "v. 發展成為｜It grew into a giant.｜它發展成巨頭。",
      "It grew into…",
      "https://youtu.be/abc?t=30",
    ],
  ],
);

// --- posOf: closed classes come from the table, open classes from the model ---
assert.equal(posOf("into"), "prep");
assert.equal(posOf("Into"), "prep"); // case-insensitive
assert.equal(posOf("is"), "aux");
assert.equal(posOf("the"), "det");
assert.equal(posOf("and"), "conj");
assert.equal(posOf("grew"), undefined); // open class: nothing without the model
assert.equal(posOf("grew", { grew: "verb" }), "verb");
// a closed-class word is never overridden by the model — "to" is a preposition, not a noun
assert.equal(posOf("to", { to: "noun" }), "prep");
// base-form fallback: the model often answers "see" for a transcript that says "sees"
assert.equal(posOf("sees", { see: "verb" }), "verb");
assert.equal(posOf("models", { model: "noun" }), "noun");
assert.equal(posOf("running", { run: "verb" }), "verb");
assert.equal(posOf("stories", { story: "noun" }), "noun");
assert.equal(posOf("stopped", { stop: "verb" }), "verb"); // doubled consonant
// the stemmer only ever accepts an exact hit, so an unrelated map stays neutral rather than guessing
assert.equal(posOf("laptop", { see: "verb" }), undefined);


// --- splitPhrases ---
assert.deepEqual(splitPhrases("hello world", []), [{ text: "hello world" }]);
assert.deepEqual(splitPhrases("it grew into the standard", ["grew into"]), [
  { text: "it " },
  { text: "grew into", phrase: true },
  { text: " the standard" },
]);
// same start position: the longer expression wins
assert.deepEqual(splitPhrases("look forward to it", ["look forward", "look forward to"]), [
  { text: "look forward to", phrase: true },
  { text: " it" },
]);
// matching is case-insensitive but the caption's own casing is what gets rendered
assert.deepEqual(splitPhrases("Grew into shape", ["grew into"]), [
  { text: "Grew into", phrase: true },
  { text: " shape" },
]);
// must not match across a word boundary: "grew into" is not inside "grown into"
assert.deepEqual(splitPhrases("it grown into", ["grew into"]), [{ text: "it grown into" }]);


// Real cue shapes from a YouTube ASR track: sentences run across cue boundaries, and one cue
// can both finish a sentence and start the next.
const s = toSentences([
  { start: 0.32, text: "Open models like Qwen, Kimmy, and the" },
  { start: 2.72, text: "GLM family are strong enough that" },
  { start: 5.52, text: "you don't always need a hosted API." },
  { start: 7.92, text: "You can run them on your own laptop." },
]);

assert.equal(s.length, 2);
assert.equal(
  s[0].text,
  "Open models like Qwen, Kimmy, and the GLM family are strong enough that you don't always need a hosted API.",
);
assert.equal(s[0].start, 0.32);
assert.equal(s[0].end, 7.92); // a sentence runs until the next one starts
assert.equal(s[1].start, 7.92); // NOT 5.52 — nothing was left over, so it begins in the next cue
assert.equal(s[1].end, Infinity);

// Two sentences finishing inside one cue: the second must start in that same cue, not the next.
const t = toSentences([
  { start: 1, text: "First one. Second two here." },
  { start: 9, text: "Third." },
]);
assert.deepEqual(
  t.map((x) => [x.text, x.start]),
  [["First one.", 1], ["Second two here.", 1], ["Third.", 9]],
);

// Abbreviation-ish text must not split mid-word: "llama.cpp" has no space after the dot.
assert.equal(toSentences([{ start: 0, text: "llama.cpp is fast." }]).length, 1);

// A trailing fragment with no closing punctuation still comes back rather than vanishing.
assert.equal(toSentences([{ start: 0, text: "no end here" }])[0].text, "no end here");

// --- CLAUSE: comma-level cuts for A/S/D and card timestamps ---
// One long ASR sentence becomes three hops, each with an interpolated start inside the cue.
const cl = toSentences(
  [{ start: 0, end: 12, text: "Well, since the dawn of time, humans dreamed of flight." }],
  CLAUSE,
);
assert.deepEqual(cl.map((x) => x.text),
  ["Well,", "since the dawn of time,", "humans dreamed of flight."]);
assert.equal(cl[0].start, 0);
assert.ok(cl[1].start > 0 && cl[1].start < cl[2].start); // starts advance through the cue
assert.equal(cl[0].end, cl[1].start); // hops tile the timeline with no gaps
// "1,000" has no space after the comma and must stay whole.
assert.equal(toSentences([{ start: 0, text: "It costs 1,000 dollars." }], CLAUSE).length, 1);
// The default (sentence) behaviour is untouched: same input, one segment.
assert.equal(
  toSentences([{ start: 0, end: 12, text: "Well, since the dawn of time, humans dreamed of flight." }]).length,
  1,
);

// --- foldSnapshots: one file per device, reconciled on read ---
// Rows are per-word facts (newest updatedAt wins); counters are per-device tallies (summed).
const ext = {
  words: [
    { id: "alpha", word: "alpha", updatedAt: 100, suspended: false },
    { id: "beta", word: "beta", updatedAt: 300, suspended: false },
    { id: "gone", word: "gone", updatedAt: 100 },
  ],
  log: { "2026-8-1": 5 },
  immLog: { "2026-8-1": 600 },
  immByVideo: { vid1: 600 },
  immersion: 600,
  deleted: {},
};
const app = {
  words: [
    { id: "alpha", word: "alpha", updatedAt: 200, suspended: true }, // reviewed later on the phone
    { id: "beta", word: "beta", updatedAt: 150, suspended: true }, // older than the desktop's copy
    { id: "gamma", word: "gamma", updatedAt: 50 },
  ],
  log: { "2026-8-1": 3 },
  immLog: { "2026-8-1": 300, "2026-8-2": 60 },
  immByVideo: { vid1: 300 },
  immersion: 360,
  deleted: { gone: 400 }, // deleted on the phone AFTER the desktop last touched it
};
const merged = foldSnapshots([ext, app]);
const byId = Object.fromEntries(merged.words.map((w) => [w.id, w]));

assert.equal(byId.alpha.suspended, true); // phone's newer stamp wins
assert.equal(byId.beta.suspended, false); // desktop's newer stamp wins, per row not per file
assert.ok(byId.gamma); // a word only one device has still arrives
assert.ok(!byId.gone); // a tombstone newer than the row deletes it everywhere
// Deleting then re-marking revives the word: the edit out-dates the stone.
assert.ok(foldSnapshots([{ words: [{ id: "gone", updatedAt: 500 }] }, app]).words.some((w) => w.id === "gone"));
// Counters sum across devices — each file holds only its own device's tally.
assert.equal(merged.log["2026-8-1"], 8);
assert.equal(merged.immLog["2026-8-1"], 900);
assert.equal(merged.immLog["2026-8-2"], 60);
assert.equal(merged.immersion, 960);
// Re-folding the SAME snapshots must not inflate a total — that is what makes a re-push safe.
assert.equal(foldSnapshots([ext, app]).immersion, 960);
// marks is derived from the merged rows, never merged itself: one source of truth.
assert.equal(merged.marks.alpha, "known");
assert.equal(merged.marks.beta, "learning");
assert.equal(merged.marks.gone, undefined);
// An unreadable device file is skipped rather than sinking the whole restore.
assert.equal(foldSnapshots([null, ext, "garbage"]).words.length, 3);
assert.deepEqual(foldSnapshots([]).words, []);

// --- the app's base64: GitHub wants it, the deck is full of Chinese, and React Native ships
// neither btoa nor TextEncoder dependably. Node's Buffer is the reference.
for (const sample of [
  "",
  "a",
  "ab",
  "abc", // every padding case
  "整體性的、全面的", // 3-byte UTF-8 throughout
  "breaking down｜分解", // mixed widths
  "🎧 immerse", // surrogate pair: one code point, two UTF-16 units
  JSON.stringify({ words: [{ word: "holistic", zh: "整體的" }] }), // a real snapshot shape
]) {
  assert.equal(b64(sample), Buffer.from(sample, "utf8").toString("base64"), `b64: ${sample}`);
}

// --- counter arithmetic: a device stores its own tallies and everyone else's apart, so that
// writing the merged total back into its own file cannot make the sum compound on every sync ---
assert.deepEqual(sumCounts({ a: 1, b: 2 }, { b: 3, c: 4 }), { a: 1, b: 5, c: 4 });
assert.deepEqual(sumCounts(undefined, { a: 1 }), { a: 1 });
assert.deepEqual(diffCounts({ a: 10, b: 5 }, { a: 4 }), { a: 6, b: 5 });
// A key we alone contributed leaves nothing behind for anyone else.
assert.deepEqual(diffCounts({ a: 7 }, { a: 7 }), {});
// A fold older than our last push can look negative; it must never be subtracted from a display.
assert.deepEqual(diffCounts({ a: 3 }, { a: 9 }), {});
// The round trip is what the sync relies on: others + ours == the folded total.
assert.deepEqual(sumCounts(diffCounts({ d1: 900 }, { d1: 300 }), { d1: 300 }), { d1: 900 });

// Tombstones expire, or the file grows forever.
assert.deepEqual(pruneDeleted({ old: T0 - 100 * DAY, recent: T0 - DAY }, T0), { recent: T0 - DAY });

console.log("ok");

// --- markTarget: the review card highlights the phrase inside its own sentence ---
assert.deepEqual(markTarget("Hello there. As you can see, I'm not in.", "as you can see"), [
  { text: "Hello there. " },
  { text: "As you can see", hit: true }, // matched case-insensitively, rendered as written
  { text: ", I'm not in." },
]);
// no partial-word hits: "see" must not light up inside "seen"
assert.deepEqual(markTarget("I have seen it.", "see"), [{ text: "I have seen it." }]);
// a word missing from the sentence leaves it untouched rather than throwing
assert.deepEqual(markTarget("nothing here", "absent"), [{ text: "nothing here" }]);
assert.deepEqual(markTarget(undefined, "x"), [{ text: "" }]);

// --- markRate: ten marks per wall-clock hour ---
const H = 3600_000;
const marked = [
  { addedAt: T0 - 30 * 60_000 }, // half an hour ago: counts
  { addedAt: T0 - 10 * H }, // last night's session: must NOT still fill the window
  {}, // legacy row without a stamp: never counted
];
assert.equal(markRate(marked, T0), 1);
// 已掌握 never consumes the budget: the cap protects the review queue, which suspended words
// never enter — marking known words is tagging, not scheduling
assert.equal(markRate([{ addedAt: T0 - 60_000 }, { addedAt: T0 - 60_000, suspended: true }], T0), 1);

// --- LLM cost accounting ---
const usage = {
  model: "claude-haiku-4-5",
  kinds: { explain: { calls: 3, in: 1500, out: 600 }, pos: { calls: 1, in: 4000, out: 3000 } },
};
assert.deepEqual(totals(usage), { calls: 4, in: 5500, out: 3600 });
// $1.00/MTok in, $5.00/MTok out
assert.ok(Math.abs(costOf(totals(usage), usage.model) - (5500 / 1e6 + (3600 / 1e6) * 5)) < 1e-12);
// an unknown model must read as "no price on file", never as free
assert.equal(costOf({ in: 1e9, out: 1e9 }, "claude-something-new"), null);
assert.equal(money(null), "—");
assert.equal(money(0.0004), "< $0.01");
assert.equal(money(1.239), "$1.24");
assert.deepEqual(totals({}), { calls: 0, in: 0, out: 0 });

// --- analytics ---
const keys = dayKeys(3, T0);
assert.equal(keys.length, 3);
assert.equal(keys[2], dayKey(T0)); // oldest first, so today is last
assert.deepEqual(seriesOf({ [keys[0]]: 5 }, keys), [5, 0, 0]); // missing days read as zero

// buckets, not a scale — a four-hour binge must not make a real 30-minute day look empty
assert.deepEqual([0, 5, 20, 45, 200].map(heatLevel), [0, 1, 2, 3, 4]);

assert.equal(efficiencyOf(10, 3600), 10); // ten words in an hour
assert.equal(efficiencyOf(5, 1800), 10);
assert.equal(efficiencyOf(10, 0), null); // no immersion at all is undefined, not "0 per hour"

assert.equal(activeDaysOf({ [keys[0]]: 60, [keys[1]]: 0 }, keys), 1);
assert.deepEqual(addedPerDay([{ addedAt: T0 }, { addedAt: T0 }, {}], dayKey), { [dayKey(T0)]: 2 });

// --- top videos & leeches ---
const tv = topVideos(
  [
    { videoId: "a", title: "A", suspended: true },
    { videoId: "a", title: "A" },
    { videoId: "b", title: "B" },
  ],
  { a: 1800 }, // half an hour on video A
);
assert.deepEqual(tv.map((g) => [g.title, g.total, g.known, g.learning, g.perHour]), [
  ["A", 2, 1, 1, 4], // 2 words in 0.5h
  ["B", 1, 0, 1, null], // no immersion recorded → no rate, rather than a fake zero
]);

assert.deepEqual(
  leeches([{ word: "a", lapses: 5 }, { word: "b", lapses: 1 }, { word: "c", lapses: 3 }]).map(
    (w) => w.word,
  ),
  ["a", "c"], // worst first, and a single lapse is not yet a leech
);

// --- library search ---
const lib = [
  { id: "a", word: "grew into", contextZh: "發展成為", sentence: "It grew into the foundation." },
  { id: "b", word: "laptop", context: "a portable computer", title: "Run LLMs Locally" },
];
assert.deepEqual(searchWords(lib, "").length, 2);
assert.deepEqual(searchWords(lib, "GREW").map((w) => w.id), ["a"]); // case-insensitive
assert.deepEqual(searchWords(lib, "發展").map((w) => w.id), ["a"]); // the Chinese explanation
assert.deepEqual(searchWords(lib, "foundation").map((w) => w.id), ["a"]); // the sentence
assert.deepEqual(searchWords(lib, "locally").map((w) => w.id), ["b"]); // the video title
assert.deepEqual(searchWords(lib, "zzz"), []);

assert.equal(dueLabel({ suspended: true }, T0), "已掌握");
assert.equal(dueLabel({}, T0), "尚未複習");
assert.equal(dueLabel({ due: T0 - DAY }, T0), "今天到期"); // overdue reads as due now, not "-1 天"
assert.equal(dueLabel({ due: T0 + 3 * DAY }, T0), "3 天後");

assert.deepEqual(filterWords(lib, "all").length, 2);
assert.deepEqual(filterWords([{ suspended: true }, {}], "known").length, 1);
assert.deepEqual(filterWords([{ suspended: true }, {}], "learning").length, 1);

// grouped by the day it was added, newest group first, with today/yesterday named
const grouped = groupWords(
  [{ id: "n", addedAt: T0 }, { id: "y", addedAt: T0 - DAY }, { id: "old" }],
  dayKey,
  T0,
);
assert.deepEqual(grouped.map((g) => [g.label, g.items.map((w) => w.id)]), [
  ["今天", ["n"]],
  ["昨天", ["y"]],
  ["更早", ["old"]], // no addedAt at all still gets a home rather than vanishing
]);

// The pure functions above are only half the risk. start_() never runs in Node, so a load-time
// error (a const used before its declaration, a missing global) sails past every assertion here.
require("child_process").execFileSync(process.execPath, [__dirname + "/smoke.js"], {
  stdio: "inherit",
});

// --- zhFor: why the Chinese line used to vanish on short sentences ---
const zh = [
  { start: 0, end: 4, text: "第一句。" },
  { start: 4, end: 9, text: "第二句，" },
  { start: 9, end: 12, text: "接續。" },
];
assert.equal(zhFor(zh, { start: 0, end: 5 }), "第一句。");
assert.equal(zhFor(zh, { start: 5, end: 12 }), "第二句，接續。");
// the regression itself: a short sentence whose translation cue began a beat early — the old
// start-in-window test matched nothing here and the line disappeared entirely
assert.equal(zhFor(zh, { start: 4.5, end: 6 }), "第二句，");
// the last sentence has end = Infinity and must still find its cue
assert.equal(zhFor(zh, { start: 9, end: Infinity }), "接續。");
assert.equal(zhFor([], { start: 0, end: 5 }), ""); // no zh track at all: empty, not a crash

// --- cueUrl: the player may itself be on an auto-translated track ---
const stashed = "https://www.youtube.com/api/timedtext?v=abc&pot=SIG&tlang=zh-Hant&lang=en";
// base fetch strips the player's tlang — the English pipeline must never run on translated text
assert.equal(cueUrl(stashed).searchParams.get("tlang"), null);
assert.equal(cueUrl(stashed).searchParams.get("pot"), "SIG"); // the signature survives untouched
assert.equal(cueUrl(stashed).searchParams.get("fmt"), "json3");
// the zh fetch re-adds exactly the language it wants
assert.equal(cueUrl(stashed, "zh-Hant").searchParams.get("tlang"), "zh-Hant");

// --- mid-cue sentence starts: why S (replay) stuck on the last word ---
// A cue holding "tail of sentence N. start of N+1" used to give N+1 the CUE's start time —
// up to a whole cue early, inside N's own tail — so replay jumped onto N's last word.
const mid = toSentences([
  { start: 0, end: 4, text: "First one. Second" },
  { start: 4, end: 8, text: "half done." },
]);
assert.equal(mid.length, 2);
assert.equal(mid[1].text, "Second half done.");
assert.ok(mid[1].start > 2 && mid[1].start < 4); // interpolated into the cue, past "First one."
assert.equal(mid[0].end, mid[1].start); // sentence N keeps its tail — playing() attribution follows

