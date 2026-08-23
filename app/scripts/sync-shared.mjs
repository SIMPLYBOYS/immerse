// Copies the extension's shared logic into app/src/shared/ so the app is self-contained.
//
// The copies ARE committed (not gitignored): EAS uploads only git-tracked files, so committing
// them guarantees they reach the cloud build no matter how EAS scopes the upload. The root files
// stay the single editable source — this script regenerates the copies before every start and
// every build, so they cannot drift. When run in a cloud container that only has app/ (no repo
// root), the source files are absent; that is fine — the committed copies are already correct, so
// a missing source is skipped rather than treated as an error.
import { copyFileSync, mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const out = join(here, "..", "src", "shared");
mkdirSync(out, { recursive: true });

const FILES = ["content.js", "prompts.js", "review.js", "analytics.js", "library.js", "merge.js"];
let copied = 0;
for (const f of FILES) {
  const src = join(repoRoot, f);
  if (existsSync(src)) { copyFileSync(src, join(out, f)); copied++; }
}
console.log(copied ? `synced ${copied}/${FILES.length} shared files` : "shared sources absent — using committed copies");

// The extension's version is bumped on every change, so stamping it into the app makes "which
// code is this phone running" a glance instead of a guess — twice now a fix "did not load" and
// nothing on screen could say whether it had. Regenerated here, committed like the copies.
const manifest = join(repoRoot, "manifest.json");
if (existsSync(manifest)) {
  const { version } = JSON.parse(readFileSync(manifest, "utf8"));
  writeFileSync(join(out, "version.js"), `module.exports = { VERSION: ${JSON.stringify(version)} };\n`);
  console.log(`stamped v${version}`);
}
