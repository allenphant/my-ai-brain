# Remote MCP Server Design Specification (Revised)

## 1. 概述 (Overview)

本規格定義了 **My Personal AI Brain** 的專屬遠端 **Model Context Protocol (MCP) Server**。該伺服器允許任何外部 AI Agent（例如 Claude Desktop、Cursor、Antigravity 或其他訂閱的遠端 Agentic 系統）透過標準 MCP 協議安全地連線，存取、檢索、分類與建立個人的 Firestore 筆記與靈感碎片。

---

## 2. 系統架構與安全性 (Architecture & Security)

### 2.1 架構模型與分層

採用分層架構（Layered Architecture），徹底將 MCP 傳輸層、領域邏輯層與資料存取層解耦：

```text
┌────────────────────────────────────────────────────────┐
│            外部訂閱 AI Agent (Claude, Cursor, etc.)     │
└───────────────┬────────────────────────▲───────────────┘
                │ Streamable HTTP (POST/GET /mcp)
                │ Legacy SSE Fallback (/sse, /messages)
┌───────────────▼────────────────────────┴───────────────┐
│              Remote MCP Transport & Security           │
│  - Constant-time Token Auth (Authorization: Bearer)    │
│  - Origin & Rate Limit Middleware                      │
│  - Streamable HTTP & Legacy SSE Adapter                │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│                    Domain Service                      │
│  - Category Resolver (虛擬 inbox 與自訂分類推導)       │
│  - Schema Normalizer (Date.now 毫秒、Editor.js JSON)   │
│  - Atomic Transaction & Idempotency Manager            │
│  - SSRF Safe Fetcher (禁止私人 IP / Metadata 服務)     │
└───────────────────────────┬────────────────────────────┘
                            │ Scoped Firestore Operations
┌───────────────────────────▼────────────────────────────┐
│       Google Cloud Firestore (my-personal-ai-brain)    │
│  Path: artifacts/{appId}/users/{DEFAULT_USER_UID}/...  │
└────────────────────────────────────────────────────────┘
```

### 2.2 傳輸協定規範 (MCP Transport)

1. **主流標準：Streamable HTTP (`/mcp`)**：
   * 符合 MCP 2025-11-25 最新規範，提供單一 `/mcp` 端點（支援 `POST` 呼叫與 `GET` 串流）。
2. **向後相容：Legacy SSE (`/sse` & `/messages`)**：
   * 針對尚未更新 Streamable HTTP 的舊版 Agent 用戶端提供 SSE 傳輸降級相容。
3. **安全邊界防護**：
   * **Constant-time 認證**：使用 `crypto.timingSafeEqual` 驗證 `Authorization: Bearer <MCP_API_KEY>`，防止時序攻擊 (Timing Attack)。
   * **嚴禁 URL Query Token**：不支援從 URL 傳遞 Token，避免敏感金鑰留存於伺服器或代理 Log。
   * **Single-user 邊界聲明**：伺服器啟動時驗證 `DEFAULT_USER_UID` 與 `FIREBASE_SERVICE_ACCOUNT_KEY`，所有 Firestore 存取皆嚴格限制於該 UID 空間。

---

## 3. 資料庫 Schema 與前端對齊 (Data Consistency)

為精確相容前端 `app.js` 的行為，資料結構定義如下：

| 欄位 | 型別 | 規格與限制 |
| :--- | :--- | :--- |
| `createdAt` | `number` (Int) | **使用數字毫秒值 `Date.now()`**（如 `1725170000000`），與前端完全一致。 |
| `order` | `number` (Float/Int) | 寫入時填入 `Date.now()`，供前端 SortableJS 拖曳排序使用。 |
| `completed` | `boolean` | **僅存在於 `todos` 分類**。移出 `todos` 時強制刪除該屬性；移入時預設為 `false`。 |
| `inbox` | 虛擬分類 (Virtual) | `inbox` 為前端虛擬分類，底層集合為 `inbox`，不屬於 `categories` 集合文件。 |
| `details/note` | Subcollection | 內容必須符合 **Editor.js JSON Schema**（包含 `time`, `blocks`, `version`），若傳入純文字則自動包裝為 Paragraph Block。 |
| `hasNote` | `boolean` | 卡片上的反正規化 (Denormalized) 欄位，避免查詢時產生 N+1 查詢。 |

---

## 4. MCP 工具介面規範 (Tools Specification)

### 4.1 分類與清單讀取

#### `list_categories`
* **說明**：列出所有可用分類。自動將虛擬分類 `inbox` 與 Firestore `categories` 集合中的自訂/預設分類整合回傳。
* **回傳**：`[{ id, name, icon, type, promptRule, order, isVirtual }]`。

#### `get_inbox_items`
* **說明**：分頁取得收件匣中的原始碎片。
* **參數**：
  * `limit` (number, 選填, 預設 20, 上限 100)
* **回傳**：`[{ id, text, createdAt, hasNote, order }]`。

#### `get_category_items`
* **說明**：取得特定分類下的卡片清單。
* **參數**：
  * `category` (string, 必填)
  * `limit` (number, 選填, 預設 20, 上限 100)
* **回傳**：`[{ id, text, createdAt, hasNote, order, completed }]`。

#### `search_items`
* **說明**：在各分類中進行文字搜尋（具備查詢上限與伺服器端過濾）。
* **參數**：
  * `keyword` (string, 必填)
  * `limit` (number, 選填, 預設 20)
* **回傳**：`[{ id, text, category, createdAt, hasNote }]`。

---

### 4.2 卡片變更、搬移與交易原子性 (Atomic Operations)

#### `move_item`
* **說明**：使用 Firestore `runTransaction` 進行原子性搬移：讀取來源卡片與 `details/note` -> 寫入目的集合與目的 note -> 刪除來源卡片與來源 note。
* **Schema Hook**：移出 `todos` 時清洗 `completed`；移入 `todos` 時初始化 `completed: false`。
* **參數**：
  * `itemId` (string, 必填)
  * `fromCategory` (string, 必填)
  * `toCategory` (string, 必填)
  * `aiReasoning` (string, 選填)
  * `tags` (string[], 選填)
  * `dryRun` (boolean, 選填, 預設 `false`)
* **回傳**：`{ success: true, movedId, fromCategory, toCategory, isDryRun }`。

#### `batch_classify_items`
* **說明**：批次搬移收件匣碎片。單次上限 50 筆，採用批次交易確保資料不遺失。
* **參數**：
  * `items` (array, 必填, 長度 1~50): `[{ itemId, toCategory, aiReasoning?, tags? }]`
  * `dryRun` (boolean, 選填, 預設 `false`)
* **回傳**：`{ success: true, processedCount, results: [...], isDryRun }`。

#### `create_item`
* **說明**：建立新卡片。自動填入 `createdAt: Date.now()` 與 `order: Date.now()`。若附帶筆記，則自動建立標準 Editor.js 格式之 `details/note` 子文件。
* **參數**：
  * `category` (string, 必填, 預設 `inbox`)
  * `text` (string, 必填)
  * `noteText` (string, 選填): 筆記文字（自動轉為 Editor.js Paragraph block）。
* **回傳**：`{ success: true, id, category, createdAt, order }`。

#### `delete_item`
* **說明**：原子性刪除卡片與關聯的 `details/note` 子集合，杜絕孤兒資料。
* **參數**：
  * `itemId` (string, 必填)
  * `category` (string, 必填)
* **回傳**：`{ success: true, deletedId }`。

---

### 4.3 網頁內容研讀工具 (SSRF-Protected)

#### `read_url_content`
* **說明**：抓取並解析目標網址正文，內建完善的 SSRF (Server-Side Request Forgery) 防護機制。
* **安全性限制**：
  * 禁止存取 `127.0.0.1`, `localhost`, RFC1918 私有網段 (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) 與雲端 Metadata 服務 IP (`169.254.169.254`)。
  * 限制最多 3 次 Redirect，並設定 10 秒連線 Timeout。
* **正文抽取**：使用 `@mozilla/readability` + `jsdom`，若判定為 SPA 動態渲染則標註警告。
* **參數**：
  * `url` (string, 必填)
  * `maxLength` (number, 選填, 預設 3000)
* **回傳**：`{ url, title, excerpt, contentMarkdown, isProbablySPA }`。

---

## 5. 目錄結構與部署設定

```text
my-ai-brain/
├── mcp-server/
│   ├── package.json
│   ├── .env.example
│   ├── Dockerfile
│   ├── render.yaml
│   ├── README.md
│   └── src/
│       ├── index.js               # Express 伺服器入口 (Streamable HTTP / SSE / Auth)
│       ├── server.js              # MCP Server 實例與 Tool 註冊中心
│       ├── services/
│       │   ├── domain.js          # 核心領域服務 (Schema Hook, 交易與搬移邏輯)
│       │   ├── firestore.js       # Firebase Admin 初始化與 Scoped 存取封裝
│       │   └── fetcher.js         # SSRF-Safe 網頁抓取與 Readability 抽取器
│       └── tools/                 # 各工具定義與參數 Schema (Zod)
```
