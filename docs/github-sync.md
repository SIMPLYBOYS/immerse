# GitHub 同步設定

學習資料（`words`、`marks`、每日紀錄、沉浸時數）鏡像到你自己 **private repo** 裡的
`immerse-deck.json`。資料改動後約 30 秒自動上傳，**每次上傳是一個 commit**——版本史免費附送，
誤刪誤改都能從 commit 歷史撈回來。**API key 與 GitHub token 永遠不會進入上傳內容。**

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
- **還原**：選項頁「從雲端還原」＝用 repo 裡的快照覆蓋本機（有確認對話框）。
  換電腦、重灌、誤刪詞彙庫時用。要回到更早的版本：在 GitHub 上打開該檔案的 History，
  把舊版內容 revert 成新 commit，再按還原。
- **安全性**：token 跟 API key 一樣以明文存在 `chrome.storage.local`——能讀這個
  Chrome profile 的東西都讀得到。它的權限被限制在那一個 repo 的內容讀寫，最壞情況的
  爆炸半徑就是那個 repo。
- **未來的 app 版**：讀寫同一個 repo 檔案即可；每筆字已帶 `updatedAt`，屆時升級為
  逐字合併。

## 已知上限（ponytail）

- 單向鏡像、無衝突防護——單一寫入者之下不需要。sha 過期會自動重抓重試一次。
- 快照全量上傳，不做增量；Contents API 的檔案上限 100MB，個人詞彙庫離這還很遠。
- token 有效期最長一年，到期要手動換發。
