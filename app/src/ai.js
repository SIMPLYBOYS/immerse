const { MODEL, SYSTEM } = require("./logic");

// The same request the extension's worker makes, with the same prompt out of prompts.js — the
// point of sharing that file is that a word explained on the phone reads exactly like the same
// word explained on the desktop.
//
// No worker in between: React Native has no CORS to satisfy, so the call goes straight out. The
// key therefore sits on the phone, in SecureStore, with the same trust model as the desktop's.
async function explain(apiKey, word, sentence) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 700,
      system: SYSTEM,
      messages: [{ role: "user", content: `Sentence: ${sentence}\nWord: ${word}` }],
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error?.message ?? `HTTP ${r.status}`);
  return data.content?.find((b) => b.type === "text")?.text || "(no reply)";
}

module.exports = { explain };
