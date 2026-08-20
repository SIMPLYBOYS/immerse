# Google Drive 同步設定

學習資料（`words`、`marks`、每日紀錄、沉浸時數）鏡像到你自己雲端硬碟裡的
`immerse-deck.json`。資料改動後約 30 秒自動上傳；選項頁可手動「立即上傳」或「從雲端還原」。
**API key 永遠不上傳。**

範圍是刻意收窄的 v1：**單向鏡像**。目前唯一會寫入的裝置就是這個擴充，所以整包快照直接覆蓋雲端
即可；還原是手動、明確的動作。每筆字都帶 `updatedAt` 時間戳——未來 app 版成為第二個寫入者時，
升級路徑是逐字合併＋條件寫入，資料格式已經準備好了。

## 一次性設定（約五分鐘）

Drive API 必須用你自己的 OAuth client（Google 的規定，沒有繞法）。client_id 不是祕密，
放進公開 repo 沒有問題。

1. **查你的擴充 ID**：`chrome://extensions` → immerse 卡片上的「ID」（32 個小寫字母）。
   注意：未打包載入的擴充 ID 由資料夾路徑決定——**移動資料夾會改變 ID**，屆時要回
   步驟 4 更新 OAuth client。
2. **建 GCP 專案**：[console.cloud.google.com](https://console.cloud.google.com) →
   新增專案（名稱隨意，如 `immerse-sync`）。
3. **啟用 Drive API**：「API 和服務」→「程式庫」→ 搜尋 Google Drive API → 啟用。
4. **設定 OAuth 同意畫面**：「API 和服務」→「OAuth 同意畫面」→ External →
   只填必填欄位。完成後按「發布應用程式」把狀態改成**正式版**（停在測試模式的話，
   授權每 7 天過期，會一直被要求重新登入）。`drive.file` 是非敏感 scope，
   正式版不需要通過 Google 驗證，只會在首次授權時多一個「未經驗證」畫面。
5. **建立憑證**：「憑證」→「建立憑證」→「OAuth 用戶端 ID」→ 應用程式類型選
   **Chrome 擴充功能** → 「項目 ID」貼上步驟 1 的擴充 ID。
6. **貼 client_id**：把產生的 `xxxx.apps.googleusercontent.com` 填進
   `manifest.json` 的 `oauth2.client_id`，回 `chrome://extensions` 重新載入擴充。
7. **連結**：打開 immerse 的選項頁 →「連結 Google Drive 並開始同步」→ 選帳號授權。
   狀態列出現「已連結，上次上傳：…」就完成了。

## 運作方式

- **上傳時機**：`words`／`marks`／每日紀錄任何一項改動後，30 秒內合併成一次上傳
  （用 `chrome.alarms`，service worker 被回收也不會漏）。
- **檔案**：`drive.file` scope 只看得到這個 app 自己建的檔案；`immerse-deck.json`
  就存在「我的雲端硬碟」根目錄，可以自行搬動、改名不影響（靠 fileId 追蹤）。
- **還原**：選項頁「從雲端還原」＝用雲端快照覆蓋本機（有確認對話框）。用途：
  換電腦、重灌、或誤刪詞彙庫後救回。
- **停用**：「停用同步」只停止自動上傳，雲端檔案留著。

## 已知上限（ponytail）

- 單向鏡像、無衝突防護——單一寫入者之下不需要。兩台電腦同時開著擴充各自標記，
  後上傳者覆蓋先上傳者。app 版加入後改成逐字 `updatedAt` 合併＋條件寫入。
- 快照全量上傳（幾百 KB～2MB），不做增量。個人資料量下不值得。
