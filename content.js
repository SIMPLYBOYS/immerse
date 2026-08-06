// immerse — click a caption word, get an AI explanation of it in context; A/S/D to move by
// sentence; Z for a Chinese line. Isolated world, no build step.
// hook.js (MAIN world) supplies the player's signed timedtext URL; bg.js makes the Claude call.

const SEG = ".ytp-caption-segment";
const BOX = "#ytp-caption-window-container";
const WORD = /[A-Za-z][A-Za-z'’-]*/;
// A sentence ends only when the punctuation is followed by space/end, so "llama.cpp" stays whole.
// ponytail: "3.5" mid-number can still false-close one. Rare enough to eat.
const SENTENCE = /^([\s\S]*?[.!?]+)(\s+|$)/;

// Closed word classes: the full membership is short and fixed, so a lookup table is exact and
// free. Only verbs and nouns are open-ended enough to need the model.
const set = (s) => new Set(s.split(" "));
const PREP = set(`about above across after against along among around as at before behind below
  beneath beside between beyond by down during except for from in inside into near of off on onto
  out outside over past since through throughout to toward towards under until up upon with within
  without`.split(/\s+/).filter(Boolean).join(" "));
const AUX = set("am is are was were be been being have has had do does did will would shall should can could may might must");
const DET = set("a an the this that these those my your his her its our their some any each every no");
const PRON = set("i you he she it we they me him us them who whom whose which what");
const CONJ = set("and but or nor so yet because although though while if unless whereas than");

// `learned` is the model's word→verb/noun map; undefined means "leave it neutral".
function posOf(word, learned) {
  const w = word.toLowerCase();
  if (AUX.has(w)) return "aux";
  if (PREP.has(w)) return "prep";
  if (DET.has(w)) return "det";
  if (PRON.has(w)) return "pron";
  if (CONJ.has(w)) return "conj";
  if (!learned) return undefined;
  if (learned[w]) return learned[w];
  // The model still answers with base forms sometimes, so try the obvious endings before giving
  // up. ponytail: a naive stemmer, not a lemmatiser — irregulars like "grew"→"grow" stay unmatched.
  // A real one means npm and a bundler, which this project does not have.
  // Each ending is its own candidate: an alternation would let /(es|s)$/ eat "sees" down to "se".
  // A wrong stem is harmless because only an exact hit in the map is accepted.
  for (const stem of [
    w.replace(/ies$/, "y"), // stories → story
    w.replace(/s$/, ""), // sees → see
    w.replace(/es$/, ""), // watches → watch
    w.replace(/ed$/, ""), // opened → open
    w.replace(/ing$/, ""), // talking → talk
    w.replace(/ing$/, "e"), // making → make
    w.replace(/([bdgklmnprt])\1(ing|ed)$/, "$1"), // running → run, stopped → stop
  ]) {
    if (stem !== w && learned[stem]) return learned[stem];
  }
  return undefined;
}

// The model answers in a line format rather than prose so the popup can lay it out: the
// in-context meaning first, then a few general senses each with an example and its translation.
// Malformed lines are dropped rather than rendered, so a bad reply degrades to less content
// instead of a broken panel.
function parseReply(text) {
  const senses = [];
  let context = "";
  let contextZh = "";
  let zh = "";
  for (const line of String(text ?? "").split("\n")) {
    const l = line.trim();
    // CONTEXT_ZH before CONTEXT: the longer prefix has to win, or it is swallowed by the shorter.
    if (l.startsWith("CONTEXT_ZH:")) contextZh = l.slice(11).trim();
    else if (l.startsWith("CONTEXT:")) context = l.slice(8).trim();
    else if (l.startsWith("ZH:")) zh = l.slice(3).trim();
    else if (l.startsWith("SENSE:")) {
      // Not named `zh`: that one is the whole sentence's translation, this is the example's.
      const [pos, gloss, example, egzh] = l.slice(6).split("|").map((p) => p.trim());
      if (pos && gloss) senses.push({ pos, gloss, example, zh: egzh });
    }
  }
  // A reply that ignored the format entirely is still worth showing as plain text.
  return {
    context: context || (senses.length ? "" : String(text ?? "").trim()),
    contextZh,
    zh,
    senses,
  };
}

// zeroStudy's own guidance: no more than ten marks per hour of immersion. Past that the reviews
// pile up faster than they can be cleared and the deck stops being reviewable at all.
const MARKS_PER_HOUR = 10;

// A plain wall-clock hour. This originally ran on the immersion clock ("an hour of watching"),
// which meant marks from yesterday still filled the window after a 10-hour break — technically
// consistent, practically absurd for an advisory cap on a personal tool. Only 學習中 counts:
// the cap exists to protect the review queue, and a word marked 已掌握 never enters it.
function markRate(words, now, windowMs = 3600_000) {
  return words.filter(
    (w) => !w.suspended && w.addedAt != null && w.addedAt > now - windowMs,
  ).length;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const bounded = (word, flags) =>
  new RegExp(`(?<![A-Za-z'’-])${escapeRe(word)}(?![A-Za-z'’-])`, flags);

// Case-insensitive, whole-word search: "grew into" must not match inside "grown into".
function indexOfWord(text, phrase) {
  const m = text.match(bounded(phrase, "i"));
  return m ? m.index : -1;
}

// Cut `text` into runs, marking the stretches that are known multi-word expressions so they can
// be rendered as one clickable unit. Idioms and phrasal verbs are exactly what an advanced
// learner misses, and boxing each word separately hides them.
function splitPhrases(text, phrases = []) {
  const out = [];
  let rest = text;
  while (rest) {
    let best = null;
    for (const p of phrases) {
      const at = indexOfWord(rest, p);
      // Earliest match wins; on a tie the longer phrase does, so "look forward to" beats
      // "look forward".
      if (at >= 0 && (!best || at < best.at || (at === best.at && p.length > best.p.length))) {
        best = { at, p };
      }
    }
    if (!best) {
      out.push({ text: rest });
      break;
    }
    out.push({ text: rest.slice(0, best.at) });
    out.push({ text: rest.slice(best.at, best.at + best.p.length), phrase: true });
    rest = rest.slice(best.at + best.p.length);
  }
  return out.filter((run) => run.text);
}

// Stitch the timed cues into sentences. Cues break mid-sentence ("...like Qwen, Kimmy, and the" /
// "GLM family are..."), so the text is concatenated and re-split on punctuation. Each sentence
// carries the time its first word is spoken — cue start when it opens a cue, interpolated by
// character position when it starts mid-cue. That is what A/S/D seeks to.
function toSentences(cues) {
  const out = [];
  let buf = "";
  let start = null;
  for (const c of cues) {
    if (start === null) start = c.start;
    buf = buf ? `${buf} ${c.text}` : c.text;
    let m;
    while ((m = buf.match(SENTENCE))) {
      out.push({ text: m[1].trim(), start });
      buf = buf.slice(m[0].length);
      if (!buf.trim()) {
        // Nothing left over: the next sentence starts in whichever cue comes next.
        start = null;
      } else {
        // The next sentence starts mid-cue. A cue-granular start sits up to a whole cue early —
        // inside the tail of the sentence just pushed — so the previous sentence's last words
        // were attributed to the next one, and S (replay) kept landing on its own last word.
        // Interpolate by character position; without a finite cue end, fall back to cue start.
        const consumed = Math.max(0, c.text.length - buf.length);
        const dur = Number.isFinite(c.end) ? c.end - c.start : 0;
        start = c.start + (c.text.length && dur > 0 ? (dur * consumed) / c.text.length : 0);
      }
    }
  }
  if (buf.trim()) out.push({ text: buf.trim(), start });
  // A sentence runs until the next one starts, which makes "which sentence is playing" a lookup.
  out.forEach((s, k) => (s.end = out[k + 1]?.start ?? Infinity));
  return out;
}

// Which zh cues translate sentence `s`. The zh track is segmented differently from the English
// one (a cue often straddles two sentences), so cues are assigned to the sentence their MIDPOINT
// falls in — the old "starts inside the window" test returned nothing for a short sentence whose
// translation cue began a beat early, and the line silently vanished. If no midpoint lands in the
// window (very short sentence), fall back to whichever cue is playing at the sentence's centre.
function zhFor(zhCues, s) {
  const mid = (c) => (c.end === Infinity ? c.start : (c.start + (c.end ?? c.start)) / 2);
  let cues = zhCues.filter((c) => mid(c) >= s.start && mid(c) < s.end);
  if (!cues.length) {
    const horizon = s.end === Infinity ? s.start + 15 : s.end;
    const centre = (s.start + horizon) / 2;
    cues = zhCues.filter((c) => c.start <= centre && centre < (c.end ?? Infinity));
  }
  return cues.map((c) => c.text).join("");
}

// Build the timedtext URL for a fetch. The stashed URL may already carry tlang=… — when the
// player itself is displaying an auto-translated track — and must be stripped, or the "English"
// pipeline (sentences, phrases, POS) silently runs on the translated text. YouTube renders one
// track at a time; both languages at once is exactly what the Z line exists for.
function cueUrl(url, tlang) {
  const u = new URL(url, "https://www.youtube.com");
  u.searchParams.set("fmt", "json3");
  u.searchParams.delete("tlang");
  if (tlang) u.searchParams.set("tlang", tlang);
  return u;
}

function start_() {
  const state = { captures: [], open: null, anchor: null, marks: {}, zhOn: false, blurOn: false,
    trackUrl: null, cues: [], sentences: [], zhCues: [], phrases: [], pos: {},
    explains: new Map() }; // word|sentence → in-flight or settled explanation, so a re-click never re-bills
  window.__im = state;

  // Immersion clock: seconds of video actually playing in a visible tab. Flushed every 15s rather
  // than every tick — a storage write per second would be absurd for a counter nobody watches.
  function tickImmersion() {
    const v = video();
    if (v && !v.paused && !v.ended && !document.hidden) state.imm += 1;
    if (state.imm - state.immSaved >= 15) {
      const delta = state.imm - state.immSaved;
      state.immSaved = state.imm;
      // Two shapes on purpose: `immersion` is a monotonic clock the mark-rate budget measures
      // against, `immLog` is per-day and is what the daily goal reads.
      const day = new Date();
      const key = `${day.getFullYear()}-${day.getMonth() + 1}-${day.getDate()}`;
      // ponytail: read-modify-write, so two YouTube tabs open at once can lose a few seconds.
      const vid = new URLSearchParams(location.search).get("v");
      getStore(["immersion", "immLog", "immByVideo"]).then(
        ({ immersion = 0, immLog = {}, immByVideo = {} }) => {
          immLog[key] = (immLog[key] ?? 0) + delta;
          // Per-video too, so "words per hour" can be answered for one video and not just overall.
          if (vid) immByVideo[vid] = (immByVideo[vid] ?? 0) + delta;
          setStore({ immersion: immersion + delta, immLog, immByVideo });
        },
      );
    }
  }

  // Reloading the extension orphans this script: chrome.* is still there but every call throws
  // "Extension context invalidated". chrome.runtime.id going undefined is the signal — but the
  // invalidation is not atomic, so a storage call can throw while the id still reads fine. Every
  // chrome.* call therefore goes through safe(), which swallows both the synchronous throw from
  // the call itself and the rejection of the promise it returns.
  const alive = () => !!chrome.runtime?.id;
  const safe = (fn, fallback) => {
    try {
      return Promise.resolve(fn()).catch(() => fallback);
    } catch {
      return Promise.resolve(fallback);
    }
  };
  // Named getStore/setStore, not get/set: `set` is already the word-class Set builder above.
  const getStore = (keys, fallback = {}) => safe(() => chrome.storage.local.get(keys), fallback);
  const setStore = (obj) => safe(() => chrome.storage.local.set(obj), undefined);

  getStore(["marks", "zhOn", "blurOn", "immersion"]).then((r) => {
    state.marks = r.marks ?? {};
    state.zhOn = !!r.zhOn;
    state.imm = r.immersion ?? 0;
    state.immSaved = state.imm;
    setBlur(!!r.blurOn);
    repaint();
  });

  // 進階聽力: blur the English words so the ear has to do the work — reading captions is the
  // path of least resistance, and the brain will take it every time it is available. Hovering
  // peeks at one word (and the hover-freeze pauses the video, so a peek also stops the clock);
  // the Chinese line stays sharp, which combined with Z gives translation-only listening.
  // CSS does all of it: the toggle is just a class on <html>.
  function setBlur(on) {
    state.blurOn = on;
    document.documentElement.classList.toggle("im-blur", on);
  }

  function toggleBlur() {
    setBlur(!state.blurOn);
    setStore({ blurOn: state.blurOn });
  }

  // sendMessage reports a dead service worker through lastError, not through the reply — without
  // this the failure arrives as a bare `undefined` and looks like an empty answer.
  const askOnce = (payload) =>
    new Promise((ok) => {
      if (!alive()) return ok({ error: "擴充剛重新載入，請重新整理這個分頁" });
      chrome.runtime.sendMessage(payload, (r) =>
        ok(chrome.runtime.lastError ? { error: chrome.runtime.lastError.message } : r),
      );
    });
  // "message channel closed" = the worker died mid-call (idle kill, update). The failure is the
  // worker's, not the request's — a new message wakes a fresh worker, so one retry usually lands.
  const ask = (payload) =>
    askOnce(payload).then((r) =>
      String(r?.error ?? "").includes("message channel closed") ? askOnce(payload) : r,
    );
  const video = () => document.querySelector("video");

  // --- transcript -----------------------------------------------------------------------------
  // The same signed URL with tlang= returns YouTube's own translation, so the Chinese line costs
  // no API call. Same origin as the page, so no CORS problem.
  async function fetchCues(url, tlang) {
    const r = await fetch(cueUrl(url, tlang));
    if (!r.ok) return [];
    const json = await r.json().catch(() => null);
    const list = (json?.events ?? [])
      .filter((e) => e.segs)
      .map((e) => ({
        start: e.tStartMs / 1000,
        text: e.segs.map((s) => s.utf8).join("").replace(/\s+/g, " ").trim(),
      }))
      .filter((c) => c.text);
    // Each cue runs until the next one starts — zhFor needs midpoints, which need ends.
    list.forEach((c, i) => (c.end = list[i + 1]?.start ?? Infinity));
    return list;
  }

  async function loadTrack() {
    const url = document.documentElement.dataset.imTimedtext;
    if (!url || url === state.trackUrl) return; // also re-fires on SPA navigation to a new video
    // No video id means a homepage/preview player fired this request. There is nothing to study
    // and no cache key to file under — and hover-previews must not burn phrase/POS calls.
    // trackUrl is deliberately left unset so the real watch page re-evaluates from scratch.
    if (!new URLSearchParams(location.search).get("v")) return;
    state.trackUrl = url;
    // Remember whether the on-screen captions are a translated track, to hint the user below.
    state.translatedTrack = url.includes("tlang=");
    state.zhCues = [];
    state.phrases = [];
    state.pos = {};
    state.cues = await fetchCues(url);
    state.sentences = toSentences(state.cues);
    if (state.zhOn) state.zhCues = await fetchCues(url, "zh-Hant");
    console.log("[immerse]", state.sentences.length, "sentences from", state.cues.length, "cues");
    // Homepage preview players fire timedtext requests too, and those often yield no usable
    // cues — an empty transcript must never reach the model (the API rejects empty content,
    // and there is nothing to ask about anyway).
    if (!state.sentences.length) return;
    loadPhrases();
    loadPos();
  }

  // Same batch-once-per-video shape as loadPhrases. Untagged words simply render neutral, so a
  // partial or missing answer degrades quietly instead of breaking the captions.
  async function loadPos() {
    const key = `pos3_${new URLSearchParams(location.search).get("v")}`;
    const full = state.sentences.map((s) => s.text).join(" ");
    const head = full.slice(0, 80);
    const hit = (await getStore(key))[key];
    const cached = hit?.head === head ? hit.raw : undefined;
    const res = cached !== undefined ? { text: cached } : await ask({ type: "pos", text: full });
    if (!res || res.error) return console.warn("[immerse] pos failed:", res?.error ?? "no reply");
    const raw = res.text ?? "";
    state.pos = Object.fromEntries(
      raw
        .split("\n")
        .map((l) => l.trim().split(/\s+/))
        .filter(([w, tag]) => w && ["verb", "noun", "adj"].includes(tag))
        .map(([w, tag]) => [w.toLowerCase(), tag]),
    );
    if (!cached && Object.keys(state.pos).length) setStore({ [key]: { raw, head } });
    console.log("[immerse]", Object.keys(state.pos).length, "words tagged");
    repaint();
  }

  // One call per video, not per sentence — the transcript goes over whole and comes back as a
  // list. Cached per video so a page reload doesn't pay for it again.
  async function loadPhrases() {
    const videoId = new URLSearchParams(location.search).get("v");
    // The prefix is the prompt version: bump it and every cached answer is re-asked, since a
    // stored list from an older prompt is exactly as wrong as a stale one.
    const key = `ph3_${videoId}`;
    const full = state.sentences.map((s) => s.text).join(" ");
    // A cache entry is only trusted if it was written for this exact transcript. SPA navigation
    // leaves the previous video's timedtext URL on <html> for a tick, so a videoId alone is not
    // proof the stored answer belongs to the text we are about to match against.
    const head = full.slice(0, 80);
    const hit = (await getStore(key))[key];
    const cached = hit?.head === head ? hit.raw : undefined;
    const res = cached !== undefined ? { text: cached } : await ask({ type: "phrases", text: full });
    // Don't let an API failure turn into "0 phrases" — that looks identical to a working
    // extension that simply found nothing, which is why this state is reported in the popup.
    if (!res || res.error) {
      state.phraseNote = `phrases failed: ${res?.error ?? "no reply from the worker"}`;
      return console.warn("[immerse]", state.phraseNote);
    }
    const raw = res.text ?? "";
    // Keep only expressions that really occur in this transcript. A hallucinated phrase simply
    // won't match, which makes this line the entire verification step.
    state.phrases = raw
      .split("\n")
      // Strip list markers the model adds despite being told not to; "- grew into" would never
      // match the transcript and would be silently dropped.
      .map((p) => p.trim().replace(/^[-*•–]+\s*|^\d+[.)]\s*/, "").trim())
      .filter((p) => p.includes(" ") && indexOfWord(full, p) >= 0);
    if (!cached && state.phrases.length) setStore({ [key]: { raw, head } });
    state.phraseNote = state.phrases.length
      ? `${state.phrases.length} phrases: ${state.phrases.slice(0, 4).join(" / ")}`
      : // Nothing matched: show both sides so a wrong-transcript case is obvious at a glance.
        `0 matched | sent "${head.slice(0, 50)}…" | got ${raw.replace(/\n/g, " / ").slice(0, 90) || "(empty)"}`;
    console.log("[immerse]", state.phraseNote, state.phrases);
    repaint();
  }

  const playing = () => {
    const t = video()?.currentTime ?? 0;
    return state.sentences.findIndex((s) => t >= s.start && t < s.end);
  };

  // The caption on screen lags the clock by up to a cue, so trust the word over the timestamp.
  function sentenceFor(word) {
    const k = playing();
    if (k < 0) return null;
    const re = bounded(word);
    for (const j of [k, k - 1, k + 1]) {
      if (state.sentences[j] && re.test(state.sentences[j].text)) return state.sentences[j];
    }
    return state.sentences[k];
  }

  function seek(delta) {
    const v = video();
    if (!v || !state.sentences.length) return;
    const k = Math.max(0, playing());
    const target = state.sentences[Math.min(state.sentences.length - 1, Math.max(0, k + delta))];
    if (target) v.currentTime = target.start;
  }

  // --- clickable caption words ----------------------------------------------------------------
  function wrap(seg) {
    const text = seg.textContent;
    if (seg.dataset.imText === text) return;
    seg.textContent = "";
    seg.appendChild(tokenSpans(text));
    seg.dataset.imText = seg.textContent;
  }

  // Colour each word by part of speech. A phrase chip stays a single click target but shows its
  // verb and particle separately — seeing "grew" and "into" in different colours inside one box
  // is the whole point of grouping it.
  function posSpans(text) {
    return text
      .split(/(\s+)/)
      .filter(Boolean)
      .map((tok) => {
        const w = tok.match(WORD);
        if (!w) return document.createTextNode(tok);
        const s = document.createElement("span");
        const p = posOf(w[0], state.pos);
        if (p) s.className = `im-${p}`;
        s.textContent = tok;
        return s;
      });
  }

  function chip(display, word, isPhrase) {
    const el = document.createElement("span");
    const how = state.marks[word.toLowerCase()]; // marks are case-insensitive
    // im-anchor re-applied on rebuild, same as the mark colours — the spans are ephemeral.
    el.className = ["im-w", isPhrase && "im-phrase", how && `im-${how}`,
      word === state.anchor && "im-anchor"].filter(Boolean).join(" ");
    el.append(...posSpans(display)); // keeps the comma; dataset holds the clean word
    el.dataset.imWord = word;
    return el;
  }

  function tokenSpans(text) {
    const frag = document.createDocumentFragment();
    // Phrases the user circled and marked join the model-detected ones, so a learned expression
    // keeps rendering as one boxed unit in every later video.
    const phrases = state.phrases.concat(Object.keys(state.marks).filter((k) => k.includes(" ")));
    // ponytail: a caption line can cut a phrase in half; that one just renders as separate
    // words rather than being tracked across segments.
    for (const run of splitPhrases(text, phrases)) {
      if (run.phrase) {
        frag.appendChild(chip(run.text, run.text, true));
        continue;
      }
      for (const tok of run.text.split(/(\s+)/)) {
        if (!tok) continue;
        const w = tok.match(WORD);
        if (!w) frag.appendChild(document.createTextNode(tok));
        else frag.appendChild(chip(tok, w[0]));
      }
    }
    return frag;
  }

  // wrap() skips a segment whose text it already handled, so a colour change needs the memo cleared.
  function repaint() {
    document.querySelectorAll(SEG).forEach((s) => {
      delete s.dataset.imText;
      wrap(s);
    });
  }

  function tick() {
    document.querySelectorAll(SEG).forEach(wrap);
    paintZh();
  }

  function capture(el, phrase) {
    const word = phrase ?? el.dataset.imWord;
    const videoId = new URLSearchParams(location.search).get("v");
    const t = +(video()?.currentTime ?? 0).toFixed(2);
    const s = sentenceFor(word);
    const item = { id: `${videoId}:${t}:${word}`, word, videoId, t, sentence: s?.text ?? null,
      context: "", senses: [], done: false };
    state.captures.push(item);
    state.open = { item, el };
    freeze(); // keyboard or programmatic clicks never went through the hover path
    if (!s) {
      Object.assign(item, { context: "(no transcript yet — turn captions on and reload)", done: true });
      render();
      return;
    }
    render();
    // One request per (word, sentence), shared and cached: re-opening the card, or clicking the
    // same word twice quickly, must not bill twice. Errors are evicted so a retry really retries.
    const cacheKey = `${word}|${s.text}`;
    const hit = state.explains.get(cacheKey);
    const job =
      hit ??
      ask({ type: "explain", word, sentence: s.text }).then((r) => {
        if (r?.text) return parseReply(r.text);
        state.explains.delete(cacheKey);
        return parseReply(r?.error ?? "(no reply)");
      });
    if (!hit) state.explains.set(cacheKey, job);
    job.then((parsed) => {
      Object.assign(item, parsed, { done: true });
      // Marked before the reply landed: the stored row was saved empty, so write it back now
      // that there is something worth reviewing.
      const how = state.marks[item.word.toLowerCase()];
      if (how) deck(item, how);
      render();
    });
  }

  // The deck is only ever changed by pressing 學習中 / 已掌握. Clicking a word is curiosity, not
  // a commitment to memorise it — auto-saving every click filled the review queue with noise.
  // Keyed on the lowercased word, so meeting the same word in a second video updates one entry
  // rather than creating a duplicate card.
  async function deck(item, how) {
    const { words = [] } = await getStore("words");
    const id = item.word.toLowerCase();
    const at = words.findIndex((w) => w.id === id);
    if (!how) {
      if (at >= 0) words.splice(at, 1);
    } else {
      const row = {
        addedAt: Date.now(), // only set on first add; the spread below keeps an existing stamp
        ...(at >= 0 ? words[at] : {}), // keep whatever scheduling the card already has
        id,
        word: item.word,
        context: item.context,
        contextZh: item.contextZh,
        senses: item.senses,
        sentence: item.sentence,
        zh: item.zh,
        videoId: item.videoId,
        title: document.title.replace(/ - YouTube$/, ""),
        t: item.t,
        suspended: how === "known", // 已掌握 stays in the library but off the review queue
        knownAt: how === "known" ? Date.now() : undefined, // for the "mastered this week" count
      };
      if (at >= 0) words[at] = row;
      else words.push(row);
    }
    await setStore({ words });
    return words;
  }

  async function mark(item, how) {
    if (!alive()) {
      state.markNote = "擴充剛重新載入，請重新整理這個分頁後再標記";
      return render();
    }
    const k = item.word.toLowerCase();
    const clearing = state.marks[k] === how; // pressing the same button again removes it entirely
    if (clearing) delete state.marks[k];
    else state.marks[k] = how;
    setStore({ marks: state.marks });
    repaint();
    render();
    const words = await deck(item, clearing ? null : how);
    const n = markRate(words, Date.now());
    // A warning, not a block: it is your call, but an unclearable backlog is the failure mode.
    state.markNote =
      n > MARKS_PER_HOUR
        ? `近一小時已標記 ${n} 個學習中，建議 ≤ ${MARKS_PER_HOUR}，標太多會複習不完`
        : "";
    render();
  }

  // --- Chinese line ---------------------------------------------------------------------------
  async function toggleZh() {
    state.zhOn = !state.zhOn;
    setStore({ zhOn: state.zhOn });
    if (state.zhOn && !state.zhCues.length && state.trackUrl) {
      state.zhCues = await fetchCues(state.trackUrl, "zh-Hant");
    }
    paintZh();
  }

  // The line lives INSIDE YouTube's caption window, not at fixed viewport coordinates. The old
  // approach measured the segments' rect and pinned a fixed div under it — but the segments are
  // rebuilt several times a second, a mid-rebuild rect reads 0,0, and the line jumped to the
  // top-left of the screen. As a child of the window it rides along with dragging, fullscreen
  // and reflow for free, with no coordinate maths to go stale.
  function paintZh() {
    let el = document.getElementById("im-zh");
    if (!el) {
      el = document.createElement("div");
      el.id = "im-zh";
      document.body.appendChild(el); // reparented under the caption window as soon as one exists
    }
    const segs = document.querySelectorAll(SEG);
    const s = state.sentences[playing()];
    if (!segs.length) {
      el.style.display = "none";
      return;
    }
    let text;
    if (state.translatedTrack) {
      // The captions on screen are Chinese already — clicking them queries garbage, and a zh
      // line under a zh track helps nobody. Say what to do instead of failing quietly.
      text = "YouTube 字幕是自動翻譯軌——請切回英文原文，中文對照改按 Z 顯示";
    } else if (state.zhOn && s) {
      text = zhFor(state.zhCues, s);
    } else {
      el.style.display = "none";
      return;
    }
    // Both writes are guarded: our own MutationObserver watches this subtree, and an
    // unconditional append/textContent every tick would be a mutation loop.
    const win = segs[segs.length - 1].closest(".caption-window");
    if (win && el.parentElement !== win) win.appendChild(el);
    if (el.textContent !== text) el.textContent = text;
    // Track the caption font so fullscreen scales the translation with the English above it.
    el.style.fontSize = `${parseFloat(getComputedStyle(segs[0]).fontSize) * 0.72 || 18}px`;
    el.style.display = text ? "block" : "none";
  }

  // --- popup ----------------------------------------------------------------------------------
  function line(text, cls) {
    const el = document.createElement("div");
    el.className = cls;
    el.textContent = text; // never innerHTML — this is API text
    return el;
  }

  // Web Speech API: no key, no network, no cost — the teardown found zeroStudy uses the same.
  const say = (text) =>
    speechSynthesis.speak(Object.assign(new SpeechSynthesisUtterance(text), { lang: "en-US" }));

  function head(word) {
    const el = document.createElement("div");
    el.className = "im-head";
    el.append(word, " ");
    const b = document.createElement("button");
    b.textContent = "🔊";
    b.title = "pronounce";
    b.addEventListener("click", () => say(word));
    el.appendChild(b);
    return el;
  }

  function sense(s) {
    const el = document.createElement("div");
    el.className = "im-sense";
    el.append(line(s.pos, "im-pos"), line(s.gloss, "im-gloss"));
    if (s.example) el.appendChild(line(s.example, "im-eg"));
    if (s.zh) el.appendChild(line(s.zh, "im-egzh"));
    return el;
  }

  function buttons(item) {
    const row = document.createElement("div");
    row.className = "im-btns";
    for (const [how, label] of [["learning", "學習中"], ["known", "已掌握"]]) {
      const b = document.createElement("button");
      b.textContent = label;
      if (state.marks[item.word.toLowerCase()] === how) b.className = "on";
      b.addEventListener("click", () => mark(item, how));
      row.appendChild(b);
    }
    return row;
  }

  function render() {
    let box = document.getElementById("im-pop");
    if (!box) {
      box = document.createElement("div");
      box.id = "im-pop";
      box.addEventListener("click", (e) => e.stopPropagation());
      document.body.appendChild(box);
    }
    if (!state.open) {
      box.style.display = "none";
      return;
    }
    const { item, el } = state.open;
    const sent = document.createElement("div");
    sent.className = "im-sent";
    sent.appendChild(tokenSpans(item.sentence ?? ""));
    box.replaceChildren(
      head(item.word),
      // Chinese first — it is the line that unblocks you. English stays underneath as input.
      line(item.done ? item.contextZh || item.context : "…", "im-ai"),
      ...(item.contextZh && item.context ? [line(item.context, "im-ai-en")] : []),
      ...item.senses.map(sense),
      // The sentence renders as clickable word chips, exactly like the captions — reading the
      // card IS the moment you notice the phrase, so circling has to work right here, not only
      // down in the captions (which may even have moved on).
      sent,
      buttons(item),
      ...(state.markNote ? [line(state.markNote, "im-warn")] : []),
      ...(item.word.includes(" ") ? [] : [line("在下面例句按住滑鼠掃過幾個字：圈成片語一起學（字幕上用 ⇧+點兩端）", "im-note")]),
      line(state.phraseNote ?? "…finding phrases", "im-note"),
    );
    box.style.display = "block";
    // The anchor span is destroyed whenever the captions repaint — marking a word repaints to
    // recolour it — and a detached node measures 0,0, flinging the popup off-screen. That looks
    // exactly like the card closing. Reposition only while the anchor is still live; otherwise
    // hold the last position and let the reply land in a popup the user can still see.
    if (el.isConnected) {
      const r = el.getBoundingClientRect();
      box.style.left = `${Math.max(8, Math.min(r.left, innerWidth - 380))}px`;
      box.style.bottom = `${innerHeight - r.top + 8}px`;
    }
  }

  // Hovering a word freezes the caption so it can be clicked at all — by the time you decide,
  // a live caption has already moved on. Only ever un-pause a video we paused ourselves, so a
  // manually paused video stays put.
  const freeze = () => {
    const v = video();
    if (v && !v.paused) {
      v.pause();
      state.pausedByUs = true;
    }
  };

  const thaw = () => {
    if (!state.pausedByUs || state.open) return; // popup still open: they are reading
    state.pausedByUs = false;
    video()?.play();
  };

  const clearAnchor = () => {
    state.anchor = null;
    document.querySelectorAll(".im-anchor").forEach((c) => c.classList.remove("im-anchor"));
  };

  const hide = () => {
    state.open = null;
    state.markNote = ""; // the warning is feedback on the mark just made, not a persistent banner
    clearAnchor();
    render();
    thaw();
  };

  function onWord(e) {
    const el = e.target.closest?.(".im-w");
    if (!el) {
      if (e.type === "click" && !e.target.closest?.("#im-pop")) hide();
      return;
    }
    // A press that moved is YouTube repositioning its caption box. Swallowing pointerdown used to
    // kill that drag outright, so only the click is intercepted and a moved pointer is left alone.
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
    e.stopPropagation(); // the player toggles play/pause on click; that decision is ours
    e.preventDefault();
    if (e.type !== "click") return;
    // 圈選: shift-click marks one end, shift-click again marks the other, and the words between
    // become one phrase card. Shift rather than drag, because dragging moves the caption box.
    // ONLY an explicit shift-click sets an end — an earlier version treated the open card's word
    // as a free first end, which hijacked any attempt to circle a different pair while a card was
    // open into one giant junk phrase. The anchor is a WORD, never an element — YouTube rebuilds
    // the caption spans at will (the popup fly-away bug had the same root), so any stored node
    // may be disconnected by the second click; the element is re-found here.
    if (e.shiftKey) {
      const chips = [...document.querySelectorAll(".im-w")];
      // Both ends must live in the same place — the popup's sentence or the captions — or the
      // slice between them would cross containers and join unrelated words.
      const pop = el.closest("#im-pop");
      const from = (w) =>
        w ? chips.find((c) => c.dataset.imWord === w && c !== el && c.closest("#im-pop") === pop) : null;
      const anchor = from(state.anchor);
      if (!anchor) {
        clearAnchor();
        state.anchor = el.dataset.imWord;
        el.classList.add("im-anchor");
        freeze(); // hold the caption still while the other end is picked
        return;
      }
      const [i, j] = [chips.indexOf(anchor), chips.indexOf(el)].sort((x, y) => x - y);
      clearAnchor();
      return capture(el, chips.slice(i, j + 1).map((c) => c.dataset.imWord).join(" "));
    }
    clearAnchor();
    capture(el);
  }

  let down = null;
  // zeroStudy-style 拖曳圈選, on the card's example sentence only: press a word, sweep, release —
  // the swept words open as one phrase card. Only there, because on the captions a drag already
  // means "move the caption box" (explicitly kept working, at the user's request), and shift-click
  // handles circling in the captions instead.
  let sweep = null; // the sentence chip the press started on
  const SENT_W = "#im-pop .im-sent .im-w";
  const sentChips = () => [...document.querySelectorAll(SENT_W)];
  document.addEventListener(
    "pointerdown",
    (e) => {
      down = { x: e.clientX, y: e.clientY };
      sweep = e.target.closest?.(SENT_W) ?? null;
    },
    true,
  );
  document.addEventListener(
    "mouseover",
    (e) => {
      if (!sweep?.isConnected) return;
      const c = e.target.closest?.(SENT_W);
      if (!c) return;
      const chips = sentChips();
      const [i, j] = [chips.indexOf(sweep), chips.indexOf(c)].sort((a, b) => a - b);
      chips.forEach((ch, k) => ch.classList.toggle("im-anchor", k >= i && k <= j));
    },
    true,
  );
  document.addEventListener(
    "pointerup",
    (e) => {
      const start = sweep;
      sweep = null;
      if (!start?.isConnected) return;
      const chips = sentChips();
      chips.forEach((c) => c.classList.remove("im-anchor"));
      const end = e.target.closest?.(SENT_W);
      // Same chip = a plain click, which onWord already turns into a single-word card. The click
      // event after a real sweep lands on the chips' common ancestor, not a chip, so it is inert.
      if (!end || end === start) return;
      const [i, j] = [chips.indexOf(start), chips.indexOf(end)].sort((a, b) => a - b);
      capture(end, chips.slice(i, j + 1).map((c) => c.dataset.imWord).join(" "));
    },
    true,
  );
  for (const type of ["click", "dblclick"]) document.addEventListener(type, onWord, true);

  // mouseover/mouseout bubble, unlike mouseenter/mouseleave — needed because the word spans are
  // rebuilt several times a second and nothing can stay bound to them.
  document.addEventListener("mouseover", (e) => e.target.closest?.(".im-w") && freeze(), true);
  document.addEventListener(
    "mouseout",
    (e) => {
      if (!e.target.closest?.(".im-w")) return;
      if (e.relatedTarget?.closest?.(".im-w, #im-pop")) return; // moving to another word or the popup
      thaw();
    },
    true,
  );

  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape") return hide();
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const focused = document.activeElement;
      // Don't hijack the search box or a comment field.
      if (focused && (focused.isContentEditable || /input|textarea/i.test(focused.tagName))) return;
      const act = { a: () => seek(-1), s: () => seek(0), d: () => seek(1), z: toggleZh,
        x: toggleBlur }[e.key.toLowerCase()];
      if (!act) return;
      e.preventDefault();
      e.stopPropagation();
      act();
    },
    true,
  );

  document.head.appendChild(document.createElement("style")).textContent = `
    /* Every word gets an outline so it reads as clickable; marked ones override the colour. */
    /* user-select:none — a shift-click must read as circle-selection, not native text selection */
    .im-w{pointer-events:auto;cursor:pointer;user-select:none;border-radius:5px;padding:0 3px;
      box-shadow:inset 0 0 0 1px #ffffff40;transition:filter .15s}
    .im-w:hover{background:#fc0;color:#000;box-shadow:inset 0 0 0 1px #fc0}
    /* .28em, not px: caption font size jumps in fullscreen and the blur must stay unreadable */
    html.im-blur .im-w{filter:blur(.28em)}
    html.im-blur .im-w:hover{filter:none}
    /* content words bright, function words dim, particles loud — that contrast is what makes a
       phrasal verb visible at a glance */
    .im-verb{color:#7fd1ff}
    .im-noun{color:#ffd479}
    .im-adj{color:#b9f5a0}
    .im-prep{color:#ff7ab6}
    .im-aux,.im-det,.im-pron,.im-conj{color:#9aa}
    .im-phrase{box-shadow:inset 0 0 0 2px #fc0a}
    /* one end of a shift-click circle-selection, waiting for the other end */
    .im-anchor{box-shadow:inset 0 0 0 2px #fc0;background:#fc03}
    .im-learning{box-shadow:inset 0 0 0 2px #4af}
    .im-known{box-shadow:inset 0 0 0 2px #4c8}
    #im-zh{position:relative;margin-top:4px;padding:2px 8px;background:#000a;color:#fff;
      border-radius:4px;font-family:-apple-system,system-ui,sans-serif;line-height:1.5;
      text-align:center;pointer-events:none}
    #im-pop{position:fixed;z-index:99999;width:360px;max-height:60vh;overflow:auto;
      padding:12px 14px;background:#111e;color:#eee;border-radius:8px;
      font:13px/1.55 -apple-system,system-ui,sans-serif;box-shadow:0 6px 24px #0008}
    #im-pop .im-head{font-size:16px;font-weight:600;color:#fc0;margin-bottom:6px}
    #im-pop .im-head button{background:none;border:0;cursor:pointer;font-size:14px;padding:0}
    #im-pop .im-ai{white-space:pre-wrap}
    #im-pop .im-ai-en{white-space:pre-wrap;margin-top:8px;font-size:12px;color:#9a9a9a}
    #im-pop .im-sense{margin-top:10px;padding-left:9px;border-left:2px solid #444}
    #im-pop .im-pos{font-size:10px;letter-spacing:.5px;text-transform:uppercase;color:#ff7ab6}
    #im-pop .im-gloss{color:#eee}
    #im-pop .im-eg{margin-top:3px;color:#bbb}
    #im-pop .im-egzh{color:#888;font-size:12px}
    #im-pop .im-sent{margin-top:8px;font-size:11px;color:#777;font-style:italic}
    #im-pop .im-warn{margin-top:10px;padding:6px 8px;border-radius:6px;font-size:12px;
      background:#4a3a10;color:#fc0}
    #im-pop .im-note{margin-top:8px;font-size:10px;color:#666}
    #im-pop .im-btns{margin-top:10px;display:flex;gap:8px}
    #im-pop .im-btns button{flex:1;padding:5px;font:inherit;cursor:pointer;
      border:1px solid #555;border-radius:5px;background:#222;color:#ccc}
    #im-pop .im-btns button.on{background:#4af;border-color:#4af;color:#000}`;

  // The caption container is created/destroyed as CC toggles, so re-attach when it changes.
  const obs = new MutationObserver(tick);
  let box = null;
  const timer = setInterval(() => {
    // An orphaned script would otherwise keep throwing once a second until the tab is closed.
    if (!alive()) {
      clearInterval(timer);
      obs.disconnect();
      return;
    }
    const cur = document.querySelector(BOX);
    if (cur && cur !== box) {
      obs.disconnect();
      obs.observe(cur, { childList: true, subtree: true, characterData: true });
      box = cur;
    }
    tick();
    tickImmersion();
    loadTrack();
  }, 1000);

  state.saved = () => getStore("words").then((r) => r.words ?? []);
}

if (typeof document !== "undefined") start_();
if (typeof module !== "undefined") module.exports = { toSentences, splitPhrases, posOf, parseReply, markRate, zhFor, cueUrl };
