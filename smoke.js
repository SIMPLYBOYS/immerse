// Does content.js actually start? test.js only reaches the pure functions — start_() never runs
// there, which is how a `const` used above its own declaration shipped twice. This stubs the bare
// minimum of the browser the load path touches and asserts the script got all the way through.
const assert = require("assert");

const node = () => ({
  style: {},
  dataset: {},
  classList: { add() {}, toggle() {}, contains: () => false },
  textContent: "",
  className: "",
  hidden: false,
  appendChild: (c) => c,
  append() {},
  replaceChildren() {},
  addEventListener() {},
  closest: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }),
});

global.window = global;
global.location = { search: "?v=smoke", origin: "https://www.youtube.com" };
global.innerWidth = 1280;
global.innerHeight = 720;
global.MutationObserver = class {
  observe() {}
  disconnect() {}
};
global.setInterval = () => 0; // the real one would hold the process open forever
global.document = {
  ...node(),
  head: node(),
  body: node(),
  documentElement: node(),
  createElement: node,
  createTextNode: (t) => ({ text: t }),
  getElementById: () => null,
  title: "smoke - YouTube",
};
global.chrome = {
  runtime: { id: "smoke", sendMessage: (_m, cb) => cb?.({ text: "" }) },
  storage: { local: { get: async () => ({}), set: async () => {} } },
};

require("./content.js");

// Reaching this line at all means the whole module body executed: no missing global, no use
// before initialisation, no syntax that only bites at runtime.
assert.ok(global.window.__im, "content.js did not finish starting");
assert.ok(Array.isArray(global.window.__im.sentences));

console.log("smoke ok");
