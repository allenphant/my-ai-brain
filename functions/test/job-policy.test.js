"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  checkBudget,
  classifySource,
  createResearchJobId,
  extractUrls,
  getNextRunAt,
  getUsagePeriodIds,
  isResearchCandidate,
  normalizeAutomationSettings,
  sourceFingerprint,
} = require("../src/job-policy");

test("automation settings stay within cost-safe limits", () => {
  const settings = normalizeAutomationSettings({
    enabled: true,
    interval: "6h",
    approvalMode: "auto",
    maxJobsPerRun: 999,
    maxJobsPerDay: 999,
    monthlyBudgetCents: 99_999,
    maxVideoMinutesPerDay: 999,
  }, 1000);
  assert.deepEqual(settings, {
    enabled: true,
    interval: "6h",
    approvalMode: "auto",
    maxJobsPerRun: 20,
    maxJobsPerDay: 50,
    monthlyBudgetCents: 500,
    maxVideoMinutesPerDay: 60,
    nextRunAt: 1000,
  });
  assert.equal(getNextRunAt("6h", 1000), 1000 + 6 * 60 * 60 * 1000);
});

test("extracts one canonical URL and classifies YouTube", () => {
  assert.deepEqual(
    extractUrls("demo https://youtu.be/abc#fragment"),
    ["https://youtu.be/abc"],
  );
  assert.equal(classifySource("https://www.youtube.com/watch?v=abc"), "youtube");
  assert.equal(classifySource("https://example.com/page"), "web");
});

test("candidate requires exactly one URL and missing research or tags", () => {
  assert.equal(isResearchCandidate({
    text: "https://example.com",
    researchSearchText: "",
    tagIds: [],
  }), true);
  assert.equal(isResearchCandidate({
    text: "https://one.example https://two.example",
  }), false);
  assert.equal(isResearchCandidate({
    text: "https://example.com",
    researchSearchText: "summary",
    tagIds: ["tag-a"],
  }), false);
});

test("fingerprint and job id are stable but change with source", () => {
  const first = sourceFingerprint({text: "read https://example.com/a"});
  const second = sourceFingerprint({text: "read https://example.com/a"});
  const changed = sourceFingerprint({text: "read https://example.com/b"});
  assert.equal(first, second);
  assert.notEqual(first, changed);
  assert.equal(
    createResearchJobId({
      uid: "u1",
      collectionName: "inbox",
      cardId: "c1",
      fingerprint: first,
    }),
    createResearchJobId({
      uid: "u1",
      collectionName: "inbox",
      cardId: "c1",
      fingerprint: first,
    }),
  );
});

test("budget blocks daily jobs, monthly cost, and video duration", () => {
  const settings = normalizeAutomationSettings({
    maxJobsPerDay: 2,
    monthlyBudgetCents: 10,
    maxVideoMinutesPerDay: 10,
  });
  assert.deepEqual(checkBudget({
    settings,
    dailyUsage: {jobs: 2},
    monthlyUsage: {},
    estimatedCostCents: 2,
  }), {allowed: false, reason: "daily_job_limit"});
  assert.deepEqual(checkBudget({
    settings,
    dailyUsage: {jobs: 0},
    monthlyUsage: {estimatedCostCents: 9},
    estimatedCostCents: 2,
  }), {allowed: false, reason: "monthly_cost_limit"});
  assert.deepEqual(checkBudget({
    settings,
    dailyUsage: {jobs: 0, videoMinutes: 5},
    monthlyUsage: {},
    estimatedCostCents: 2,
    videoMinutes: 10,
  }), {allowed: false, reason: "daily_video_limit"});
});

test("usage periods are calculated in Asia/Taipei", () => {
  const ids = getUsagePeriodIds(Date.parse("2026-07-27T16:30:00Z"));
  assert.deepEqual(ids, {
    dayId: "day-2026-07-28",
    monthId: "month-2026-07",
  });
});
