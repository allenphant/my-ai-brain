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
    export const httpsCallable = () => (async () => ({ data: {} }));
`;

test('BYOD: Unconfigured Firebase state and settings configuration flow', async () => {
    const server = createServer(async (request, response) => {
        try {
            const requestedPath = new URL(request.url, 'http://127.0.0.1').pathname;
            const relativePath = requestedPath === '/' ? 'index.html' : requestedPath.slice(1);
            const filePath = normalize(join(root, relativePath));
            if (!filePath.startsWith(normalize(root))) throw new Error('Invalid path');
            const body = await readFile(filePath);
            response.writeHead(200, { 'Content-Type': mimeTypes[extname(filePath)] || 'application/octet-stream' });
            response.end(body);
        } catch {
            response.writeHead(404);
            response.end('Not found');
        }
    });

    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });

    const port = server.address().port;
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

        // 確保 localStorage 沒有 firebaseConfig
        await page.evaluateOnNewDocument(() => {
            localStorage.clear();
        });

        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#auth-text');

        // 1. 驗證頂部狀態為「本機儲存模式」
        const authText = await page.$eval('#auth-text', el => el.innerText);
        assert.equal(authText, '本機儲存模式');

        // 2. 驗證登入按鈕變更為「連結雲端」
        const loginBtnText = await page.$eval('#login-btn', el => el.innerText.trim());
        assert.equal(loginBtnText.includes('連結雲端'), true);

        // 3. 驗證主畫面已自動渲染 4 個本機預設分類
        await page.waitForSelector('#list-todos');
        const hasTodos = await page.$eval('#list-todos', el => Boolean(el));
        assert.equal(hasTodos, true);

        // 4. 點擊「連結雲端」按鈕應彈出設定視窗以供設定 Firebase
        await page.click('#login-btn');
        const isSettingsOpen = await page.$eval('#settings-modal', el => !el.classList.contains('hidden'));
        assert.equal(isSettingsOpen, true);

        // 5. 驗證設定視窗內的 Firebase 徽章與輸入框
        const badgeText = await page.$eval('#firebase-status-badge', el => el.innerText.trim());
        assert.equal(badgeText, '未設定');

        // 6. 驗證設定視窗具備固定底列結構與就近儲存按鈕
        const hasModalBody = await page.$eval('#settings-modal-body', el => Boolean(el && el.classList.contains('overflow-y-auto')));
        assert.equal(hasModalBody, true);
        const hasSaveFirebaseBtn = await page.$eval('#save-firebase-btn', el => Boolean(el && el.innerText.includes('儲存並連線')));
        assert.equal(hasSaveFirebaseBtn, true);

        // 7. 填入無效 Firebase 設定並點擊專屬「儲存並連線」按鈕，應在下方顯示錯誤且不關閉 Modal
        await page.$eval('#firebase-config-input', el => el.value = 'invalid json {');
        await page.click('#save-firebase-btn');
        const statusText = await page.$eval('#firebase-save-status', el => el.innerText.trim());
        assert.equal(statusText.includes('無效'), true);
        const isStillOpenAfterInlineSave = await page.$eval('#settings-modal', el => !el.classList.contains('hidden'));
        assert.equal(isStillOpenAfterInlineSave, true);

        // 8. 驗證全局「儲存設定」按鈕亦相容無效檢查
        let dialogMessage = '';
        page.once('dialog', async dialog => {
            dialogMessage = dialog.message();
            await dialog.dismiss();
        });
        await page.click('#save-settings-btn');
        assert.equal(dialogMessage.includes('無效'), true);
        const isStillOpen = await page.$eval('#settings-modal', el => !el.classList.contains('hidden'));
        assert.equal(isStillOpen, true);

        // 9. 填入有效 Firebase 設定並點擊「儲存並連線」，應成功寫入 localStorage
        const validConfig = JSON.stringify({ apiKey: "AIzaSyFakeKey12345", projectId: "fake-brain-proj" });
        await page.$eval('#firebase-config-input', (el, val) => {
            el.value = val;
            el.dispatchEvent(new Event('input'));
        }, validConfig);
        const statusClearedOnInput = await page.$eval('#firebase-save-status', el => el.innerText.trim());
        assert.equal(statusClearedOnInput, '');

        await page.click('#save-firebase-btn');
        const successStatus = await page.$eval('#firebase-save-status', el => el.innerText.trim());
        assert.equal(successStatus.includes('已儲存'), true);
        const savedInStorage = await page.evaluate(() => localStorage.getItem('firebaseConfig'));
        assert.equal(savedInStorage.includes('AIzaSyFakeKey12345'), true);

        assert.equal(pageErrors.length, 0);
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
});
