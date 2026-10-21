const { File, Directory, Paths } = require("expo-file-system");

// 跟讀 takes. expo-audio writes every recording to a NEW file — recording-<UUID>.m4a — and
// deletes none of them, so without this they pile up in the cache for good: at ~8 seconds a
// take and a few dozen takes a day, that is the better part of a gigabyte a year. Only the take
// being compared right now is ever worth keeping.
//
// They are not in the cache root but in a subfolder, named per platform (read off the native
// sources: Android `cacheDirectory/Audio`, iOS `cachesDirectory/ExpoAudio`). A sweep of the root
// alone — the obvious reading of the docs — would find nothing.
const DIRS = ["Audio", "ExpoAudio"];

// Delete one take. File.delete() THROWS on a file that is not there (FileSystemPath.delete on
// Android), and a cleanup failing must never interrupt practice — so check, and swallow the rest.
function dropClip(uri) {
  if (!uri) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // already gone, or not ours to touch; the next sweep will try again
  }
}

// Remove every take left behind except `keep` — leftovers from a session the app was killed in
// mid-take, or from builds before this cleanup existed. Returns how many went.
function sweepClips(keep) {
  let n = 0;
  for (const name of DIRS) {
    try {
      const dir = new Directory(Paths.cache, name);
      if (!dir.exists) continue;
      for (const item of dir.list()) {
        if (item instanceof File && item.name.startsWith("recording-") && item.uri !== keep) {
          try {
            item.delete();
            n += 1;
          } catch {
            // one stubborn file must not stop the rest
          }
        }
      }
    } catch {
      // this platform does not use this folder
    }
  }
  return n;
}

module.exports = { dropClip, sweepClips };
