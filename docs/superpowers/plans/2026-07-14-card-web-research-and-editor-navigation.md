# Card Web Research and Editor Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add preview-confirmed, append-only AI web research to eligible existing cards and make external links and mobile Back behave correctly around card overlays.

**Architecture:** Extract deterministic eligibility, cache, EditorJS-block, and interaction-target helpers into `web-research.mjs` so Node tests can exercise real production code. Keep Gemini, Firestore, DOM, and History API orchestration in `app.js`; add one preview modal to `index.html` and use Firestore transactions for append-only writes.

**Tech Stack:** Vanilla JavaScript ES modules, Node built-in test runner, JSDOM/Puppeteer for browser verification, Firebase Firestore 11.6.1, EditorJS, Tailwind CDN.

## Global Constraints

- Manual web research belongs only to existing cards, never the main input or add-card modal.
- Only cards with exactly one unique HTTP(S) URL and at most 1,200 trimmed characters are eligible.
- Research output is previewed before an explicit append confirmation.
- Confirmation appends `AI 網址研讀｜YYYY/MM/DD HH:mm` and a paragraph to `details/note`; it never changes card `text`.
- Cache TTL remains 24 hours and real Gemini requests use a global 60-second cooldown.
- Cache hits bypass cooldown but still require preview confirmation.
- External-link clicks must not open the editor.
- Browser/mobile Back closes preview, then editor, before leaving the application.
- Preserve unrelated user changes and do not stage `CURRENT_STATE.md`, `docs/ADR.md`, package files, `patch.py`, or `node_modules/`.

---

### Task 1: Pure Web-Research Domain Helpers

**Files:**
- Create: `web-research.mjs`
- Create: `tests/web-research.test.mjs`

**Interfaces:**
- Produces: `extractUrls(text)`, `canUseWebResearch(text)`, `getWebResearchCacheKey(text)`, `readWebResearchCache(storage, text, now)`, `writeWebResearchCache(storage, text, value, now)`, `getWebResearchCooldownRemaining(storage, now)`, `buildWebResearchAppendData(existingData, result, now)`, and `isInteractiveCardTarget(target)`.

- [ ] **Step 1: Write failing pure-logic tests**

Test zero/one/duplicate/multiple URLs, the 1,200-character boundary, cache hit/expiry/malformed removal, cooldown arithmetic, append preservation/escaping, timestamp format, and anchor/button interaction detection using `node:test` and `node:assert/strict`.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/web-research.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `web-research.mjs`.

- [ ] **Step 3: Implement the helpers**

Use constants `WEB_RESEARCH_COOLDOWN_MS = 60_000`, `WEB_RESEARCH_CACHE_TTL_MS = 86_400_000`, and `WEB_RESEARCH_CACHE_PREFIX = 'webPolishCache:'`. Preserve existing blocks with array spread, escape `&`, `<`, `>`, quotes, and apostrophes, then convert newlines to `<br>` in the paragraph block.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `node --test tests/web-research.test.mjs`

Expected: all tests pass with exit code 0.

- [ ] **Step 5: Commit the isolated helper change**

```bash
git add web-research.mjs tests/web-research.test.mjs
git commit -m "test(ai): cover card web research helpers"
```

### Task 2: Existing-Card Research UI and Preview

**Files:**
- Modify: `index.html` card preview/modal markup near the existing add-card and editor modals
- Modify: `app.js` imports, card renderers, event wiring, Gemini flow, and Firestore imports
- Test: `tests/web-research.test.mjs`

**Interfaces:**
- Consumes: all Task 1 helper exports.
- Produces: `getWebResearchButtonHTML(item)`, `runCardWebResearch(item, collectionName, button)`, `openWebResearchPreview(payload)`, `closeWebResearchPreview(options)`, and `appendPendingWebResearch()`.

- [ ] **Step 1: Add failing render-contract assertions**

Read `index.html` and `app.js` in the Node test and assert that the old `polish-link-btn` and `polish-add-card-btn` IDs are absent, the preview modal IDs exist, and `getWebResearchButtonHTML(item)` is referenced by text/todo/bookmark render paths.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/web-research.test.mjs`

Expected: FAIL because old controls still exist and preview/card actions do not.

- [ ] **Step 3: Implement card controls and preview**

Remove both new-content research buttons and their listeners. Render an always-visible `AI 研讀` button only when `canUseWebResearch(item.text).ok`. Add a modal with `web-research-preview-modal`, `web-research-preview-content`, `cancel-web-research-preview-btn`, and `append-web-research-btn`. Store pending `{ itemId, collectionName, sourceText, result }` only in memory.

- [ ] **Step 4: Implement append-only transaction**

Import `runTransaction`. On confirmation, transactionally read the latest `details/note`, call `buildWebResearchAppendData()`, and write `{ data, updatedAt }`. Keep the preview open on failure and close it only after the transaction resolves.

- [ ] **Step 5: Reuse cache/cooldown/error semantics**

Refactor `runManualWebPolish` into the card-scoped flow. Cache hits open preview without changing cooldown. Real requests write `lastWebPolishTime` before fetch. Quota and generic failures update status and never create pending preview state.

- [ ] **Step 6: Run tests and verify GREEN**

Run: `node --test tests/web-research.test.mjs`

Expected: all tests pass.

- [ ] **Step 7: Commit card research UI**

```bash
git add index.html app.js tests/web-research.test.mjs
git commit -m "feat(ai): add per-card web research preview"
```

### Task 3: Link Isolation and Overlay History

**Files:**
- Modify: `app.js` card click handlers, editor open/close functions, startup deep-link handling, and history listeners
- Modify: `web-research.mjs` only if interaction helper adjustments are required by tests
- Test: `tests/web-research.test.mjs`

**Interfaces:**
- Consumes: `isInteractiveCardTarget(target)` and preview open/close functions.
- Produces: `pushOverlayHistory(type, payload)`, history-aware editor open/close behavior, and a single `popstate` overlay coordinator.

- [ ] **Step 1: Add failing history/source assertions**

Assert card click handlers call `isInteractiveCardTarget(e.target)`, `openEditor()` uses `history.pushState` for UI opens, a `popstate` listener exists, and Back prioritizes preview before editor.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/web-research.test.mjs`

Expected: FAIL on the existing anchor bubbling and `replaceState`-only history implementation.

- [ ] **Step 3: Isolate interactive clicks**

Update text and todo card container handlers to return for anchors, buttons, or descendants of either. Ensure the card research handler calls `stopPropagation()`.

- [ ] **Step 4: Implement overlay history**

Push an `{ overlay: 'editor', itemId, collectionName }` state on UI editor opens and an `{ overlay: 'web-research-preview' }` state when preview opens. Route close button, backdrop, and Escape through a close request that consumes the current overlay entry. In `popstate`, close preview first, otherwise editor, without writing more history.

- [ ] **Step 5: Normalize deep links**

When startup finds `?editor` and `col`, replace the current entry with the clean base URL, push the editor state with the original query, and open without a second push. This guarantees one Back action returns to the base application.

- [ ] **Step 6: Run tests and verify GREEN**

Run: `node --test tests/web-research.test.mjs`

Expected: all tests pass.

- [ ] **Step 7: Commit navigation fix**

```bash
git add app.js web-research.mjs tests/web-research.test.mjs
git commit -m "fix(ux): close card overlays with browser back"
```

### Task 4: Browser Regression Verification

**Files:**
- Create: `tests/card-web-research.browser.mjs`
- Modify: `package.json` only if it is explicitly brought under project ownership; otherwise run scripts directly and leave the existing untracked file untouched

**Interfaces:**
- Consumes: rendered app, preview flow, cache/cooldown state, and history behavior from Tasks 1-3.
- Produces: repeatable Puppeteer regression coverage with intercepted Gemini responses.

- [ ] **Step 1: Write the browser regression script**

Start from a local HTTP server, intercept Gemini OPTIONS/POST with CORS headers, and verify mobile viewport behavior. Stub or seed the minimum authenticated/card state required without making real Gemini writes.

- [ ] **Step 2: Demonstrate regression sensitivity**

Run the focused source/pure tests against the pre-fix behavior or temporarily revert one guarded condition and confirm the relevant assertion fails; restore the fix immediately.

- [ ] **Step 3: Run complete verification**

Run:

```bash
node --test tests/web-research.test.mjs
node tests/card-web-research.browser.mjs
git diff --check
```

Expected: all commands exit 0, no failed assertions, no unexpected page errors, and no whitespace errors.

- [ ] **Step 4: Inspect final scope**

Run `git status --short` and `git diff --stat HEAD~3..HEAD`. Confirm unrelated pre-existing files remain unstaged and unchanged by this work.

- [ ] **Step 5: Commit browser verification**

```bash
git add tests/card-web-research.browser.mjs
git commit -m "test(ux): verify card research and overlay navigation"
```
