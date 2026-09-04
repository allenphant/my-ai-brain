import test from 'node:test';
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
    '.json': 'application/json; charset=utf-8'
};

const browserGlobalsModule = `
    window.tailwind = { config: {} };
    window.Sortable = class { constructor() {} };
    window.EditorJS = class {
        constructor(config) {
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
    window.InlineCode = class {};
    window.CodeTool = class {};
    window.Delimiter = class {};
    window.Undo = class { constructor() {} };
`;

const firebaseAppModule = `
    export const initializeApp = config => ({ config });
`;

const firebaseAuthModule = `
    export const getAuth = () => ({});
    export class GoogleAuthProvider {}
    export const signInWithPopup = async () => {};
    export const signOut = async () => {};
    export const signInWithCustomToken = async () => {};
    export const onAuthStateChanged = (auth, callback) => (() => {});
`;

const firebaseFirestoreModule = `
    export const getFirestore = () => ({});
    export const collection = () => ({});
    export const doc = () => ({});
    export const query = () => ({});
    export const where = () => ({});
    export const addDoc = async () => ({ id: 'new-id' });
    export const deleteDoc = async () => {};
    export const updateDoc = async () => {};
    export const setDoc = async () => {};
    export const getDoc = async () => ({ exists: () => false, data: () => ({}) });
    export const onSnapshot = () => (() => {});
    export const runTransaction = async () => {};
`;

const firebaseFunctionsModule = `
    export const getFunctions = () => ({});
    export const httpsCallable = () => async () => ({ data: {} });
`;

test('E2E: Local-First IndexedDB persistence across page reloads', async () => {
    const server = createServer(async (req, res) => {
        try {
            const rawPath = req.url.split('?')[0];
            const safePath = normalize(rawPath).replace(/^(\.\.[/\\])+/, '');
            const filePath = join(root, safePath === '/' ? 'index.html' : safePath);
            const content = await readFile(filePath);
            const ext = extname(filePath);
            res.writeHead(200, {
                'Content-Type': mimeTypes[ext] || 'application/octet-stream',
                'Access-Control-Allow-Origin': '*'
            });
            res.end(content);
        } catch (e) {
            res.writeHead(404);
            res.end('Not found');
        }
    });

    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;
    const pageErrors = [];

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-crash-reporter']
    });

    try {
        const page = await browser.newPage();
        page.on('pageerror', err => pageErrors.push(err.message));
        await page.setRequestInterception(true);
        page.on('request', req => {
            const url = req.url();
            if (url.startsWith(baseUrl)) {
                req.continue();
                return;
            }
            if (url.includes('firebase-app.js')) {
                req.respond({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'text/javascript', body: firebaseAppModule });
                return;
            }
            if (url.includes('firebase-auth.js')) {
                req.respond({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'text/javascript', body: firebaseAuthModule });
                return;
            }
            if (url.includes('firebase-firestore.js')) {
                req.respond({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'text/javascript', body: firebaseFirestoreModule });
                return;
            }
            if (url.includes('firebase-functions.js')) {
                req.respond({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'text/javascript', body: firebaseFunctionsModule });
                return;
            }
            if (req.resourceType() === 'script') {
                req.respond({ status: 200, contentType: 'text/javascript', body: browserGlobalsModule });
                return;
            }
            req.respond({ status: 200, body: '' });
        });

        // 確保全新本機環境
        await page.evaluateOnNewDocument(() => {
            localStorage.clear();
        });

        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#auth-text');

        // 1. 驗證本機模式狀態列
        const authText = await page.$eval('#auth-text', el => el.innerText);
        assert.equal(authText, '本機儲存模式');

        // 2. 驗證預設分類已在 IndexedDB 中就位並渲染
        await page.waitForSelector('#list-todos');
        await page.waitForSelector('#list-learning');
        await page.waitForSelector('#list-ideas');
        await page.waitForSelector('#list-bookmarks');

        // 3. 於快速輸入框新增一張本機卡片
        await page.type('#idea-input', '這是一張本機離線卡片');
        await page.$eval('#category-select', el => el.value = 'todos');
        await page.click('#submit-btn');

        // 等待卡片出現在 todos 清單中
        await page.waitForFunction(() => {
            const list = document.querySelector('#list-todos');
            return list && list.innerText.includes('這是一張本機離線卡片');
        });

        // 4. 打勾完成此卡片
        const checkbox = await page.$('#list-todos .todo-checkbox');
        assert.ok(checkbox);
        await checkbox.click();
        await page.waitForSelector('#list-todos .todo-item-completed');

        // 5. 重新整理頁面，驗證 IndexedDB 持久化保留了卡片與完成狀態
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#list-todos');

        await page.waitForFunction(() => {
            const list = document.querySelector('#list-todos');
            return list && list.innerText.includes('這是一張本機離線卡片');
        });

        const reloadedCheckboxChecked = await page.$eval('#list-todos .todo-checkbox', el => el.checked);
        assert.equal(reloadedCheckboxChecked, true);

        // 6. 點擊卡片開啟 Editor
        await page.click('#list-todos li');
        await page.waitForSelector('#editor-modal:not(.hidden)');
        const editorTitle = await page.$eval('#editor-title', el => el.innerText);
        assert.equal(editorTitle, '這是一張本機離線卡片');

        // 關閉 Editor
        await page.click('#editor-close-btn');

        if (pageErrors.length > 0) {
            console.error('Page errors caught:', pageErrors);
        }
        assert.equal(pageErrors.length, 0);
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
});
