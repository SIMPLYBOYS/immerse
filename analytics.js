// 數據分析 tab. Loaded after review.js, so dayKey/dayKeys/DAY are already in the global lexical
// scope — classic scripts share those, which is the whole reason this project has no bundler.

const HEAT = ["#ebedf0", "#c6e9d4", "#7ccfa3", "#3fbf7f", "#2a8f5d"];

// Buckets, not a scale: the point of a habit map is "did I show up", and a 4-hour binge should
// not make every honest 30-minute day look empty by comparison.
const heatLevel = (mins) => (mins <= 0 ? 0 : mins < 10 ? 1 : mins < 30 ? 2 : mins < 60 ? 3 : 4);

const seriesOf = (log, keys) => keys.map((k) => log[k] ?? 0);

// Words per hour of immersion. null rather than 0 when nothing has been watched — dividing by no
// time at all is undefined, and reporting "0 words/hour" would read as a bad result.
function efficiencyOf(wordCount, immSec) {
  return immSec > 0 ? Math.round((wordCount / (immSec / 3600)) * 10) / 10 : null;
}

const activeDaysOf = (log, keys) => keys.filter((k) => (log[k] ?? 0) > 0).length;

// Which videos actually taught you something. Per-video immersion is what makes 字/每小時
// answerable here rather than only overall — a long video with three words is worse value than a
// short one with three.
function topVideos(words, immByVideo = {}, limit = 5) {
  const map = new Map();
  for (const w of words) {
    const id = w.videoId ?? "";
    if (!map.has(id)) map.set(id, { id, title: w.title || id || "未知來源", total: 0, known: 0 });
    const g = map.get(id);
    g.total += 1;
    if (w.suspended) g.known += 1;
  }
  return [...map.values()]
    .map((g) => {
      const sec = immByVideo[g.id] ?? 0;
      return { ...g, learning: g.total - g.known, perHour: sec > 0 ? +(g.total / (sec / 3600)).toFixed(1) : null };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

// Anki calls these leeches: words you keep forgetting. They are the ones worth rewriting or
// dropping — a card you have failed five times is not going to fix itself on the sixth.
const leeches = (words, min = 3, limit = 8) =>
  words
    .filter((w) => (w.lapses ?? 0) >= min)
    .sort((a, b) => (b.lapses ?? 0) - (a.lapses ?? 0))
    .slice(0, limit);

// A day bucket counting the words added on it, so the chart can show vocabulary alongside time.
function addedPerDay(words, keyOf) {
  const out = {};
  for (const w of words) if (w.addedAt) out[keyOf(w.addedAt)] = (out[keyOf(w.addedAt)] ?? 0) + 1;
  return out;
}

function wireStats() {
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  let words = [];
  let immLog = {};
  let log = {};
  let immByVideo = {};
  let days = 7;
  let metric = "imm";
  let cumulative = false;

  const spanOf = () => {
    if (days) return days;
    // "全部": from the earliest day we have any record of, floored at a week so the chart is
    // never a single lonely bar.
    const stamps = [
      ...words.map((w) => w.addedAt).filter(Boolean),
      ...Object.keys({ ...immLog, ...log }).map((k) => new Date(k).getTime()),
    ].filter((n) => Number.isFinite(n));
    if (!stamps.length) return 7;
    return Math.max(7, Math.ceil((Date.now() - Math.min(...stamps)) / DAY) + 1);
  };

  function paint() {
    const now = Date.now();
    const span = spanOf();
    const keys = dayKeys(span, now);
    const immMins = Object.fromEntries(keys.map((k) => [k, Math.round((immLog[k] ?? 0) / 60)]));
    const added = addedPerDay(words, (t) => dayKey(t));

    const immSec = keys.reduce((n, k) => n + (immLog[k] ?? 0), 0);
    const inRange = words.filter((w) => (w.addedAt ?? 0) >= now - span * DAY).length;
    const eff = efficiencyOf(inRange, immSec);
    $("effVal").textContent = eff === null ? "—" : eff;
    $("immAvg").textContent = Math.round(immSec / 60 / span);
    $("activeVal").textContent = activeDaysOf(immLog, keys);

    const data =
      metric === "imm"
        ? seriesOf(immMins, keys)
        : metric === "words"
          ? seriesOf(added, keys)
          : seriesOf(log, keys);
    // Cumulative answers "am I growing", per-day answers "did I show up" — different questions.
    let running = 0;
    const shown = cumulative ? data.map((n) => (running += n)) : data;
    const peak = Math.max(1, ...shown);
    // Labels only when they can be read; 365 columns of text is noise, not information.
    const label = (k) => (span <= 31 ? k.split("-").slice(1).join("/") : "");
    $("chart").replaceChildren(
      ...shown.map((n, i) => {
        const col = el("div", "col");
        const bar = el("div", "bar");
        bar.style.height = `${(n / peak) * 118}px`;
        bar.title = `${keys[i]}: ${n}`;
        col.append(bar, el("div", "d", label(keys[i])));
        return col;
      }),
    );

    // Half a year of habit, aligned so every column is one Sunday-to-Saturday week.
    const back = 182;
    const start = new Date(now - (back - 1) * DAY);
    start.setDate(start.getDate() - start.getDay());
    const cells = Math.ceil((now - start.getTime()) / DAY) + 1;
    $("heat").replaceChildren(
      ...Array.from({ length: cells }, (_, i) => {
        const t = start.getTime() + i * DAY;
        const mins = Math.round((immLog[dayKey(t)] ?? 0) / 60);
        const cell = el("div");
        cell.style.background = HEAT[heatLevel(mins)];
        cell.title = `${dayKey(t)} — ${mins} 分鐘`;
        return cell;
      }),
    );
    // One label per column, printed only when the month changes — otherwise it is 26 copies of
    // the same word.
    let lastMonth = -1;
    $("heatMonths").replaceChildren(
      ...Array.from({ length: Math.ceil(cells / 7) }, (_, w) => {
        const d = new Date(start.getTime() + w * 7 * DAY);
        const show = d.getMonth() !== lastMonth;
        lastMonth = d.getMonth();
        return el("span", null, show ? `${d.getMonth() + 1}月` : "");
      }),
    );

    $("topVideos").replaceChildren(
      ...topVideos(words, immByVideo).map((g) => {
        const row = el("div", "vrow");
        const head = el("div", "vhead");
        head.append(el("span", "vname", g.title), el("b", null, `${g.total} 字`));
        const track = el("div", "vtrack");
        const known = el("div", "vfill");
        known.style.width = `${(g.known / g.total) * 100}%`;
        track.append(known);
        const meta = el("div", "vmeta");
        meta.append(
          el("span", null, `${g.known} 已掌握 · ${g.learning} 學習中`),
          el("span", null, g.perHour === null ? "" : `${g.perHour} 字／每小時`),
        );
        row.append(head, track, meta);
        return row;
      }),
    );

    const stuck = leeches(words);
    $("leeches").replaceChildren(
      ...(stuck.length
        ? stuck.map((w) => {
            const row = el("div", "lrow");
            row.append(el("span", null, w.word), el("span", "lcount", `忘記 ${w.lapses} 次`));
            return row;
          })
        : [el("div", "vmeta", "還沒有反覆忘記的詞——很好。")]),
    );
  }

  const load = () =>
    chrome.storage.local.get(["words", "immLog", "log", "immByVideo", "cloud"]).then((r) => {
      // This screen only ever reads, so the other devices' tallies can be folded in right here.
      // review.js cannot do the same — it writes these keys back, and they must stay ours alone.
      const c = r.cloud ?? {};
      words = r.words ?? [];
      immLog = sumCounts(r.immLog, c.immLog);
      log = sumCounts(r.log, c.log);
      immByVideo = sumCounts(r.immByVideo, c.immByVideo);
      paint();
    });

  for (const b of document.querySelectorAll(".ranges button")) {
    b.addEventListener("click", () => {
      for (const o of document.querySelectorAll(".ranges button")) o.classList.toggle("on", o === b);
      days = Number(b.dataset.days);
      paint();
    });
  }
  for (const b of document.querySelectorAll(".toggles button")) {
    b.addEventListener("click", () => {
      for (const o of document.querySelectorAll(".toggles button")) o.classList.toggle("on", o === b);
      metric = b.dataset.metric;
      paint();
    });
  }
  for (const b of document.querySelectorAll(".modes button")) {
    b.addEventListener("click", () => {
      for (const o of document.querySelectorAll(".modes button")) o.classList.toggle("on", o === b);
      cumulative = b.dataset.mode === "cum";
      paint();
    });
  }
  // Loaded lazily: opening the extension shouldn't read and render a year of history.
  document.addEventListener("im-view", (e) => e.detail === "viewStats" && load());
}

if (typeof document !== "undefined") wireStats();
if (typeof module !== "undefined")
  module.exports = { HEAT, heatLevel, seriesOf, efficiencyOf, activeDaysOf, addedPerDay, topVideos, leeches };
