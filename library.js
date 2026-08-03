// 詞彙庫 tab: the only screen that shows the words themselves rather than counts, and the only
// place a word's status can be changed without finding it in a video again.

// Matches across everything worth remembering a word by — you rarely recall the headword, you
// recall the sentence it was in.
function searchWords(words, q) {
  const needle = q.trim().toLowerCase();
  if (!needle) return words;
  return words.filter((w) =>
    [w.word, w.contextZh, w.context, w.sentence, w.title]
      .filter(Boolean)
      .some((f) => String(f).toLowerCase().includes(needle)),
  );
}

const filterWords = (words, status) =>
  status === "all" ? words : words.filter((w) => (status === "known") === !!w.suspended);

const dueLabel = (w, now = Date.now()) => {
  if (w.suspended) return "已掌握";
  if (!w.due) return "尚未複習";
  const days = Math.round((w.due - now) / 86400000);
  return days <= 0 ? "今天到期" : `${days} 天後`;
};

// Grouped by the day it was added, newest first — "what did I pick up today" is the question the
// list is actually asked. keyOf is injected so there is still only one definition of a day.
function groupWords(words, keyOf, now = Date.now()) {
  const groups = new Map();
  for (const w of [...words].sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0))) {
    const k = w.addedAt ? keyOf(w.addedAt) : "—";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(w);
  }
  const today = keyOf(now);
  const yesterday = keyOf(now - 86400000);
  return [...groups.entries()].map(([k, items]) => ({
    key: k,
    label: k === today ? "今天" : k === yesterday ? "昨天" : k === "—" ? "更早" : k,
    items,
  }));
}

function wireLibrary() {
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  let words = [];
  let marks = {};
  let status = "all";
  let openId = null;

  const save = () => chrome.storage.local.set({ words, marks });

  function paint() {
    const shown = searchWords(filterWords(words, status), $("q").value);
    $("libCount").textContent = `您已標記 ${words.length} 個詞彙${
      shown.length === words.length ? "" : `，符合 ${shown.length} 個`
    }`;
    const out = [];
    for (const g of groupWords(shown, dayKey)) {
      const head = el("div", "ghead");
      head.append(el("span", null, g.label), el("span", null, `${g.items.length} 個詞彙`));
      out.push(head, ...g.items.map(render));
    }
    $("list").replaceChildren(...(out.length ? out : [el("div", "vmeta", "沒有符合的詞彙。")]));
  }

  // Status lives in two places on purpose: `words` drives the review queue, `marks` drives the
  // colour on the captions. Changing it here has to move both or the video stops agreeing.
  async function setStatus(w, how) {
    w.suspended = how === "known";
    if (w.suspended) w.knownAt = Date.now();
    else delete w.knownAt; // demoting un-masters it — the weekly count must not keep it
    marks[w.id] = how;
    await save();
    paint();
  }

  async function remove(w) {
    words = words.filter((x) => x.id !== w.id);
    delete marks[w.id];
    await save();
    paint();
  }

  function render(w) {
    const item = el("div", "item");

    const top = el("div", "itop");
    const dot = el("span", `dot ${w.suspended ? "d-known" : "d-learn"}`, w.suspended ? "✓" : "");
    const word = el("span", "iword", w.word);
    const due = el("span", "idue", dueLabel(w));
    top.append(dot, word, due);
    top.style.cursor = "pointer";
    top.addEventListener("click", () => {
      openId = openId === w.id ? null : w.id; // click again to collapse
      paint();
    });
    item.append(top);

    item.append(el("div", "imean", w.contextZh || w.context || ""));

    if (openId !== w.id) return item;

    // Expanded: everything the popup on the video showed, plus the controls that were only
    // reachable there.
    if (w.context) item.append(el("div", "ien", w.context));
    for (const s of w.senses ?? []) {
      item.append(
        el("div", "sense", [`${s.pos} ${s.gloss}`, s.example, s.zh].filter(Boolean).join("\n")),
      );
    }
    if (w.sentence) item.append(el("div", "isent", `「${w.sentence}」`));
    if (w.videoId) {
      const src = el("div", "isrc");
      const a = document.createElement("a");
      a.href = `https://youtu.be/${w.videoId}?t=${Math.floor(w.t ?? 0)}`;
      a.target = "_blank";
      a.textContent = w.title || w.videoId;
      src.append("▶ ", a);
      item.append(src);
    }

    const bar = el("div", "ibtns");
    for (const [how, label] of [["learning", "學習中"], ["known", "已掌握"]]) {
      const b = el("button", (w.suspended ? "known" : "learning") === how ? "on" : "", label);
      b.addEventListener("click", () => setStatus(w, how));
      bar.append(b);
    }
    const del = el("button", "del", "從詞彙庫移除");
    del.addEventListener("click", () => remove(w));
    bar.append(del);
    item.append(bar);
    return item;
  }

  $("q").addEventListener("input", paint);
  for (const b of document.querySelectorAll(".filters button")) {
    b.addEventListener("click", () => {
      for (const o of document.querySelectorAll(".filters button")) o.classList.toggle("on", o === b);
      status = b.dataset.status;
      paint();
    });
  }
  document.addEventListener("im-view", (e) => {
    if (e.detail !== "viewLib") return;
    chrome.storage.local.get(["words", "marks"]).then((r) => {
      words = r.words ?? [];
      marks = r.marks ?? {};
      paint();
    });
  });
}

if (typeof document !== "undefined") wireLibrary();
if (typeof module !== "undefined")
  module.exports = { searchWords, filterWords, dueLabel, groupWords };
