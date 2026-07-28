# My AI Brain Google Cloud／Firebase 設定指南

> 本指南刻意把會產生帳務或權限變更的步驟留給專案擁有者確認。  
> 所有 CLI 指令都固定指定 `my-ai-brain-6867e`，避免誤用其他 gcloud 預設專案。

## 0. 已確認的現況

- 現有 Firebase／Google Cloud project ID：`my-ai-brain-6867e`
- 現有前端：GitHub Pages
- 現有資料庫：Cloud Firestore
- 現有登入：Firebase Authentication
- 本機已有 Google Cloud CLI
- 本機目前 gcloud 預設專案不是本專案，因此禁止省略 `--project`
- Firebase CLI 尚未安裝

## 1. 確認你正在操作正確專案

開啟：

- [Firebase Console](https://console.firebase.google.com/)
- [Google Cloud Console](https://console.cloud.google.com/)

兩邊都選擇：

```text
my-ai-brain-6867e
```

Firebase 專案本身就是 Google Cloud 專案，不要再建立一個新專案。

## 2. 先記錄 Firestore Location

在 Firebase Console：

```text
Build
→ Firestore Database
→ Database
→ Location
```

把 location 記下來。Cloud Functions region 應盡量靠近 Firestore；若不確定，先不要部署。

本專案預設 Function region 為 `asia-east1`，部署前可透過環境變數覆蓋：

```bash
FUNCTION_REGION=你的區域 npm run deploy:functions
```

## 3. 綁定 Billing／升級 Blaze

在 Firebase Console：

```text
Project settings
→ Usage and billing
→ Modify plan
→ Blaze
```

選擇既有或新建 Google Cloud Billing account。

Blaze 沒有固定月費，免費額度仍保留；超過免費額度才收費。

這一步會建立真實計費能力，請由專案擁有者親自確認。

## 4. 立即建立 Budget

綁定 Billing 後，先不要部署。到：

```text
Google Cloud Console
→ Billing
→ Budgets & alerts
→ Create budget
```

建議：

```text
Scope: project my-ai-brain-6867e
Monthly budget: US$5
Thresholds: 50%、90%、100%
Forecasted spend: 開啟
```

Budget 不是硬性上限。真正的 US$5 停止條件由本專案後端執行。

## 5. 安裝與登入 CLI

在 repository 根目錄執行：

```bash
npm install
npx firebase-tools login
```

確認 Google Cloud 登入：

```bash
gcloud auth login
gcloud auth list
```

不要用 `gcloud config set project` 依賴全域預設；本專案腳本會明確指定 project。

## 6. 啟用必要 API

先只執行 dry-run 檢查：

```bash
npm run cloud:preflight
```

確認 project ID 正確後，再啟用：

```bash
CONFIRM_BILLABLE_PROJECT=my-ai-brain-6867e npm run cloud:enable-apis
```

會啟用：

- Cloud Functions
- Cloud Run
- Cloud Build
- Artifact Registry
- Cloud Scheduler
- Cloud Tasks
- Secret Manager
- Eventarc
- Pub/Sub
- Firestore

啟用 API 本身通常不收費，實際使用資源才計費。

## 7. 設定伺服器端 Secrets

```bash
npx firebase-tools functions:secrets:set GEMINI_API_KEY --project my-ai-brain-6867e
npx firebase-tools functions:secrets:set JINA_API_KEY --project my-ai-brain-6867e
npx firebase-tools functions:secrets:set OPENROUTER_API_KEY --project my-ai-brain-6867e
```

正式 Worker 以 Jina 擷取一般網址、OpenRouter 免費模型整理，並保留 Gemini secret
作為舊版相容備援。Jina 與 OpenRouter 兩者都要設定，避免匿名 Reader 限制或缺少
模型授權讓夜間佇列持續失敗。

未來使用 Mistral 時：

```bash
npx firebase-tools functions:secrets:set MISTRAL_API_KEY --project my-ai-brain-6867e
```

不要把 Key 寫入：

- `.env`
- `firebase.json`
- `.firebaserc`
- GitHub repository
- 前端 `app.js`

## 8. 本機測試

```bash
npm test
npm run cloud:preflight
```

如果要啟動 Firebase Emulator：

```bash
npm run emulators
```

Emulator 不會呼叫正式 Scheduler。未設定 secrets 時，研讀 Worker 的外部 API 整合測試會被跳過。

## 9. 第一次部署

只部署 Functions，不碰 GitHub Pages 和 Firestore rules：

```bash
CONFIRM_BILLABLE_PROJECT=my-ai-brain-6867e npm run deploy:functions
```

腳本等同：

```bash
npx firebase-tools deploy \
  --only functions \
  --project my-ai-brain-6867e
```

部署後 Firebase CLI 會建立：

- Callable functions
- Scheduled function
- Cloud Tasks queue
- 對應 Cloud Run／Functions revisions

## 10. 部署後安全檢查

Google Cloud Console：

```text
Cloud Run／Functions
→ 每個服務
→ Scaling
```

確認：

```text
minimum instances = 0
maximum instances = 1
```

Cloud Tasks：

```text
runResearchJob queue
→ max concurrent dispatches = 1
```

Cloud Scheduler：

```text
只有 discoverDueResearchJobs
每 10 分鐘
```

Secret Manager：

```text
只有需要的 secret versions
舊版本不再使用時 destroy
```

## 11. 初始化個人自動研讀設定

後端部署完成後，前端下一階段會呼叫 `updateResearchAutomation`。預設設定：

```json
{
  "enabled": false,
  "interval": "daily",
  "approvalMode": "manual",
  "maxJobsPerRun": 20,
  "maxJobsPerDay": 50,
  "monthlyBudgetCents": 500,
  "maxVideoMinutesPerDay": 60
}
```

第一次部署仍保持 `enabled: false`。等單張測試成功後，再從介面打開自動排程。

## 12. 分階段驗收

1. 手動建立 1 張一般網址工作。
2. 確認 Firestore job 依序變成 `queued → running → pending_review`。
3. 確認詳細筆記尚未被自動覆寫。
4. 測試相同卡片不會重複建立工作。
5. 測試修改卡片後舊工作會變成 `cancelled_stale`。
6. 測試 5 張卡片，確認 Tasks 每次只執行一張。
7. 測試 OpenRouter 429，確認進入有限 retry；401／402 必須直接終止。
8. 最後才將 `enabled` 設為 `true`。

## 13. 回復方式

若後端有問題：

1. 呼叫 `updateResearchAutomation` 將 `enabled` 設為 `false`。
2. 暫停 Cloud Scheduler job。
3. 暫停 Cloud Tasks queue。
4. 不要刪除 Firestore。
5. 不要停用整個 Billing account。

前端目前的純瀏覽器研讀仍可保留作為暫時 fallback。
