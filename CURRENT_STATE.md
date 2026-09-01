# feat(mcp): 遠端 MCP Server (Streamable HTTP & Legacy SSE) 實作完成並已合併至 main

> **更新時間**：2026-09-01 14:33
> **專案核心**：以 Vanilla JavaScript、Firebase、Tailwind CDN 與 Google Gemini API 打造之個人大腦 PWA，並具備專屬遠端 MCP Server 供外部 Agent 自動化分類與存取。

## 本次對話目標

為專案設計並實作專屬的遠端 MCP (Model Context Protocol) Server，讓外部訂閱之 AI Agent (如 Claude Desktop, Cursor, Antigravity) 能透過標準協議安全讀取、分類、整理與檢索個人的 Firestore 靈感碎片與筆記。

## 已完成任務

* **[規格設計與 OpenAI Codex 深度審查]**：
  * 完成規格書並透過本機 `codex-cli` 進行架構審核，精確對齊前端毫秒時間戳、虛擬 inbox 分類、todos 欄位清洗、原子性交易與 SSRF 內網防護。
  * `docs/superpowers/specs/2026-09-01-remote-mcp-server-design.md`
  * `docs/superpowers/plans/2026-09-01-remote-mcp-server.md`
* **[建立 `mcp-server` 模組與服務實作]**：
  * 實作 Streamable HTTP (`/mcp`) 與 Legacy SSE (`/sse`, `/messages`) 雙傳輸協定與常數時間 Bearer Token 驗證。
  * 實作 Scoped Firestore 資料庫封裝與 `runTransaction` 原子性搬移/刪除（自動遷移 `details/note` 筆記）。
  * 實作 SSRF 防護之 `@mozilla/readability` 網頁正文解析工具 (`services/fetcher.js`)。
  * 註冊 9 大領域工具並完成全數單元測試。
  * `mcp-server/src/index.js`
  * `mcp-server/src/server.js`
  * `mcp-server/src/services/domain.js`
  * `mcp-server/src/services/fetcher.js`
  * `mcp-server/src/services/firestore.js`
  * `mcp-server/tests/*.test.js`
* **[雲端部署與連線說明文件]**：
  * 提供 `Dockerfile`、`render.yaml` 與完整客戶端連線指南。
  * `mcp-server/Dockerfile`
  * `mcp-server/render.yaml`
  * `mcp-server/README.md`

## 進行中與卡點 (In Progress & Blockers)

* **目前進度**：MCP Server 模組已全數實作、測試通過並已 Fast-Forward 合併至 `main` 分支。
* **下一步**：使用者可設定 `.env` 中的 `FIREBASE_SERVICE_ACCOUNT_KEY` 與 `DEFAULT_USER_UID` 進行本機啟動或一鍵部署至 Render / Fly.io。
* **卡點 (Blocker)**：無。

## 避坑指南 (Failed Approaches)

* **嘗試過的方法**：傳統 URL Query Token (`?token=...`) 認證與僅支援舊版 SSE 傳輸。
  * **為什麼失敗**：OpenAI Codex 審查指出 URL Token 會留存於代理伺服器或負載平衡器日誌中造成金鑰洩漏；且 MCP 2025-11-25 規範已由 Streamable HTTP (`/mcp`) 取代舊版 SSE。
  * **教訓**：強制採用 Header `Authorization: Bearer` 與常數時間比對，並以 Streamable HTTP 為主力、Legacy SSE 為向後相容 fallback。
* **嘗試過的方法**：分步複製與刪除 `details/note` 子集合。
  * **為什麼失敗**：分步執行非原子操作，中途若斷線會遺失卡片或殘留孤兒筆記資料。
  * **教訓**：全數使用 Firestore `runTransaction` 保證搬移與刪除的原子性。

## 關鍵決策 (Key Decisions)

* **[自建專屬 Domain MCP 而非泛用型 Firestore MCP]**：
  * **原因**：專屬 MCP 提供 `move_item`、`batch_classify_items` 等高階語意工具，自動處理 Editor.js JSON 封裝、`order` 排序與子集合遷移，大幅降低 Agent Token 消耗與路徑出錯率。
  * **被否決的方案**：直接使用現成 `@firebase/mcp-server`（需由 Agent 自行拼裝多層 CRUD 指令，容易損毀資料）。
* **[SSRF 防護之 Readability 網頁研讀]**：
  * **原因**：以開源標準 `@mozilla/readability` + `jsdom` 清洗雜訊，並在發送請求前攔截私有 IP 與雲端 Metadata 服務，兼顧穩定性與資安防護。
  * **被否決的方案**：自行撰寫 HTML 正則爬蟲。

## 交接備忘錄 (Handover Context)

目前程式碼已位於 `main` 分支。
若要接手此專案，第一步請閱讀 `/home/cdc/CCdevelopment/my-ai-brain/CURRENT_STATE.md` 與 `/home/cdc/CCdevelopment/my-ai-brain/mcp-server/README.md`。
若要驗證 MCP 伺服器，可在 `mcp-server/` 目錄執行 `npm test`；若要啟動本機伺服器，請先建立 `mcp-server/.env`（填入 Firebase Service Account JSON、UID 與自訂 MCP API Key）後執行 `npm start`。
