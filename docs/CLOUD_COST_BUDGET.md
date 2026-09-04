# My AI Brain 雲端成本預算與防爆帳單清單

> 更新日期：2026-07-27  
> 適用專案：`my-ai-brain-6867e`  
> 使用情境：個人使用、首次約 200 張卡片回補、之後每天約 10 張網址卡片。

## 結論

本專案需要把 Firebase 從不綁帳務的 Spark 方案升級到按量計費的 Blaze，才能部署 Cloud Functions／Cloud Run。Blaze 沒有固定月費，Firestore、Cloud Run、Cloud Tasks、Cloud Scheduler 與 Secret Manager 在免費額度內仍可是 US$0。

依目前使用量估算：

| 類別 | 每月預估 |
|---|---:|
| Firestore | US$0 |
| Cloud Functions／Cloud Run | US$0 |
| Cloud Scheduler | US$0 |
| Cloud Tasks | US$0 |
| Secret Manager | US$0 |
| Artifact Registry | US$0～少量零頭 |
| Jina Reader | US$0 |
| Gemini 一般網頁 | US$0～4 |
| Gemini YouTube URL | 目前 Preview 無額外費用；價格與限制可能改變 |
| Mistral | 依 Mistral 帳號方案 |
| NotebookLM Enterprise | 不納入目前架構 |

比較保守的整體預算是：

- 沒有大量影片：每月 US$0～5。
- 偶爾分析 YouTube：目前 URL 功能為免費 Preview，但仍保留每日影片上限，避免
  Google 日後調整價格時失控。
- 完全使用 Gemini 免費額度：有機會維持 US$0，但必須接受 429、速度與每日配額限制。

官方價格參考：

- [Firebase 定價方案](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans)
- [Firestore 免費額度](https://firebase.google.com/docs/firestore/quotas)
- [Cloud Run 價格](https://cloud.google.com/run/pricing)
- [Cloud Scheduler 價格](https://cloud.google.com/scheduler/pricing)
- [Cloud Tasks 價格](https://cloud.google.com/tasks/pricing)
- [Secret Manager 價格](https://cloud.google.com/secret-manager/pricing)
- [Artifact Registry 價格](https://cloud.google.com/artifact-registry/pricing)
- [Gemini API 價格](https://ai.google.dev/gemini-api/docs/pricing)
- [Gemini 影片理解與 YouTube URL 限制](https://ai.google.dev/gemini-api/docs/video-understanding)
- [Jina Reader](https://jina.ai/reader/)

## 目前用量的保守估算

假設第一個月處理 500 張卡，每張最多使用：

- 10 次 Firestore reads。
- 8 次 Firestore writes。
- 6 次 Cloud Tasks 操作。
- 30 秒 Cloud Run 執行時間。
- 1 vCPU、512 MiB RAM。

估計結果：

| 服務 | 估計用量 | 免費額度 |
|---|---:|---:|
| Firestore reads | 5,000 | 50,000／日 |
| Firestore writes | 4,000 | 20,000／日 |
| Cloud Run CPU | 15,000 vCPU-sec | 180,000／月 |
| Cloud Run RAM | 7,500 GiB-sec | 360,000／月 |
| Cloud Run requests | 約 2,000 | 2,000,000／月 |
| Cloud Tasks | 約 3,000 operations | 1,000,000／月 |
| Cloud Scheduler | 1 job | 3 jobs／月 |
| Secret Manager | 3～4 active versions | 6 active versions |

基礎設施有很大餘裕。真正容易遇到的不是 Google Cloud 運算費，而是 Gemini／Mistral 的模型配額與 token 費。

目前 Gemini 官方將「直接傳入公開 YouTube URL」列為 Preview 且不收費，但也明確
提醒價格與 rate limit 可能改變。因此程式仍把每支未知長度影片保守預留完整的
60 分鐘日額度；在未取得可靠片長前，一天最多自動建立一支 YouTube 工作。

## 後端內建成本硬上限

本專案後端預設採以下限制：

```text
每日最多建立工作：50 張
單次排程最多建立：20 張
每月 AI 預估成本上限：US$5
YouTube 每日最多處理：60 分鐘
Cloud Tasks 最大同時處理：1
Cloud Tasks 最大派送速率：約每 60 秒 1 張
Cloud Run／Functions 最大 instance：1
Cloud Run minimum instances：0
```

Google Cloud Budget 只會寄通知，不會自動停止服務。因此後端會在 Firestore 保存每日／每月用量帳本，超過限制時停止建立新工作，等待人工解除。

## 不要做的設定

以下設定容易造成不必要費用或資料風險。初期請不要開啟：

### 專案與帳務

- 不要建立第二個 Firebase／Google Cloud 專案來放 Cloud Run；使用現有 `my-ai-brain-6867e`。
- 不要在未確認目前專案 ID 時執行沒有 `--project my-ai-brain-6867e` 的部署指令。
- 不要以為 Google Cloud Budget 是硬性上限；它預設只發通知。
- 不要用 Budget 通知自動解除整個專案 Billing。停用 Billing 可能使 Firestore 等付費資源暫時無法存取。

### Cloud Run／Functions

- 不要設定 `minimum instances` 大於 0，否則沒有請求時也可能產生 idle 費用。
- 不要開啟 instance-based billing；目前使用 request-based billing。
- 不要啟用 GPU。
- 不要在初期把 `maximum instances` 設為大於 1。
- 不要在 Worker 裡用 `sleep(60)` 等待 API 冷卻；應結束執行並交由 Cloud Tasks 延後重送。
- 不要把完整網頁原文、API Key 或模型 response dump 到 Cloud Logging。

### Scheduler／Tasks

- 不要為每位使用者、每種頻率建立一個 Scheduler。
- 不要把 Scheduler 設成每分鐘掃描；目前每 10 分鐘足夠。
- 不要長期開啟 Cloud Tasks debug logging；除錯完成後關閉。
- 不要移除 Tasks 的 `maxConcurrentDispatches: 1`，除非已重新評估模型 RPM／TPM。
- 不要保留 Cloud Tasks 預設的 500 tasks/sec；部署腳本會覆寫為約每分鐘 1 張。

### Firestore

- 不要在初期開啟 PITR、scheduled backup、clone 或大量 TTL deletes；這些不在 Firestore 免費額度內。
- 不要把每次 API retry 都保存完整來源文字；工作紀錄只保存必要摘要與錯誤分類。
- 不要讓同一張卡的相同來源內容重複建立工作；必須使用來源 fingerprint 和冪等 job ID。

### Secrets 與模型

- 不要再把新的伺服器端 Gemini／Mistral／Jina Key 寫進前端或 Git。
- 不要保留大量 disabled Secret versions；不再使用的舊版本應 destroy。
- 不要在未設應用程式成本上限前開啟高價模型或大量影片排程。
- 不要啟用 NotebookLM Enterprise；目前自動回寫流程不需要它，而且另有授權費。

### Artifact Registry

- 不要保留所有歷史 container images。
- 不要在初期啟用付費 vulnerability scanning。
- 應設定 cleanup policy，只保留最近 3～5 個版本，刪除 30 天前的無標籤映像。

## 建議帳務警示

在 Google Cloud Billing 建立每月 US$5 預算，警示門檻：

- 50%：US$2.50
- 90%：US$4.50
- 100%：US$5.00

另外保留 Forecasted spend 警示。收到通知後先暫停自動研讀，不要直接停用整個專案 Billing。

官方提醒：Budget 不會自動限制花費。[Google Cloud Budget 說明](https://cloud.google.com/billing/docs/how-to/budgets)

## 驗收前檢查

- [ ] Cloud Run／Functions minimum instances 為 0。
- [ ] Maximum instances 為 1。
- [ ] Cloud Tasks concurrency 為 1。
- [ ] Scheduler 只有 1 個。
- [ ] 每月應用程式預算為 500 cents。
- [ ] Secrets 沒有出現在 Git、前端程式或 Logs。
- [ ] Artifact Registry 已建立 cleanup policy。
- [ ] Billing Budget 已建立。
- [ ] 先以 1 張測試卡驗證，再開 5 張，最後才開批量。
