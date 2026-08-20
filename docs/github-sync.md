# GitHub 同步設定

學習資料（`words`、`marks`、每日紀錄、沉浸時數）鏡像到你自己 **private repo**。資料改動後
約 30 秒自動上傳，**每次上傳是一個 commit**——版本史免費附送，誤刪誤改都能從 commit 歷史
撈回來。**API key 與 GitHub token 永遠不會進入上傳內容。**

## 每台裝置一個檔案

repo 裡不是一個檔案，而是每台裝置一個：`deck-ext-a1b2c3d4.json`、未來手機 app 的
`deck-app-xxxxxxxx.json`。**一台裝置只寫自己的檔，從不碰別人的**，所以寫入端永遠不會衝突、
不需要鎖也不需要合併重試；合併發生在讀取時（`merge.js` 的 `foldSnapshots`）：

| 資料 | 合併規則 | 為什麼 |
|---|---|---|
| `words` | 逐字取 `updatedAt` 最新的 | 每筆是「這個字現在的狀態」，最後寫的人說了算 |
| `marks` | **不合併**，由合併後的 words 推導 | 兩份真相會漂移，一份不會 |
| `log`／`immLog`／`immByVideo`／`immersion` | 各裝置相加 | 每個檔只記自己那台的量，相加才是總量；且重推同一份檔不會灌水 |
| `deleted`（墓碑） | 取最新，且蓋過比它舊的 words | 沒有墓碑的話，刪除會被「還留著那筆」的另一台裝置復活 |

刪除任何一個字（詞彙庫移除、單字負債清理、清空詞彙庫、在影片上取消標記）都會留下一個
`deleted[id] = 時間`。之後若在影片上重新標記同一個字，新的 `updatedAt` 會蓋過墓碑——復活是
刻意的，那正是「重新標記」的意思。墓碑保存 90 天後自動清掉。

單一寫入者時代的 `immerse-deck.json` 不符合 `deck-*.json` 命名，**不會被讀取也不會被覆蓋**，
留著當備份；確認新機制正常後可以自行刪除。

選 GitHub 而不是 Google Drive 的原因很務實：Drive 需要在 GCP 主控台建 OAuth 同意畫面，
而那個流程（2026-08）反覆故障；GitHub 只需要一個 token，貼上就能用。Drive 後端的程式碼
完整保留（`bg.js` 的 `BACKEND` 開關），設定步驟在 [drive-sync.md](drive-sync.md)，
想切回去改一行即可。

## 一次性設定（約三分鐘）

1. **建 private repo**：[github.com/new](https://github.com/new) → 名稱如 `immerse-data` →
   勾 **Private** → Create。不用 README、不用任何檔案，空的就好。
2. **建 fine-grained token**：
   [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new)
   - Token name：`immerse-sync`
   - Expiration：選最長（到期後來這裡重生一顆、重貼一次）
   - Repository access：**Only select repositories** → 選剛建的 `immerse-data`
   - Permissions → Repository permissions → **Contents：Read and write**（Metadata 會自動變唯讀，正常）
   - Generate token → 複製 `github_pat_…`（只顯示這一次）
3. **貼進選項頁**：immerse 選項頁 →「雲端同步（GitHub）」→ repo 填 `你的帳號/immerse-data`、
   token 貼上 → Save →「**連結並開始同步**」。狀態列顯示「已連結，上次上傳：…」即完成，
   repo 裡會出現第一個 commit。

## 運作方式

- **上傳時機**：`words`／`marks`／每日紀錄任何改動後 30 秒內合併成一次上傳
  （`chrome.alarms`，service worker 被回收也不會漏）。
- **還原**：選項頁「從雲端還原」＝把 repo 裡**所有**裝置檔折疊成一份，覆蓋本機
  （有確認對話框）。換電腦、重灌、誤刪詞彙庫時用。要回到更早的版本：在 GitHub 上打開
  該檔案的 History，把舊版內容 revert 成新 commit，再按還原。
- **安全性**：token 跟 API key 一樣以明文存在 `chrome.storage.local`——能讀這個
  Chrome profile 的東西都讀得到。它的權限被限制在那一個 repo 的內容讀寫，最壞情況的
  爆炸半徑就是那個 repo。
- **未來的 app 版**：寫自己的 `deck-app-xxxxxxxx.json`，遵守三條約定——每筆字蓋
  `updatedAt`、計數器只記自己那台的量、刪除留墓碑。合併規則見上表與 `merge.js`。

## 已知上限（ponytail）

- **還原是手動的**：上傳自動、下載要按按鈕。手機 app 加入後若想看到即時合併的內容，
  下一步是開頁時自動 pull-fold；現階段只有一個寫入者，自動拉取沒有價值卻有風險。
- 快照全量上傳，不做增量；Contents API 的檔案上限 100MB，個人詞彙庫離這還很遠。
- 墓碑 90 天到期，沒有「每台裝置都確認看過了」的機制。離線超過一季的裝置可能讓
  已刪除的字復活——個人工具不會有這種情境。
- token 有效期最長一年，到期要手動換發。
