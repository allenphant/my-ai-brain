# AI 網址研讀改用 Jina Reader 擷取、Gemini 整理，加入可管理 Tag

> **更新時間**：2026-07-15 11:35
> **專案核心**：以 Vanilla JS 與 Firebase 打造的類似 Notion 的個人 AI 大腦/知識庫工具。

## 2026-07-15 最新狀態

* **網址研讀資料流**：卡片網址先交給 Jina Reader 擷取公開網站／社群貼文文字，再把擷取內容交給獨立設定的 Gemini 模型整理；不再由 Gemini Search 猜讀網址。
* **影片限制**：Jina 只保留影片連結與頁面周邊文字，不轉錄影片。若有文字則整理文字並標示「影片內容未解析」；若只有影片則不呼叫 Gemini、不產生推測摘要。
* **Prompt 設定**：系統設定可編輯網址研讀 System Prompt，預設為繁體中文、純文字、TL;DR、一句話評價、詳細筆記，並禁止猜測未解析媒體；可一鍵恢復預設。
* **Tag 管理**：使用者可在設定新增、重新命名、刪除 tag。Gemini 優先匹配既有 tag，也可建議新 tag；預覽時逐一勾選，只有勾選並確認的新 tag 才會建立。
* **儲存位置**：研讀文字仍只 append 到卡片「詳細筆記」，主卡片文字與原網址保持簡潔。卡片只存穩定的 `tagIds`，名稱即時由 `users/{uid}/settings/tags` catalog 解析，因此重新命名或刪除不會留下過期標籤。搜尋資料拆成 `cardSearchText` 與可持續追加的 `researchSearchText`，tag 搜尋則由 `tagIds + catalog` 即時解析，避免再次研讀時覆蓋舊索引。
* **快取與錯誤**：快取會納入網址、Gemini 模型、System Prompt 與 tag catalog；任一變更都不沿用舊預覽。Jina 擷取錯誤、Gemini 配額錯誤與空／損壞回應分開顯示。
* **模型清單**：網址研讀模型會列出即時取得的所有 `generateContent` 模型；Search 支援測試清單也保留已確認模型，方便重新測試 Gemini 2.5 Flash。

## 待辦／未來方向

* **Tag filter**：依卡片 `tagIds` 實作單選／複選篩選。
* **搜尋功能**：先整合卡片的 `cardSearchText`、`researchSearchText`，並以 `tagIds + catalog` 動態解析 tag 名稱做本地全文搜尋，再評估以 Jina Embeddings 加入語意搜尋；搜尋 UI 尚未實作。
* **影片研讀**：目前刻意不處理影片。若未來需要，應另接字幕／逐字稿或影片理解服務，不能把 Jina Reader 當成影片轉錄器。

---

以下內容是 2026-07-09 的歷史快照；其中 Gemini Search Grounding 直讀網址的方案已由上方 Jina Reader → Gemini 流程取代。

## 本次對話目標

實作外部分享串接（PWA/Share Target）、自訂 App 縮圖、擴充分類圖示，並修正編輯狀態下 `Ctrl` 快捷鍵打架與全選問題，以及優化分類 `+` 按鈕之新增體驗。

## 已完成任務

* **[PWA 分享串接]**：升級為 PWA，新增 `manifest.json` 與 `sw.js`。串接 Web Share Target API，使外部分享（如 YouTube、Threads 等）自動導向並將內容填入首頁輸入框，且加入離線 `localStorage` 暫存登入後自動加載功能。
  * `manifest.json`
  * `sw.js`
  * `index.html`
* **[自訂與更換 App 縮圖]**：生成高質感 3D 擬態 PWA 大腦圖示（`brain-icon.jpg`）並在 Manifest 中完成路徑配置，使用者可直接覆蓋此檔案自訂 icon。
  * `brain-icon.jpg`
  * `manifest.json`
  * `index.html`
* **[AI 網頁聯網研讀與潤飾]**：整合 Gemini API 聯網搜尋（Google Search Grounding）功能。當輸入框檢測到 URL 時，自動利用 AI 連網讀取網頁並歸納潤飾為繁體中文筆記，並在最後保留原網頁連結。同時完善了 candidates 檢查與 FinishReason 的錯誤拋出診斷。
  * `index.html`
* **[新增分類圖示 picker]**：在編輯分類圖示選擇器中一口氣擴增 20 多個實用 icon（服飾、記帳、娛樂、健康、數位、社交、天氣等）。
  * `index.html`
* **[快捷鍵攔截優化]**：修正編輯視窗與卡片移動 Undo/Redo 快捷鍵衝突。在 Editorjs 或 Edit Modal 等編輯彈窗開啟時，全域快捷鍵暫停以防干擾 native 文字操作。同時為 EditorJS 實作自訂的 `Ctrl + A` / `Cmd + A` 整篇內容跨 block 全選機制，並攔截了非編輯區下的 global 全選以避免 modal 背景文字反白。
  * `index.html`
* **[分類 "+" 按鈕快捷新增彈窗]**：將各分類區的 `+` 按鈕由原先的「移至頂端 + 變更 dropdown」改為「直接彈出專屬新增小視窗 (`#add-card-modal`)」，無縫繼承 `Enter` 快捷送出、AI 網頁研讀與 Undo 歷史管理器，不影響原本頁面焦點。
  * `index.html`

## 進行中與卡點 (In Progress & Blockers)

* **目前進度**：本階段所有功能與問題修復皆已完美實作並推送至 `main` 分支。
* **下一步**：等待使用者確認外部分享與快捷選取的體驗，並依需求進行下一個階段的優化。
* **卡點 (Blocker)**：無。

## 避坑指南 (Failed Approaches)

* **瀏覽器跨網域限制 (CORS)**：原先想在前端直接透過 fetch 抓取使用者分享的網頁連結進行爬蟲，但受限於瀏覽器的 CORS 機制會直接報錯失敗。
  * **教訓**：改為利用 Gemini 的 `google_search` 聯網工具（Google Search Grounding）在後端代為抓取與研讀，前端只做對接，成功繞過 CORS。
* **Gemini REST API 參數大小寫**：在 v1beta API 中，Tools 啟用搜尋的欄位是 `google_search`（蛇形命名），誤用駝峰命名 `googleSearch` 會被 API 直接視為無效或丟出 HTTP 400 錯誤。
  * **教訓**：必須嚴格遵守 API 文件格式。同時，使用 `response.ok` 詳實捕獲 `err.message` 呈現在 Toast 中，而非吞掉錯誤。
* **跨 contenteditable 全選限制**：Editor.js 的每個 block 都是獨立的 contenteditable `div`，原生瀏覽器的全選（Ctrl+A）只會選取單個 paragraph。
  * **教訓**：透過 `range.selectNodeContents(editorContainer)` 強行全選整個編輯器容器的 DOM range，並在非編輯焦點時 `preventDefault` 防止選到 modal 背後的整頁背景。

## 關鍵決策 (Key Decisions)

* **[分享攔截寫入輸入框]**：原本分享會直接寫入 Firebase 建立卡片。決策改為「僅帶入輸入框並 focus」，原因是用戶分享外站內容時通常需要加上個人短評，自動新增會導致雜亂，帶入輸入框能給用戶二度編輯的緩衝。
* **[PWA 離線策略-網路優先]**：Service Worker 採用 Network-First 策略。因為此 app 強度依賴 Firebase 與網路連線，Network-First 可確保使用者在有網路時，GitHub Pages 上任何代碼修改都能即時更新（無快取鎖死問題），只在離線時 fallback 快取。

## 交接備忘錄 (Handover Context)

這是一個 Vanilla JS + Firebase + Tailwind CDN 打造的單網頁 app。本階段完成了 PWA 的封裝與 Search Grounding 連網研讀。
接手後第一步請先閱讀 `/home/cdc/CCdevelopment/my-ai-brain/CURRENT_STATE.md`。如有需要測試 PWA 功能，請將 GitHub Pages 加入手機主畫面並點選分享測試。
