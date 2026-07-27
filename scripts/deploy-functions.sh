#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="my-ai-brain-6867e"
REGION="${FUNCTION_REGION:-asia-east1}"
TASK_QUEUE="runResearchJob"

if [[ "${CONFIRM_BILLABLE_PROJECT:-}" != "${PROJECT_ID}" ]]; then
  echo "安全停止：這個動作會部署可計費的 Cloud Functions／Cloud Run 資源。"
  echo "確認 Budget、Secrets 與 docs/CLOUD_SETUP_GUIDE.md 後執行："
  echo "CONFIRM_BILLABLE_PROJECT=${PROJECT_ID} npm run deploy:functions"
  exit 2
fi

node scripts/cloud-preflight.mjs
npx firebase-tools deploy --only functions --project "${PROJECT_ID}"

# Firebase task functions default to a very high queue dispatch rate when only
# concurrency is specified. Keep the queue at one in-flight task and roughly
# one new dispatch per minute so Jina/Gemini are not hammered by a backlog.
gcloud tasks queues update "${TASK_QUEUE}" \
  --location="${REGION}" \
  --project="${PROJECT_ID}" \
  --max-concurrent-dispatches=1 \
  --max-dispatches-per-second=0.016667

gcloud tasks queues describe "${TASK_QUEUE}" \
  --location="${REGION}" \
  --project="${PROJECT_ID}" \
  --format="yaml(state,rateLimits,retryConfig)"
