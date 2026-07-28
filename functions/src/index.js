"use strict";

const {initializeApp} = require("firebase-admin/app");
const {getFirestore, FieldValue} = require("firebase-admin/firestore");
const {getFunctions} = require("firebase-admin/functions");
const {logger} = require("firebase-functions");
const {defineSecret, defineString} = require("firebase-functions/params");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {onTaskDispatched} = require("firebase-functions/tasks");
const {
  APP_ID,
  checkBudget,
  classifySource,
  createResearchJobId,
  estimateJobCostCents,
  extractUrls,
  getCardPath,
  getNextRunAt,
  getResearchJobPath,
  getUsagePeriodIds,
  isResearchCandidate,
  normalizeAutomationSettings,
  sourceFingerprint,
} = require("./job-policy");
const {analyzeSource, ExternalServiceError} = require("./providers");
const {describeTaskEnqueueError} = require("./enqueue-errors");

initializeApp();

const db = getFirestore();
const REGION = process.env.FUNCTION_REGION || "asia-east1";
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
const JINA_API_KEY = defineSecret("JINA_API_KEY");
const OPENROUTER_API_KEY = defineSecret("OPENROUTER_API_KEY");
const GEMINI_RESEARCH_MODEL = defineString("GEMINI_RESEARCH_MODEL", {
  default: "gemini-3.5-flash-lite",
});
const OPENROUTER_RESEARCH_MODEL = defineString("OPENROUTER_RESEARCH_MODEL", {
  default: "auto:free",
});
const TERMINAL_JOB_STATUSES = new Set([
  "pending_review",
  "succeeded",
  "discarded",
  "blocked_budget",
  "cancelled_stale",
  "failed_terminal",
]);

function requireAuth(request) {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "請先登入。");
  }
  return request.auth.uid;
}

function assertDocumentPart(value, field) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.includes("/") || normalized.length > 160) {
    throw new HttpsError("invalid-argument", `${field} 格式不正確。`);
  }
  return normalized;
}

function automationRef(uid) {
  return db.doc(`artifacts/${APP_ID}/automationUsers/${uid}`);
}

function researchUsageRef(uid, periodId) {
  return db.doc(`artifacts/${APP_ID}/users/${uid}/researchUsage/${periodId}`);
}

async function getAutomationSettings(uid) {
  const snapshot = await automationRef(uid).get();
  return normalizeAutomationSettings(snapshot.exists ? snapshot.data() : {});
}

function taskTargetUri() {
  const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  if (!projectId) throw new Error("找不到 GCLOUD_PROJECT");
  return `https://${REGION}-${projectId}.cloudfunctions.net/runResearchJob`;
}

async function enqueueTask(jobPath) {
  // firebase-admin getFunctions() accepts only an App argument. Passing REGION
  // as a second argument is silently ignored and makes a short queue name fall
  // back to us-central1. Include the location in the function resource name.
  const queue = getFunctions().taskQueue(
    `locations/${REGION}/functions/runResearchJob`,
  );
  await queue.enqueue(
    {jobPath},
    {
      dispatchDeadlineSeconds: 60 * 5,
      uri: taskTargetUri(),
    },
  );
}

async function reserveAndCreateJob({uid, collectionName, cardId, card, settings}) {
  const urls = extractUrls(card.text);
  if (urls.length !== 1) {
    return {created: false, reason: "requires_single_url"};
  }
  const sourceUrl = urls[0];
  const sourceKind = classifySource(sourceUrl);
  const fingerprint = sourceFingerprint(card);
  const jobId = createResearchJobId({uid, collectionName, cardId, fingerprint});
  const jobPath = getResearchJobPath(uid, jobId);
  const jobRef = db.doc(jobPath);
  const estimatedCostCents = estimateJobCostCents(sourceKind);
  // YouTube is currently a manual NotebookLM handoff. The worker does not read
  // its audio or video, so it must not consume the video-processing allowance.
  const videoMinutes = 0;
  const {dayId, monthId} = getUsagePeriodIds();
  const dayRef = researchUsageRef(uid, dayId);
  const monthRef = researchUsageRef(uid, monthId);

  const result = await db.runTransaction(async (transaction) => {
    const [existingJob, dayUsage, monthUsage] = await Promise.all([
      transaction.get(jobRef),
      transaction.get(dayRef),
      transaction.get(monthRef),
    ]);
    if (existingJob.exists) {
      const existing = existingJob.data();
      return {
        created: false,
        reason: "idempotent_existing",
        status: existing.status,
        jobId,
        jobPath,
        shouldEnqueue: existing.status === "enqueue_failed",
      };
    }

    const budget = checkBudget({
      settings,
      dailyUsage: dayUsage.exists ? dayUsage.data() : {},
      monthlyUsage: monthUsage.exists ? monthUsage.data() : {},
      estimatedCostCents,
      videoMinutes,
    });
    const now = FieldValue.serverTimestamp();
    if (!budget.allowed) {
      transaction.set(jobRef, {
        uid,
        collectionName,
        cardId,
        sourceUrl,
        sourceKind,
        sourceFingerprint: fingerprint,
        status: "blocked_budget",
        budgetReason: budget.reason,
        estimatedCostCents,
        createdAt: now,
        updatedAt: now,
      });
      return {created: true, reason: budget.reason, jobId, jobPath, shouldEnqueue: false};
    }

    transaction.set(dayRef, {
      jobs: FieldValue.increment(1),
      videoMinutes: FieldValue.increment(videoMinutes),
      updatedAt: now,
    }, {merge: true});
    transaction.set(monthRef, {
      jobs: FieldValue.increment(1),
      estimatedCostCents: FieldValue.increment(estimatedCostCents),
      videoMinutes: FieldValue.increment(videoMinutes),
      updatedAt: now,
    }, {merge: true});
    transaction.set(jobRef, {
      uid,
      collectionName,
      cardId,
      sourceUrl,
      sourceKind,
      sourceFingerprint: fingerprint,
      status: "queued",
      attempts: 0,
      estimatedCostCents,
      createdAt: now,
      updatedAt: now,
    });
    return {created: true, reason: "queued", jobId, jobPath, shouldEnqueue: true};
  });

  if (result.shouldEnqueue) {
    try {
      await enqueueTask(result.jobPath);
      await jobRef.set({
        taskEnqueuedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
    } catch (error) {
      await jobRef.set({
        status: "enqueue_failed",
        error: {
          code: "task_enqueue_failed",
          message: String(error?.message || "Cloud Tasks enqueue failed").slice(0, 500),
        },
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
      throw error;
    }
  }
  return result;
}

exports.updateResearchAutomation = onCall({
  region: REGION,
  memory: "256MiB",
  minInstances: 0,
  maxInstances: 1,
}, async (request) => {
  const uid = requireAuth(request);
  const settings = normalizeAutomationSettings(request.data || {});
  await automationRef(uid).set({
    ...settings,
    uid,
    updatedAt: FieldValue.serverTimestamp(),
  }, {merge: true});
  return {ok: true, settings};
});

exports.enqueueCardResearch = onCall({
  region: REGION,
  memory: "256MiB",
  minInstances: 0,
  maxInstances: 1,
}, async (request) => {
  const uid = requireAuth(request);
  const collectionName = assertDocumentPart(request.data?.collectionName, "collectionName");
  const cardId = assertDocumentPart(request.data?.cardId, "cardId");
  const cardRef = db.doc(getCardPath(uid, collectionName, cardId));
  const cardSnapshot = await cardRef.get();
  if (!cardSnapshot.exists) {
    throw new HttpsError("not-found", "找不到卡片。");
  }
  try {
    return await reserveAndCreateJob({
      uid,
      collectionName,
      cardId,
      card: cardSnapshot.data(),
      settings: await getAutomationSettings(uid),
    });
  } catch (error) {
    const diagnostic = describeTaskEnqueueError(error);
    logger.error("enqueueCardResearch failed", {
      uid,
      collectionName,
      cardId,
      enqueueErrorCategory: diagnostic.category,
      enqueueErrorCode: diagnostic.errorCode,
      enqueueErrorMessage: diagnostic.errorMessage,
      enqueueErrorDetails: diagnostic.errorDetails,
      enqueueErrorStack: diagnostic.stack,
    });
    throw new HttpsError("internal", diagnostic.clientMessage);
  }
});

exports.resolveResearchReview = onCall({
  region: REGION,
  memory: "256MiB",
  minInstances: 0,
  maxInstances: 1,
}, async (request) => {
  const uid = requireAuth(request);
  const jobId = assertDocumentPart(request.data?.jobId, "jobId");
  const decision = request.data?.decision === "succeeded" ? "succeeded" : "discarded";
  const jobRef = db.doc(getResearchJobPath(uid, jobId));
  const snapshot = await jobRef.get();
  if (!snapshot.exists) {
    throw new HttpsError("not-found", "找不到研讀工作。");
  }
  if (snapshot.data().status !== "pending_review") {
    return {ok: true, status: snapshot.data().status, unchanged: true};
  }
  await jobRef.set({
    status: decision,
    reviewDecision: decision === "succeeded" ? "approved" : "discarded",
    reviewedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, {merge: true});
  return {ok: true, status: decision};
});

async function findCandidateCards(uid, maxJobs) {
  const categorySnapshots = await db
    .collection(`artifacts/${APP_ID}/users/${uid}/categories`)
    .get();
  const collectionNames = new Set(["inbox"]);
  categorySnapshots.forEach((snapshot) => collectionNames.add(snapshot.id));
  const candidates = [];

  for (const collectionName of collectionNames) {
    if (candidates.length >= maxJobs) break;
    const snapshot = await db
      .collection(`artifacts/${APP_ID}/users/${uid}/${collectionName}`)
      .limit(Math.max(20, maxJobs * 2))
      .get();
    snapshot.forEach((cardSnapshot) => {
      if (candidates.length >= maxJobs) return;
      const card = cardSnapshot.data();
      if (isResearchCandidate(card)) {
        candidates.push({
          collectionName,
          cardId: cardSnapshot.id,
          card,
        });
      }
    });
  }
  return candidates;
}

exports.discoverDueResearchJobs = onSchedule({
  schedule: "every 10 minutes",
  timeZone: "Asia/Taipei",
  region: REGION,
  memory: "256MiB",
  minInstances: 0,
  maxInstances: 1,
  retryCount: 0,
}, async () => {
  const usersSnapshot = await db
    .collection(`artifacts/${APP_ID}/automationUsers`)
    .where("enabled", "==", true)
    .limit(50)
    .get();

  const dueUsers = usersSnapshot.docs
    .filter((snapshot) => Number(snapshot.data().nextRunAt) <= Date.now())
    .slice(0, 20);
  for (const userSnapshot of dueUsers) {
    const uid = userSnapshot.id;
    const settings = normalizeAutomationSettings(userSnapshot.data());
    try {
      const candidates = await findCandidateCards(uid, settings.maxJobsPerRun);
      for (const candidate of candidates) {
        await reserveAndCreateJob({uid, settings, ...candidate});
      }
      await userSnapshot.ref.set({
        lastRunAt: FieldValue.serverTimestamp(),
        nextRunAt: getNextRunAt(settings.interval),
        lastRunCandidateCount: candidates.length,
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
    } catch (error) {
      logger.error("scheduled research discovery failed", {
        uid,
        message: error?.message,
      });
      await userSnapshot.ref.set({
        lastError: String(error?.message || "unknown").slice(0, 500),
        lastErrorAt: FieldValue.serverTimestamp(),
        nextRunAt: Date.now() + 60 * 60 * 1000,
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
    }
  }
});

exports.runResearchJob = onTaskDispatched({
  region: REGION,
  secrets: [GEMINI_API_KEY, JINA_API_KEY, OPENROUTER_API_KEY],
  memory: "512MiB",
  minInstances: 0,
  maxInstances: 1,
  timeoutSeconds: 300,
  retryConfig: {
    maxAttempts: 3,
    minBackoffSeconds: 60,
    maxBackoffSeconds: 3600,
    maxRetrySeconds: 24 * 60 * 60,
  },
  rateLimits: {
    maxConcurrentDispatches: 1,
  },
}, async (request) => {
  const jobPath = String(request.data?.jobPath || "");
  if (!/^artifacts\/[^/]+\/users\/[^/]+\/researchJobs\/[^/]+$/.test(jobPath)) {
    throw new Error("Invalid jobPath");
  }
  const jobRef = db.doc(jobPath);
  const jobSnapshot = await jobRef.get();
  if (!jobSnapshot.exists) return;
  const job = jobSnapshot.data();
  if (TERMINAL_JOB_STATUSES.has(job.status)) return;

  const cardRef = db.doc(getCardPath(job.uid, job.collectionName, job.cardId));
  const cardSnapshot = await cardRef.get();
  if (!cardSnapshot.exists) {
    await jobRef.set({
      status: "failed_terminal",
      error: {code: "card_not_found", message: "卡片已不存在。"},
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
    return;
  }
  const currentFingerprint = sourceFingerprint(cardSnapshot.data());
  if (currentFingerprint !== job.sourceFingerprint) {
    await jobRef.set({
      status: "cancelled_stale",
      error: {code: "source_changed", message: "卡片內容已變更，舊工作已取消。"},
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
    return;
  }

  await jobRef.set({
    status: "running",
    attempts: FieldValue.increment(1),
    startedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, {merge: true});

  try {
    const result = await analyzeSource({
      sourceUrl: job.sourceUrl,
      sourceKind: job.sourceKind,
      geminiApiKey: GEMINI_API_KEY.value(),
      jinaApiKey: JINA_API_KEY.value(),
      model: GEMINI_RESEARCH_MODEL.value(),
      openRouterApiKey: OPENROUTER_API_KEY.value(),
      openRouterModel: OPENROUTER_RESEARCH_MODEL.value(),
    });
    const {
      provider: resultProvider,
      model: resultModel,
      ...resultPayload
    } = result;
    await jobRef.set({
      status: "pending_review",
      result: resultPayload,
      provider: resultProvider || (job.sourceKind === "youtube" ?
        "notebooklm-manual" :
        "jina+openrouter"),
      model: resultModel || "",
      completedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      error: FieldValue.delete(),
    }, {merge: true});
  } catch (error) {
    const retryable = error instanceof ExternalServiceError && error.retryable;
    await jobRef.set({
      status: retryable ? "retry_wait" : "failed_terminal",
      error: {
        code: error?.reason ||
          (retryable ? "external_retryable" : "external_terminal"),
        provider: error?.provider || "unknown",
        status: error?.status || 0,
        retryAfterSeconds: error?.retryAfterSeconds || 0,
        message: String(error?.message || "research failed").slice(0, 500),
        details: String(error?.details || "").slice(0, 1000),
      },
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
    if (retryable) throw error;
  }
});
