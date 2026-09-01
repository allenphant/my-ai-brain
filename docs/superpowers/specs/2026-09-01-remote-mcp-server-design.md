# Remote MCP Server Design Specification

## 1. 概述 (Overview)

本規格定義了 **My Personal AI Brain** 的專屬遠端 **Model Context Protocol (MCP) Server**。該伺服器允許任何外部 AI Agent（例如 Claude Desktop、Cursor、Antigravity 或其他訂閱的遠端 Agentic 系統）透過標準 SSE (Server-Sent Events) 協議安全地連線，存取、檢索、分類與建立個人的 Firestore 筆記與靈感碎片。

---

## 2. 系統架構與安全性 (Architecture & Security)

### 2.1 架構模型

```
┌────────────────────────────────────────────────────────┐
│            外部訂閱 AI Agent (Claude, Cursor, etc.)     │
└───────────────────────────┬────────────────────────────┘
                            │ SSE / HTTP (JSON-RPC) + Bearer Token
┌───────────────────────────▼────────────────────────────┐
│               Remote MCP Server (Express)              │
│  - Auth Middleware (Bearer Token / Query Token)        │
│  - SSEServerTransport (@modelcontextprotocol/sdk)       │
│  - Domain Tool Handlers (Triage, Readability, Search)  │
│  - Firebase Admin SDK (Scoped to User UID)             │
└───────────────────────────┬────────────────────────────┘
                            │ Firestore Admin API
┌───────────────────────────▼────────────────────────────┐
│       Google Cloud Firestore (my-personal-ai-brain)    │
│  Path: artifacts/{appId}/users/{DEFAULT_USER_UID}/...  │
└────────────────────────────────────────────────────────┘
```

### 2.2 安全性與存取邊界 (Security Boundary)

1. **認證機制 (Authentication)**：
   * 所有請求均需通過 `MCP_API_KEY` 認證。
   * 支援兩種認證方式：
     * HTTP Header: `Authorization: Bearer <MCP_API_KEY>`
     * Query Parameter: `?token=<MCP_API_KEY>` 或 `?api_key=<MCP_API_KEY>`（相容僅支援 URL 設定的 Agent 客戶端）。
   * 若認證失敗，立即回傳 HTTP 401 Unauthorized。
2. **多租戶與資料路徑隔離 (Data Isolation)**：
   * 透過環境變數 `DEFAULT_USER_UID` 綁定目標使用者的 Firebase Auth UID。
   * 所有資料庫讀寫皆嚴格限定在路徑 `artifacts/${APP_ID}/users/${DEFAULT_USER_UID}/`，不可越權存取其他集合。

---

## 3. 目錄結構 (Directory Structure)

專案將在根目錄新增獨立的 `mcp-server/` 子模組：

```text
my-ai-brain/
├── mcp-server/
│   ├── package.json               # 依賴 @modelcontextprotocol/sdk, express, firebase-admin, @mozilla/readability, jsdom
│   ├── .env.example               # 環境變數設定範本
│   ├── Dockerfile                 # 容器化部署設定
│   ├── render.yaml                # Render 一鍵部署設定
│   ├── README.md                  # 部署與連線設定教學
│   └── src/
│       ├── index.js               # Express 伺服器入口、SSE/HTTP 端點、Auth 中介軟體
│       ├── server.js              # MCP Server 實例與 Tool 註冊中心
│       ├── firestore.js           # Firebase Admin 初始化與資料庫 CRUD / 交易封裝
│       ├── utils/
│       │   └── readability.js     # 成熟的 @mozilla/readability + jsdom 網頁正文解析工具
│       └── tools/
│           ├── categories.js      # list_categories 工具
│           ├── items.js           # get_inbox_items, get_category_items, search_items
│           ├── mutate.js          # move_item, batch_classify_items, create_item, delete_item
│           └── research.js        # read_url_content 工具
```

---

## 4. MCP 工具介面規範 (Tools Specification)

### 4.1 分類與清單讀取

#### `list_categories`
* **說明**：列出目前所有分類（包含系統預設分類 `inbox`, `todos`, `learning`, `ideas`, `bookmarks` 以及使用者自訂分類）。
* **參數**：無。
* **回傳**：分類陣列 `[{ id, name, icon, color, isCustom }]`。

#### `get_inbox_items`
* **說明**：取得收件匣中尚未歸類的原始碎片。
* **參數**：
  * `limit` (number, 選填, 預設 20): 最大回傳筆數。
* **回傳**：碎片陣列 `[{ id, text, createdAt, hasNote }]`。

#### `get_category_items`
* **說明**：取得特定分類下的所有卡片。
* **參數**：
  * `category` (string, 必填): 分類 ID 或名稱。
  * `limit` (number, 選填, 預設 20): 最大回傳筆數。
* **回傳**：卡片陣列 `[{ id, text, createdAt, hasNote, completed, completedAt }]`。

#### `search_items`
* **說明**：在所有分類與收件匣中模糊搜尋卡片文字。
* **參數**：
  * `keyword` (string, 必填): 搜尋關鍵字。
* **回傳**：符合條件的卡片陣列 `[{ id, text, category, createdAt }]`。

---

### 4.2 卡片變更與批次整理

#### `move_item`
* **說明**：將單一卡片從來源分類移至目標分類，並自動連帶搬移 `details/note` 子集合筆記資料。
* **參數**：
  * `itemId` (string, 必填): 卡片 ID。
  * `fromCategory` (string, 必填): 來源分類（如 `inbox`）。
  * `toCategory` (string, 必填): 目標分類（如 `todos`）。
  * `aiReasoning` (string, 選填): Agent 的分類理由。
  * `tags` (string[], 選填): 附帶標籤。
  * `dryRun` (boolean, 選填, 預設 `false`): 若為 true 僅模擬回傳變更，不實際寫入。
* **回傳**：`{ success: true, movedId, fromCategory, toCategory, isDryRun }`。

#### `batch_classify_items`
* **說明**：一次批次分類多筆收件匣碎片，採用 Firestore Transaction 確保原子性。
* **參數**：
  * `items` (array, 必填): `[{ itemId, toCategory, aiReasoning?, tags? }]`
  * `dryRun` (boolean, 選填, 預設 `false`)
* **回傳**：`{ success: true, processedCount, results: [...], isDryRun }`。

#### `create_item`
* **說明**：在指定分類或收件匣中主動建立一張新卡片。
* **參數**：
  * `category` (string, 必填, 預設 `inbox`): 目標分類。
  * `text` (string, 必填): 卡片標題或文字內容。
  * `note` (string, 選填): 卡片詳細筆記內容 (純文字或 JSON)。
* **回傳**：`{ success: true, id, category, createdAt }`。

#### `delete_item`
* **說明**：刪除指定分類下的卡片及其關聯筆記。
* **參數**：
  * `itemId` (string, 必填): 卡片 ID。
  * `category` (string, 必填): 所在分類。
* **回傳**：`{ success: true, deletedId }`。

---

### 4.3 網頁內容研讀工具

#### `read_url_content`
* **說明**：使用成熟的 `@mozilla/readability` 與 `jsdom` 抓取並解析目標網址的正文內容，過濾廣告雜訊後輸出簡潔的 Markdown，供 Agent 進行內容研讀。
* **參數**：
  * `url` (string, 必填): 要解析的網址。
  * `maxLength` (number, 選填, 預設 3000): 內文字數上限。
* **回傳**：`{ url, title, excerpt, contentMarkdown, byline }`。

---

## 5. 環境設定與部署 (Environment & Deployment)

### 5.1 環境變數 (`.env`)

```ini
PORT=3000
APP_ID=my-personal-ai-brain
DEFAULT_USER_UID=your_firebase_auth_uid
MCP_API_KEY=your_secret_bearer_token

# Firebase Service Account JSON (支援檔案路徑或 JSON 字串)
FIREBASE_SERVICE_ACCOUNT_KEY='{"type":"service_account",...}'
```

### 5.2 部署支援

* 提供 Dockerfile 與標準 Node.js 執行環境。
* 預設支援 Render、Fly.io、Railway 與 Google Cloud Run。
