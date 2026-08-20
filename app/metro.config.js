const { getDefaultConfig } = require("expo/metro-config");

// The app is self-contained: the extension's shared logic is copied into src/shared/ before
// every start and build (scripts/sync-shared.mjs), so Metro has nothing to resolve above the
// project directory and EAS can archive app/ alone.
module.exports = getDefaultConfig(__dirname);
