// Copies the extension's shared logic into app/src/shared/ so the app is self-contained.
//
// The copies ARE committed (not gitignored): EAS uploads only git-tracked files, so committing
// them guarantees they reach the cloud build no matter how EAS scopes the upload. The root files
// stay the single editable source — this script regenerates the copies before every start and
// every build, so they cannot drift. When run in a cloud container that only has app/ (no repo
// root), the source files are absent; that is fine — the committed copies are already correct, so
// a missing source is skipped rather than treated as an error.
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
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
