# 網址研讀模型探索與回應 UX 設計

## 目標

將一般 AI 整理模型與網址研讀模型分開設定，避免 Free tier 選到無法使用 Google Search Grounding 的模型；同時修正 Gemini 多-part 回應被誤判為空內容，以及 429 錯誤資訊過度簡化的問題。

## 模型探索

- 設定頁仍即時呼叫 Gemini `models.list`，取得目前 API Key 可見且支援 `generateContent` 的模型。
- Models API 不提供 `google_search` capability，因此不能只靠回傳 metadata 判定。
- 已知 Free-tier Search 模型 `gemini-2.5-flash`、`gemini-2.5-flash-lite` 直接列為已驗證。
- 未知的新模型保留在「待驗證」清單；使用者可明確按下測試按鈕，送出一次最小 Search Grounding 請求。
- 成功即加入網址研讀選單；明確不支援則標記不可用；429 或服務錯誤標記暫時無法驗證，不當成永久不支援。
- 驗證結果按模型快取 7 天；使用者重新查詢模型時仍可再次驗證。

## 設定與遷移

- 一般 AI 整理沿用 `geminiModel`。
- 網址研讀使用獨立的 `geminiWebResearchModel`，預設 `gemini-2.5-flash`。
- 舊使用者即使 `geminiModel` 是 Gemini 3，也不會再影響網址研讀。
- 設定頁清楚顯示兩個下拉選單及 Search Grounding／Free-tier 說明。

## 回應與錯誤處理

- 從 candidate 的所有 parts 收集非 thought 的文字並依序合併，不再只讀 `parts[0]`。
- 若沒有可顯示文字，錯誤需包含模型與 finish reason，並在 console 保留安全的 response metadata。
- HTTP 錯誤保存 status、模型、Google message、quotaId 與 retryDelay；畫面不顯示 API Key 或完整請求網址。
- 狀態面板顯示實際使用模型，429 不再一律稱為「配額暫時不足」。

## 驗證

- 單元測試涵蓋模型交集、7 天快取、多-part／thought 回應、quota 與 retry 描述。
- 瀏覽器測試涵蓋獨立模型設定、實際 request model、成功預覽、詳細 429 與既有卡片／導航流程。

