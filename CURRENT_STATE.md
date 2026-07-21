# AI 網址研讀已支援 Gemini／Mistral 與配額暫停

> **更新時間**：2026-07-21
> **專案核心**：以 Vanilla JS 與 Firebase 打造的類似 Notion 的個人 AI 大腦/知識庫工具。

## 2026-07-20 最新狀態

* **API Key 明確保存**：Gemini、Mistral、Jina 三組 Key 各自提供「儲存 Key」按鈕與即時狀態；保存成功會明確顯示只儲存在目前瀏覽器，關閉設定再開仍會載入。輸入內容若與已保存值不同，會提示尚未保存，避免誤以為模型查詢等同保存。
* **Gemini／Mistral 可切換**：一般 AI 整理仍使用 Gemini；網址研讀整理服務可獨立選擇 Gemini 或 Mistral。Mistral API Key 與網址研讀模型在設定頁分開保存，預設建議模型為 `mistral-small-2603`。
* **Mistral 動態模型清單**：設定頁會用使用者的 Mistral Key 即時查詢 `/v1/models`，列出可用的 chat completion 模型，因此未來新增模型不需要改版才能選取。
* **資料流維持不變**：Jina Reader 仍只負責擷取公開文字；選定的 Gemini 或 Mistral 模型負責輸出相同的結構化 TL;DR、評價、詳細筆記與 Tag 建議。快取 context 已加入 provider，切換服務不會誤用另一家的舊結果。
* **429 真正暫停佇列**：Gemini 或 Mistral 回傳配額不足時，佇列保留目前卡片、不增加失敗數也不前進下一張；連續配額失敗依 5／15／60 分鐘退避，若 API 提供更長的 retry delay 則採更長時間。成功一次後重設退避，手動停止會清除重試計時。
* **Mistral Key 固定可見**：Mistral API Key 區塊已移到網址研讀服務選單正下方，無論目前選擇 Gemini 或 Mistral 都會顯示，不再需要先切換服務才找得到。
* **跨分類全文搜尋**：首頁頂部與側欄新增搜尋入口（桌面亦可用 `Ctrl/Cmd + K`），即時搜尋卡片文字／網址、`researchSearchText` AI 研讀索引與 Tag 名稱。多個空白分隔關鍵字採 AND 條件，結果依原分類分組並依標題、Tag、AI 索引的相關度排序。
* **搜尋 UX**：搜尋結果會標示命中來源並顯示 AI 索引片段；點開卡片後，手機返回鍵只關閉編輯器並回到原搜尋結果，再返回才關閉搜尋。Escape、關閉按鈕與瀏覽器前進／後退皆納入 overlay history。

* **跨分類 Tag 瀏覽**：頂部與側欄提供 Tag 瀏覽入口，使用既有 Firestore snapshot 的記憶體快取整合收件匣與所有自訂分類，不增加額外查詢。
* **篩選方式**：可多選 Tag，預設「符合全部（AND）」並可切換「符合任一（OR）」；未選 Tag 時顯示所有已有 Tag 的卡片。
* **結果呈現**：結果依卡片原分類分組，空分類自動隱藏，顯示每個 Tag 的跨分類使用數量；卡片仍可開啟詳細筆記或觸發 AI 研讀。
* **返回 UX**：Tag 瀏覽納入瀏覽器 history 與鍵盤層，手機返回鍵、桌面 Escape、關閉按鈕皆只關閉 Tag 頁，前進可重新開啟。
* **選擇性回補**：Tag 瀏覽的「待回補」頁只列出含單一網址且缺少 Tag 或研讀索引的卡片；可逐一勾選或全選後建立研讀佇列。
* **非阻塞 overnight 佇列**：研讀成功後不再等待逐張確認，完整結果會保存到同一瀏覽器的「待審核」區並自動繼續下一張；關閉 Tag 瀏覽不會停止佇列，執行期間會盡力取得 Screen Wake Lock 並在離頁時警告。
* **延後審核與安全寫入**：待審結果可日後逐張預覽、勾選 Tag、確認追加或捨棄；取消預覽會保留結果，只有確認追加才會更新詳細筆記與卡片 Tag。沿用 60 秒冷卻與 24 小時快取；一般錯誤卡片跳過，配額錯誤停在原卡退避，缺少所選服務的 API Key 或無法持久保存結果時停止。
* **手動／自動通過**：回補頁可在啟動前選擇「手動審核」或「自動通過」。手動模式把結果送往待審；自動模式直接追加詳細筆記並套用全部建議 Tag，寫入失敗則降級送往待審，不阻塞後續卡片。
* **背景進度可視化**：佇列不再與審核視窗耦合；每張完成後依 60 秒冷卻自動處理下一張，主頁顯示浮動進度與倒數，點擊可返回回補頁。
* **影片降級**：YouTube／Vimeo 影片網址不再送 Jina 或 Gemini 產生空泛內容，固定回覆「影片無法解析。」並只建議／套用 `尚未解析的影片` Tag。
* **審核來源資訊**：預覽與待審卡片會顯示原始卡片內容、來源標題及可點擊原網址；YouTube 標題會盡力透過 oEmbed 取得。

## 2026-07-15 AI 研讀狀態

* **網址研讀資料流**：卡片網址先交給 Jina Reader 擷取公開網站／社群貼文文字，再把擷取內容交給獨立設定的 Gemini 模型整理；不再由 Gemini Search 猜讀網址。
* **影片限制**：Jina 只保留影片連結與頁面周邊文字，不轉錄影片。若有文字則整理文字並標示「影片內容未解析」；若只有影片則不呼叫 Gemini、不產生推測摘要。
* **Prompt 設定**：系統設定可編輯網址研讀 System Prompt，預設為繁體中文、純文字、TL;DR、一句話評價、詳細筆記，並禁止猜測未解析媒體；可一鍵恢復預設。
* **Tag 管理**：使用者可在設定新增、重新命名、刪除 tag。Gemini 優先匹配既有 tag，也可建議新 tag；預覽時逐一勾選，只有勾選並確認的新 tag 才會建立。
* **儲存位置**：研讀文字仍只 append 到卡片「詳細筆記」，主卡片文字與原網址保持簡潔。卡片只存穩定的 `tagIds`，名稱即時由 `users/{uid}/settings/tags` catalog 解析，因此重新命名或刪除不會留下過期標籤。搜尋資料拆成 `cardSearchText` 與可持續追加的 `researchSearchText`，tag 搜尋則由 `tagIds + catalog` 即時解析，避免再次研讀時覆蓋舊索引。
* **快取與錯誤**：快取會納入網址、Gemini 模型、System Prompt 與 tag catalog；任一變更都不沿用舊預覽。Jina 擷取錯誤、Gemini 配額錯誤與空／損壞回應分開顯示。
* **模型清單**：網址研讀模型會列出即時取得的所有 `generateContent` 模型；Search 支援測試清單也保留已確認模型，方便重新測試 Gemini 2.5 Flash。

## 待辦／未來方向

* **Tag filter 後續**：可再加入 Tag 合併工具與每個 Tag 的排序方式。
* **搜尋後續**：目前本地搜尋已涵蓋卡片文字、AI 研讀索引與 Tag。手動撰寫但尚未建立索引的 Editor.js 詳細筆記不會被全文搜尋；若需要，下一階段應在詳細筆記儲存時同步維護純文字索引，再評估以 Jina Embeddings 加入語意搜尋。
* **影片研讀**：目前刻意不處理影片。若未來需要，應另接字幕／逐字稿或影片理解服務，不能把 Jina Reader 當成影片轉錄器。
* **待審核同步**：目前待審結果儲存在啟動佇列的瀏覽器（依登入使用者隔離），可跨重新整理保留，但尚未同步到其他裝置；若需要跨裝置審核，再搬到 Firestore。

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
