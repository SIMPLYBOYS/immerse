# immerse

A Chrome extension that turns YouTube into English reading practice: click any word in the
captions and get an explanation of what it means **in that sentence**, then review what you kept
with built-in spaced repetition.

Built for an advanced learner who reads technical English fine but keeps tripping over idioms,
phrasal verbs and slang — so the explanation leads with context, not with a dictionary entry.

<img src="icon128.png" width="72" alt="">

[繁體中文說明在下面 ↓](#繁體中文)

---

## What it does

- **Click a word** in the captions → an AI explanation of that word *in this sentence*, plus 2–4
  general senses, each with an example sentence and a Chinese gloss.
- **Phrases are grouped.** `grew into` is one clickable box, not two words — idioms and phrasal
  verbs are exactly what an advanced learner misses, and boxing each word separately hides them.
- **Parts of speech are colour-coded.** Verbs blue, nouns amber, adjectives green, prepositions
  pink, function words dimmed. The structure of a sentence becomes visible at a glance.
- **Sentence navigation.** <kbd>A</kbd> previous sentence, <kbd>S</kbd> replay, <kbd>D</kbd> next
  — real sentence boundaries, not caption chunks.
- **Chinese subtitles** with <kbd>Z</kbd>, at no API cost (YouTube's own translation).
- **Hover to freeze.** Moving the mouse onto a word pauses the video so you can actually click it;
  moving away resumes.
- **Spaced repetition** built in. Mark a word 學習中, and it enters an SM-2 review queue ordered by
  how much of the memory has probably decayed.

## Install

No build step, no dependencies. Clone it and load it:

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select this folder
3. Open the extension's options page and paste an [Anthropic API key](https://console.anthropic.com/)
4. Open a YouTube video **with captions on** and reload the page

## What it costs

It calls Claude Haiku 4.5 three ways, all batched and cached per video:

| Call | When | Roughly |
| --- | --- | --- |
| Word explanation | Each word you click | Fractions of a cent |
| Phrase scan | Once per video | One call, cached |
| Part-of-speech tagging | Once per video | The expensive one — a few hundred lines of output |

The options page shows real token usage and estimated cost, broken down by call type. For one
person watching a few videos a day this lands in cents per month, but measure rather than trust
that sentence — that's what the meter is for.

## How it works

The interesting problem is getting the transcript at all. YouTube gates `/api/timedtext` behind a
Proof-of-Origin Token, so fetching a caption track directly returns `200` with an empty body.

immerse doesn't forge a token. A `MAIN`-world content script monkey-patches `fetch` and
`XMLHttpRequest.open` and copies the URL of the request **the player itself makes** — already
signed — onto a DOM attribute, which is the only channel the isolated world can read. Re-fetching
that URL with `fmt=json3` yields the whole timed transcript; the same URL with `tlang=zh-Hant`
yields YouTube's own translation, which is why the Chinese subtitle line costs nothing.

Having the full transcript up front is what makes everything else simple: sentence boundaries are
computed once, so clicking a word gives you the complete sentence immediately rather than waiting
for the speaker to finish it.

```
hook.js      MAIN world, document_start — captures the signed timedtext URL
content.js   isolated world — captions, clicking, colouring, the vocabulary deck
bg.js        service worker — every network call (host_permissions exempt it from CORS)
review.html  the spaced-repetition screen
options.html API key, usage meter, CSV export
```

## Development

```sh
node test.js     # pure logic: sentence stitching, phrase matching, POS, SM-2, CSV, cost maths
node icon.js     # regenerate the icons (a hand-rolled PNG encoder, zlib is the only dependency)
```

There is deliberately no npm, no bundler and no framework. Every dependency was declined on
purpose, and the comments say which and why — `ponytail:` marks a shortcut with a known ceiling
and the upgrade path if it ever matters.

## Known limitations

These are known and deliberate, not oversights:

- **YouTube can break this at any time.** It depends on the player's own caption request and on
  DOM class names. There is no SLA; when it breaks, you fix it.
- **Irregular verbs may not get coloured** (`grew` → `grow`). The stemmer is naive on purpose; a
  real lemmatiser means npm and a bundler.
- **A phrase split across two caption lines** falls back to separate words.
- **The first sentence of a video is uncoloured for a few seconds** while the tagging call
  returns. Cached per video, so a rewatch is instant.
- **The API key is stored in plaintext** in `chrome.storage.local`. Anything that can read your
  Chrome profile can read it.
- **Reviews are desktop-only and don't sync.** If you want mobile and sync, export to CSV and use
  Anki instead — that was the original plan and it's still a reasonable one.

## Credits

The design owes a lot to [zeroStudy](https://zerostudy.app), which solved this problem first and
solved it well. immerse started as a teardown of it and ended up as a personal tool with a
different bet: the explanation is context-first, and everything runs against your own API key.

## License

MIT — see [LICENSE](LICENSE).

---

## 繁體中文

一個把 YouTube 變成英文閱讀練習場的 Chrome 擴充：**點字幕上的任何一個字，看它在這句話裡的意思**，
再用內建的間隔重複複習記下來的詞。

目標使用者是讀技術英文沒問題、但常卡在慣用語、片語動詞和俚語的中高階學習者——所以解釋是
**語境優先**，不是先丟一頁字典義項。

### 功能

- **點字**看它在這句的意思，另附 2–4 個常見義項，各配英文例句和中文語意。
- **片語成組**：`grew into` 是一個可點的框，不是兩個字。中高階卡的正是這些跨詞的東西。
- **詞性上色**：動詞藍、名詞琥珀、形容詞綠、介系詞粉紅、功能詞灰掉。
- **句子導航**：<kbd>A</kbd> 上一句、<kbd>S</kbd> 重播、<kbd>D</kbd> 下一句——切在真正的句子邊界。
- **中文對照字幕**（<kbd>Z</kbd>），零 API 成本，用的是 YouTube 自己的翻譯。
- **滑到字上就暫停**，移開繼續，不用先按空白鍵。
- **間隔重複複習**：按下「學習中」才進詞彙庫，佇列依「記憶衰退程度」排序。

### 安裝

不需要建置、沒有相依套件。

1. `chrome://extensions` → 開啟**開發人員模式**
2. **載入未封裝項目** → 選這個資料夾
3. 到擴充功能選項貼上 [Anthropic API key](https://console.anthropic.com/)
4. 開一支**有開字幕**的 YouTube 影片，重新整理

### 標記速率

沿用 zeroStudy 的建議：**每小時沉浸最多標 10 個字**。標太多會累積成清不完的待複習。超過時彈窗會提醒，
但不會阻止你——那是你的判斷。時數用的是「影片實際播放且分頁在前景」的秒數。

### 已知限制

見上方 [Known limitations](#known-limitations)。最重要的一條：**YouTube 隨時可能改版打壞它**，
壞了要自己修，沒有 SLA。
