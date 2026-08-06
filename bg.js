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
};

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  const job =
    JOBS[msg.type]?.(msg) ??
    claude(SYSTEM, `Sentence: ${msg.sentence}\nWord: ${msg.word}`, 700, "explain");
  job
    .then((text) => respond({ text: String(text) }))
    .catch((e) => respond({ error: String(e.message || e) }));
  return true; // keep the channel open for the async respond
});

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
