"use strict";

const crypto = require("node:crypto");

const APP_ID = "my-personal-ai-brain";
const PROMPT_VERSION = "cloud-research-v2-openrouter";
const DEFAULT_TIME_ZONE = "Asia/Taipei";
const MAX_CARD_TEXT_LENGTH = 20_000;
const INTERVALS_MS = Object.freeze({
  "6h": 6 * 60 * 60 * 1000,
  "12h": 12 * 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  "3d": 3 * 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
});

const DEFAULT_AUTOMATION_SETTINGS = Object.freeze({
  enabled: false,
  interval: "daily",
  approvalMode: "manual",
  maxJobsPerRun: 20,
  maxJobsPerDay: 50,
  monthlyBudgetCents: 500,
  maxVideoMinutesPerDay: 60,
});

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeAutomationSettings(input = {}, now = Date.now()) {
  const interval = Object.hasOwn(INTERVALS_MS, input.interval) ?
    input.interval :
    DEFAULT_AUTOMATION_SETTINGS.interval;
  const settings = {
    enabled: input.enabled === true,
    interval,
    approvalMode: input.approvalMode === "auto" ? "auto" : "manual",
    maxJobsPerRun: clampInteger(
      input.maxJobsPerRun,
      1,
      20,
      DEFAULT_AUTOMATION_SETTINGS.maxJobsPerRun,
    ),
    maxJobsPerDay: clampInteger(
      input.maxJobsPerDay,
      1,
      50,
      DEFAULT_AUTOMATION_SETTINGS.maxJobsPerDay,
    ),
    monthlyBudgetCents: clampInteger(
      input.monthlyBudgetCents,
      0,
      500,
      DEFAULT_AUTOMATION_SETTINGS.monthlyBudgetCents,
    ),
    maxVideoMinutesPerDay: clampInteger(
      input.maxVideoMinutesPerDay,
      0,
      60,
      DEFAULT_AUTOMATION_SETTINGS.maxVideoMinutesPerDay,
    ),
  };
  settings.nextRunAt = settings.enabled ?
    Number(input.nextRunAt) || now :
    null;
  return settings;
}

function getNextRunAt(interval, from = Date.now()) {
  const duration = INTERVALS_MS[interval] || INTERVALS_MS.daily;
  return from + duration;
}

function normalizeHttpUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (!["http:", "https:"].includes(url.protocol)) return "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function extractUrls(text) {
  const matches = String(text || "").match(/https?:\/\/[^\s<>"'`）)】\]]+/gi) || [];
  return [...new Set(matches.map(normalizeHttpUrl).filter(Boolean))];
}

function classifySource(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    if (hostname === "youtu.be" || hostname === "youtube.com" || hostname.endsWith(".youtube.com")) {
      return "youtube";
    }
    return "web";
  } catch {
    return "invalid";
  }
}

function sourceFingerprint(card = {}) {
  const source = [
    String(card.text || "").slice(0, MAX_CARD_TEXT_LENGTH),
    ...extractUrls(card.text),
  ].join("\n");
  return crypto.createHash("sha256").update(source).digest("hex");
}

function createResearchJobId({uid, collectionName, cardId, fingerprint}) {
  const raw = [uid, collectionName, cardId, fingerprint, PROMPT_VERSION].join("|");
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 40);
}

function getResearchJobPath(uid, jobId) {
  return `artifacts/${APP_ID}/users/${uid}/researchJobs/${jobId}`;
}

function getCardPath(uid, collectionName, cardId) {
  return `artifacts/${APP_ID}/users/${uid}/${collectionName}/${cardId}`;
}

function isResearchCandidate(card = {}) {
  const urls = extractUrls(card.text);
  if (urls.length !== 1) return false;
  const hasResearchIndex = String(card.researchSearchText || "").trim().length > 0;
  const hasTags = Array.isArray(card.tagIds) && card.tagIds.length > 0;
  return !hasResearchIndex || !hasTags;
}

function estimateJobCostCents(sourceKind) {
  return sourceKind === "youtube" ? 0 : 2;
}

function formatPeriod(date, options) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: DEFAULT_TIME_ZONE,
    ...options,
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return options.day ?
    `${values.year}-${values.month}-${values.day}` :
    `${values.year}-${values.month}`;
}

function getUsagePeriodIds(now = Date.now()) {
  const date = new Date(now);
  return {
    dayId: `day-${formatPeriod(date, {year: "numeric", month: "2-digit", day: "2-digit"})}`,
    monthId: `month-${formatPeriod(date, {year: "numeric", month: "2-digit"})}`,
  };
}

function checkBudget({
  settings,
  dailyUsage = {},
  monthlyUsage = {},
  estimatedCostCents,
  videoMinutes = 0,
}) {
  if ((dailyUsage.jobs || 0) + 1 > settings.maxJobsPerDay) {
    return {allowed: false, reason: "daily_job_limit"};
  }
  if ((monthlyUsage.estimatedCostCents || 0) + estimatedCostCents > settings.monthlyBudgetCents) {
    return {allowed: false, reason: "monthly_cost_limit"};
  }
  if ((dailyUsage.videoMinutes || 0) + videoMinutes > settings.maxVideoMinutesPerDay) {
    return {allowed: false, reason: "daily_video_limit"};
  }
  return {allowed: true, reason: ""};
}

module.exports = {
  APP_ID,
  DEFAULT_AUTOMATION_SETTINGS,
  DEFAULT_TIME_ZONE,
  INTERVALS_MS,
  PROMPT_VERSION,
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
  normalizeHttpUrl,
  sourceFingerprint,
};
