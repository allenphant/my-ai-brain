# My Personal AI Brain (我的個人中樞)

這是一個極度輕量、零延遲、且跨裝置同步的「個人大腦緩衝區」與「點子收集處」。
專案採用純前端靜態架構與自帶資料庫（BYOD, Bring Your Own Database）設計，結合 **Firebase 即時資料庫**、**Google Gemini / Mistral API** 與 **ImgBB 圖床**。你可以隨時隨地將大腦中零碎的待辦事項、靈感、網址或截圖「傾倒」進收件匣，並透過 AI 一鍵自動分類與深度研讀。

---

## 核心特色 (Features)

* **無延遲傾倒 (Zero-Latency Dump)：** 採用樂觀更新 (Optimistic UI) 技術，輸入點子按下 Enter 瞬間清空輸入框，即使網路延遲也能像機關槍一樣連續輸入，絕不打斷思緒。
* **自帶資料庫與隱私至上 (BYOD Architecture)：** 前端程式碼與靜態託管完全不持有任何使用者的資料庫金鑰。每位使用者自帶個人的 Firebase Config 與 API Key，所有資料僅存在於你個人的 Firebase 專案與本地端瀏覽器中。
* **AI 魔法整理 (AI Auto-Categorization)：** 串接 Google Gemini API，一鍵將凌亂的收件匣碎片，精準分類至「待辦事項」、「待學習資源」、「點子庫」與「收藏貼文」或自訂分類。
* **智慧網址研讀 (Smart Web Research)：** 透過 Jina Reader 擷取網址與文章內容，交由 Gemini 或 Mistral 進行結構化提煉（TL;DR、評價、重點筆記），並自動建議適合的 Tag。
* **跨裝置即時同步 (Real-time Sync)：** 底層使用 Firebase Cloud Firestore，手機端送出點子，電腦端畫面 0.1 秒內自動同步，無需手動重新整理。
* **圖片貼上與圖床支援 (Image Staging & ImgBB)：** 支援在輸入框直接以剪貼簿貼上截圖（Ctrl+V）或選取相片，透過自帶的免費 ImgBB API Key 自動上傳圖床並關聯至卡片。
* **區塊筆記編輯器 (Block-based Editor)：** 整合 Editor.js 與 Markdown 快捷鍵，為每張卡片提供如同 Notion 的詳細筆記編輯空間。
* **全域搜尋與 Tag 瀏覽器 (Global Search & Tag Browser)：** 支援跨分類即時搜尋標題、研讀摘要與標籤，並提供 Tag 批次篩選與未研讀卡片回補佇列。
* **遠端 MCP Server 支援 (Model Context Protocol)：** 內建專屬遠端 MCP Server（支援 Streamable HTTP 與 Legacy SSE），允許外部 AI Agent（如 Claude Desktop、Cursor、Antigravity）直接存取並整理你的個人知識庫。

---

## 技術棧 (Tech Stack)

* **前端核心：** 100% 原生 HTML5, JavaScript (ES6 Modules)
* **樣式與介面：** Tailwind CSS (CDN), FontAwesome 6 (向量圖示)
* **編輯器引擎：** Editor.js (支援 Header, List, Checklist, Quote, Code, Delimiter, Undo)
* **資料庫與認證：** Firebase (Authentication, Cloud Firestore)
* **圖床服務：** ImgBB API（選配，外部公用圖床，請詳閱下方安全警示）
* **AI 引擎：** Google Gemini API (`gemini-2.5-flash`), Mistral API (`mistral-small-2603`)
* **MCP 服務：** Express, @modelcontextprotocol/sdk (位於 `mcp-server/`)
* **靜態部署：** GitHub Pages

---

## 快速開始：自帶設定指南 (BYOD Setup)

本專案無需在程式碼中寫死任何敏感憑證，所有設定皆直接於網頁介面的「系統設定」面板輸入，並安全保存在使用者的瀏覽器本地儲存區 (`localStorage`)。

### 步驟 1：準備 Firebase 資料庫
1. 前往 [Firebase Console](https://console.firebase.google.com/) 建立一個免費專案。
2. 進入專案設定，在「一般」頁籤點擊「新增應用程式」並選擇 Web（`</>`）圖示，建立後複製畫面上的 `firebaseConfig` JSON 物件：
   ```json
   {
     "apiKey": "AIzaSy...",
     "authDomain": "your-project.firebaseapp.com",
     "projectId": "your-project",
     "storageBucket": "your-project.firebasestorage.app",
     "messagingSenderId": "...",
     "appId": "..."
   }
   ```
3. 前往 **Authentication（驗證）** > Sign-in method，啟用 **Google** 登入提供者。
4. 前往 **Firestore Database** 建立資料庫，並至「規則 (Rules)」頁籤發佈以下安全規則（嚴格依使用者 UID 進行資料隔離）：
   ```javascript
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /artifacts/{appId}/users/{userId}/{document=**} {
         allow read, write: if request.auth != null && request.auth.uid == userId;
       }
     }
   }
   ```
5. *(若使用 GitHub Pages)*：至 Authentication > Settings > **Authorized domains（已授權網域）**，新增你的網域名稱（例如 `your-username.github.io`）。

### 步驟 2：取得 AI 與圖床 API Key
1. **Google Gemini API Key**：至 [Google AI Studio](https://aistudio.google.com/app/apikey) 申請一組免費 Key（用於卡片自動分類與網址研讀）。
2. **ImgBB API Key（選配，圖片支援）**：至 [ImgBB API](https://api.imgbb.com/) 免費註冊並取得 Key（用於支援在輸入框貼上截圖與相片上傳）。

> [!WARNING]
> **ImgBB 免費圖床隱私與可用性警示**：
> 1. **公開存取風險 (Public URL Risk)**：ImgBB 產生的圖片網址為公開 CDN 連結，無存取控制清單（ACL）。任何取得圖片網址者皆可在公網直接檢視圖片。**絕對嚴禁上傳包含密碼、金鑰憑證、個人隱私文件或商業機密之截圖**。
> 2. **無 SLA 與被動清除風險 (Retention Policy & Zero SLA)**：免費圖床不提供服務等級協議（SLA），長時間未存取的圖片可能遭平台清理失效，導致卡片連結破圖。重要筆記請以文字或結構化 Markdown 記錄。

### 步驟 3：在介面中完成設定
1. 使用瀏覽器開啟本專案網頁。
2. 點擊右上角的「系統設定」按鈕。
3. 依序填入：
   - **Firebase 資料庫 (BYOD)**：貼上步驟 1 取得的 `firebaseConfig` JSON 或物件內容。
   - **Google Gemini API Key**：填入 Gemini Key，並可點擊查詢可用模型。
   - **ImgBB API Key**：填入 ImgBB Key 以解鎖圖片上傳功能。
4. 點擊「儲存設定」，網頁將自動重新載入並完成資料庫掛載。
5. 點擊頂部「登入」按鈕，以你的 Google 帳號完成驗證，即可開始使用。

---

## 遠端 MCP Server (Model Context Protocol)

專案包含一套獨立的遠端 MCP Server（位於 [`mcp-server/`](file:///home/cdc/CCdevelopment/my-ai-brain/mcp-server/) 目錄），可將你的個人資料庫開放給支援 MCP 的外部 AI Agent：

* **雙傳輸協定：** 同時支援現代標準的 Streamable HTTP (`/mcp`) 與相容舊客戶端的 Legacy SSE (`/sse`)。
* **安全防護：** 具備常數時間 Bearer Token 驗證、嚴格的用戶 UID 路徑隔離、以及 SSRF 內網 IP 阻擋機制。
* **詳細設定方式：** 請參閱 [`mcp-server/README.md`](file:///home/cdc/CCdevelopment/my-ai-brain/mcp-server/README.md)。

---

## 自行部署 (Self-Hosting)

本專案為 100% 純靜態前端，可部署於任何靜態網頁託管平台：

### 部署至 GitHub Pages
1. Fork 本儲存庫至你個人的 GitHub。
2. 前往儲存庫的 **Settings** > **Pages**。
3. 在 **Build and deployment** 下方的 **Source** 選擇 `Deploy from a branch`，Branch 選擇 `main` / `root` 並儲存。
4. 部署完成後，即可直接透過 `https://<你的帳號>.github.io/<專案名稱>/` 造訪你的專屬站台。

---

## 安全與隱私架構

* **零中心化憑證：** 專案主幹原始碼與 GitHub Pages 建置成果皆不含任何寫死之資料庫連線資訊或金鑰。
* **本地隔離：** 你的所有設定（包含 Firebase Config、Gemini Key、ImgBB Key）均只儲存在你裝置當前的瀏覽器 `localStorage` 中。
* **雲端隔離：** 透過 Firestore Security Rules 規則，只有通過你 Firebase 專案授權之 Google 帳號能夠存取你的資料分區。
* **安全性分界 (Security Boundaries)：** 
  - **Firestore 資料庫**：享有 Google 級別的安全認證與 UID 白名單隔離，只有你自己能讀寫個人的卡片文字與詳細筆記。
  - **ImgBB 圖床**：為外部公開設施，其圖片 URL 任何人皆可直接存取且無 SLA 保障。請依據資料敏感度審慎決定是否貼上圖片，嚴禁上傳包含密碼或個人隱私之機敏截圖。
