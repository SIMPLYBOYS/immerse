const assert = require("assert");
const { toSentences, splitPhrases, posOf, parseReply, markRate } = require("./content.js");

// --- parseReply ---
const reply = parseReply(`CONTEXT: "Grew into" means developed into something larger.
SENSE: v. | 發展成為 | It grew into a giant. | 它發展成一家巨頭。
SENSE: v. | 長大到穿得下 | He grew into his brother's coat. | 他長大到穿得下他哥的外套。`);
assert.equal(reply.context, '"Grew into" means developed into something larger.');
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
const { schedule, stats, forecast, isDue, urgency, buildQueue, streakOf, byVideo, markTarget } =
  require("./review.js");

// --- SM-2 ---
const T0 = 1_700_000_000_000;
const DAY = 86400000;

// first correct answer → 1 day, second → 6, then interval * ease
let c = schedule({}, 4, T0);
assert.equal(c.interval, 1);
assert.equal(c.due, T0 + DAY);
c = schedule(c, 4, T0);
assert.equal(c.interval, 6);
c = schedule(c, 4, T0);
assert.equal(c.interval, Math.round(6 * c.ease));

// forgetting resets the streak and schedules for tomorrow, and counts a lapse
const lapsed = schedule({ reps: 5, interval: 40, ease: 2.5 }, 0, T0);
assert.equal(lapsed.reps, 0);
assert.equal(lapsed.interval, 1);
assert.equal(lapsed.lapses, 1);

// ease can never fall below 1.3, however many times it is failed
let bad = { ease: 1.4, reps: 3, interval: 10 };
for (let i = 0; i < 10; i++) bad = schedule(bad, 3, T0);
assert.ok(bad.ease >= 1.3);

// a newly added word has no `due`, so it is due immediately
assert.equal(isDue({}, T0), true);
assert.equal(isDue({ due: T0 + DAY }, T0), false);
// 已掌握 suspends: it stays in the library but is never scheduled, even when overdue
assert.equal(isDue({ suspended: true, due: T0 - DAY }, T0), false);

assert.deepEqual(
  stats([{}, { due: T0 - 1 }, { suspended: true, due: T0 - 1 }, { due: T0 + 9 * DAY }], T0),
  { learning: 3, known: 1, due: 2, retention: null }, // no reviews yet → no rate to report
);
assert.equal(stats([{ reviews: 10, lapses: 2 }], T0).retention, 80);

// --- urgency: overdue-ness relative to the interval, which is what decides review order ---
// two days late on a two-day interval is far more urgent than two days late on a sixty-day one
assert.ok(
  urgency({ due: T0 - 2 * DAY, interval: 2 }, T0) > urgency({ due: T0 - 2 * DAY, interval: 60 }, T0),
);

// --- buildQueue: the fix for "every session starts with the same words" ---
const deck = [
  { id: "new1" },
  { id: "new2" },
  { id: "urgent", due: T0 - 5 * DAY, interval: 1 },
  { id: "mild", due: T0 - 1 * DAY, interval: 30 },
  { id: "later", due: T0 + 5 * DAY, interval: 10 },
  { id: "sus", suspended: true },
];
const q = buildQueue(deck, T0, () => 0.5).map((w) => w.id);
assert.ok(!q.includes("later") && !q.includes("sus")); // not due / suspended never queue
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

// --- markRate: the ten-marks-per-hour guard, measured on the immersion clock ---
const marked = [{ atSec: 100 }, { atSec: 3500 }, { atSec: 3700 }, {}]; // the last one predates it
assert.equal(markRate(marked, 3700), 2); // only the two inside the trailing hour
// after another hour of watching, the earlier marks age out of the window
assert.equal(markRate(marked, 7400), 0);
// a week away from YouTube must not expire the budget — it is immersion time, not wall clock
assert.equal(markRate([{ atSec: 50 }], 60), 1);

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
