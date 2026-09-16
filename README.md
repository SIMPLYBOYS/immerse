# immerse

A Chrome extension that turns YouTube into English reading practice: click any word in the
captions and get an explanation of what it means **in that sentence**, then review what you kept
with built-in spaced repetition. A companion Android app reads the same deck, so the reviews and
the videos you watched on the desktop come with you.

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
- **Chinese subtitles** with <kbd>Z</kbd>: the model's own translation of each sentence, aligned to
  the real sentence boundaries. YouTube's translated track stands in for the few seconds that takes
  — on auto-generated captions it drifts up to several sentences away from the speech, which is why
  it is only a stand-in.
- **Listening mode** with <kbd>X</kbd>: the English captions blur to unreadable so your ear does
  the work; hover a word to peek at just that word. Pair with <kbd>Z</kbd> for translation-only
  listening. Reading captions is the path of least resistance, and the brain will take it.
- **Hover to freeze.** Moving the mouse onto a word pauses the video so you can actually click it;
  moving away resumes.
- **Spaced repetition** built in. Mark a word 學習中, and it enters an SM-2 review queue ordered by
  how much of the memory has probably decayed.

## On the phone

`app/` is a React Native (Expo) app for Android that reads the same deck from the sync repo.

- **Immerse.** Pick a video the desktop has uploaded. It plays in an embedded player while the
  line being spoken lights up and scrolls itself; tap a line to jump there, tap a word to have it
  explained in that sentence — the same prompt as the desktop, so a word reads the same on both.
  Phrase boxes and part-of-speech colours come along with the transcript. Circle a phrase of your
  own by tapping a word and growing the selection with ◀ ▶. Looking something up pauses the video.
  Turn the phone sideways and the video and transcript sit side by side, with a draggable divider.
- **Review** with the same cards and the same scheduler — `review.js` is shared, not rewritten —
  plus text-to-speech.
- **Library, stats and a home screen**: search the deck, a four-month heatmap and words per hour of
  immersion, and on the home screen what is due today and the review streak. A daily reminder in
  the installed build.

The phone cannot fetch captions itself: YouTube only hands them to its own player, and that player
is out of reach inside a mobile WebView. So transcripts come from the desktop. Watch a video there
with sync on and the extension uploads the sentences, phrase boxes, part-of-speech tags and
translation to the repo; the phone reads all of it without paying for any of it again.

Building an APK with EAS: [app/BUILD.md](app/BUILD.md) (in Chinese). There is no iOS build.

## Sync

Optional. The deck — your words, the daily log, immersion time — is mirrored to a **private
GitHub repo of your own**, about 30 seconds after it changes. Every upload is a commit, so history
comes free.

Each device writes only its own file (`deck-ext-….json`, `deck-app-….json`) and never touches
another's, so writes cannot conflict. Merging happens on read, in `merge.js`: each word's latest
`updatedAt` wins, counters add up, deletions leave tombstones. The API key and the GitHub token are
never uploaded. Setup: [docs/github-sync.md](docs/github-sync.md).

## Install

No build step, no dependencies. Clone it and load it:

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select this folder
3. Open the extension's options page and paste an [Anthropic API key](https://console.anthropic.com/)
4. Open a YouTube video **with captions on** and reload the page

## What it costs

It calls Claude Haiku 4.5 four ways, all batched and cached per video:

| Call | When | Roughly |
| --- | --- | --- |
| Word explanation | Each word you click | Fractions of a cent |
| Phrase scan | Once per video | One call, cached |
| Part-of-speech tagging | Once per video | The expensive one — a few hundred lines of output |
| Sentence translation | Once per video | About five cents for a 20-minute talk |

The options page shows real token usage and estimated cost, broken down by call type. For one
person watching a few videos a day this lands in cents per month, but measure rather than trust
that sentence — that's what the meter is for.

The app holds its own copy of the key for the words you look up on the phone. Everything
per-video was already paid for on the desktop.

## How it works

The interesting problem is getting the transcript at all. YouTube gates `/api/timedtext` behind a
Proof-of-Origin Token, so fetching a caption track directly returns `200` with an empty body.

immerse doesn't forge a token. A `MAIN`-world content script monkey-patches `fetch` and
`XMLHttpRequest.open` and copies the URL of the request **the player itself makes** — already
signed — onto a DOM attribute, which is the only channel the isolated world can read. Re-fetching
that URL with `fmt=json3` yields the whole timed transcript; the same URL with `tlang=zh-Hant`
yields YouTube's own translation, which fills the Chinese line until the per-sentence translation
arrives.

Having the full transcript up front is what makes everything else simple: sentence boundaries are
computed once, so clicking a word gives you the complete sentence immediately rather than waiting
for the speaker to finish it.

```
hook.js      MAIN world, document_start — captures the signed timedtext URL
content.js   isolated world — captions, clicking, colouring, the vocabulary deck
bg.js        service worker — every network call (host_permissions exempt it from CORS)
prompts.js   every system prompt, shared with the app
merge.js     folds every device's deck file into one
review.html  the spaced-repetition screen
options.html API key, usage meter, sync, CSV export
app/         the phone app; app/src/shared/ is copied from the root, never edited there
```

## Development

```sh
node test.js     # pure logic: sentence stitching, phrase matching, POS, SM-2, CSV, cost maths
node smoke.js    # does content.js actually start? test.js never runs the load path
node icon.js     # regenerate the icons (a hand-rolled PNG encoder, zlib is the only dependency)
```

The extension deliberately has no npm, no bundler and no framework. Every dependency was declined
on purpose, and the comments say which and why — `ponytail:` marks a shortcut with a known ceiling
and the upgrade path if it ever matters.

The app is the exception, because React Native does not run without them. It does not import
across that boundary: `app/scripts/sync-shared.mjs` copies the shared logic (`review.js`,
`merge.js`, `prompts.js` and friends) into `app/src/shared/` before every start and every build, so
the root stays the one place to edit it.

## Known limitations

These are known and deliberate, not oversights:

- **YouTube can break this at any time.** It depends on the player's own caption request and on
  DOM class names. There is no SLA; when it breaks, you fix it.
- **Irregular verbs may not get coloured** (`grew` → `grow`). The stemmer is naive on purpose; a
  real lemmatiser means npm and a bundler.
- **A phrase split across two caption lines** falls back to separate words.
- **The first sentence of a video is uncoloured for a few seconds** while the tagging call
  returns. Cached per video, so a rewatch is instant.
- **The API key and the GitHub token are stored in plaintext** in `chrome.storage.local`. Anything
  that can read your Chrome profile can read them. The setup scopes the token to one repo's
  contents, so that repo is the blast radius.
- **The phone cannot capture a transcript.** Only videos opened on the desktop with sync on show
  up in the app.
- **Some videos will not play in the app.** An uploader can switch embedding off; the transcript
  then carries the session alone and the video opens in the YouTube app instead.
- **Android only.** Installing on your own iPhone needs a paid Apple developer account, so there
  is no iOS build.

## Credits

The design owes a lot to [zeroStudy](https://zerostudy.app), which solved this problem first and
solved it well. immerse started as a teardown of it and ended up as a personal tool with a
different bet: the explanation is context-first, and everything runs against your own API key.

## License

MIT — see [LICENSE](LICENSE).

---

## 繁體中文

一個把 YouTube 變成英文閱讀練習場的 Chrome 擴充：**點字幕上的任何一個字，看它在這句話裡的意思**，
再用內建的間隔重複複習記下來的詞。另有一支 Android 手機 app 讀同一份詞彙庫，複習進度和桌機看過的影片
都帶得走。

目標使用者是讀技術英文沒問題、但常卡在慣用語、片語動詞和俚語的中高階學習者——所以解釋是
**語境優先**，不是先丟一頁字典義項。

### 功能

- **點字**看它在這句的意思，另附 2–4 個常見義項，各配英文例句和中文語意。
- **片語成組**：`grew into` 是一個可點的框，不是兩個字。中高階卡的正是這些跨詞的東西。
- **詞性上色**：動詞藍、名詞琥珀、形容詞綠、介系詞粉紅、功能詞灰掉。
- **句子導航**：<kbd>A</kbd> 上一句、<kbd>S</kbd> 重播、<kbd>D</kbd> 下一句——切在真正的句子邊界。
- **中文對照字幕**（<kbd>Z</kbd>）：模型逐句翻譯，對齊真正的句子邊界。翻譯回來前的幾秒先用 YouTube
  自己的翻譯頂著——自動字幕的翻譯會跟語音差到好幾句，所以只當替補。
- **進階聽力模式**（<kbd>X</kbd>）：英文字幕模糊到不可讀，逼耳朵工作；滑到單一個字上偷看那個字。
  搭配 <kbd>Z</kbd> 就是「只看翻譯」的聽力訓練。依賴文字是聽力的殺手。
- **滑到字上就暫停**，移開繼續，不用先按空白鍵。
- **間隔重複複習**：按下「學習中」才進詞彙庫，佇列依「記憶衰退程度」排序。

### 手機 app

`app/` 是 React Native（Expo）寫的 Android app，從同步 repo 讀同一份詞彙庫。

- **沉浸**：挑一支桌機已上傳的影片，內嵌播放器播放，正在講的那句會亮起並自動捲動；點句子跳到那裡，
  點字看它在這句的意思（跟桌機同一份 prompt，同一個字兩邊讀起來一樣）。片語框和詞性顏色跟著逐字稿
  一起來；點一個字再用 ◀ ▶ 往外擴，就能圈自己的片語。查字時影片自動暫停。橫放時影片和逐字稿左右
  並排，中間的分隔線可以拖。
- **複習**：同樣的卡片、同一份排程（`review.js` 直接共用，不是重寫），可以朗讀。
- **詞彙庫、數據、首頁**：詞彙搜尋、四個月的熱力圖和每小時沉浸學到的字數；首頁顯示今天要複習幾個、
  連續複習幾天。安裝版另有每日提醒。

手機自己抓不到字幕：YouTube 只把字幕交給它自己的播放器，而手機 WebView 裡碰不到那個播放器。所以逐字稿
來自桌機——開啟同步後在桌機看一支影片，擴充會把句子、片語框、詞性和翻譯一起上傳，手機直接拿來用，
不用再付一次錢。

用 EAS 打包成 APK：見 [app/BUILD.md](app/BUILD.md)。沒有 iOS 版。

### 同步

選用。詞彙、每日紀錄、沉浸時數會鏡像到**你自己的 private GitHub repo**，改動後約 30 秒上傳，
每次上傳是一個 commit，版本史免費附送。每台裝置只寫自己的檔、從不碰別人的，合併發生在讀取時
（`merge.js`），所以不會互相覆蓋。API key 和 GitHub token 不會上傳。設定見
[docs/github-sync.md](docs/github-sync.md)。

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
壞了要自己修，沒有 SLA。手機版另外兩條：**手機自己抓不到逐字稿**，只有桌機開同步看過的影片會出現；
**只有 Android**。
