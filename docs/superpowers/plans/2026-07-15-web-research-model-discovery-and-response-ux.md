# Web Research Model Discovery and Response UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate general AI and web-research models, discover future Search-capable models safely, parse Gemini multi-part output, and expose actionable errors.

**Architecture:** Pure model filtering, verification-cache, response parsing, and error-description helpers live in `web-research.mjs`. `app.js` coordinates Gemini requests and settings state; `index.html` exposes two model selectors and explicit unknown-model verification.

**Tech Stack:** Browser ES modules, Gemini REST API, localStorage, Node test runner, Puppeteer.

## Global Constraints

- Never expose the Gemini API key in UI, logs added by this change, or stored diagnostic text.
- Unknown models remain discoverable and are never permanently rejected on 429/5xx.
- Search verification is user-triggered and cached for 7 days.
- Existing AI sorting behavior and stored `geminiModel` remain compatible.

---

### Task 1: Pure model, response, and error helpers

**Files:**
- Modify: `web-research.mjs`
- Test: `tests/web-research.test.mjs`

**Interfaces:**
- Produces: `getKnownWebResearchModels(models)`, `extractGeminiResponseText(data)`, `describeGeminiApiError(payload, status, model)`, and 7-day verification cache helpers.

- [ ] **Step 1: Write failing tests** for known model intersection, unknown preservation, multi-part text extraction excluding thought parts, empty output, quotaId/retryDelay extraction, and verification cache expiry.
- [ ] **Step 2: Run `node --test tests/web-research.test.mjs`** and confirm missing exports fail.
- [ ] **Step 3: Implement minimal pure helpers** with exact stable model IDs and structured safe error output.
- [ ] **Step 4: Rerun the unit test** and confirm it passes.
- [ ] **Step 5: Commit** `web-research.mjs` and `tests/web-research.test.mjs`.

### Task 2: Independent settings and model verification

**Files:**
- Modify: `index.html`
- Modify: `app.js`
- Test: `tests/card-web-research.browser.mjs`

**Interfaces:**
- Consumes: Task 1 model/filter/cache helpers.
- Produces: `geminiWebResearchModel` settings flow and explicit unknown-model verification UI.

- [ ] **Step 1: Extend the browser fixture** so `models.list` returns known, unknown, and unsupported models; assert two selectors and explicit verification controls.
- [ ] **Step 2: Run the Puppeteer test** and confirm the new selectors are missing.
- [ ] **Step 3: Add separate settings controls**, populate general models in real time, populate known Search models by intersection, and render unknown models for explicit testing.
- [ ] **Step 4: Implement the minimal Search probe**; cache only supported/unsupported results and treat 429/5xx as temporary.
- [ ] **Step 5: Rerun the Puppeteer test** and confirm settings persistence and request routing pass.

### Task 3: Robust response and actionable errors

**Files:**
- Modify: `app.js`
- Test: `tests/card-web-research.browser.mjs`

**Interfaces:**
- Consumes: `extractGeminiResponseText` and `describeGeminiApiError`.
- Produces: safe structured errors containing `model`, `status`, `quotaId`, and `retryDelay`.

- [ ] **Step 1: Add browser cases** where the first part has no text and a later part contains output, plus 429 payloads with and without quota details.
- [ ] **Step 2: Run the browser test** and confirm the multi-part case reports empty output under old behavior.
- [ ] **Step 3: Parse all non-thought parts** and attach safe structured error metadata without request URLs or keys.
- [ ] **Step 4: Render actual model and actionable detail** in the status panel and toast.
- [ ] **Step 5: Run all unit and browser tests**, syntax checks, and `git diff --check`.

### Task 4: Publish

**Files:**
- No additional product files.

- [ ] **Step 1: Request independent code review** for the complete diff.
- [ ] **Step 2: Resolve actionable findings and rerun verification.**
- [ ] **Step 3: Commit remaining changes.**
- [ ] **Step 4: Push the verified branch to `origin/main` and confirm the remote SHA.**
