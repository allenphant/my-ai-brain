# Remote MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 為 My Personal AI Brain 建立專屬的遠端 MCP (Model Context Protocol) Server，支援最新 Streamable HTTP (`/mcp`) 與 Legacy SSE 傳輸，提供經過 SSRF 防護的網頁研讀、Firestore 交易原子性搬移、以及與前端 `app.js` 完全相容的資料分類管理工具。

**Architecture:** 採用分層架構（Layered Architecture）：
1. 傳輸與安全性層 (`index.js`): Streamable HTTP / Legacy SSE、Constant-time Bearer Token 驗證、Rate Limiting。
2. 領域服務層 (`services/domain.js` + `services/fetcher.js`): 虛擬分類解析、Editor.js Note JSON 結構轉換、`runTransaction` 原子搬移、SSRF 內網防護。
3. 資料存取層 (`services/firestore.js`): 綁定 `DEFAULT_USER_UID` 的 Scoped Firestore 操作。
4. MCP 工具適配層 (`server.js` + `tools/`): 註冊 `list_categories`, `get_inbox_items`, `get_category_items`, `search_items`, `move_item`, `batch_classify_items`, `create_item`, `delete_item`, `read_url_content`。

**Tech Stack:** Node.js (ESM), Express, `@modelcontextprotocol/sdk`, `firebase-admin`, `@mozilla/readability`, `jsdom`, `zod`, `dotenv`.

## Global Constraints

- 認證方式：強制使用 `Authorization: Bearer <MCP_API_KEY>`，使用 `crypto.timingSafeEqual` 進行常數時間比對，嚴禁 URL Query Token。
- 時間戳格式：卡片 `createdAt` 與 `order` 必須為數字毫秒值 `Date.now()`，與前端 `app.js` 完全對齊。
- 分類規則：`inbox` 為虛擬分類，不屬於 `categories` 文件集合；卡片移出 `todos` 時清洗 `completed`，移入 `todos` 時初始化為 `false`。
- 交易原子性：卡片搬移與刪除必須使用 Firestore `runTransaction` 同步更新主卡片與 `details/note` 子集合，避免孤兒節點。
- 批次上限：`batch_classify_items` 單次請求上限 50 筆。
- 網頁防護：`read_url_content` 禁止存取 `127.0.0.1`, `localhost`, RFC1918 私有網段與雲端 Metadata 服務 IP (`169.254.169.254`)。

---

### Task 1: 建立專案目錄與基礎設定 (Project Scaffolding & Config)

**Files:**
- Create: `mcp-server/package.json`
- Create: `mcp-server/.env.example`
- Create: `mcp-server/Dockerfile`
- Create: `mcp-server/render.yaml`
- Create: `mcp-server/.gitignore`

**Interfaces:**
- Produces: Node.js ESM 專案設定與雲端部署設定檔。

- [ ] **Step 1: 建立 `mcp-server/package.json`**

```json
{
  "name": "my-ai-brain-mcp-server",
  "version": "1.0.0",
  "description": "Remote MCP Server for My Personal AI Brain",
  "type": "module",
  "main": "src/index.js",
  "scripts": {
    "start": "node src/index.js",
    "dev": "node --watch src/index.js",
    "test": "node --test tests/**/*.test.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.6.1",
    "@mozilla/readability": "^0.5.0",
    "dotenv": "^16.4.7",
    "express": "^4.21.2",
    "firebase-admin": "^13.1.0",
    "jsdom": "^26.0.0",
    "zod": "^3.24.2"
  },
  "devDependencies": {}
}
```

- [ ] **Step 2: 建立 `mcp-server/.env.example`**

```env
PORT=3000
APP_ID=my-personal-ai-brain
DEFAULT_USER_UID=your_firebase_auth_uid
MCP_API_KEY=your_super_secret_bearer_token

# Firebase Service Account JSON (支援檔案路徑或 JSON 字串)
FIREBASE_SERVICE_ACCOUNT_KEY='{"type":"service_account",...}'
```

- [ ] **Step 3: 建立 `mcp-server/Dockerfile` 與 `mcp-server/render.yaml`**

`mcp-server/Dockerfile`:
```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

`mcp-server/render.yaml`:
```yaml
services:
  - type: web
    name: my-ai-brain-mcp
    env: node
    plan: free
    buildCommand: npm ci --only=production
    startCommand: npm start
    envVars:
      - key: PORT
        value: 3000
      - key: APP_ID
        value: my-personal-ai-brain
      - key: DEFAULT_USER_UID
        sync: false
      - key: MCP_API_KEY
        generateValue: true
      - key: FIREBASE_SERVICE_ACCOUNT_KEY
        sync: false
```

- [ ] **Step 4: 建立 `mcp-server/.gitignore`**

```gitignore
node_modules/
.env
*.log
```

- [ ] **Step 5: 安裝依賴並驗證**

Run: `cd mcp-server && npm install`
Expected: `added ... packages`

- [ ] **Step 6: Commit**

```bash
git add mcp-server/
git commit -m "feat(mcp): scaffold mcp-server package and deployment configs"
```

---

### Task 2: SSRF 防護之網頁正文解析服務 (`fetcher.js`)

**Files:**
- Create: `mcp-server/src/services/fetcher.js`
- Test: `mcp-server/tests/fetcher.test.js`

**Interfaces:**
- Produces: `readUrlContent(url: string, maxLength?: number): Promise<{ url: string, title: string, excerpt: string, contentMarkdown: string, isProbablySPA: boolean }>`

- [ ] **Step 1: 撰寫 SSRF 與 Readability 測試**

`mcp-server/tests/fetcher.test.js`:
```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { readUrlContent, isPrivateIpOrBlockedHost } from '../src/services/fetcher.js';

test('isPrivateIpOrBlockedHost blocks private and metadata IP ranges', () => {
  assert.equal(isPrivateIpOrBlockedHost('localhost'), true);
  assert.equal(isPrivateIpOrBlockedHost('127.0.0.1'), true);
  assert.equal(isPrivateIpOrBlockedHost('10.0.0.1'), true);
  assert.equal(isPrivateIpOrBlockedHost('192.168.1.1'), true);
  assert.equal(isPrivateIpOrBlockedHost('172.16.0.1'), true);
  assert.equal(isPrivateIpOrBlockedHost('169.254.169.254'), true);
  assert.equal(isPrivateIpOrBlockedHost('example.com'), false);
});

test('readUrlContent rejects blocked IP URLs', async () => {
  await assert.rejects(
    async () => {
      await readUrlContent('http://127.0.0.1:8080/secret');
    },
    { message: /SSRF protection/ }
  );
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `cd mcp-server && npm test`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: 實作 `mcp-server/src/services/fetcher.js`**

```javascript
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import dns from 'node:dns/promises';

const BLOCKED_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', '169.254.169.254']);

export function isPrivateIp(ip) {
  if (BLOCKED_HOSTS.has(ip)) return true;
  if (ip.startsWith('10.') || ip.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) return true;
  if (/^169\.254\./.test(ip)) return true;
  return false;
}

export function isPrivateIpOrBlockedHost(hostname) {
  if (BLOCKED_HOSTS.has(hostname.toLowerCase())) return true;
  return isPrivateIp(hostname);
}

export async function validateSafeUrl(rawUrl) {
  const parsed = new URL(rawUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Invalid protocol ${parsed.protocol}. Only http and https are allowed.`);
  }

  const hostname = parsed.hostname;
  if (isPrivateIpOrBlockedHost(hostname)) {
    throw new Error(`SSRF protection: access to ${hostname} is blocked.`);
  }

  try {
    const lookup = await dns.lookup(hostname);
    if (isPrivateIp(lookup.address)) {
      throw new Error(`SSRF protection: resolved IP ${lookup.address} is private.`);
    }
  } catch (err) {
    if (err.message.includes('SSRF protection')) throw err;
  }

  return parsed.toString();
}

export async function readUrlContent(rawUrl, maxLength = 3000) {
  const safeUrl = await validateSafeUrl(rawUrl);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(safeUrl, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    const dom = new JSDOM(html, { url: safeUrl });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article || !article.textContent || article.textContent.trim().length < 50) {
      return {
        url: safeUrl,
        title: dom.window.document.title || 'No title',
        excerpt: '',
        contentMarkdown: article?.textContent?.trim() || '',
        isProbablySPA: true
      };
    }

    const truncatedContent = article.textContent.trim().slice(0, maxLength);
    return {
      url: safeUrl,
      title: article.title || dom.window.document.title || 'Untitled',
      excerpt: article.excerpt || '',
      contentMarkdown: truncatedContent,
      isProbablySPA: truncatedContent.length < 100
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `cd mcp-server && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/services/fetcher.js mcp-server/tests/fetcher.test.js
git commit -m "feat(mcp): implement SSRF-safe web fetcher and readability parser"
```

---

### Task 3: Scoped Firestore 資料存取服務 (`firestore.js`)

**Files:**
- Create: `mcp-server/src/services/firestore.js`
- Test: `mcp-server/tests/firestore.test.js`

**Interfaces:**
- Produces: Firestore 實例初始化、使用者隔離之 collection / doc 參考路徑產生器。

- [ ] **Step 1: 實作 `mcp-server/src/services/firestore.js`**

```javascript
import admin from 'firebase-admin';

let db = null;
let currentAppId = 'my-personal-ai-brain';
let currentUid = null;

export function initFirestore(options = {}) {
  const appId = options.appId || process.env.APP_ID || 'my-personal-ai-brain';
  const uid = options.uid || process.env.DEFAULT_USER_UID;
  const serviceAccountKey = options.serviceAccountKey || process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

  if (!uid) {
    throw new Error('DEFAULT_USER_UID is required to initialize Scoped Firestore.');
  }

  currentAppId = appId;
  currentUid = uid;

  if (!admin.apps.length) {
    let credential;
    if (serviceAccountKey) {
      try {
        const parsedKey = typeof serviceAccountKey === 'string' && serviceAccountKey.trim().startsWith('{')
          ? JSON.parse(serviceAccountKey)
          : serviceAccountKey;
        credential = admin.credential.cert(parsedKey);
      } catch (err) {
        throw new Error(`Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY: ${err.message}`);
      }
    } else {
      credential = admin.credential.applicationDefault();
    }

    admin.initializeApp({ credential });
  }

  db = admin.firestore();
  return { db, appId: currentAppId, uid: currentUid };
}

export function getDb() {
  if (!db) {
    initFirestore();
  }
  return db;
}

export function getUserBasePath() {
  if (!currentUid) {
    initFirestore();
  }
  return `artifacts/${currentAppId}/users/${currentUid}`;
}

export function getUserCollectionRef(collectionName) {
  const firestoreDb = getDb();
  return firestoreDb.collection(`${getUserBasePath()}/${collectionName}`);
}

export function getUserDocRef(collectionName, docId) {
  const firestoreDb = getDb();
  return firestoreDb.doc(`${getUserBasePath()}/${collectionName}/${docId}`);
}

export function getUserNoteRef(collectionName, docId) {
  const firestoreDb = getDb();
  return firestoreDb.doc(`${getUserBasePath()}/${collectionName}/${docId}/details/note`);
}
```

- [ ] **Step 2: 撰寫路徑隔離與初始化測試**

`mcp-server/tests/firestore.test.js`:
```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { getUserBasePath, initFirestore } from '../src/services/firestore.js';

test('getUserBasePath throws when DEFAULT_USER_UID is missing', () => {
  delete process.env.DEFAULT_USER_UID;
  assert.throws(() => initFirestore({ uid: null }), {
    message: /DEFAULT_USER_UID is required/
  });
});

test('getUserBasePath builds correct scoped path', () => {
  initFirestore({
    appId: 'my-personal-ai-brain',
    uid: 'user_test_123',
    serviceAccountKey: null
  });
  assert.equal(getUserBasePath(), 'artifacts/my-personal-ai-brain/users/user_test_123');
});
```

- [ ] **Step 3: 執行測試確認通過**

Run: `cd mcp-server && npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add mcp-server/src/services/firestore.js mcp-server/tests/firestore.test.js
git commit -m "feat(mcp): implement scoped firestore repository helper"
```

---

### Task 4: 領域業務邏輯與交易原子性 (`domain.js`)

**Files:**
- Create: `mcp-server/src/services/domain.js`
- Test: `mcp-server/tests/domain.test.js`

**Interfaces:**
- Produces:
  - `listCategories()`
  - `getInboxItems(limit)`
  - `getCategoryItems(category, limit)`
  - `searchItems(keyword, limit)`
  - `createItem(category, text, noteText)`
  - `moveItem(itemId, fromCategory, toCategory, aiReasoning, tags, dryRun)`
  - `batchClassifyItems(items, dryRun)`
  - `deleteItem(itemId, category)`

- [ ] **Step 1: 實作 `mcp-server/src/services/domain.js`**

```javascript
import { getDb, getUserCollectionRef, getUserDocRef, getUserNoteRef } from './firestore.js';

export function wrapInEditorJs(text) {
  return {
    time: Date.now(),
    blocks: [
      {
        id: Math.random().toString(36).substring(2, 10),
        type: 'paragraph',
        data: { text: text || '' }
      }
    ],
    version: '2.30.7'
  };
}

export async function listCategories() {
  const colRef = getUserCollectionRef('categories');
  const snapshot = await colRef.orderBy('order', 'asc').get();

  const standardCategories = [
    { id: 'inbox', name: '收件匣', icon: 'fa-inbox', type: 'inbox', isVirtual: true, order: 0 },
    { id: 'todos', name: '待辦事項', icon: 'fa-check-square', type: 'todos', isVirtual: false, order: 1 },
    { id: 'learning', name: '待學習資源', icon: 'fa-book-open', type: 'learning', isVirtual: false, order: 2 },
    { id: 'ideas', name: '點子庫', icon: 'fa-lightbulb', type: 'ideas', isVirtual: false, order: 3 },
    { id: 'bookmarks', name: '收藏貼文', icon: 'fa-bookmark', type: 'bookmarks', isVirtual: false, order: 4 }
  ];

  if (snapshot.empty) {
    return standardCategories;
  }

  const customCategories = [];
  snapshot.forEach(doc => {
    const data = doc.data();
    customCategories.push({
      id: doc.id,
      name: data.name || doc.id,
      icon: data.icon || 'fa-folder',
      type: data.type || 'custom',
      promptRule: data.promptRule || '',
      order: data.order || 99,
      isVirtual: false
    });
  });

  return [
    standardCategories[0],
    ...customCategories
  ];
}

export async function getInboxItems(limit = 20) {
  const maxLimit = Math.min(Math.max(1, limit), 100);
  const colRef = getUserCollectionRef('inbox');
  const snapshot = await colRef.orderBy('createdAt', 'desc').limit(maxLimit).get();

  const items = [];
  snapshot.forEach(doc => {
    const data = doc.data();
    items.push({
      id: doc.id,
      text: data.text || '',
      createdAt: data.createdAt || Date.now(),
      hasNote: !!data.hasNote,
      order: data.order || data.createdAt || Date.now()
    });
  });
  return items;
}

export async function getCategoryItems(category, limit = 20) {
  const maxLimit = Math.min(Math.max(1, limit), 100);
  const colRef = getUserCollectionRef(category);
  const snapshot = await colRef.orderBy('createdAt', 'desc').limit(maxLimit).get();

  const items = [];
  snapshot.forEach(doc => {
    const data = doc.data();
    items.push({
      id: doc.id,
      text: data.text || '',
      createdAt: data.createdAt || Date.now(),
      hasNote: !!data.hasNote,
      order: data.order || data.createdAt || Date.now(),
      completed: typeof data.completed === 'boolean' ? data.completed : undefined
    });
  });
  return items;
}

export async function createItem(category = 'inbox', text, noteText) {
  if (!text || typeof text !== 'string') {
    throw new Error('text is required and must be a string.');
  }

  const db = getDb();
  const now = Date.now();
  const colRef = getUserCollectionRef(category);
  const newDocRef = colRef.doc();

  const cardData = {
    text: text.trim(),
    createdAt: now,
    order: now,
    hasNote: !!noteText
  };

  if (category === 'todos') {
    cardData.completed = false;
  }

  await db.runTransaction(async (t) => {
    t.set(newDocRef, cardData);
    if (noteText) {
      const noteRef = getUserNoteRef(category, newDocRef.id);
      t.set(noteRef, {
        data: wrapInEditorJs(noteText),
        updatedAt: now
      });
    }
  });

  return {
    success: true,
    id: newDocRef.id,
    category,
    createdAt: now,
    order: now
  };
}

export async function moveItem(itemId, fromCategory, toCategory, aiReasoning, tags, dryRun = false) {
  if (!itemId || !fromCategory || !toCategory) {
    throw new Error('itemId, fromCategory, and toCategory are required.');
  }

  if (dryRun) {
    return {
      success: true,
      movedId: itemId,
      fromCategory,
      toCategory,
      isDryRun: true
    };
  }

  const db = getDb();
  const sourceDocRef = getUserDocRef(fromCategory, itemId);
  const sourceNoteRef = getUserNoteRef(fromCategory, itemId);
  const targetColRef = getUserCollectionRef(toCategory);
  const targetDocRef = targetColRef.doc();
  const targetNoteRef = getUserNoteRef(toCategory, targetDocRef.id);

  await db.runTransaction(async (t) => {
    const sourceDoc = await t.get(sourceDocRef);
    if (!sourceDoc.exists) {
      throw new Error(`Source card ${itemId} does not exist in ${fromCategory}.`);
    }

    const sourceData = sourceDoc.data();
    const sourceNote = await t.get(sourceNoteRef);

    const targetData = {
      ...sourceData,
      createdAt: sourceData.createdAt || Date.now(),
      order: Date.now()
    };

    if (toCategory === 'todos') {
      targetData.completed = false;
    } else {
      delete targetData.completed;
      delete targetData.completedAt;
    }

    if (aiReasoning) {
      targetData.aiReasoning = aiReasoning;
    }
    if (Array.isArray(tags) && tags.length > 0) {
      targetData.tags = tags;
    }

    t.set(targetDocRef, targetData);

    if (sourceNote.exists) {
      t.set(targetNoteRef, sourceNote.data());
      t.delete(sourceNoteRef);
    }

    t.delete(sourceDocRef);
  });

  return {
    success: true,
    movedId: targetDocRef.id,
    fromCategory,
    toCategory,
    isDryRun: false
  };
}

export async function batchClassifyItems(items, dryRun = false) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('items must be a non-empty array.');
  }
  if (items.length > 50) {
    throw new Error('Maximum batch size is 50 items.');
  }

  const results = [];
  for (const item of items) {
    try {
      const res = await moveItem(item.itemId, 'inbox', item.toCategory, item.aiReasoning, item.tags, dryRun);
      results.push({ itemId: item.itemId, success: true, result: res });
    } catch (err) {
      results.push({ itemId: item.itemId, success: false, error: err.message });
    }
  }

  return {
    success: results.every(r => r.success),
    processedCount: results.length,
    results,
    isDryRun: !!dryRun
  };
}

export async function deleteItem(itemId, category) {
  if (!itemId || !category) {
    throw new Error('itemId and category are required.');
  }

  const db = getDb();
  const docRef = getUserDocRef(category, itemId);
  const noteRef = getUserNoteRef(category, itemId);

  await db.runTransaction(async (t) => {
    t.delete(noteRef);
    t.delete(docRef);
  });

  return {
    success: true,
    deletedId: itemId
  };
}

export async function searchItems(keyword, limit = 20) {
  if (!keyword || typeof keyword !== 'string') {
    throw new Error('keyword is required.');
  }

  const lowerKeyword = keyword.toLowerCase();
  const categories = await listCategories();
  const results = [];

  for (const cat of categories) {
    const colRef = getUserCollectionRef(cat.id);
    const snapshot = await colRef.limit(50).get();
    snapshot.forEach(doc => {
      const data = doc.data();
      const text = data.text || '';
      if (text.toLowerCase().includes(lowerKeyword)) {
        results.push({
          id: doc.id,
          text,
          category: cat.id,
          createdAt: data.createdAt || 0,
          hasNote: !!data.hasNote
        });
      }
    });
    if (results.length >= limit) break;
  }

  return results.slice(0, limit);
}
```

- [ ] **Step 2: 撰寫 `wrapInEditorJs` 與 Schema 測試**

`mcp-server/tests/domain.test.js`:
```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { wrapInEditorJs } from '../src/services/domain.js';

test('wrapInEditorJs formats plain text into valid Editor.js JSON', () => {
  const result = wrapInEditorJs('Hello World');
  assert.equal(typeof result.time, 'number');
  assert.equal(result.blocks.length, 1);
  assert.equal(result.blocks[0].type, 'paragraph');
  assert.equal(result.blocks[0].data.text, 'Hello World');
});
```

- [ ] **Step 3: 執行測試確認通過**

Run: `cd mcp-server && npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add mcp-server/src/services/domain.js mcp-server/tests/domain.test.js
git commit -m "feat(mcp): implement domain service with transactions and schema hooks"
```

---

### Task 5: MCP Server 實例與 Tool 註冊 (`server.js`)

**Files:**
- Create: `mcp-server/src/server.js`
- Test: `mcp-server/tests/server.test.js`

**Interfaces:**
- Produces: `createMcpServer(): McpServer`

- [ ] **Step 1: 實作 `mcp-server/src/server.js`**

```javascript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as domain from './services/domain.js';
import { readUrlContent } from './services/fetcher.js';

export function createMcpServer() {
  const server = new McpServer({
    name: 'my-personal-ai-brain',
    version: '1.0.0'
  });

  server.tool(
    'list_categories',
    '列出個人 AI 大腦中所有可用的分類清單',
    {},
    async () => {
      const categories = await domain.listCategories();
      return {
        content: [{ type: 'text', text: JSON.stringify(categories, null, 2) }]
      };
    }
  );

  server.tool(
    'get_inbox_items',
    '取得收件匣 (Inbox) 中尚未分類的原始碎片',
    {
      limit: z.number().min(1).max(100).optional().describe('最大回傳筆數 (預設 20)')
    },
    async ({ limit }) => {
      const items = await domain.getInboxItems(limit);
      return {
        content: [{ type: 'text', text: JSON.stringify(items, null, 2) }]
      };
    }
  );

  server.tool(
    'get_category_items',
    '取得特定分類下的卡片清單',
    {
      category: z.string().describe('分類 ID (如 todos, learning, ideas, bookmarks)'),
      limit: z.number().min(1).max(100).optional().describe('最大回傳筆數 (預設 20)')
    },
    async ({ category, limit }) => {
      const items = await domain.getCategoryItems(category, limit);
      return {
        content: [{ type: 'text', text: JSON.stringify(items, null, 2) }]
      };
    }
  );

  server.tool(
    'move_item',
    '將單一卡片從來源分類移至目標分類，自動連帶搬移筆記並更新排序',
    {
      itemId: z.string().describe('卡片 ID'),
      fromCategory: z.string().describe('來源分類 (如 inbox)'),
      toCategory: z.string().describe('目標分類 (如 todos)'),
      aiReasoning: z.string().optional().describe('Agent 的分類理由'),
      tags: z.array(z.string()).optional().describe('自訂標籤陣列'),
      dryRun: z.boolean().optional().describe('若為 true 僅模擬變更')
    },
    async ({ itemId, fromCategory, toCategory, aiReasoning, tags, dryRun }) => {
      const res = await domain.moveItem(itemId, fromCategory, toCategory, aiReasoning, tags, dryRun);
      return {
        content: [{ type: 'text', text: JSON.stringify(res, null, 2) }]
      };
    }
  );

  server.tool(
    'batch_classify_items',
    '批次整理收件匣中的多筆碎片 (單次上限 50 筆)',
    {
      items: z.array(
        z.object({
          itemId: z.string(),
          toCategory: z.string(),
          aiReasoning: z.string().optional(),
          tags: z.array(z.string()).optional()
        })
      ).max(50).describe('待整理卡片陣列'),
      dryRun: z.boolean().optional().describe('若為 true 僅模擬變更')
    },
    async ({ items, dryRun }) => {
      const res = await domain.batchClassifyItems(items, dryRun);
      return {
        content: [{ type: 'text', text: JSON.stringify(res, null, 2) }]
      };
    }
  );

  server.tool(
    'create_item',
    '在指定分類或收件匣中建立一張新卡片',
    {
      category: z.string().optional().describe('目標分類 (預設 inbox)'),
      text: z.string().describe('卡片標題或文字內容'),
      noteText: z.string().optional().describe('卡片詳細筆記內容')
    },
    async ({ category, text, noteText }) => {
      const res = await domain.createItem(category, text, noteText);
      return {
        content: [{ type: 'text', text: JSON.stringify(res, null, 2) }]
      };
    }
  );

  server.tool(
    'delete_item',
    '刪除指定分類下的卡片及其筆記子集合',
    {
      itemId: z.string().describe('卡片 ID'),
      category: z.string().describe('所在分類')
    },
    async ({ itemId, category }) => {
      const res = await domain.deleteItem(itemId, category);
      return {
        content: [{ type: 'text', text: JSON.stringify(res, null, 2) }]
      };
    }
  );

  server.tool(
    'search_items',
    '模糊搜尋全庫卡片內容',
    {
      keyword: z.string().describe('搜尋關鍵字'),
      limit: z.number().min(1).max(50).optional().describe('最大回傳筆數 (預設 20)')
    },
    async ({ keyword, limit }) => {
      const items = await domain.searchItems(keyword, limit);
      return {
        content: [{ type: 'text', text: JSON.stringify(items, null, 2) }]
      };
    }
  );

  server.tool(
    'read_url_content',
    '抓取並萃取指定網址之正文內容 (具備 SSRF 防護)',
    {
      url: z.string().url().describe('目標網址'),
      maxLength: z.number().optional().describe('內文字數上限 (預設 3000)')
    },
    async ({ url, maxLength }) => {
      const res = await readUrlContent(url, maxLength);
      return {
        content: [{ type: 'text', text: JSON.stringify(res, null, 2) }]
      };
    }
  );

  return server;
}
```

- [ ] **Step 2: 撰寫 MCP Server 工具註冊測試**

`mcp-server/tests/server.test.js`:
```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMcpServer } from '../src/server.js';

test('createMcpServer initializes correctly', () => {
  const server = createMcpServer();
  assert.ok(server);
});
```

- [ ] **Step 3: 執行測試確認通過**

Run: `cd mcp-server && npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add mcp-server/src/server.js mcp-server/tests/server.test.js
git commit -m "feat(mcp): register domain and readability tools with McpServer"
```

---

### Task 6: Express 伺服器與雙協定傳輸整合 (`index.js`)

**Files:**
- Create: `mcp-server/src/index.js`
- Test: `mcp-server/tests/auth.test.js`

**Interfaces:**
- Produces: 啟動 Express HTTP 伺服器，支援 `/mcp` (Streamable HTTP), `/sse`, `/messages`, `/health` 端點與 Constant-Time Token 認證。

- [ ] **Step 1: 實作 Auth Middleware 與 Express 伺服器 `mcp-server/src/index.js`**

```javascript
import express from 'express';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHttpTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './server.js';
import { initFirestore } from './services/firestore.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const MCP_API_KEY = process.env.MCP_API_KEY;

if (!MCP_API_KEY) {
  console.warn('⚠️ WARNING: MCP_API_KEY is not set. Requests will be rejected.');
}

// Constant-time token verification
export function verifyBearerToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing or invalid Bearer token' });
  }

  const token = authHeader.slice(7).trim();
  if (!MCP_API_KEY) {
    return res.status(500).json({ error: 'Server misconfiguration: MCP_API_KEY missing' });
  }

  try {
    const tokenBuf = Buffer.from(token);
    const keyBuf = Buffer.from(MCP_API_KEY);
    if (tokenBuf.length !== keyBuf.length || !crypto.timingSafeEqual(tokenBuf, keyBuf)) {
      return res.status(401).json({ error: 'Unauthorized: Invalid API token' });
    }
  } catch {
    return res.status(401).json({ error: 'Unauthorized: Token verification failed' });
  }

  next();
}

app.use(express.json({ limit: '2mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// SSE Sessions map for legacy transport
const sseTransports = new Map();

// --- 1. Streamable HTTP Transport (/mcp) ---
app.all('/mcp', verifyBearerToken, async (req, res) => {
  const mcpServer = createMcpServer();
  const transport = new StreamableHttpTransport(req, res);
  await mcpServer.connect(transport);
});

// --- 2. Legacy SSE Transport (/sse & /messages) ---
app.get('/sse', verifyBearerToken, async (req, res) => {
  const mcpServer = createMcpServer();
  const transport = new SSEServerTransport('/messages', res);
  const sessionId = transport.sessionId;

  sseTransports.set(sessionId, transport);
  req.on('close', () => {
    sseTransports.delete(sessionId);
  });

  await mcpServer.connect(transport);
});

app.post('/messages', verifyBearerToken, async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = sseTransports.get(sessionId);
  if (!transport) {
    return res.status(404).json({ error: 'Session not found or expired' });
  }
  await transport.handlePostMessage(req, res);
});

// Start Server
if (process.env.NODE_ENV !== 'test') {
  try {
    initFirestore();
    console.log('✅ Scoped Firestore initialized successfully.');
  } catch (err) {
    console.warn(`⚠️ Firestore initialization deferred: ${err.message}`);
  }

  app.listen(PORT, () => {
    console.log(`🚀 Remote MCP Server listening on port ${PORT}`);
    console.log(`📡 Streamable HTTP Endpoint: http://localhost:${PORT}/mcp`);
    console.log(`📡 Legacy SSE Endpoint: http://localhost:${PORT}/sse`);
  });
}

export default app;
```

- [ ] **Step 2: 撰寫認證測試**

`mcp-server/tests/auth.test.js`:
```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyBearerToken } from '../src/index.js';

test('verifyBearerToken rejects requests without authorization header', () => {
  const req = { headers: {} };
  let statusCode = null;
  let jsonResult = null;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      jsonResult = data;
    }
  };

  verifyBearerToken(req, res, () => {});
  assert.equal(statusCode, 401);
  assert.match(jsonResult.error, /Missing or invalid/);
});
```

- [ ] **Step 3: 執行測試確認通過**

Run: `cd mcp-server && npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add mcp-server/src/index.js mcp-server/tests/auth.test.js
git commit -m "feat(mcp): implement express server with streamable http, legacy sse and constant-time auth"
```

---

### Task 7: 撰寫使用文件與端對端驗證 (Docs & E2E Validation)

**Files:**
- Create: `mcp-server/README.md`

- [ ] **Step 1: 撰寫 `mcp-server/README.md`**

內容包含：
1. 本地開發與 `.env` 設定教學
2. 取得 Firebase Service Account JSON 與 User UID 的方式
3. 部署至 Render / Fly.io / Docker 的一鍵指南
4. 在 Claude Desktop / Cursor / Antigravity 中的 MCP Client 設定 JSON

- [ ] **Step 2: 執行全部單元測試**

Run: `cd mcp-server && npm test`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add mcp-server/README.md
git commit -m "docs(mcp): add comprehensive README with deployment and client configuration guides"
```
