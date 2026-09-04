#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="my-ai-brain-6867e"

if [[ "${CONFIRM_BILLABLE_PROJECT:-}" != "${PROJECT_ID}" ]]; then
  echo "安全停止：這個動作會在可計費專案啟用 Google Cloud APIs。"
  echo "請先閱讀 docs/CLOUD_COST_BUDGET.md，確認專案與 Billing。"
  echo "確認後執行："
  echo "CONFIRM_BILLABLE_PROJECT=${PROJECT_ID} npm run cloud:enable-apis"
  exit 2
fi

gcloud services enable \
  cloudfunctions.googleapis.com \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  cloudscheduler.googleapis.com \
  cloudtasks.googleapis.com \
  secretmanager.googleapis.com \
  eventarc.googleapis.com \
  pubsub.googleapis.com \
  firestore.googleapis.com \
  --project="${PROJECT_ID}"

echo "APIs enabled for ${PROJECT_ID}. No Functions have been deployed yet."
