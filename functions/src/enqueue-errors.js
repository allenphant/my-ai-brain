"use strict";

function text(value, maxLength = 1000) {
  return String(value || "").slice(0, maxLength);
}

function describeTaskEnqueueError(error) {
  const errorCode = text(error?.code, 120);
  const errorMessage = text(error?.message || "Cloud Tasks enqueue failed");
  const errorDetails = text(error?.details, 1500);
  const combined = `${errorCode} ${errorMessage} ${errorDetails}`.toLowerCase();

  let clientMessage = "建立雲端研讀工作失敗；後端已記錄完整原因。";
  let category = "unknown";

  if (
    combined.includes("cloudtasks.tasks.create") ||
    combined.includes("cloud tasks enqueuer")
  ) {
    category = "missing_tasks_enqueuer";
    clientMessage = "雲端佇列缺少 Cloud Tasks Enqueuer 權限，請重新部署後端以補齊 IAM。";
  } else if (
    combined.includes("iam.serviceaccounts.actas") ||
    combined.includes("actas") ||
    combined.includes("service account user")
  ) {
    category = "missing_service_account_user";
    clientMessage = "雲端佇列無法代表後端服務帳戶簽發憑證，請重新部署後端以補齊 IAM。";
  } else if (
    combined.includes("run.routes.invoke") ||
    combined.includes("cloudfunctions.functions.invoke") ||
    combined.includes("cloud run invoker")
  ) {
    category = "missing_worker_invoker";
    clientMessage = "Cloud Tasks 尚無權呼叫研讀 worker，請重新部署後端以補齊 IAM。";
  } else if (
    combined.includes("queue") &&
    (combined.includes("not found") || combined.includes("does not exist"))
  ) {
    category = "queue_not_found";
    clientMessage = "找不到雲端研讀佇列；請重新部署 Functions 建立 runResearchJob 佇列。";
  } else if (
    combined.includes("permission_denied") ||
    errorCode === "7"
  ) {
    category = "permission_denied";
    clientMessage = "建立雲端研讀工作時被 Google Cloud 拒絕；請重新部署後端以同步 IAM。";
  } else if (
    combined.includes("unauthenticated") ||
    errorCode === "16"
  ) {
    category = "cloud_authentication";
    clientMessage = "後端的 Google Cloud 身分驗證失效，請重新部署 Functions。";
  }

  return {
    category,
    clientMessage,
    errorCode,
    errorMessage,
    errorDetails,
    stack: text(error?.stack, 3000),
  };
}

module.exports = {
  describeTaskEnqueueError,
};
