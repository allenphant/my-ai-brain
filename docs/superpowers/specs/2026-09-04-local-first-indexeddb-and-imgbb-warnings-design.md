# 系統設計規格書：漸進式架構 (Local-First IndexedDB) 與圖床風險專章

- **文件日期**：2026-09-04
- **狀態**：審查中 (Under Review)
- **架構原則**：Local-First、零依賴原生 ES Modules、無中心化金鑰、資料主權歸屬使用者

---

## 1. 背景與目標

### 1.1 背景
在先前的安全重構中，我們將專案調整為 Bring Your Own Database (BYOD) 架構，徹底拔除了前端寫死的 Firebase 金鑰。然而，這產生了新的使用門檻問題：大眾使用者初次打開網站時，因尚未配置 Firebase 憑證，系統會直接停留在「尚未設定專屬 Firebase 資料庫」的阻斷狀態，無法離線體驗基本看板、卡片新增與 Markdown 編輯功能。

此外，ImgBB 作為選配的第三方圖床，其公開可存取性（Public CDN URLs）與缺乏服務等級協定（Zero SLA）的特性，若使用者不慎上傳機敏資料或帳密截圖，可能產生隱私外洩與破圖風險。

### 1.2 核心目標
1. **零門檻本機優先 (Local-First Onboarding)**：未配置 Firebase 時，系統自動以瀏覽器原生 IndexedDB 啟動「本機離線模式」，預設分類自動就位，所有卡片操作（新增、編輯、拖曳、標籤、搜尋、本地 AI 整理）即刻可用。
2. **無縫升級與資料遷移 (Seamless Cloud Migration Wizard)**：當使用者在本地累積資料後，於設定中綁定 Firebase 並登入 Google，系統自動偵測並提示「一鍵匯入雲端」，將本機卡片安全同步至 Firestore。
3. **安全透明度與風險揭露 (Security & Privacy Transparency)**：於 `README.md` 重點標註 ImgBB 公開網址與無 SLA 限制，指導使用者安全使用規範。

---

## 2. 架構與模組設計

```
+-------------------------------------------------------------+
|                      前端介面 (UI Layer)                     |
|  看板網格 / 拖曳排序 / Editor.js 筆記 / 標籤篩選 / 全域搜尋  |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
|               儲存層控制器 (Storage Controller)              |
|        js/storage-controller.mjs (提供統一的 CRUD 介面)       |
+-------------------------------------------------------------+
               |                               |
    [未綁定 / 本機模式]               [已登入 Firebase]
               v                               v
+-------------------------------+ +---------------------------+
| 本地引擎 (LocalDbEngine)       | | 雲端引擎 (FirestoreEngine) |
| js/local-db.mjs (IndexedDB)   | | Firebase Cloud Firestore  |
+-------------------------------+ +---------------------------+
               \                               ^
                \---- [一鍵遷移精靈 Migration] ---/
```

### 2.1 本地資料庫規格 (`js/local-db.mjs`)
採用原生瀏覽器 `window.indexedDB` 進行封裝，資料庫名稱為 `MyAiBrainLocalDB`，版本為 `1`。

#### Object Stores 規劃：
1. **`categories`** (Key: `id`)
   - 欄位：`id`, `name`, `icon`, `type`, `promptRule`, `order`, `createdAt`
   - 預設提供 4 組標準分類：
     - `todos`（待辦事項，type: `todo`, order: 1000）
     - `learning`（學習筆記，type: `text`, order: 2000）
     - `ideas`（靈感與想法，type: `text`, order: 3000）
     - `bookmarks`（稍後閱讀，type: `bookmark`, order: 4000）
2. **`cards`** (Key: `id`)
   - 欄位：`id`, `collection`, `title`, `order`, `completed`, `tags`, `url`, `research`, `pinned`, `createdAt`, `updatedAt`
   - 索引（Indexes）：
     - `by_collection`：索引欄位 `collection`
     - `by_collection_order`：複合索引 `[collection, order]`
3. **`notes`** (Key: `id`，對應 cardId)
   - 欄位：`id`（cardId）, `blocks`, `time`, `version`
4. **`metadata`** (Key: `key`)
   - 儲存鍵值：
     - `tags`：標籤陣列 `[{ id, name }]`
     - `migration_status`：遷移標記 `{ hasMigratedToCloud: boolean, migratedAt: timestamp }`

### 2.2 儲存層調度介面 (`js/storage-controller.mjs`)
對外暴露一致的 API，並提供事件監聽機制以支援介面響應式更新：
- `init(mode, firebaseContext)`
- `getCategories()`, `saveCategory(category)`, `deleteCategory(id)`
- `getCards(collectionName)`, `addCard(collectionName, cardData)`, `updateCard(collectionName, cardId, cardData)`, `deleteCard(collectionName, cardId)`, `moveCard(fromCol, toCol, cardId, cardData)`
- `getNote(cardId)`, `saveNote(cardId, noteData)`
- `getTags()`, `saveTags(tags)`
- `subscribe(eventType, callback)`：支援 `categories_changed`, `cards_changed`, `tags_changed` 事件。
- `exportAllData()`：完整匯出本機資料，供遷移或備份使用。

---

## 3. 使用者體驗與狀態流轉

### 3.1 頂部狀態列規範
1. **本機離線模式 (預設)**：
   - 狀態指標：天藍色燈號（`bg-sky-500`）。
   - 狀態說明：「本機儲存模式（離線可用）」。
   - 按鈕樣式：顯示「連結雲端（Firebase）」主按鈕。
2. **雲端已連線模式**：
   - 狀態指標：翡翠綠燈號（`bg-emerald-500`）。
   - 狀態說明：「嗨，[使用者名稱]（已同步雲端）」。
   - 按鈕樣式：顯示「登出」與「設定」按鈕。

### 3.2 資料遷移精靈 (Migration Wizard)
- **觸發時機**：使用者填入 Firebase Config 且 Google 驗證成功後，系統自動檢查本機 IndexedDB 的 `cards` 筆數與 `hasMigratedToCloud` 狀態。
- **互動流程**：
  1. 若本機有未遷移的卡片資料，彈出對話框：
     - 「偵測到本機有 N 筆離線卡片與自訂分類。是否要一鍵匯入至你的 Firebase 雲端資料庫？」
  2. 使用者選擇「一鍵匯入雲端」：
     - 顯示進度指示條。
     - 調用 `storage-controller.exportAllData()` 取得本機資料。
     - 批次以原本的 ID 寫入 Firestore 集合中（保留完整筆記與標籤關聯）。
     - 寫入完畢後標記 `hasMigratedToCloud: true`。
     - 彈出成功通知並切換為雲端資料視圖。
  3. 使用者選擇「暫不匯入」：
     - 關閉對話框，維持雲端資料庫視圖；本地資料完整保留於 IndexedDB，不作刪除。

---

## 4. ImgBB 安全與隱私風險專章規範

於 `README.md` 中增修以下重點：

### 4.1 警示標籤 (`> [!WARNING]`)
1. **公開存取性 (Public URL Disclosure)**：
   - ImgBB 產生的圖片網址為公開 CDN 連結，無存取控制清單。
   - 嚴禁透過剪貼簿貼上或上傳包含帳號密碼、API 金鑰、個人身分證件或商業機密之截圖。
2. **無 SLA 保證與被動清除政策 (Retention Policy & Zero SLA)**：
   - 免費圖床不保證永久可用性，長時間未存取或平台容量策略調整可能造成圖片失效。
   - 建議重要筆記以文字或 Markdown 結構為主，避免依賴外部公開圖床存放關鍵資產。

---

## 5. 測試與驗證計畫

1. **單元測試 (`tests/local-db.test.mjs`)**：
   - 驗證 IndexedDB 結構初始化與 4 個標準分類之自動生成。
   - 驗證卡片 CRUD、分類 CRUD、標籤存取與排序索引查詢。
2. **控制器整合測試 (`tests/storage-controller.test.mjs`)**：
   - 驗證 Local 模式下資料操作與訂閱事件派發。
   - 驗證 `exportAllData()` 資料完整性。
3. **回歸測試**：
   - 執行 `npm test`，確保現有 97 項測試（含 BYOD 解析、搜尋、排程、Markdown 語法）全數持續通過。
