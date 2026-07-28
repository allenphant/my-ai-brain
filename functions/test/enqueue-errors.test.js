"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {describeTaskEnqueueError} = require("../src/enqueue-errors");

test("classifies Cloud Tasks enqueuer permission failures", () => {
  const result = describeTaskEnqueueError({
    code: 7,
    message: "Permission cloudtasks.tasks.create denied",
  });
  assert.equal(result.category, "missing_tasks_enqueuer");
  assert.match(result.clientMessage, /Cloud Tasks Enqueuer/);
});

test("classifies service account actAs failures", () => {
  const result = describeTaskEnqueueError({
    code: "PERMISSION_DENIED",
    message: "Permission iam.serviceAccounts.actAs denied",
  });
  assert.equal(result.category, "missing_service_account_user");
  assert.match(result.clientMessage, /簽發憑證/);
});

test("keeps an unknown error useful without exposing an unbounded payload", () => {
  const result = describeTaskEnqueueError({
    message: `unexpected ${"x".repeat(2000)}`,
    stack: "trace",
  });
  assert.equal(result.category, "unknown");
  assert.equal(result.errorMessage.length, 1000);
  assert.equal(result.stack, "trace");
});

test("classifies a missing regional Cloud Tasks queue", () => {
  const result = describeTaskEnqueueError({
    message: "Queue does not exist. If you just created the queue, wait at least a minute.",
  });
  assert.equal(result.category, "queue_not_found");
  assert.match(result.clientMessage, /runResearchJob/);
});
