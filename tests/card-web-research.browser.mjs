import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import puppeteer from 'puppeteer';

const root = new URL('..', import.meta.url).pathname;
const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.jpg': 'image/jpeg',
    '.png': 'image/png'
};

const server = createServer(async (request, response) => {
    try {
        const requestedPath = new URL(request.url, 'http://127.0.0.1').pathname;
        const relativePath = requestedPath === '/' ? 'index.html' : requestedPath.slice(1);
        const filePath = normalize(join(root, relativePath));
        if (!filePath.startsWith(normalize(root))) throw new Error('Invalid path');
        const body = await readFile(filePath);
        response.writeHead(200, { 'Content-Type': mimeTypes[extname(filePath)] || 'application/octet-stream' });
        response.end(body);
    } catch (error) {
        response.writeHead(404);
        response.end('Not found');
    }
});

const firebaseAppModule = `
    export const initializeApp = config => ({ config });
`;

const firebaseAuthModule = `
    export const getAuth = () => ({});
    export class GoogleAuthProvider {}
    export const signInWithPopup = async () => {};
    export const signOut = async () => {};
    export const signInWithCustomToken = async () => {};
    export const onAuthStateChanged = (auth, callback) => {
        queueMicrotask(() => callback({ uid: 'test-user', displayName: '測試者' }));
        return () => {};
    };
`;

const firebaseFirestoreModule = `
    const toPath = parts => parts.map(part => typeof part === 'string' ? part : part?.path || '').filter(Boolean).join('/');
    export const getFirestore = () => ({});
    export const collection = (...parts) => ({ path: toPath(parts) });
    export const doc = (...parts) => ({ path: toPath(parts) });
    export const addDoc = async () => ({ id: 'new-id' });
    export const deleteDoc = async () => {};
    export const updateDoc = async () => {};
    export const setDoc = async (ref, data, options) => {
        globalThis.__mockSetDocWrites ||= [];
        globalThis.__mockSetDocWrites.push({ path: ref.path, data, options });
    };
    export const getDoc = async ref => {
        const cardTexts = {
            'card-1': '測試文章 https://success.example',
            'card-2': '冷卻文章 https://cooldown.example',
            'card-3': '配額文章 https://quota.example',
            'card-4': '錯誤文章 https://error.example',
            'card-5': '沒有網址的普通卡片'
        };
        const cardId = Object.keys(cardTexts).find(id => ref.path.endsWith('/inbox/' + id));
        if (cardId) {
            return { exists: () => true, data: () => ({ text: cardTexts[cardId] }) };
        }
        if (ref.path.endsWith('/todos/todo-1')) {
            return { exists: () => true, data: () => ({ text: '待辦網址 https://todo.example' }) };
        }
        if (ref.path.endsWith('/bookmarks/bookmark-1')) {
            return { exists: () => true, data: () => ({ text: '書籤網址 https://bookmark.example' }) };
        }
        if (ref.path.endsWith('/details/note')) {
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        return { exists: () => false, data: () => ({}) };
    };
    export const onSnapshot = (ref, callback) => {
        let rows = [];
        if (ref.path.endsWith('/inbox')) {
            rows = [
                { id: 'card-1', data: () => ({ text: '測試文章 https://success.example', createdAt: 3 }) },
                { id: 'card-2', data: () => ({ text: '冷卻文章 https://cooldown.example', createdAt: 2 }) },
                { id: 'card-3', data: () => ({ text: '配額文章 https://quota.example', createdAt: 1 }) },
                { id: 'card-4', data: () => ({ text: '錯誤文章 https://error.example', createdAt: 0 }) },
                { id: 'card-5', data: () => ({ text: '沒有網址的普通卡片', createdAt: -1 }) }
            ];
        } else if (ref.path.endsWith('/categories')) {
            rows = [
                { id: 'todos', data: () => ({ name: '待辦事項', icon: 'fas fa-check-square', type: 'todo', order: 1 }) },
                { id: 'bookmarks', data: () => ({ name: '稍後閱讀', icon: 'fas fa-bookmark', type: 'bookmark', order: 2 }) }
            ];
        } else if (ref.path.endsWith('/todos')) {
            rows = [{ id: 'todo-1', data: () => ({ text: '待辦網址 https://todo.example', createdAt: 1 }) }];
        } else if (ref.path.endsWith('/bookmarks')) {
            rows = [{ id: 'bookmark-1', data: () => ({ text: '書籤網址 https://bookmark.example', createdAt: 1 }) }];
        }
        queueMicrotask(() => callback({ forEach: handler => rows.forEach(handler) }));
        return () => {};
    };
    export const runTransaction = async (db, operation) => {
        globalThis.__mockTransactionWrites ||= [];
        if (globalThis.__mockTransactionShouldFail) throw new Error('Mock append failure');
        const transaction = {
            get: async () => ({
                exists: () => true,
                data: () => ({
                    data: {
                        time: 100,
                        version: '2.30.0',
                        blocks: [{ type: 'paragraph', data: { text: '既有筆記' } }]
                    }
                })
            }),
            set: (ref, data, options) => globalThis.__mockTransactionWrites.push({ path: ref.path, data, options })
        };
        return operation(transaction);
    };
`;

const browserGlobalsModule = `
    window.tailwind = { config: {} };
    window.Sortable = class { constructor() {} };
    window.EditorJS = class {
        constructor(config) {
            globalThis.__mockEditorConstructCount = (globalThis.__mockEditorConstructCount || 0) + 1;
            this.config = config;
            queueMicrotask(() => config.onReady?.());
        }
        async save() { return { time: Date.now(), blocks: [] }; }
        destroy() {}
    };
    window.Header = class {};
    window.EditorjsList = class {};
    window.Checklist = class {};
    window.Quote = class {};
    window.Marker = class {};
    window.Undo = class { constructor() {} };
`;

await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
});

const address = server.address();
const baseUrl = `http://127.0.0.1:${address.port}`;
let browser;

try {
    browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-crash-reporter']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    const pageErrors = [];
    const consoleMessages = [];
    let geminiPosts = 0;

    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', message => consoleMessages.push(`${message.type()}: ${message.text()}`));
    await page.setRequestInterception(true);
    page.on('request', request => {
        const url = request.url();
        if (url.startsWith(baseUrl)) {
            request.continue();
            return;
        }
        if (url.includes('firebase-app.js')) {
            request.respond({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'text/javascript', body: firebaseAppModule });
            return;
        }
        if (url.includes('firebase-auth.js')) {
            request.respond({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'text/javascript', body: firebaseAuthModule });
            return;
        }
        if (url.includes('firebase-firestore.js')) {
            request.respond({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'text/javascript', body: firebaseFirestoreModule });
            return;
        }
        if (url.includes('generativelanguage.googleapis.com')) {
            const corsHeaders = {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'POST, OPTIONS'
            };
            if (request.method() === 'OPTIONS') {
                request.respond({ status: 204, headers: corsHeaders });
                return;
            }
            geminiPosts += 1;
            if ((request.postData() || '').includes('quota.example')) {
                request.respond({
                    status: 429,
                    headers: corsHeaders,
                    contentType: 'application/json',
                    body: JSON.stringify({ error: { message: 'Quota exceeded 429' } })
                });
                return;
            }
            if ((request.postData() || '').includes('error.example')) {
                request.respond({
                    status: 500,
                    headers: corsHeaders,
                    contentType: 'application/json',
                    body: JSON.stringify({ error: { message: 'Server failure' } })
                });
                return;
            }
            request.respond({
                status: 200,
                headers: corsHeaders,
                contentType: 'application/json',
                body: JSON.stringify({
                    candidates: [{
                        finishReason: 'STOP',
                        content: { parts: [{ text: 'AI 整理結果\nhttps://success.example' }] }
                    }]
                })
            });
            return;
        }
        if (url === 'https://success.example/' || url.startsWith('https://success.example/?')) {
            request.respond({ status: 200, contentType: 'text/html', body: '<title>External</title>' });
            return;
        }
        if (request.resourceType() === 'script') {
            request.respond({ status: 200, contentType: 'text/javascript', body: browserGlobalsModule });
            return;
        }
        request.respond({ status: 200, body: '' });
    });

    await page.evaluateOnNewDocument(() => {
        localStorage.setItem('hasMigratedDefaultCategories', 'true');
        localStorage.setItem('geminiApiKey', 'fake-key');
        localStorage.setItem('autoSortSetting', 'off');
    });
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    try {
        await page.waitForSelector('.web-research-btn', { timeout: 10_000 });
        await page.waitForSelector('#list-todos li[data-id="todo-1"] .web-research-btn', { timeout: 10_000 });
        await page.waitForSelector('#list-bookmarks li[data-id="bookmark-1"] .web-research-btn', { timeout: 10_000 });
    } catch (error) {
        console.error(JSON.stringify({ pageErrors, consoleMessages }, null, 2));
        throw error;
    }

    assert.equal(await page.$('#polish-link-btn'), null);
    assert.equal(await page.$('#polish-add-card-btn'), null);
    assert.equal(await page.$$eval('.web-research-btn', elements => elements.length), 6);
    assert.equal(await page.$('li[data-id="card-5"] .web-research-btn'), null);
    assert.equal(await page.$eval('.web-research-btn', element => element.innerText.trim()), 'AI 研讀');
    await page.screenshot({ path: '/tmp/my-ai-brain-card-research.png', fullPage: false });

    await page.click('li[data-id="card-1"] .web-research-btn');
    await page.waitForFunction(() => !document.querySelector('#web-research-preview-modal').classList.contains('hidden'));
    assert.equal(
        await page.$eval('#web-research-preview-content', element => element.textContent),
        'AI 整理結果\nhttps://success.example'
    );
    assert.equal(geminiPosts, 1);

    await page.click('#cancel-web-research-preview-btn');
    await page.waitForFunction(() => document.querySelector('#web-research-preview-modal').classList.contains('hidden'));
    await page.click('li[data-id="card-1"] .web-research-btn');
    await page.waitForFunction(() => !document.querySelector('#web-research-preview-modal').classList.contains('hidden'));
    assert.equal(geminiPosts, 1, 'cache hit must not make a second Gemini POST');

    await page.evaluate(() => { globalThis.__mockTransactionShouldFail = true; });
    await page.click('#append-web-research-btn');
    await page.waitForFunction(() => !document.querySelector('#append-web-research-btn').disabled);
    assert.equal(await page.$eval('#web-research-preview-modal', element => element.classList.contains('hidden')), false);
    assert.equal(await page.evaluate(() => globalThis.__mockTransactionWrites.length), 0);

    await page.evaluate(() => { globalThis.__mockTransactionShouldFail = false; });
    await page.click('#append-web-research-btn');
    await page.waitForFunction(() => document.querySelector('#web-research-preview-modal').classList.contains('hidden'));
    const writes = await page.evaluate(() => globalThis.__mockTransactionWrites);
    assert.equal(writes.length, 1);
    assert.match(writes[0].path, /inbox\/card-1\/details\/note$/);
    assert.equal(writes[0].data.data.blocks[0].data.text, '既有筆記');
    assert.match(writes[0].data.data.blocks[1].data.text, /^AI 網址研讀｜/);
    assert.equal(writes[0].data.data.blocks[2].data.text, 'AI 整理結果<br>https://success.example');
    assert.match(await page.$eval('li[data-id="card-1"]', element => element.innerText), /測試文章/);
    assert.doesNotMatch(await page.$eval('li[data-id="card-1"]', element => element.innerText), /AI 整理結果/);

    await page.click('li[data-id="card-2"] .web-research-btn');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('aiStatus:web') || '{}').status === '冷卻中');
    assert.equal(geminiPosts, 1, 'cooldown must block a different uncached card');
    assert.equal(await page.$eval('#web-research-preview-modal', element => element.classList.contains('hidden')), true);

    await page.evaluate(() => localStorage.removeItem('lastWebPolishTime'));
    await page.click('li[data-id="card-3"] .web-research-btn');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('aiStatus:web') || '{}').status === '配額不足');
    assert.equal(geminiPosts, 2);
    assert.equal(await page.$eval('#web-research-preview-modal', element => element.classList.contains('hidden')), true);

    await page.evaluate(() => localStorage.removeItem('lastWebPolishTime'));
    await page.click('li[data-id="card-4"] .web-research-btn');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('aiStatus:web') || '{}').status === '失敗');
    assert.equal(geminiPosts, 3);
    assert.equal(await page.$eval('#web-research-preview-modal', element => element.classList.contains('hidden')), true);
    assert.match(await page.$eval('li[data-id="card-4"]', element => element.innerText), /錯誤文章/);

    await page.evaluate(() => localStorage.removeItem('lastWebPolishTime'));
    await page.click('#list-todos li[data-id="todo-1"] .web-research-btn');
    await page.waitForFunction(() => !document.querySelector('#web-research-preview-modal').classList.contains('hidden'));
    await page.click('#close-web-research-preview-btn');
    await page.waitForFunction(() => document.querySelector('#web-research-preview-modal').classList.contains('hidden'));

    await page.evaluate(() => localStorage.removeItem('lastWebPolishTime'));
    await page.click('#list-bookmarks li[data-id="bookmark-1"] .web-research-btn');
    await page.waitForFunction(() => !document.querySelector('#web-research-preview-modal').classList.contains('hidden'));
    await page.evaluate(() => document.querySelector('#web-research-preview-modal').click());
    await page.waitForFunction(() => document.querySelector('#web-research-preview-modal').classList.contains('hidden'));

    await page.click('#list-bookmarks li[data-id="bookmark-1"] .web-research-btn');
    await page.waitForFunction(() => !document.querySelector('#web-research-preview-modal').classList.contains('hidden'));
    await page.click('#append-web-research-btn');
    await page.waitForFunction(() => document.querySelector('#web-research-preview-modal').classList.contains('hidden'));
    const allWrites = await page.evaluate(() => globalThis.__mockTransactionWrites);
    assert.equal(allWrites.length, 2);
    assert.match(allWrites[1].path, /bookmarks\/bookmark-1\/details\/note$/);
    assert.equal(geminiPosts, 5);

    const externalPagePromise = new Promise(resolve => browser.once('targetcreated', async target => {
        const targetPage = await target.page();
        if (targetPage) resolve(targetPage);
    }));
    await page.click('#inbox-list a[href="https://success.example/"]');
    const externalPage = await externalPagePromise;
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(await page.$eval('#editor-modal', element => element.classList.contains('hidden')), true);
    await externalPage.close();

    await page.click('#inbox-list li[data-id="card-1"] .leading-relaxed');
    await page.waitForFunction(() => document.body.classList.contains('editor-open'));
    assert.match(page.url(), /[?&]editor=card-1/);
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !document.body.classList.contains('editor-open'));
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(await page.evaluate(() => globalThis.__mockEditorConstructCount || 0), 0, 'closing during note load must abort editor initialization');
    assert.equal(new URL(page.url()).search, '');

    await page.goForward({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.body.classList.contains('editor-open'));
    assert.match(page.url(), /[?&]editor=card-1/);
    await page.waitForFunction(() => (globalThis.__mockEditorConstructCount || 0) === 1);
    await page.$eval('#editor-title', element => {
        element.innerText = '返回前修改標題';
        element.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !document.body.classList.contains('editor-open'));
    await page.waitForFunction(() => (globalThis.__mockSetDocWrites || []).some(write => write.path.endsWith('/inbox/card-1/details/note')));
    await page.waitForFunction(() => document.querySelector('#editor-modal').classList.contains('hidden'));

    await page.click('#inbox-list li[data-id="card-1"] .leading-relaxed');
    await page.waitForFunction(() => document.body.classList.contains('editor-open'));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.body.classList.contains('editor-open'));
    await page.waitForFunction(() => document.querySelector('#editor-modal').classList.contains('hidden'));

    await page.click('#inbox-list li[data-id="card-1"] .leading-relaxed');
    await page.waitForFunction(() => document.body.classList.contains('editor-open'));
    await page.click('#editor-close-btn');
    await page.waitForFunction(() => !document.body.classList.contains('editor-open'));
    await page.waitForFunction(() => document.querySelector('#editor-modal').classList.contains('hidden'));

    await page.click('#inbox-list li[data-id="card-1"] .leading-relaxed');
    await page.waitForFunction(() => document.body.classList.contains('editor-open'));
    await page.evaluate(() => document.querySelector('#editor-backdrop').click());
    await page.waitForFunction(() => !document.body.classList.contains('editor-open'));
    await page.waitForFunction(() => document.querySelector('#editor-modal').classList.contains('hidden'));

    await page.click('#inbox-list li[data-id="card-1"] .leading-relaxed');
    await page.waitForFunction(() => document.body.classList.contains('editor-open'));
    await page.evaluate(() => document.querySelector('li[data-id="card-1"] .web-research-btn').click());
    await page.waitForFunction(() => !document.querySelector('#web-research-preview-modal').classList.contains('hidden'));
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#web-research-preview-modal').classList.contains('hidden'));
    assert.equal(await page.evaluate(() => document.body.classList.contains('editor-open')), true);
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !document.body.classList.contains('editor-open'));
    await page.waitForFunction(() => document.querySelector('#editor-modal').classList.contains('hidden'));

    await page.click('li[data-id="card-1"] .web-research-btn');
    await page.waitForFunction(() => !document.querySelector('#web-research-preview-modal').classList.contains('hidden'));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('#web-research-preview-modal').classList.contains('hidden'));
    assert.equal(new URL(page.url()).origin, baseUrl);

    await page.goto(`${baseUrl}?editor=card-1&col=inbox`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForFunction(() => document.body.classList.contains('editor-open'));
    assert.match(page.url(), /[?&]editor=card-1/);
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !document.body.classList.contains('editor-open'));

    assert.deepEqual(pageErrors, []);
    console.log(JSON.stringify({
        cardResearchButton: 'visible',
        geminiPosts,
        cacheHit: true,
        cooldownBlockedSecondCard: true,
        quotaErrorPreservedCard: true,
        genericErrorPreservedCard: true,
        appendFailureRetried: true,
        todoAndBookmarkRenderers: true,
        overlayCloseControls: true,
        stackedBackOrder: true,
        deepLinkOpenedEditor: true,
        backSavedPendingEditorChange: true,
        appendedBlocks: writes[0].data.data.blocks.length,
        externalLinkOpenedEditor: false,
        mobileBackClosedEditor: true,
        forwardReopenedEditor: true,
        pageErrors
    }, null, 2));
} finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
}
