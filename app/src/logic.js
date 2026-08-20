// The single place that reaches up into the extension's shared logic. Screens import from here
// so none of them carries its own count of `../` segments, and so there is exactly one line to
// change if the layout ever moves.
//
// These are the same files the extension loads with <script> tags — not a port, not a copy. The
// forgetting curve, the queue order and the merge rules have each been corrected against real
// use, and two copies would quietly drift into scheduling the same word differently on each
// device. Requiring them here is safe because every one guards its DOM wiring behind
// `typeof document !== "undefined"`, which is false in React Native.
module.exports = {
  ...require("./shared/content.js"), // splitPhrases / posOf / parseReply — the caption brain
  ...require("./shared/prompts.js"), // the same model and prompts the extension asks with
  ...require("./shared/review.js"),
  ...require("./shared/analytics.js"),
  ...require("./shared/library.js"),
  ...require("./shared/merge.js"),
};
