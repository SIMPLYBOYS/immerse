# 打包成獨立 app（EAS Build）

把手機 app 從「Expo Go + 開發伺服器」變成一支真正安裝在手機上、離線可用、不需要電腦的 app。
目標平台 Android（你的裝置），輸出一個可直接安裝的 APK。

程式碼這邊已經備好了：app 自給自足（共用邏輯已複製進 `src/shared/` 並提交），`eas.json`、
`app.json` 的識別碼都設好了。剩下的是幾個**需要互動式登入**的指令，你在終端機跑。

## 一次性設定

```bash
# 用專案指定的 Node（EAS 需要 >= 20.19.4）
nvm use 20.20.2
cd /Users/mac/Documents/OpenSourceProjects/immerse/app

# 1. 登入（沒有 Expo 帳號的話會引導你註冊，免費）
npx eas-cli login

# 2. 把這個專案登記到你的 Expo 帳號，並寫入 projectId
npx eas-cli init
```

`eas init` 會在 `app.json` 裡補一段 `extra.eas.projectId`——那是這支 app 在 Expo 雲端的識別碼，
提交進 git 沒問題（不是祕密）。

## 每次要出新版就跑這行

```bash
nvm use 20.20.2
cd /Users/mac/Documents/OpenSourceProjects/immerse/app
npx eas-cli build --platform android --profile preview
```

- 編譯在 **Expo 雲端**跑，約 10–20 分鐘（第一次比較久）。
- 跑之前它會自動執行 `eas-build-pre-install` → `sync-shared.mjs`，把最新的共用邏輯帶進去。
- 完成後給你一個網址，裡面有 **APK 下載連結**。用手機開那個網址下載、安裝
  （Android 會問要不要允許「安裝未知來源的應用程式」，允許即可）。

裝好後就是一支獨立的 immerse：自己的圖示、離線可開、不需要 Expo Go、不需要你的電腦。
第一次開一樣要在設定頁填 repo、GitHub token、Anthropic API key。

## 之後改了程式怎麼更新

EAS build 出來的 APK 是**當下版本的快照**，不會像開發伺服器那樣即時刷新。改了程式要更新到手機，
就再跑一次上面那行 `eas build`，重新下載安裝新的 APK（會蓋掉舊的，資料保留）。

出新版前把 `app.json` 的 `version`（給人看的，如 1.0.1）和 `android.versionCode`（整數，每次 +1）
往上調一格，比較好分辨。

## 共用邏輯的維護規則（重要）

排程、合併、字幕處理這些邏輯的**唯一可編輯來源在 repo 根目錄**（`review.js`、`merge.js` 等）。
`app/src/shared/` 裡是它們的**複製檔**，由 `scripts/sync-shared.mjs` 產生：

- `npm start`（開發）會自動先跑 sync，所以本機永遠是最新的。
- `eas build` 會在雲端自動先跑 sync。
- **不要手動改 `src/shared/` 裡的檔案**——下次 sync 就被覆蓋。要改邏輯改根目錄。

複製檔有提交進 git，是因為 EAS 只上傳 git 追蹤的檔案，這樣才保證雲端編得到。改了根目錄的邏輯後，
`npm run sync-shared` 一下再提交，複製檔就會跟上。

## 不做 iOS 的原因

iOS 要 Apple Developer 帳號（年費 US$99）才能把 app 裝進自己的 iPhone。Android 直接裝 APK，
零成本。你是 Android，走這條就好。

## ponytail

- APK 走 `preview` profile、internal distribution——個人自用最省事的形態，不上架商店。
- `production` profile（app-bundle）留著，真要上 Google Play 時才用。
- 每日提醒在獨立 app 裡才真正能用（Expo Go 的 Android 沒有這個原生模組）。
