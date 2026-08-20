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
  ...require("../../review.js"),
  ...require("../../analytics.js"),
  ...require("../../library.js"),
  ...require("../../merge.js"),
};
