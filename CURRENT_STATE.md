# 專案當前狀態 (Current State)

> **更新時間**：2026-09-04
> **專案核心**：以 Vanilla JavaScript、Firebase、Tailwind CDN 與 Google Gemini API 打造之個人大腦 PWA，支援自帶資料庫（BYOD）架構、無人值守雲端研讀後端，並具備專屬遠端 MCP Server 供外部 Agent 自動化分類與存取。

## 2026-09-04 最新狀態：Firebase BYOD 架構上線與安全防護

* **BYOD (Bring Your Own Database) 架構**：已徹底移除前端程式碼中寫死的 Firebase 敏感金鑰，改由使用者於設定面板自帶 Firebase Web App Config，儲存於使用者本地 `localStorage`，確保跨裝置私有部署且外部訪客不會誤寫入專案擁有者之資料庫。
* **未設定防護狀態**：在未配置 Firebase 時，介面呈現優雅的未設定引導狀態，防止未授權讀寫或意外崩潰。
* **安全性事件指引**：完整記錄公開金鑰暴露事件成因、影響範圍與防範指引至 `docs/SECURITY-INCIDENT-FIREBASE-EXPOSURE-GUIDELINES.md`。

## 2026-09-01 MCP Server 狀態

* **遠端 MCP Server**：完成 Streamable HTTP 與 Legacy SSE 雙傳輸通道支援，支援外部 Agent 對個人大腦進行自動化操作與檢索。

## 2026-07-28 最新狀態

* **雲端文字研讀改用 OpenRouter**：一般網址固定由 Jina Reader 擷取公開文字，
  後端再從 OpenRouter `/models` 動態挑選支援文字、至少 16K context、
  結構化輸出且 prompt／completion 單價皆為 0 的模型；清單於 Function instance
  內快取 1 小時，前三個候選交由 OpenRouter model fallback 依序嘗試。實際使用的
  model 會寫進 Firestore job，未來新免費模型不需改版才能被選到。
* **OpenRouter Secret 與錯誤邊界**：Worker 綁定 Secret Manager
  `OPENROUTER_API_KEY`。401／403 立即以 `authentication_failed` 終止，402 以
  `billing_credits_depleted` 終止，404 模型不存在終止；只有 429、逾時與 5xx
  交給 Cloud Tasks 有限重試。程式只會選取價格明確為 0 的模型，不會自行切到
  付費模型。
* **YouTube 改為 NotebookLM 手動交接**：YouTube 不再送 Gemini Video 或文字模型
  猜測，雲端工作直接產生 `尚未解析的影片` 待審結果。YouTube 卡片新增
  `NotebookLM` 按鈕，點擊會複製原網址並開啟 NotebookLM，讓使用者貼到
  「新增來源」。此流程不假裝自動把 NotebookLM 結果寫回。
* **舊失敗工作可重新建立**：雲端 job prompt version 已升為
  `cloud-research-v2-openrouter`，所以先前因 Gemini 額度終止的相同卡片會建立
  新 OpenRouter 工作，不會被舊 `failed_terminal` job 擋住。
* **驗證**：Node 單元測試 13/13 通過；手機尺寸完整瀏覽器回歸測試通過，
  NotebookLM 按鈕只出現在 YouTube 卡，會複製正確網址、開啟正確入口且沒有
  page error。正式 Functions 部署後以獨立暫時 UID 執行端到端 smoke test，
  工作成功進入 `pending_review`，provider 為 `jina+openrouter`，實際模型為
  `google/gemma-4-26b-a4b-it:free`，TL;DR／評價／Tags 結構完整；暫時卡片、
  job 與 task 已全數清除。
* **Cloud Tasks IAM 已納入部署流程**：部署腳本會替 Functions runtime service
  account 補上 `roles/cloudtasks.enqueuer`、自身 `roles/iam.serviceAccountUser`
  與 `runResearchJob` invoker，避免 callable 能執行但無法建立已驗證 Task。
  Invoker 由部署後的 `gcloud` 指令設定；不在 `onTaskDispatched` options 重複
  宣告，以避開 Firebase CLI 15.24.0 更新 Gen2 task function 時的 IAM 錯誤。
* **修正跨區佇列定位**：Firebase Admin SDK 的 `getFunctions()` 不接受 region
  第二參數；舊程式因此忽略 `asia-east1` 並誤找 `us-central1` queue。現在改用
  `locations/asia-east1/functions/runResearchJob` 資源名稱，對準已部署佇列。
* **送入失敗可診斷**：`enqueueCardResearch` 不再用 `message` 欄位遮蔽底層例外；
  Cloud Logging 會保留錯誤類別、code、details 與 stack，前端也會區分缺少
  Tasks Enqueuer、service account actAs、worker invoker 與 queue 不存在。
* **429 分流**：一般 provider rate limit 仍由 Cloud Tasks 有限退避；Gemini
  明確回傳 `prepayment credits are depleted` 時改為 `billing_credits_depleted`
  終止錯誤，不再浪費後續自動重試。
* **舊 Gemini 路徑的生產端驗證**：Functions 已部署至 asia-east1。以原本失敗的 GitHub
  研讀工作重送後，Cloud Tasks 成功呼叫 worker、Jina Secret 成功讀取、Gemini
  回應也成功分類；因專案預付額度耗盡，工作正確停在 `failed_terminal` /
  `billing_credits_depleted`，worker HTTP 204，佇列沒有殘留重試。Queue 維持
  concurrency 1、每 60 秒最多派送一張。

## 2026-07-27 狀態

* **Google Cloud 已正式部署**：Firebase 專案 `my-ai-brain-6867e` 已升級 Blaze，
  設定每月 US$5 預算通知；四個 asia-east1 Functions、每 10 分鐘 Scheduler
  與 `runResearchJob` Cloud Tasks queue 均為 ACTIVE。
* **雲端吞吐護欄**：`runResearchJob` 維持 min instances 0、max instances 1；
  Cloud Tasks concurrency 1、每 60 秒最多派送一張、最多嘗試 3 次，退避
  60～3600 秒且最長 24 小時。
* **前端雲端模式**：設定頁新增「雲端背景研讀」開關。啟用後，單卡按鈕改為
  「雲端研讀」，自動週期透過 callable 同步至後端；關閉網頁或電腦後工作仍會
  在 Cloud Tasks 繼續。預設仍關閉，舊瀏覽器前景研讀保留作為備援。
* **跨裝置待審核**：前端即時監聽 Firestore `researchJobs` 的 `pending_review`，
  將雲端結果轉為既有預覽格式並顯示原卡片文字、原網址、TL;DR、評價、詳細內容、
  限制與 Tag 建議。核准才 append 到詳細筆記並標記 `succeeded`；捨棄標記
  `discarded`，兩者都不會重複排程相同來源內容。
* **驗證**：Node 測試全數通過；手機尺寸無頭瀏覽器回歸測試通過，包含既有快取、
  冷卻、配額暫停、搜尋、Tag、返回 UX，以及新雲端按鈕 callable 呼叫，無 page error。

* **成本與設定文件**：新增 `docs/CLOUD_COST_BUDGET.md`、`docs/CLOUD_SETUP_GUIDE.md`
  與 `docs/CLOUD_RESEARCH_ARCHITECTURE.md`，記錄免費額度估算、US$5 預算護欄、
  禁止設定與逐步部署流程。
* **安全部署入口**：Firebase Functions 專案與部署腳本固定 project
  `my-ai-brain-6867e`，並要求 `CONFIRM_BILLABLE_PROJECT`，避免誤部署至其他專案。
* **後端研讀骨架**：Callable Functions 驗證 Firebase Auth；單一 Scheduler 找出
  到期使用者；Cloud Tasks 以 concurrency 1 執行 Jina → OpenRouter 免費模型；
  YouTube 降級為 NotebookLM 手動交接。結果先寫入 Firestore `pending_review`，
  不直接修改卡片。
* **成本與失敗護欄**：預設關閉排程、每批 20、每日 50、每月預估 US$5、影片
  每日保守預留 60 分鐘、instance 0～1、Tasks 約每 60 秒最多派送一張、相同來源
  冪等、卡片變更時取消舊工作、429／5xx 交由 Tasks 有限退避。
* **仍刻意未開啟**：雲端自動通過與 Mistral 後端 adapter 尚未開啟；第一階段固定
  手動審核，先避免無人值守時直接改寫卡片。

## 2026-07-23 最新狀態

* **定期自動回補**：設定頁可選關閉、每 6／12 小時、每天、每 3 天或每週，自動挑選所有分類中尚未研讀且沒有待審結果的單一網址卡片。可隨時按「現在檢查並執行」。
* **純前端排程邊界**：排程由目前登入的瀏覽器執行；頁面關閉、裝置休眠或瀏覽器凍結時不會在伺服器背景運行。重新開啟或回到頁面後會檢查是否逾期並補做。若要真正無人值守，後續需移至 Cloud Functions／Cloud Scheduler。
* **壞卡隔離**：相同卡片內容跨三次排程皆研讀失敗時，會從自動排程隔離並寫入研讀紀錄，提醒檢查公開權限、單一網址與內容結構。卡片文字或網址修改後，來源指紋改變即自動解除隔離；設定頁也能手動清除失敗紀錄。
* **亂碼 Tag 根因與防護**：模型曾把既有 Tag 的內部 ID（如 `tag-5wcwmz`）放進 `suggestedTags`，舊 parser 因驗證不足而當成新名稱。新版會把已知 ID 還原成既有 Tag、拒絕其他 ID 形狀的新名稱；設定頁會偵測並可移除既有可疑 Tag。
* **未來 Agent 路徑**：目前主要資料庫為 Firebase Cloud Firestore。建議以 Cloud Functions／Cloud Run 建立受控工具 API，讓 Agent 只能搜尋、讀取、提出修改與確認寫入；大量內容可在 Firestore 儲存 embeddings 並建立 Vector Search 索引。

## 2026-07-22 狀態

* **統一故障決策層**：Jina、Gemini、Mistral、Firestore 與瀏覽器儲存錯誤均先分類再決定停止、暫停、有限重試或跳過，不再由各畫面各自判斷。
* **不再無限重送**：Key 過期、權限、帳務與模型下架會立即停止佇列；429 保留同一張並按服務時間或 5／15／60 分鐘退避，但三次仍失敗就停止整條佇列；斷網、逾時與 5xx 只以 15／60／180 秒重試三次，仍失敗才跳過。
* **來源與儲存保護**：Jina 匿名封鎖會要求設定 Key 並停止；來源 404／不相容只跳過該卡。Firebase 自動寫入失敗會先降級保存到本機待審，連本機也無法保存才停止，避免研讀結果遺失。
* **研讀紀錄頁**：頂部 Tag 頁與側欄可開啟「研讀紀錄」，保留目前瀏覽器最近 200 筆成功、快取、冷卻、重試、跳過與停止事件，可按嚴重度篩選。每筆包含原卡文字、網址、服務／模型、決策原因與建議處理方式，並會遮蔽 API Key。
* **冷卻時機修正**：只有 Jina 成功取得可整理文字、即將呼叫 Gemini／Mistral 時才開始模型冷卻；Jina 擷取失敗不再白白消耗 60 秒冷卻。
* **內建操作說明**：限制頁新增故障處理矩陣，直接說明各類錯誤的佇列去向。

## 2026-07-21 狀態

* **網站內使用說明**：頂部與側欄新增「使用說明」頁籤，以「收集 → 研讀 → 整理 → 找回」整理快速上手、單張／批次 AI 網址研讀、搜尋與 Tag、模型與 Key、部署與資料邊界、快捷鍵及限制。說明頁納入 overlay history，手機返回、桌面 Escape、關閉按鈕與瀏覽器前進／後退都能正確運作。
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
* **待審核同步**：本機前景佇列仍將結果存在啟動瀏覽器；雲端模式的結果已保存於
  Firestore，可跨裝置審核。

---

以下內容是 2026-07-09 的歷史快照；其中 Gemini Search Grounding 直讀網址的方案已由上方 Jina Reader → Gemini 流程取代。

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
