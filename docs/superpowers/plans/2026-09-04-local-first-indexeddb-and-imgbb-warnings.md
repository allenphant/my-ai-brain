# 漸進式架構 (Local-First IndexedDB) 與圖床風險警示實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 實現本機離線優先的 IndexedDB 儲存層與雲端一鍵遷移精靈，並於 README.md 中全面增補 ImgBB 免費圖床的安全性與隱私風險專章。

**Architecture:** 抽象化儲存層為本地引擎（LocalDbEngine，以瀏覽器原生 IndexedDB 儲存卡片、分類、標籤與詳細筆記）與雲端引擎（FirestoreEngine）。使用者開啟網站即刻進入具備預設分類的本機模式；當登入 Firebase 後，由遷移精靈自動提示並一鍵將本地離線資料無縫同步至雲端。

**Tech Stack:** 原生 JavaScript (ES6 Modules), 原生 IndexedDB API, fake-indexeddb (用於 Node.js 測試), Node.js test runner, Puppeteer

## Global Constraints

- 永遠禁止在任何回覆、引導、說明、文件或程式碼註解中使用任何 emoji（無論何種情境均嚴格禁用）。
- 嚴格維持零打包工具（Zero Build Tooling）、純靜態前端架構。
- 專有名詞保留英文，回覆與說明使用繁體中文。
- 遵循 TDD 流程：先寫測試、驗證失敗、撰寫最小實作、驗證通過、原子化提交。
- 保持現有 97 項測試持續全數通過。

---

### Task 1: README.md 增補 ImgBB 安全與隱私風險專章

**Files:**
- Modify: `README.md`
- Test: `tests/readme-warning.test.mjs`

**Interfaces:**
- Produces: `README.md` 中的 `[!WARNING]` 警示區塊，包含「公開存取風險 (Public URL Risk)」與「無 SLA 與被動清除風險 (Retention Policy & Zero SLA)」。

- [ ] **Step 1: 撰寫測試驗證 README 包含 ImgBB 風險警示且無 Emoji**

```javascript
// tests/readme-warning.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('README.md includes ImgBB security & privacy warnings without emoji', () => {
    const content = readFileSync('README.md', 'utf8');

    // Emoji check
    const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B50}-\u{2B55}\u{203C}\u{2049}\u{25AA}\u{25AB}\u{25B6}\u{25C0}\u{25FB}-\u{25FE}]/u;
    assert.equal(emojiRegex.test(content), false, 'README should contain zero emoji');

    // Risk warning keywords
    assert.ok(content.includes('ImgBB 免費圖床隱私與可用性警示'), 'Should contain ImgBB warning title');
    assert.ok(content.includes('公開存取風險'), 'Should contain public access risk warning');
    assert.ok(content.includes('無 SLA 與被動清除風險'), 'Should contain retention policy / SLA warning');
    assert.ok(content.includes('嚴禁上傳包含密碼'), 'Should explicitly forbid uploading credentials');
});
```

- [ ] **Step 2: 執行測試確認失敗**

執行：`node --test tests/readme-warning.test.mjs`
預期輸出：FAIL（找不到警示關鍵字）

- [ ] **Step 3: 更新 README.md 加入 ImgBB 安全警示**

在 `README.md` 的「步驟 2：取得 AI 與圖床 API Key」、「技術棧」與「安全與隱私架構」加入：

```markdown
> [!WARNING]
> **ImgBB 免費圖床隱私與可用性警示**：
> 1. **公開存取風險 (Public URL Risk)**：ImgBB 產生的圖片網址為公開 CDN 連結，無存取控制清單（ACL）。任何取得圖片網址者皆可直接檢視圖片。**絕對嚴禁上傳包含帳號密碼、API 金鑰、個人隱私或商業機密之截圖**。
> 2. **無 SLA 與被動清除風險 (Retention Policy & Zero SLA)**：免費圖床不提供服務水準保證（SLA），長時間未存取的圖片可能遭平台清理失效，導致卡片連結破圖。重要筆記內容請務必以文字或結構化 Markdown 記錄。
```

- [ ] **Step 4: 執行測試確認通過**

執行：`node --test tests/readme-warning.test.mjs`
預期輸出：PASS

- [ ] **Step 5: 提交變更**

```bash
git add README.md tests/readme-warning.test.mjs
git commit -m "docs: add ImgBB security, privacy, and retention policy warnings to README"
```

---

### Task 2: 實作原生 IndexedDB 資料庫模組 (`js/local-db.mjs`)

**Files:**
- Create: `js/local-db.mjs`
- Test: `tests/local-db.test.mjs`

**Interfaces:**
- Produces:
  - `openLocalDb(): Promise<IDBDatabase>`
  - `ensureDefaultCategories(): Promise<Array>`
  - `getAllCategories(): Promise<Array>`
  - `saveCategory(category): Promise<Object>`
  - `deleteCategory(id): Promise<void>`
  - `getCardsByCollection(collectionName): Promise<Array>`
  - `getAllCards(): Promise<Array>`
  - `addCard(collectionName, cardData): Promise<Object>`
  - `updateCard(collectionName, cardId, cardData): Promise<Object>`
  - `deleteCard(collectionName, cardId): Promise<void>`
  - `moveCard(fromCol, toCol, cardId, cardData): Promise<void>`
  - `getNote(cardId): Promise<Object|null>`
  - `saveNote(cardId, noteData): Promise<void>`
  - `getTags(): Promise<Array>`
  - `saveTags(tags): Promise<void>`
  - `getMigrationStatus(): Promise<Object>`
  - `setMigrationStatus(status): Promise<void>`
  - `exportAllLocalData(): Promise<Object>`
  - `clearAllLocalData(): Promise<void>`

- [ ] **Step 1: 撰寫 LocalDB 單元測試**

```javascript
// tests/local-db.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {
    openLocalDb,
    ensureDefaultCategories,
    getAllCategories,
    saveCategory,
    deleteCategory,
    addCard,
    getCardsByCollection,
    updateCard,
    deleteCard,
    moveCard,
    saveNote,
    getNote,
    getTags,
    saveTags,
    exportAllLocalData,
    clearAllLocalData
} from '../js/local-db.mjs';

test('LocalDB: lifecycle and CRUD operations', async () => {
    await clearAllLocalData();

    // 1. Categories
    const defaultCats = await ensureDefaultCategories();
    assert.equal(defaultCats.length, 4);
    assert.equal(defaultCats[0].id, 'todos');

    await saveCategory({ id: 'custom-cat', name: '自訂專案', order: 5000, type: 'text' });
    const allCats = await getAllCategories();
    assert.equal(allCats.length, 5);

    // 2. Cards
    const newCard = await addCard('inbox', {
        title: '測試靈感卡片',
        url: 'https://example.com',
        tags: ['tech']
    });
    assert.ok(newCard.id);
    assert.equal(newCard.collection, 'inbox');

    const inboxCards = await getCardsByCollection('inbox');
    assert.equal(inboxCards.length, 1);
    assert.equal(inboxCards[0].title, '測試靈感卡片');

    // 3. Move card
    await moveCard('inbox', 'todos', newCard.id, { ...newCard, title: '移動到待辦' });
    const updatedInbox = await getCardsByCollection('inbox');
    assert.equal(updatedInbox.length, 0);
    const todosCards = await getCardsByCollection('todos');
    assert.equal(todosCards.length, 1);
    assert.equal(todosCards[0].title, '移動到待辦');

    // 4. Notes
    await saveNote(newCard.id, { blocks: [{ type: 'paragraph', data: { text: '詳細筆記' } }] });
    const note = await getNote(newCard.id);
    assert.equal(note.blocks[0].data.text, '詳細筆記');

    // 5. Tags
    await saveTags([{ id: 't1', name: '技術' }]);
    const tags = await getTags();
    assert.equal(tags.length, 1);
    assert.equal(tags[0].name, '技術');

    // 6. Export data
    const exported = await exportAllLocalData();
    assert.equal(exported.categories.length, 5);
    assert.equal(exported.cards.length, 1);
    assert.equal(exported.tags.length, 1);
    assert.ok(exported.notes[newCard.id]);
});
```

- [ ] **Step 2: 執行測試確認失敗**

執行：`node --test tests/local-db.test.mjs`
預期輸出：FAIL（找不到 `js/local-db.mjs`）

- [ ] **Step 3: 實作 `js/local-db.mjs`**

使用原生 IndexedDB 建立 `MyAiBrainLocalDB`，封裝 Promise 式操作。

- [ ] **Step 4: 執行測試確認通過**

執行：`node --test tests/local-db.test.mjs`
預期輸出：PASS

- [ ] **Step 5: 提交變更**

```bash
git add js/local-db.mjs tests/local-db.test.mjs package.json package-lock.json
git commit -m "feat: implement native IndexedDB local storage engine"
```

---

### Task 3: 實作儲存調度器與雲端遷移器 (`js/storage-controller.mjs`)

**Files:**
- Create: `js/storage-controller.mjs`
- Test: `tests/storage-controller.test.mjs`

**Interfaces:**
- Consumes: `js/local-db.mjs`
- Produces:
  - `StorageController.getMode()`: `'local'` | `'cloud'`
  - `StorageController.setMode(mode)`
  - `StorageController.subscribe(event, callback)`
  - `StorageController.migrateLocalToCloud(firestoreContext, progressCallback)`

- [ ] **Step 1: 撰寫 StorageController 單元測試**

```javascript
// tests/storage-controller.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { StorageController } from '../js/storage-controller.mjs';
import { clearAllLocalData, addCard } from '../js/local-db.mjs';

test('StorageController dispatches local mode events and exports migration payload', async () => {
    await clearAllLocalData();
    const controller = new StorageController();
    controller.setMode('local');

    let eventFired = false;
    controller.subscribe('cards_changed', () => { eventFired = true; });

    await controller.addCard('inbox', { title: '控制器測試' });
    assert.equal(eventFired, true);

    const checkMigration = await controller.needsCloudMigration();
    assert.equal(checkMigration.needed, true);
    assert.equal(checkMigration.cardCount, 1);
});
```

- [ ] **Step 2: 執行測試確認失敗**

執行：`node --test tests/storage-controller.test.mjs`
預期輸出：FAIL

- [ ] **Step 3: 實作 `js/storage-controller.mjs`**

實作具備事件派發（Pub/Sub）能力的統一存取層，並實作 `migrateLocalToCloud`。

- [ ] **Step 4: 執行測試確認通過**

執行：`node --test tests/storage-controller.test.mjs`
預期輸出：PASS

- [ ] **Step 5: 提交變更**

```bash
git add js/storage-controller.mjs tests/storage-controller.test.mjs
git commit -m "feat: implement StorageController and cloud migration bridge"
```

---

### Task 4: 前端介面整合與狀態流轉更新 (`index.html`, `app.js`)

**Files:**
- Modify: `index.html` (加入本機模式標籤與遷移彈跳對話框 markup)
- Modify: `app.js` (整合本機模式開箱即用、登入後遷移偵測與即時介面重繪)
- Test: `tests/byod-firebase.test.mjs`, `tests/local-first-integration.test.mjs`

- [ ] **Step 1: 撰寫整合測試驗證本機模式預設載入與無憑證運行**

```javascript
// tests/local-first-integration.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('index.html contains Local Mode badge and Migration Modal dialog', () => {
    const html = readFileSync('index.html', 'utf8');
    assert.ok(html.includes('migration-modal'), 'Should contain migration modal markup');
    assert.ok(html.includes('confirm-migration-btn'), 'Should contain confirm migration button');
    assert.ok(html.includes('dismiss-migration-btn'), 'Should contain dismiss migration button');
});
```

- [ ] **Step 2: 執行測試確認失敗**

執行：`node --test tests/local-first-integration.test.mjs`
預期輸出：FAIL

- [ ] **Step 3: 更新 `index.html` 與 `app.js`**

1. `index.html`：在頂部導航列支援本機狀態顯示，並新增 `migration-modal`。
2. `app.js`：
   - 當 `isFirebaseConfigured` 為 false 時，不再調用阻斷式的 `renderUnconfiguredState()`，而是調用 `initLocalMode()`。
   - `initLocalMode()` 載入 LocalDB 的預設分類與卡片，更新頂部為「本機儲存模式（離線可用）」。
   - 當 Firebase 登入成功時，觸發 `checkAndPromptMigration()`，若本機有資料則跳出遷移精靈。

- [ ] **Step 4: 執行全套測試確認通過**

執行：`npm test`
預期輸出：100+ 項測試通過

- [ ] **Step 5: 提交變更**

```bash
git add index.html app.js tests/local-first-integration.test.mjs
git commit -m "feat: integrate Local-First IndexedDB experience and migration modal into UI"
```

---

### Task 5: 端到端瀏覽器測試與整體回歸驗證

**Files:**
- Create: `tests/local-first-browser.test.mjs`
- Verify: `npm test` & `npm run test:browser`

- [ ] **Step 1: 撰寫 Puppeteer 瀏覽器端到端測試**

測試情境：
1. 全新開啟無 LocalStorage 狀態：確認畫面自動呈現 4 個預設分類與收件匣，頂部顯示「本機儲存模式」。
2. 新增一張卡片：驗證卡片成功出現在本機畫面上，且頁面重新整理後卡片依然存在（由 IndexedDB 持久化）。

- [ ] **Step 2: 執行端到端瀏覽器測試**

執行：`node tests/local-first-browser.test.mjs`
預期輸出：PASS

- [ ] **Step 3: 執行全專案回歸測試**

執行：`npm test`
預期輸出：所有單元測試與端到端測試全部通過，0 errors。

- [ ] **Step 4: 提交最終整合變更並推送遠端**

```bash
git add tests/local-first-browser.test.mjs
git commit -m "test: add e2e browser test for local-first indexeddb workflow"
git push origin main
```
