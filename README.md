# 🧠 My Personal AI Brain (我的個人中樞)

[![Live Demo](https://img.shields.io/badge/Live%20Demo-立即體驗-indigo?style=for-the-badge&logo=vercel)](https://allenphant.github.io/my-ai-brain/)

🔗 **線上預覽/使用網址：[https://allenphant.github.io/my-ai-brain/](https://allenphant.github.io/my-ai-brain/)**

這是一個極度輕量、零延遲、且跨裝置同步的「個人大腦緩衝區」與「點子收集處」。
透過結合 **Firebase 即時資料庫** 與 **Google Gemini API**，你可以隨時隨地將大腦中零碎的待辦事項、靈感或網址「傾倒」進收件匣，並透過「AI 魔法整理」一鍵自動將碎片歸類到專屬的區塊中。

## ✨ 核心特色 (Features)

* ⚡ **無延遲傾倒 (Zero-Latency Dump)：** 採用樂觀更新 (Optimistic UI) 技術，輸入點子按下 Enter 瞬間清空輸入框，即使網路延遲也能像機關槍一樣連續輸入，絕不打斷思緒。
* 🤖 **AI 魔法整理 (AI Auto-Categorization)：** 內建串接 Google Gemini API，一鍵將凌亂的收件匣碎片，精準分類至「待辦事項」、「待學習資源」、「點子庫」與「收藏貼文」。
* 🔄 **跨裝置即時同步 (Real-time Sync)：** 底層使用 Firebase Firestore，手機端送出點子，電腦端畫面 0.1 秒內自動同步，無需重新整理。
* ✏️ **碎片管理與編輯：** 支援全碎片即時編輯修改、跨分類無縫轉移，確保思緒隨時可以更新迭代。
* 🔗 **智慧連結預覽 (Smart URL Previews)：** 自動解析「收藏區」的超連結。若是 YouTube 網址會自動抓取並顯示影片縮圖；若是 GitHub 網址則會轉換為專屬連結卡片。
* 🔐 **極致隱私與安全 (Privacy & Security)：**
  * 採用 Google 帳號登入 (Firebase Auth)，確保資料只有自己看得到。
  * 你的個人 Gemini API Key 僅儲存於本地端瀏覽器 (`localStorage`)，不會上傳至任何伺服器。

## 🛠️ 技術棧 (Tech Stack)

* **前端：** 100% 原生 HTML, JavaScript (ES6 Modules)
* **樣式：** Tailwind CSS (透過 CDN 載入)
* **圖示：** FontAwesome 6
* **後端與資料庫：** Firebase (Authentication, Cloud Firestore)
* **AI 引擎：** Google Gemini API (`gemini-2.5-flash`)
* **部署：** GitHub Pages (完全免費)

## 📦 專案結構與區塊

系統將所有知識碎片分為以下五大狀態：
1. **📥 收件匣 (Inbox)：** 未分類的原始碎片。
2. **✅ 待辦事項 (Todos)：** 可打勾劃掉的生活/工作任務（支援隱藏已完成項目）。
3. **📚 待學習/探討資源 (Learning)：** 想進一步研究的知識點或教學文章。
4. **💡 點子庫 (Ideas)：** 稍縱即逝的靈感或專案構想。
5. **📌 收藏貼文/影片 (Bookmarks)：** 值得保存的外部網址、影片或社群貼文。

## 🚀 快速開始 (Getting Started)

要建立屬於你自己的 AI 大腦，請按照以下步驟進行設定：

### 1. 準備 Firebase 後端
1. 前往 [Firebase Console](https://console.firebase.google.com/) 建立一個新專案。
2. 註冊一個 Web 應用程式，並取得 `firebaseConfig` 金鑰。
3. 於「驗證 (Authentication)」中啟用 **Google 登入**。
4. 建立 **Firestore Database**，並設定安全性規則為：
   ```javascript
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /{document=**} {
         allow read, write: if request.auth != null; // 僅限登入者存取
       }
     }
   }
   ```

### 2. 部署至 GitHub Pages
1. 將本專案的 `index.html` Fork 或下載至你的本地端。
2. 將你獲得的 `firebaseConfig` 替換掉 `index.html` 中的預設金鑰設定。
3. 將程式碼 Push 至你的 GitHub Repository。
4. 於 Repository 的 Settings -> Pages 中，將來源設為 `main` 分支並儲存。
5. **(重要)** 回到 Firebase 的 Authentication -> Settings -> Authorized domains，將你的 `[GitHub帳號].github.io` 加入白名單中。

### 3. 設定 Gemini API
1. 使用瀏覽器開啟你部署好的 GitHub Pages 網址。
2. 點擊右上角的「設定 (⚙️)」圖示。
3. 前往 [Google AI Studio](https://aistudio.google.com/app/apikey) 申請一組免費的 API Key。
4. 將 API Key 填入網頁設定中並儲存，即可解鎖「✨ AI 魔法整理」按鈕！

---
