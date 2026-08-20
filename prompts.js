// The model and its prompts, shared by the extension worker and the phone app. They live in one
// file because both make the same explain call: a prompt that drifted between them would quietly
// produce two different qualities of explanation for the same word, and nobody would notice until
// the cards started reading oddly.
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

if (typeof module !== "undefined")
  module.exports = { MODEL, SYSTEM, PHRASE_SYSTEM, POS_SYSTEM };
