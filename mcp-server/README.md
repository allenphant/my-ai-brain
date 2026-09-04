# My Personal AI Brain - Remote MCP Server

這是 **My Personal AI Brain** 的專屬遠端 **Model Context Protocol (MCP) Server**。  
支援最新 MCP 2025-11-25 規範的 **Streamable HTTP (`/mcp`)** 與向後相容的 **Legacy SSE (`/sse`)**，能讓任何外部 AI Agent（例如 Claude Desktop、Cursor、Antigravity 或其他訂閱的遠端 Agentic 系統）安全地讀取、檢索、分類與建立你的個人 Firestore 靈感碎片與筆記。

---

## 核心特色

1. **雙協定支援**：
   * 最新標準：`POST/GET /mcp` (Streamable HTTP)
   * 舊版相容：`GET /sse` + `POST /messages` (Legacy SSE)
2. **安全與隔離 (Zero Leakage)**：
   * 強制常數時間 Bearer Token 驗證 (`crypto.timingSafeEqual`)。
   * 資料讀寫嚴格限定在 `DEFAULT_USER_UID` 底下，杜絕跨用戶越權。
3. **SSRF 內網防護**：
   * `read_url_content` 工具內建 IP 攔截機制，禁止存取 `localhost`、RFC1918 私有網段與雲端 Metadata 服務。
4. **前端完全相容與原子性**：
   * `move_item` 與 `delete_item` 採用 Firestore `runTransaction` 同步遷移/刪除 `details/note` 子集合，杜絕孤兒筆記。
   * 自動維護 `order: Date.now()` 排序欄位，確保前端 SortableJS 拖曳順序不崩潰。

---

## 可用 MCP 工具 (Tools)

| 工具名稱 | 用途說明 |
| :--- | :--- |
| `list_categories` | 列出所有可用分類（包含收件匣虛擬分類與 Firestore 自訂分類）。 |
| `get_inbox_items` | 取得收件匣中未分類的原始碎片。 |
| `get_category_items` | 取得特定分類（如 todos, learning, ideas, bookmarks）下的卡片清單。 |
| `move_item` | 將單一卡片移至目標分類（自動搬移 `details/note` 筆記，支援 dry-run 與 AI 理由記錄）。 |
| `batch_classify_items` | 一次批次整理最多 50 筆收件匣碎片。 |
| `create_item` | 在指定分類建立新卡片（若傳入 noteText 會自動轉為 Editor.js JSON 格式）。 |
| `delete_item` | 刪除卡片與關聯的筆記子集合。 |
| `search_items` | 跨分類模糊搜尋卡片文字。 |
| `read_url_content` | 抓取並解析目標網址的正文內容（SSRF 安全防護，以 Readability 抽取乾淨 Markdown）。 |

---

## 快速開始 (本地運行)

### 1. 安裝套件
```bash
cd mcp-server
npm install
```

### 2. 設定環境變數
複製 `.env.example` 為 `.env` 並填入你的資訊：
```ini
PORT=3000
APP_ID=my-personal-ai-brain
DEFAULT_USER_UID=your_firebase_auth_uid
MCP_API_KEY=your_super_secret_bearer_token

# Firebase Service Account JSON (可為 JSON 字串或檔案內容)
FIREBASE_SERVICE_ACCOUNT_KEY='{"type":"service_account",...}'
```

> **如何取得 Firebase Service Account？**
> 1. 前往 Firebase Console -> 專案設定 -> 服務帳戶 (Service Accounts)。
> 2. 點擊「產生新的私密金鑰 (Generate new private key)」並下載 JSON 檔案。

### 3. 啟動伺服器
```bash
npm start
```

---

## 雲端一鍵部署

### 部署至 Render / Fly.io / Docker

本專案內建 `Dockerfile` 與 `render.yaml`：
1. 將程式碼 Push 至 GitHub。
2. 在 **Render** 選擇「New Web Service」並連接本儲存庫（或使用 Blueprint `render.yaml`）。
3. 在環境變數中設定 `MCP_API_KEY`、`DEFAULT_USER_UID` 與 `FIREBASE_SERVICE_ACCOUNT_KEY`。
4. 部署完成後，取得公開網址，例如：`https://your-mcp.onrender.com`。

---

## 外部 Agent 連線設定 (Client Config)

### 在 Claude Desktop (或支援 MCP 的客戶端) 中設定：

編輯 Claude Desktop 設定檔 (`claude_desktop_config.json`)：

```json
{
  "mcpServers": {
    "my-personal-brain": {
      "url": "https://your-mcp.onrender.com/mcp",
      "headers": {
        "Authorization": "Bearer your_super_secret_bearer_token"
      }
    }
  }
}
```

> 若客戶端僅支援舊版 SSE，可將網址改為 `https://your-mcp.onrender.com/sse`。
