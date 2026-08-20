const DAY = 86400000;
const NEW_PER_SESSION = 20; // adding fifty words at once shouldn't bury the actual reviews

const dayKey = (t) => {
  const d = new Date(t); // local, not UTC — a day boundary should match the user's midnight
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

// Due dates land on the 4am day boundary (Anki's rollover), not at now + n×86400s. A person
// reviews at roughly the same hour each day, so timestamp-exact dues drift against the habit:
// a 10pm review with a one-day interval comes due at 10pm tomorrow, which a morning session
// misses — the card is actually seen ~34 hours later, every round, while SM-2 assumes it was
// seen on time. "Review tomorrow" is day-granular for a human; 4am marks the night's sleep.
const ROLLOVER_H = 4;
function dueAt(now, intervalDays) {
  const d = new Date(now + intervalDays * DAY);
  d.setHours(ROLLOVER_H, 0, 0, 0);
  return d.getTime();
}

// SM-2 — the algorithm Anki ran on for twenty years.
// ponytail: FSRS schedules measurably better, but ts-fsrs means npm and a bundler, which this
// project has stayed free of. Revisit if the intervals actually feel wrong in use.
// quality: 0 forgot, 3 hard, 4 good, 5 easy.
function schedule(card, quality, now = Date.now()) {
  const c = { ease: 2.5, reps: 0, interval: 0, lapses: 0, reviews: 0, ...card };
  c.reviews += 1;
  if (quality < 3) {
    c.reps = 0;
    // The long-term schedule restarts at a day. The same-session retry is the review screen's
    // job, not the curve's — see grade().
    c.interval = 1;
    c.lapses += 1;
    // Original SM-2 leaves ease untouched on failure, but under the two-grade UI the success
    // path's ease delta is exactly zero (q=4 → +0.1 − 0.1), which left ease frozen at 2.5 for
    // every card. A lapse penalty — Anki's default — is then the only signal that a particular
    // card is hard: words you keep forgetting grow their intervals more slowly.
    c.ease = Math.max(1.3, c.ease - 0.2);
  } else {
    c.reps += 1;
    c.interval = c.reps === 1 ? 1 : c.reps === 2 ? 6 : Math.round(c.interval * c.ease);
    // Standard SM-2 ease adjustment, floored at 1.3 so a run of bad answers can't collapse it.
    c.ease = Math.max(1.3, c.ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
  }
  c.due = dueAt(now, c.interval);
  return c;
}

// 已掌握 suspends a card: it stays in the library but is never scheduled again. A newly marked
// word is NOT due the day it was marked — the marking moment, reading the full in-context
// explanation, is itself the first study event, and drilling it minutes later retrieves a memory
// that hasn't begun to decay. The first retrieval belongs after a night's sleep, on the next
// study day, exactly like every later review.
const isDue = (w, now) => {
  if (w.suspended) return false;
  if (w.due) return w.due <= now;
  if (w.addedAt) return dueAt(w.addedAt, 1) <= now;
  return true; // legacy rows without any stamp: available immediately
};

// Predicted probability the word is still recallable, on the same curve SM-2's intervals assume:
// a card sitting exactly on its due date is about 90% recallable and decays from there. Two days
// late on a two-day interval has decayed far more than two days late on a sixty-day one, which is
// what stops every session opening with the same handful of words in insertion order.
// ponytail: a one-parameter curve. FSRS fits difficulty and stability per card and predicts this
// properly — but it means ts-fsrs, npm and a bundler.
function recallOf(w, now = Date.now()) {
  if (!w.due || !w.interval) return 0; // never scheduled: nothing to recall yet
  const sinceReview = (now - (w.due - w.interval * DAY)) / DAY;
  return Math.min(1, 0.9 ** (sinceReview / w.interval));
}

// Reviews come first by urgency; a capped, shuffled handful of new words is spread through them
// so a session is neither all-new nor always in the same order.
function buildQueue(words, now = Date.now(), rand = Math.random) {
  const due = words.filter((w) => isDue(w, now));
  // Least recallable first — the ones closest to being forgotten are worth the most.
  const review = due.filter((w) => w.due).sort((a, b) => recallOf(a, now) - recallOf(b, now));
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
  // Two different questions, deliberately kept apart: `predicted` is how much of the deck you
  // could still recall right now, `correct` is how often you have answered right historically.
  // Both fields, not just `due`: a card we cannot estimate must be left out of the average rather
  // than averaged in as 0%, which would read as "you have forgotten everything".
  const scheduled = words.filter((w) => !w.suspended && w.due && w.interval);
  const predicted = scheduled.length
    ? Math.round((scheduled.reduce((n, w) => n + recallOf(w, now), 0) / scheduled.length) * 100)
    : null;
  return {
    predicted,
    learning: words.filter((w) => !w.suspended).length,
    known: words.filter((w) => w.suspended).length,
    due: words.filter((w) => isDue(w, now)).length,
    correct: reviews ? Math.round(((reviews - lapses) / reviews) * 100) : null,
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

// Oldest first — the shape every chart on the analytics tab wants. dayKey lives here so there is
// exactly one definition of "which day is this", shared by whatever writes and whatever reads.
const dayKeys = (n, now = Date.now()) =>
  Array.from({ length: n }, (_, i) => dayKey(now - (n - 1 - i) * DAY));

const GOAL_MIN = 30; // zeroStudy's default daily immersion target
const todayMins = (immLog, now = Date.now()) => Math.floor((immLog[dayKey(now)] ?? 0) / 60);
// `suspended` too, not just the stamp: a word demoted back to 學習中 keeps its history but is no
// longer mastered, and must not linger in the weekly count.
const masteredSince = (words, since) =>
  words.filter((w) => w.suspended && (w.knownAt ?? 0) >= since).length;
const addedSince = (words, since) => words.filter((w) => (w.addedAt ?? 0) >= since).length;

// zeroStudy's 單字負債: still 學習中, never reviewed once, marked more than `days` ago. Words
// like that are promises the queue keeps making and the user keeps not keeping — dead weight
// that inflates 待複習 forever. Surfacing them for cleanup keeps the due count honest.
// A row with no addedAt (the earliest schema) counts as old: its age is unknown, but "never
// reviewed after all this time" is the signal that matters.
const debtOf = (words, now = Date.now(), days = 30) =>
  words.filter((w) => !w.suspended && !(w.reviews > 0) && (w.addedAt ?? 0) <= now - days * DAY);

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
  let marks = {};
  let log = {};
  let queue = [];
  let card = null;
  let immersion = 0;
  let immLog = {};
  let total = 0;
  let done = 0;
  let mastered = 0; // 已掌握 presses this session — shown live so the press visibly counts
  let relearned = new Set(); // ids re-queued this session, so one miss cannot loop forever
  // Every words-write from this page goes through one chain. grade/master/drop each
  // read-modify-write the whole array, and with hundreds of words a storage round-trip is slow
  // enough that two rapid keyboard actions (3, 3 on consecutive cards) overlap — the second
  // read predates the first write and silently wipes it. Same fix as deck() in content.js.
  // ...and resolves either way, so one failed write cannot silently stop every later grade:
  // `chain.then(fn)` on a rejected promise never runs fn at all.
  let writeChain = Promise.resolve();
  const chained = (fn) =>
    (writeChain = writeChain.then(fn).catch((e) => console.warn("[immerse] write failed", e)));

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
    $("total").textContent = s.learning + s.known;
    $("weekKnown").textContent = masteredSince(words, now - 7 * DAY);
    $("weekAdded").textContent = addedSince(words, now - 7 * DAY);
    $("predicted").textContent = s.predicted === null ? "—" : `${s.predicted}%`;
    $("correct").textContent = s.correct === null ? "—" : `${s.correct}%`;
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

    const debt = debtOf(words, now);
    $("debtSec").hidden = !debt.length;
    if (debt.length) {
      const never = words.filter((w) => !w.suspended && !(w.reviews > 0)).length;
      $("debtMeta").textContent =
        `${never} 個從未複習，其中 ${debt.length} 個已標記超過 30 天——多半不會再學了，清掉讓「待複習」誠實。`;
      $("debtAll").textContent = `全部清理 (${debt.length})`;
      $("debtList").replaceChildren(
        ...debt.map((w) => {
          const r = el("div", "lrow");
          const age = w.addedAt ? `${Math.floor((now - w.addedAt) / DAY)} 天前標記` : "早期資料";
          const x = el("button", "idel", "✕");
          x.title = "從詞彙庫移除";
          x.addEventListener("click", () => drop([w.id]));
          r.append(el("span", null, w.word), el("span", "lcount", `${w.title ?? ""} · ${age}`), x);
          return r;
        }),
      );
    }
  }

  // Deck rows and caption marks always move together, same as the library's delete — an orphaned
  // mark would keep painting the word as 學習中 in videos with nothing behind it. Reads fresh at
  // write time: this tab's copy may be hours stale, and removing a few ids must not also erase
  // every word marked since the page loaded.
  function drop(ids) {
    return chained(async () => {
      const r = await chrome.storage.local.get(["words", "marks", "deleted"]);
      words = (r.words ?? []).filter((w) => !ids.includes(w.id));
      marks = r.marks ?? {};
      const deleted = r.deleted ?? {};
      // Tombstones travel with the deck, so a cleanup done here is not undone by the next merge
      // with a device that still has the rows.
      for (const id of ids) {
        delete marks[id];
        deleted[id] = Date.now();
      }
      await chrome.storage.local.set({ words, marks, deleted });
      paint();
    });
  }

  function run(pool) {
    queue = buildQueue(pool);
    if (!queue.length) return;
    total = queue.length;
    done = 0;
    mastered = 0;
    $("sessKnown").textContent = "";
    relearned = new Set();
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
    // 回到影片那一刻 lives in the header (the ▶ title link) — it used to be duplicated here too.
  }

  function grade(q) {
    const now = Date.now();
    Object.assign(card, schedule(card, q, now));
    log[dayKey(now)] = (log[dayKey(now)] ?? 0) + 1;
    // Write against a fresh read, replacing only this card's row. This page sits open in a
    // background tab for hours, so its in-memory copy is reliably stale — writing the whole
    // array here used to wipe every word marked on a video since the page loaded ("已掌握
    // sometimes doesn't stick").
    const row = { ...card, updatedAt: now };
    chained(async () => {
      const { words: fresh = [] } = await chrome.storage.local.get("words");
      const at = fresh.findIndex((w) => w.id === row.id);
      if (at >= 0) fresh[at] = row; // deleted meanwhile in another tab: stays deleted
      words = fresh;
      await chrome.storage.local.set({ words: fresh, log });
    });
    done += 1;
    // A word you just got wrong comes back a few cards later in this same session. Ending a
    // review having only ever failed an item is the one thing spacing cannot repair. Its
    // long-term schedule is untouched — that stays with the curve; this is only about not
    // walking away from a miss. Once per session, so a hard word can't trap you in a loop.
    if (q < 3 && !relearned.has(card.id)) {
      relearned.add(card.id);
      queue.splice(Math.min(queue.length, 4), 0, card);
      total += 1;
    }
    next();
  }

  chrome.storage.local.get(["words", "marks", "log", "recall", "immersion", "immLog"]).then((r) => {
    words = r.words ?? [];
    marks = r.marks ?? {};
    log = r.log ?? {};
    immersion = r.immersion ?? 0;
    immLog = r.immLog ?? {};
    $("recall").checked = !!r.recall;
    paint();
  });

  // A dashboard left open in a background tab must not go stale: marks made on videos arrive
  // here as storage events. Mid-review the repaint waits — numbers moving under the card is noise.
  chrome.storage.onChanged?.addListener((ch, area) => {
    if (area !== "local") return;
    if (ch.words) words = ch.words.newValue ?? [];
    if (ch.marks) marks = ch.marks.newValue ?? {};
    if (ch.log) log = ch.log.newValue ?? {};
    if (ch.immLog) immLog = ch.immLog.newValue ?? {};
    if (ch.immersion) immersion = ch.immersion.newValue ?? 0;
    if ($("card").hidden) paint();
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

  // Tabs. Each view reloads its own data when shown rather than sharing state — three small
  // independent readers beat one store everything has to agree about.
  const views = ["viewReview", "viewStats", "viewLib"];
  for (const b of document.querySelectorAll("nav button")) {
    b.addEventListener("click", () => {
      for (const o of document.querySelectorAll("nav button")) o.classList.toggle("on", o === b);
      for (const id of views) $(id).hidden = id !== b.dataset.view;
      document.dispatchEvent(new CustomEvent("im-view", { detail: b.dataset.view }));
    });
  }

  $("start").addEventListener("click", () => run(words));
  $("debtAll").addEventListener("click", () => {
    const debt = debtOf(words);
    if (!confirm(`清理 ${debt.length} 個單字？將從詞彙庫移除，無法復原。`)) return;
    drop(debt.map((w) => w.id));
  });
  $("reveal").addEventListener("click", reveal);
  // Deleting is irreversible and there is no undo, so it asks first.
  $("clear").addEventListener("click", async () => {
    if (!confirm(`刪除全部 ${words.length} 個詞彙？無法復原。`)) return;
    const { deleted = {} } = await chrome.storage.local.get("deleted");
    for (const w of words) deleted[w.id] = Date.now();
    words = [];
    await chrome.storage.local.set({ words: [], marks: {}, deleted });
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

  // 已掌握 from the card itself: realising mid-review that a word is already known used to mean
  // going back to a video to press the button there. Suspends the card (kept in the library,
  // never scheduled again) and syncs the caption mark, with the same fresh-read write as grade().
  function master() {
    if (!card) return;
    card.suspended = true;
    card.knownAt = Date.now();
    const row = { ...card, updatedAt: Date.now() };
    chained(async () => {
      const { words: fresh = [], marks: m = {} } = await chrome.storage.local.get(["words", "marks"]);
      const at = fresh.findIndex((w) => w.id === row.id);
      if (at >= 0) fresh[at] = row;
      m[row.id] = "known";
      words = fresh;
      marks = m;
      await chrome.storage.local.set({ words: fresh, marks: m });
    });
    // A same-session relearn copy of this card must not resurface either.
    const before = queue.length;
    queue = queue.filter((w) => w.id !== card.id);
    total -= before - queue.length;
    done += 1;
    // Instant feedback on the card itself — the dashboard's numbers are invisible mid-session,
    // and a press that changes nothing on screen reads as a press that didn't register.
    mastered += 1;
    $("sessKnown").textContent = `✓ 已掌握 +${mastered}`;
    next();
  }

  // Two grades rather than four, as in the reference design. ponytail: SM-2 can use the finer
  // 模糊/簡單 steps, so scheduling is slightly coarser now; add them back if intervals feel blunt.
  $("again").addEventListener("click", () => grade(0));
  $("got").addEventListener("click", () => grade(4));
  $("master").addEventListener("click", master);
  $("skip").addEventListener("click", skip);
  $("quit").addEventListener("click", quit);
  document.addEventListener("keydown", (e) => {
    if ($("card").hidden) return;
    if (e.key === "Escape") return quit();
    if (e.key === "ArrowRight") return skip();
    if (e.key === " ") return (e.preventDefault(), $("reveal").hidden ? null : reveal());
    if (e.key === "1") grade(0);
    if (e.key === "2") grade(4);
    if (e.key === "3") master();
  });
}

if (typeof document !== "undefined") wire();
if (typeof module !== "undefined")
  module.exports = { schedule, stats, forecast, isDue, buildQueue, streakOf, byVideo, debtOf,
    markTarget, todayMins, masteredSince, addedSince, dayKeys, dayKey, recallOf, dueAt, GOAL_MIN };
