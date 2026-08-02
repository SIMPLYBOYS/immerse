const DAY = 86400000;
const NEW_PER_SESSION = 20; // adding fifty words at once shouldn't bury the actual reviews

const dayKey = (t) => {
  const d = new Date(t); // local, not UTC — a day boundary should match the user's midnight
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

// SM-2 — the algorithm Anki ran on for twenty years.
// ponytail: FSRS schedules measurably better, but ts-fsrs means npm and a bundler, which this
// project has stayed free of. Revisit if the intervals actually feel wrong in use.
// quality: 0 forgot, 3 hard, 4 good, 5 easy.
function schedule(card, quality, now = Date.now()) {
  const c = { ease: 2.5, reps: 0, interval: 0, lapses: 0, reviews: 0, ...card };
  c.reviews += 1;
  if (quality < 3) {
    c.reps = 0;
    c.interval = 1; // relearn tomorrow rather than today: sleep is the point of spacing
    c.lapses += 1;
  } else {
    c.reps += 1;
    c.interval = c.reps === 1 ? 1 : c.reps === 2 ? 6 : Math.round(c.interval * c.ease);
    // Standard SM-2 ease adjustment, floored at 1.3 so a run of bad answers can't collapse it.
    c.ease = Math.max(1.3, c.ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
  }
  c.due = now + c.interval * DAY;
  return c;
}

// A newly added word has no `due`, so it is due immediately. 已掌握 suspends a card: it stays in
// the library but is never scheduled again.
const isDue = (w, now) => !w.suspended && (w.due ?? 0) <= now;

// How much of the memory has probably decayed: two days late on a two-day interval is far more
// urgent than two days late on a sixty-day one. This is what stops every session opening with the
// same handful of words in insertion order.
function urgency(w, now) {
  if (!w.due) return 1; // never reviewed: mid priority, so new words interleave with reviews
  return (now - w.due) / DAY / Math.max(1, w.interval ?? 1);
}

// Reviews come first by urgency; a capped, shuffled handful of new words is spread through them
// so a session is neither all-new nor always in the same order.
function buildQueue(words, now = Date.now(), rand = Math.random) {
  const due = words.filter((w) => isDue(w, now));
  const review = due.filter((w) => w.due).sort((a, b) => urgency(b, now) - urgency(a, now));
  const fresh = due
    .filter((w) => !w.due)
    .map((w) => [rand(), w])
    .sort((a, b) => a[0] - b[0])
    .slice(0, NEW_PER_SESSION)
    .map(([, w]) => w);
  if (!fresh.length) return review;
  const every = Math.max(1, Math.ceil(review.length / fresh.length));
  const out = [];
  for (let i = 0; i < review.length; i++) {
    out.push(review[i]);
    if ((i + 1) % every === 0 && fresh.length) out.push(fresh.shift());
  }
  return out.concat(fresh);
}

const stats = (words, now = Date.now()) => {
  const reviews = words.reduce((n, w) => n + (w.reviews ?? 0), 0);
  const lapses = words.reduce((n, w) => n + (w.lapses ?? 0), 0);
  return {
    learning: words.filter((w) => !w.suspended).length,
    known: words.filter((w) => w.suspended).length,
    due: words.filter((w) => isDue(w, now)).length,
    retention: reviews ? Math.round(((reviews - lapses) / reviews) * 100) : null,
  };
};

const forecast = (words, now = Date.now()) =>
  [1, 2, 3, 4, 5].map(
    (d) =>
      words.filter((w) => !w.suspended && w.due > now + (d - 1) * DAY && w.due <= now + d * DAY)
        .length,
  );

// Consecutive days whose entry reaches `min`. Not having reached it *yet today* must not zero a
// streak that is still alive — otherwise every morning starts at zero.
function streakOf(log, now = Date.now(), min = 1) {
  const hit = (t) => (log[dayKey(t)] ?? 0) >= min;
  let n = 0;
  let i = hit(now) ? 0 : 1;
  for (; hit(now - i * DAY); i++) n++;
  return n;
}

const GOAL_MIN = 30; // zeroStudy's default daily immersion target
const todayMins = (immLog, now = Date.now()) => Math.floor((immLog[dayKey(now)] ?? 0) / 60);
const masteredSince = (words, since) => words.filter((w) => (w.knownAt ?? 0) >= since).length;

// Split a sentence around the target so the card can highlight it in place. Recall works from the
// phrase as it was heard, in its own sentence — a bare headword tests recognition, not retrieval.
function markTarget(sentence, word) {
  const s = String(sentence ?? "");
  const safe = String(word ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = safe && s.match(new RegExp(`(?<![A-Za-z'’-])${safe}(?![A-Za-z'’-])`, "i"));
  if (!m) return [{ text: s }];
  return [
    { text: s.slice(0, m.index) },
    { text: s.slice(m.index, m.index + m[0].length), hit: true },
    { text: s.slice(m.index + m[0].length) },
  ].filter((r) => r.text);
}

const mmss = (t) => `${Math.floor((t ?? 0) / 60)}:${String(Math.floor((t ?? 0) % 60)).padStart(2, "0")}`;

const byVideo = (words) => {
  const groups = new Map();
  for (const w of words) {
    const id = w.videoId ?? "";
    if (!groups.has(id)) groups.set(id, { id, title: w.title || id || "未知來源", words: [] });
    groups.get(id).words.push(w);
  }
  return [...groups.values()].sort((a, b) => b.words.length - a.words.length);
};

function wire() {
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  let words = [];
  let log = {};
  let queue = [];
  let card = null;
  let immersion = 0;
  let immLog = {};
  let total = 0;
  let done = 0;

  function paint() {
    const now = Date.now();
    const s = stats(words, now);
    $("headline").textContent = s.due
      ? `你今天有 ${s.due} 個詞彙需要複習。`
      : words.length
        ? "今天沒有待複習的詞彙。"
        : "詞彙庫是空的。在影片上按「學習中」把詞加進來。";
    // The streak that matters is the immersion habit, not the reviewing — reviewing follows it.
    const mins = todayMins(immLog, now);
    $("goalMins").textContent = mins;
    $("goalOf").textContent = `${mins} / ${GOAL_MIN} mins`;
    $("goalBar").style.width = `${Math.min(100, (mins / GOAL_MIN) * 100)}%`;
    $("goalHint").textContent =
      mins >= GOAL_MIN ? "今天已達標" : `再 ${GOAL_MIN - mins} 分鐘即可達成目標`;
    $("goalStreak").textContent = `🔥 連續達標 ${streakOf(immLog, now, GOAL_MIN * 60)} 天`;
    $("today").textContent = `✓ 今日複習 ${log[dayKey(now)] ?? 0} 詞`;
    // The denominator of the ten-marks-per-hour rule, so the warning in the popup has a meaning.
    $("imm").textContent = `⏱ 累計沉浸 ${Math.floor(immersion / 3600)}h ${Math.floor((immersion % 3600) / 60)}m`;
    $("weekKnown").textContent = masteredSince(words, now - 7 * DAY);
    $("retention").textContent = s.retention === null ? "—" : `${s.retention}%`;
    $("learning").textContent = s.learning;
    $("known").textContent = s.known;
    const size = Math.max(1, s.learning + s.known); // not `total`: that one counts the session
    $("barLearning").style.width = `${(s.learning / size) * 100}%`;
    $("barKnown").style.width = `${(s.known / size) * 100}%`;

    const days = forecast(words, now);
    const peak = Math.max(1, ...days);
    $("forecast").replaceChildren(
      ...days.map((n, i) => {
        const col = el("div", "col");
        const bar = el("div", "bar");
        bar.style.height = `${(n / peak) * 46}px`;
        col.append(
          el("span", "n", n || ""),
          bar,
          el("span", "d", "日一二三四五六"[new Date(now + (i + 1) * DAY).getDay()]),
        );
        return col;
      }),
    );

    $("start").disabled = !s.due;
    $("start").textContent = s.due ? `開始複習 (${s.due})` : "今天沒有待複習";

    $("videos").replaceChildren(
      ...byVideo(words).map((g) => {
        const due = g.words.filter((w) => isDue(w, now)).length;
        const known = g.words.filter((w) => w.suspended).length;
        const c = el("div", "vcard");
        c.append(el("div", "vtitle", g.title));
        c.append(el("span", "vdue", due ? `${due} 待複習` : "已完成"));
        const track = el("div", "vtrack");
        const fill = el("div", "vfill");
        fill.style.width = `${(known / g.words.length) * 100}%`;
        track.append(fill);
        c.append(track, el("div", "vmeta", `${known} 已掌握 · ${g.words.length - known} 學習中`));
        if (due) c.addEventListener("click", () => run(g.words));
        else c.classList.add("done");
        return c;
      }),
    );
  }

  function run(pool) {
    queue = buildQueue(pool);
    if (!queue.length) return;
    total = queue.length;
    done = 0;
    $("home").hidden = true;
    $("card").hidden = false;
    next();
  }

  const say = (text) =>
    speechSynthesis.speak(Object.assign(new SpeechSynthesisUtterance(text), { lang: "en-US" }));

  const speaker = (text) => {
    const b = el("button", null, "🔊");
    b.title = "唸出來";
    b.addEventListener("click", () => say(text));
    return b;
  };

  function next() {
    card = queue.shift();
    if (!card) {
      $("card").hidden = true;
      $("home").hidden = false;
      paint();
      return;
    }
    const url = card.videoId ? `https://youtu.be/${card.videoId}?t=${Math.floor(card.t ?? 0)}` : "";
    $("vtitle").textContent = card.title ?? card.videoId ?? "";
    $("vlink").href = url;
    $("stamp").textContent = mmss(card.t);
    $("left").textContent = `${done + 1} / ${total}`;

    // 主動回憶: the headword is withheld so the sentence has to do the retrieving.
    $("front").replaceChildren($("recall").checked ? "____" : card.word, speaker(card.word));
    $("ctx").replaceChildren(
      ...markTarget(card.sentence, card.word).map((r) =>
        r.hit ? el("span", "hit", r.text) : document.createTextNode(r.text),
      ),
      speaker(card.sentence ?? ""),
    );

    $("zh").hidden = true;
    $("zh").textContent = card.zh ?? "";
    $("showzh").hidden = !card.zh;
    $("back").hidden = true;
    $("reveal").hidden = false;
  }

  function reveal() {
    $("reveal").hidden = true;
    $("back").hidden = false;
    $("front").replaceChildren(card.word, speaker(card.word)); // recall mode: the answer, at last
    $("contextZh").textContent = card.contextZh ?? "";
    $("context").textContent = card.context ?? "";
    $("senses").replaceChildren(
      ...(card.senses ?? []).map((s) =>
        el("div", "sense", [`${s.pos} ${s.gloss}`, s.example, s.zh].filter(Boolean).join("\n")),
      ),
    );
    const url = card.videoId ? `https://youtu.be/${card.videoId}?t=${Math.floor(card.t ?? 0)}` : "";
    $("link").href = url;
    $("link").textContent = url ? "回到影片那一刻" : "";
  }

  function grade(q) {
    const now = Date.now();
    Object.assign(card, schedule(card, q, now));
    const at = words.findIndex((w) => w.id === card.id);
    if (at >= 0) words[at] = card;
    log[dayKey(now)] = (log[dayKey(now)] ?? 0) + 1;
    chrome.storage.local.set({ words, log });
    done += 1;
    next();
  }

  chrome.storage.local.get(["words", "log", "recall", "immersion", "immLog"]).then((r) => {
    words = r.words ?? [];
    log = r.log ?? {};
    immersion = r.immersion ?? 0;
    immLog = r.immLog ?? {};
    $("recall").checked = !!r.recall;
    paint();
  });
  $("recall").addEventListener("change", (e) => {
    chrome.storage.local.set({ recall: e.target.checked });
    // Only re-blank while the answer is still hidden; after 顯示解釋 the word stays visible.
    if (card && !$("card").hidden && $("back").hidden) {
      $("front").replaceChildren(e.target.checked ? "____" : card.word, speaker(card.word));
    }
  });
  $("showzh").addEventListener("click", () => {
    $("zh").hidden = false;
    $("showzh").hidden = true;
  });

  $("start").addEventListener("click", () => run(words));
  $("reveal").addEventListener("click", reveal);
  // Deleting is irreversible and there is no undo, so it asks first.
  $("clear").addEventListener("click", async () => {
    if (!confirm(`刪除全部 ${words.length} 個詞彙？無法復原。`)) return;
    words = [];
    await chrome.storage.local.set({ words: [], marks: {} });
    paint();
  });
  const quit = () => {
    card = null;
    $("card").hidden = true;
    $("home").hidden = false;
    paint(); // the dashboard reflects whatever was graded before leaving
  };

  // Skipping sends the card to the back of the queue and leaves its schedule alone: declining to
  // answer is not the same as answering wrong, and shouldn't cost the card its interval.
  const skip = () => {
    if (card) queue.push(card);
    next();
  };

  // Two grades rather than four, as in the reference design. ponytail: SM-2 can use the finer
  // 模糊/簡單 steps, so scheduling is slightly coarser now; add them back if intervals feel blunt.
  $("again").addEventListener("click", () => grade(0));
  $("got").addEventListener("click", () => grade(4));
  $("skip").addEventListener("click", skip);
  $("quit").addEventListener("click", quit);
  document.addEventListener("keydown", (e) => {
    if ($("card").hidden) return;
    if (e.key === "Escape") return quit();
    if (e.key === "ArrowRight") return skip();
    if (e.key === " ") return (e.preventDefault(), $("reveal").hidden ? null : reveal());
    if (e.key === "1") grade(0);
    if (e.key === "2") grade(4);
  });
}

if (typeof document !== "undefined") wire();
if (typeof module !== "undefined")
  module.exports = { schedule, stats, forecast, isDue, urgency, buildQueue, streakOf, byVideo,
    markTarget, todayMins, masteredSince, GOAL_MIN };
