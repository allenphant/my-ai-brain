# Cloud Research Backend 架構

## 目標

將必須保持瀏覽器開啟的研讀佇列搬到受控後端，同時保留：

- GitHub Pages 前端。
- Firebase Authentication。
- 既有 Firestore 卡片資料。
- 手動審核／自動通過選擇。
- Jina → OpenRouter 免費文字模型資料流。
- 失敗隔離與研讀紀錄。

## 第一階段元件

```text
GitHub Pages
  └─ Firebase Callable Functions
       ├─ updateResearchAutomation
       └─ enqueueCardResearch

Cloud Scheduler（每 10 分鐘）
  └─ discoverDueResearchJobs
       └─ Cloud Tasks
            └─ runResearchJob
                 ├─ Jina Reader
                 ├─ OpenRouter free text model fallback
                 ├─ YouTube → NotebookLM manual handoff
                 └─ Firestore pending result
```

## Firestore 路徑

```text
artifacts/{appId}/automationUsers/{uid}
artifacts/{appId}/users/{uid}/researchJobs/{jobId}
artifacts/{appId}/users/{uid}/researchUsage/{periodId}
```

`automationUsers/{uid}`：

- `enabled`
- `interval`
- `nextRunAt`
- `approvalMode`
- `maxJobsPerRun`
- `maxJobsPerDay`
- `monthlyBudgetCents`
- `maxVideoMinutesPerDay`

`researchJobs/{jobId}`：

- `status`
- `collectionName`
- `cardId`
- `sourceUrl`
- `sourceFingerprint`
- `sourceKind`
- `attempts`
- `result`
- `error`
- `createdAt`
- `updatedAt`

`researchUsage/{periodId}`：

- `jobs`
- `estimatedCostCents`
- `videoMinutes`
- `updatedAt`

## Job 狀態

```text
queued
  ↓
running
  ├─ pending_review
  ├─ succeeded
  ├─ retry_wait
  ├─ blocked_budget
  ├─ cancelled_stale
  └─ failed_terminal
```

第一階段一律把模型結果寫入 `pending_review`，不直接修改詳細筆記。等前端審核介面改為讀取 Firestore 後，再支援安全的自動通過。

## 冪等

Job ID 由以下資料建立：

```text
uid
collectionName
cardId
sourceFingerprint
promptVersion
```

相同卡片、相同來源內容、相同 prompt 版本只會得到同一個 job ID。Cloud Scheduler 至少一次傳送時，不會重複消耗模型或追加筆記。

## 成本控制

- Callable function 驗證 Firebase Auth。
- Schedule 只找 `enabled: true` 且 `nextRunAt <= now` 的使用者。
- 單次最多 20 張。
- 每日最多 50 張。
- 每月預估 AI 費用最多 500 cents。
- YouTube 不呼叫影片理解 API，因此不占用影片分鐘額度，也不產生模型費用。
- OpenRouter 只會從模型目錄選擇 prompt／completion 明確為 0 的模型。
- Tasks concurrency 為 1。
- Tasks dispatch rate 為 `0.016667/sec`，約每 60 秒最多開始一張；部署腳本會在
  Firebase 部署後重新套用，避免 queue 回到 500/sec 預設值。
- 相同工作成功或待審時直接返回。
- 卡片內容已改變則標記 `cancelled_stale`。
- 429／5xx 交由 Cloud Tasks 退避，不在 Function 內 sleep。

## 尚未接上的部分

目前前端與雲端後端已正式串接，仍刻意保留以下限制：

- 自動通過尚未在後端啟用。
- NotebookLM 沒有接自動回寫；YouTube 只提供複製網址並開啟 NotebookLM 的手動入口。

這些刻意分階段，避免一部署就開始批量產生費用。
