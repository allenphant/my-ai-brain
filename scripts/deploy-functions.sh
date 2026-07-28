#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="my-ai-brain-6867e"
PROJECT_NUMBER="755512158785"
REGION="${FUNCTION_REGION:-asia-east1}"
TASK_QUEUE="runResearchJob"
TASK_FUNCTION="runResearchJob"
RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

if [[ "${CONFIRM_BILLABLE_PROJECT:-}" != "${PROJECT_ID}" ]]; then
  echo "安全停止：這個動作會部署可計費的 Cloud Functions／Cloud Run 資源。"
  echo "確認 Budget、Secrets 與 docs/CLOUD_SETUP_GUIDE.md 後執行："
  echo "CONFIRM_BILLABLE_PROJECT=${PROJECT_ID} npm run deploy:functions"
  exit 2
fi

node scripts/cloud-preflight.mjs

# enqueueCardResearch creates an authenticated Cloud Task using the same
# runtime service account. Keep all three required IAM edges reproducible:
# create the task, mint its OIDC identity, and invoke the private worker.
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/cloudtasks.enqueuer" \
  --condition=None

gcloud iam service-accounts add-iam-policy-binding "${RUNTIME_SA}" \
  --project="${PROJECT_ID}" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/iam.serviceAccountUser" \
  --condition=None

npx firebase-tools deploy --only functions --project "${PROJECT_ID}"

gcloud functions add-invoker-policy-binding "${TASK_FUNCTION}" \
  --gen2 \
  --region="${REGION}" \
  --project="${PROJECT_ID}" \
  --member="serviceAccount:${RUNTIME_SA}"

# Firebase task functions default to a very high queue dispatch rate when only
# concurrency is specified. Keep the queue at one in-flight task and roughly
# one new dispatch per minute so Jina/OpenRouter are not hammered by a backlog.
gcloud tasks queues update "${TASK_QUEUE}" \
  --location="${REGION}" \
  --project="${PROJECT_ID}" \
  --max-concurrent-dispatches=1 \
  --max-dispatches-per-second=0.016667

gcloud tasks queues describe "${TASK_QUEUE}" \
  --location="${REGION}" \
  --project="${PROJECT_ID}" \
  --format="yaml(state,rateLimits,retryConfig)"
