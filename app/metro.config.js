const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, "..");

// The app requires the extension's own review.js / merge.js rather than a copy of them. The
// forgetting curve, the queue order and the merge rules have each been tuned against real use and
// corrected more than once; two copies would drift apart within a month, and the phone would
// quietly schedule differently from the desktop. Sharing the file is also why those files stay
// plain JS with the `module.exports` guard at the bottom — a .ts port could not be loaded by the
// extension's <script> tags.
// watchFolders lets Metro resolve and hot-reload files above the app directory.
const config = getDefaultConfig(projectRoot);
config.watchFolders = [repoRoot];
// Without this Metro also searches repoRoot/node_modules, which does not exist and must not:
// the extension half of this repo is deliberately dependency-free.
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules")];

module.exports = config;
