"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  extractGenerateContentText,
  extractInteractionText,
  normalizeResearchResult,
  serviceErrorFromResponse,
  stripJsonFence,
} = require("../src/providers");

test("strips fenced JSON without touching normal JSON", () => {
  assert.equal(stripJsonFence("```json\n{\"a\":1}\n```"), "{\"a\":1}");
  assert.equal(stripJsonFence("{\"a\":1}"), "{\"a\":1}");
});

test("normalizes model result and limits tags", () => {
  assert.deepEqual(normalizeResearchResult({
    tldr: " 摘要 ",
    verdict: " 評價 ",
    notes: " 筆記 ",
    suggestedTags: ["A", " B ", "", "C", "D", "E", "F"],
    limitations: " 無 ",
  }, "https://example.com"), {
    tldr: "摘要",
    verdict: "評價",
    notes: "筆記",
    suggestedTags: ["A", "B", "C", "D", "E"],
    limitations: "無",
    sourceUrl: "https://example.com",
  });
});

test("extracts text from Gemini generateContent and Interactions shapes", () => {
  assert.equal(extractGenerateContentText({
    candidates: [{content: {parts: [{text: "one"}, {text: "two"}]}}],
  }), "one\ntwo");
  assert.equal(extractInteractionText({
    steps: [{content: [{text: "video result"}]}],
  }), "video result");
  assert.equal(extractInteractionText({output_text: "direct"}), "direct");
});

test("does not retry a Gemini 429 caused by depleted prepayment credits", () => {
  const error = serviceErrorFromResponse("gemini", {
    status: 429,
    headers: new Headers(),
  }, "Your prepayment credits are depleted. Please manage billing.");
  assert.equal(error.retryable, false);
  assert.equal(error.reason, "billing_credits_depleted");
});

test("still retries an ordinary provider rate-limit response", () => {
  const error = serviceErrorFromResponse("gemini", {
    status: 429,
    headers: new Headers({"retry-after": "60"}),
  }, "Too many requests");
  assert.equal(error.retryable, true);
  assert.equal(error.reason, "");
  assert.equal(error.retryAfterSeconds, 60);
});
