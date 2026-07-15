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
    export const updateDoc = async (ref, data) => {
        globalThis.__mockUpdateDocWrites ||= [];
        globalThis.__mockUpdateDocWrites.push({ path: ref.path, data });
    };
    export const setDoc = async (ref, data, options) => {
        globalThis.__mockSetDocWrites ||= [];
        globalThis.__mockSetDocWrites.push({ path: ref.path, data, options });
    };
    export const getDoc = async ref => {
        if (ref.path.endsWith('/settings/tags')) {
            return { exists: () => true, data: () => ({ items: [{ id: 'ai', name: 'AI' }, { id: 'design', name: '設計' }] }) };
        }
        const cardTexts = {
            'card-1': '測試文章 https://success.example',
            'card-2': '冷卻文章 https://cooldown.example',
            'card-3': '配額文章 https://quota.example',
            'card-4': '錯誤文章 https://error.example',
            'card-5': '沒有網址的普通卡片',
            'card-6': '空回傳文章 https://empty.example',
            'card-7': '影片貼文 https://video.example'
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
        if (ref.path.endsWith('/settings/tags')) {
            queueMicrotask(() => callback({
                exists: () => true,
                data: () => ({ items: [{ id: 'ai', name: 'AI' }, { id: 'design', name: '設計' }] })
            }));
            return () => {};
        }
        let rows = [];
        if (ref.path.endsWith('/inbox')) {
            rows = [
                { id: 'card-1', data: () => ({ text: '測試文章 https://success.example', createdAt: 3 }) },
                { id: 'card-2', data: () => ({ text: '冷卻文章 https://cooldown.example', createdAt: 2 }) },
                { id: 'card-3', data: () => ({ text: '配額文章 https://quota.example', createdAt: 1 }) },
                { id: 'card-4', data: () => ({ text: '錯誤文章 https://error.example', createdAt: 0 }) },
                { id: 'card-5', data: () => ({ text: '沒有網址的普通卡片', createdAt: -1 }) },
                { id: 'card-6', data: () => ({ text: '空回傳文章 https://empty.example', createdAt: -2 }) },
                { id: 'card-7', data: () => ({ text: '影片貼文 https://video.example', createdAt: -3 }) }
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
            get: async ref => {
                if (ref.path.endsWith('/settings/tags')) {
                    return { exists: () => true, data: () => ({ items: [{ id: 'ai', name: 'AI' }, { id: 'design', name: '設計' }] }) };
                }
                if (/\\/(?:inbox|todos|bookmarks)\\/[^/]+$/.test(ref.path)) {
                    return { exists: () => true, data: () => ({ tagIds: ['ai'] }) };
                }
                return {
                    exists: () => true,
                    data: () => ({
                        data: {
                            time: 100,
                            version: '2.30.0',
                            blocks: [{ type: 'paragraph', data: { text: '既有筆記' } }]
                        }
                    })
                };
            },
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
    window.InlineCode = class {};
    window.CodeTool = class {};
    window.Delimiter = class {};
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
    let webResearchPosts = 0;
    let verificationPosts = 0;
    let jinaGets = 0;
    const jinaRequests = [];
    const requestedGeminiModels = [];
    const researchPostBodies = [];

    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', message => consoleMessages.push(`${message.type()}: ${message.text()}`));
    await page.setRequestInterception(true);
    page.on('request', async request => {
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
        if (url.startsWith('https://r.jina.ai/http')) {
            const jinaCorsHeaders = {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Max-Tokens, X-Retain-Media',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
            };
            if (request.method() === 'OPTIONS') {
                request.respond({ status: 204, headers: jinaCorsHeaders });
                return;
            }
            jinaGets += 1;
            jinaRequests.push({ url, headers: request.headers() });
            const sourceUrl = url.replace('https://r.jina.ai/', '');
            request.respond({
                status: 200,
                headers: jinaCorsHeaders,
                contentType: 'application/json',
                body: JSON.stringify({ data: {
                    title: 'Jina 擷取的公開頁面',
                    url: sourceUrl,
                    content: sourceUrl.includes('video.example')
                        ? '[Video 1](https://cdn.example/clip.mp4)'
                        : `這是由 Jina Reader 從 ${sourceUrl} 擷取的公開文字，內容足夠讓 Gemini 整理。`
                } })
            });
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
            if (request.method() === 'GET' && url.includes('/v1beta/models?')) {
                if (url.includes('key=query-race-key')) {
                    await new Promise(resolve => setTimeout(resolve, 150));
                }
                request.respond({
                    status: 200,
                    headers: corsHeaders,
                    contentType: 'application/json',
                    body: JSON.stringify({ models: [
                        { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent'] },
                        { name: 'models/gemini-2.5-flash-lite', displayName: 'Gemini 2.5 Flash-Lite', supportedGenerationMethods: ['generateContent'] },
                        { name: 'models/gemini-3.1-flash-lite', displayName: 'Gemini 3.1 Flash-Lite', supportedGenerationMethods: ['generateContent'] },
                        { name: 'models/gemini-6.0-race', displayName: 'Gemini 6 Race', supportedGenerationMethods: ['generateContent'] },
                        { name: 'models/gemini-7.0-server-error', displayName: 'Gemini 7 Server Error', supportedGenerationMethods: ['generateContent'] },
                        { name: 'models/gemini-8.0-no-search', displayName: 'Gemini 8 No Search', supportedGenerationMethods: ['generateContent'] },
                        { name: 'models/gemini-9.0-flash', displayName: 'Gemini 9 Flash', supportedGenerationMethods: ['generateContent'] },
                        { name: 'models/text-embedding-004', displayName: 'Embedding', supportedGenerationMethods: ['embedContent'] }
                    ] })
                });
                return;
            }
            geminiPosts += 1;
            const postData = request.postData() || '';
            const modelMatch = url.match(/\/models\/([^:]+):generateContent/);
            if (modelMatch) requestedGeminiModels.push(modelMatch[1]);
            if (postData.includes('只回覆「SEARCH_OK」')) {
                verificationPosts += 1;
                if (url.includes('/gemini-6.0-race:')) {
                    await new Promise(resolve => setTimeout(resolve, 150));
                }
                if (url.includes('/gemini-7.0-server-error:')) {
                    request.respond({
                        status: 500,
                        headers: corsHeaders,
                        contentType: 'application/json',
                        body: JSON.stringify({ error: { status: 'INTERNAL', message: 'Temporary server failure' } })
                    });
                    return;
                }
                if (url.includes('/gemini-3.1-flash-lite:')) {
                    request.respond({
                        status: 429,
                        headers: corsHeaders,
                        contentType: 'application/json',
                        body: JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED', message: 'Temporary quota exhausted' } })
                    });
                    return;
                }
                if (url.includes('/gemini-8.0-no-search:')) {
                    request.respond({
                        status: 400,
                        headers: corsHeaders,
                        contentType: 'application/json',
                        body: JSON.stringify({ error: { status: 'INVALID_ARGUMENT', message: 'google_search tool is not supported' } })
                    });
                    return;
                }
                request.respond({
                    status: 200,
                    headers: corsHeaders,
                    contentType: 'application/json',
                    body: JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'SEARCH_OK' }] } }] })
                });
                return;
            }
            webResearchPosts += 1;
            researchPostBodies.push(postData);
            if (postData.includes('quota.example')) {
                request.respond({
                    status: 429,
                    headers: corsHeaders,
                    contentType: 'application/json',
                    body: JSON.stringify({ error: {
                        status: 'RESOURCE_EXHAUSTED',
                        message: 'Quota exceeded',
                        details: [
                            { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] },
                            { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '21s' }
                        ]
                    } })
                });
                return;
            }
            if (postData.includes('error.example')) {
                request.respond({
                    status: 500,
                    headers: corsHeaders,
                    contentType: 'application/json',
                    body: JSON.stringify({ error: { message: 'Server failure <img src=x onerror="globalThis.__xss=true"> AIzaSyDefinitelySecretValue' } })
                });
                return;
            }
            if (postData.includes('empty.example')) {
                request.respond({
                    status: 200,
                    headers: corsHeaders,
                    contentType: 'application/json',
                    body: JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'private chain of thought' }] } }] })
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
                        content: { parts: [
                            { thought: true, text: '內部推理不得顯示' },
                            { inlineData: { mimeType: 'text/plain', data: 'ignored' } },
                            { text: JSON.stringify({
                                tldr: '這是一篇設計工具介紹。',
                                evaluation: '適合作為設計工作流程參考。',
                                details: '文章說明工具用途與適合的使用情境。',
                                matchedTagIds: ['design'],
                                suggestedTags: ['設計工具']
                            }) }
                        ] }
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
    assert.equal(await page.$$eval('.web-research-btn', elements => elements.length), 8);
    assert.equal(await page.$('li[data-id="card-5"] .web-research-btn'), null);
    assert.equal(await page.$eval('.web-research-btn', element => element.innerText.trim()), 'AI 研讀');
    await page.screenshot({ path: '/tmp/my-ai-brain-card-research.png', fullPage: false });

    await page.$eval('#settings-btn', button => button.click());
    assert.match(await page.$eval('#web-research-system-prompt', element => element.value), /TL;DR/);
    assert.deepEqual(
        await page.$$eval('#tag-manager-list input', inputs => inputs.map(input => input.value)),
        ['AI', '設計']
    );
    await page.$eval('#new-tag-input', input => { input.value = '研究'; });
    await page.click('#add-tag-btn');
    assert.equal(await page.$$eval('#tag-manager-list input', inputs => inputs.some(input => input.value === '研究')), true);
    await page.$eval('#web-research-system-prompt', input => { input.value = '自訂研讀提示：只根據來源輸出繁體中文。'; });
    await page.screenshot({ path: '/tmp/my-ai-brain-jina-settings.png', fullPage: false });
    await page.click('#verify-key-btn');
    await page.waitForFunction(() => !document.querySelector('#model-select-container').classList.contains('hidden'));
    await page.waitForFunction(() => !document.querySelector('#web-research-model-select-container').classList.contains('hidden'));
    assert.deepEqual(
        await page.$$eval('#model-select option', options => options.map(option => option.value)),
        ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-6.0-race', 'gemini-7.0-server-error', 'gemini-8.0-no-search', 'gemini-9.0-flash']
    );
    assert.deepEqual(
        await page.$$eval('#web-research-model-select option', options => options.map(option => option.value)),
        ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-6.0-race', 'gemini-7.0-server-error', 'gemini-8.0-no-search', 'gemini-9.0-flash']
    );
    assert.deepEqual(
        await page.$$eval('#web-research-candidate-select option', options => options.map(option => option.value)),
        ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-6.0-race', 'gemini-7.0-server-error', 'gemini-8.0-no-search', 'gemini-9.0-flash']
    );
    await page.click('#web-research-model-discovery summary');
    await page.select('#model-select', 'gemini-3.1-flash-lite');
    await page.select('#web-research-candidate-select', 'gemini-9.0-flash');
    await page.click('#verify-web-research-model-btn');
    await page.waitForFunction(
        () => Array.from(document.querySelectorAll('#web-research-model-select option')).some(option => option.value === 'gemini-9.0-flash'),
        { timeout: 5_000 }
    ).catch(async error => {
        console.error(JSON.stringify({
            verificationPosts,
            requestedGeminiModels,
            status: await page.$eval('#web-research-model-verification-status', element => element.textContent),
            options: await page.$$eval('#web-research-model-select option', options => options.map(option => option.value)),
            pageErrors,
            consoleMessages
        }, null, 2));
        throw error;
    });
    assert.equal(verificationPosts, 1);
    await page.select('#web-research-candidate-select', 'gemini-7.0-server-error');
    await page.click('#verify-web-research-model-btn');
    await page.waitForFunction(() => document.querySelector('#web-research-model-verification-status').textContent.includes('gemini-7.0-server-error 暫時無法驗證'));
    assert.equal(
        await page.$eval('#web-research-candidate-select', select => Array.from(select.options).some(option => option.value === 'gemini-7.0-server-error')),
        true,
        '5xx verification must leave the model retryable'
    );
    await page.select('#web-research-candidate-select', 'gemini-6.0-race');
    await page.click('#verify-web-research-model-btn');
    await page.$eval('#api-key-input', input => { input.value = 'changed-key'; });
    await page.waitForFunction(() => document.querySelector('#web-research-model-verification-status').textContent.includes('已丟棄這次測試結果'));
    assert.equal(
        await page.evaluate(() => Object.keys(localStorage).some(key => key.endsWith(':gemini-6.0-race'))),
        false,
        'a probe completed for a stale API key must not be cached'
    );
    await page.$eval('#api-key-input', input => { input.value = 'fake-key'; });
    await page.select('#web-research-candidate-select', 'gemini-3.1-flash-lite');
    await page.click('#verify-web-research-model-btn');
    await page.waitForFunction(() => document.querySelector('#web-research-model-verification-status').textContent.includes('這不代表模型不支援'));
    assert.equal(
        await page.$eval('#web-research-candidate-select', select => Array.from(select.options).some(option => option.value === 'gemini-3.1-flash-lite')),
        true,
        '429 verification must leave the model retryable'
    );
    await page.select('#web-research-candidate-select', 'gemini-8.0-no-search');
    await page.click('#verify-web-research-model-btn');
    await page.waitForFunction(() => document.querySelector('#web-research-model-verification-status').textContent.includes('明確回覆不支援'));
    assert.equal(
        await page.$eval('#web-research-candidate-select', select => Array.from(select.options).some(option => option.value === 'gemini-8.0-no-search')),
        false,
        'clear 400 unsupported response should be cached and removed from candidates'
    );
    assert.equal(verificationPosts, 5);
    assert.equal(await page.$eval('#web-research-model-select', select => Array.from(select.options).some(option => option.value === 'gemini-9.0-flash')), true);
    await page.waitForFunction(() => !document.querySelector('#verify-key-btn').disabled);
    await page.$eval('#api-key-input', input => { input.value = 'query-race-key'; });
    await page.click('#verify-key-btn');
    await page.$eval('#api-key-input', input => { input.value = 'fake-key'; });
    await page.waitForFunction(() => document.querySelector('#web-research-model-verification-status').textContent.includes('已丟棄舊 Key'));
    assert.equal(await page.$eval('#web-research-model-select', select => Array.from(select.options).some(option => option.value === 'gemini-9.0-flash')), true);
    await page.select('#web-research-model-select', 'gemini-9.0-flash');
    await page.click('#save-settings-btn');
    assert.deepEqual(await page.evaluate(() => ({
        general: localStorage.getItem('geminiModel'),
        web: localStorage.getItem('geminiWebResearchModel'),
        prompt: localStorage.getItem('webResearchSystemPrompt')
    })), {
        general: 'gemini-3.1-flash-lite',
        web: 'gemini-9.0-flash',
        prompt: '自訂研讀提示：只根據來源輸出繁體中文。'
    });
    assert.equal(
        await page.evaluate(() => (globalThis.__mockSetDocWrites || []).some(write =>
            write.path.endsWith('/settings/tags') && write.data.items.some(tag => tag.name === '研究')
        )),
        true
    );

    await page.$eval('#settings-btn', button => button.click());
    await page.$eval('#api-key-input', input => {
        input.value = 'new-unqueried-key';
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    assert.equal(await page.$eval('#model-select-container', element => element.classList.contains('hidden')), true);
    assert.equal(await page.$eval('#web-research-model-select-container', element => element.classList.contains('hidden')), true);
    await page.click('#save-settings-btn');
    assert.equal(await page.$eval('#settings-modal', element => element.classList.contains('hidden')), false);
    assert.equal(await page.evaluate(() => localStorage.getItem('geminiApiKey')), 'fake-key');
    await page.$eval('#api-key-input', input => {
        input.value = 'fake-key';
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.click('#verify-key-btn');
    await page.waitForFunction(() => !document.querySelector('#web-research-model-select-container').classList.contains('hidden'));
    assert.equal(await page.$eval('#web-research-model-select', select => select.value), 'gemini-9.0-flash');
    await page.click('#save-settings-btn');

    await page.click('li[data-id="card-1"] .web-research-btn');
    await page.waitForFunction(() => !document.querySelector('#web-research-preview-modal').classList.contains('hidden'));
    assert.match(await page.$eval('#web-research-preview-content', element => element.textContent), /^TL;DR：這是一篇設計工具介紹。/);
    assert.match(await page.$eval('#web-research-preview-content', element => element.textContent), /一句話評價：適合作為設計工作流程參考。/);
    assert.match(await page.$eval('#web-research-preview-content', element => element.textContent), /來源：https:\/\/success\.example\/$/);
    assert.deepEqual(
        await page.$$eval('#web-research-preview-tags input', inputs => inputs.map(input => ({ value: input.value, checked: input.checked }))),
        [{ value: 'design', checked: true }, { value: 'new:設計工具', checked: true }]
    );
    await page.screenshot({ path: '/tmp/my-ai-brain-jina-preview.png', fullPage: false });
    assert.equal(webResearchPosts, 1);
    assert.equal(jinaGets, 1);
    assert.match(researchPostBodies[0], /自訂研讀提示/);
    assert.match(researchPostBodies[0], /Jina Reader/);
    assert.equal(jinaRequests[0].headers.accept, 'application/json');
    assert.equal(jinaRequests[0].headers['x-retain-media'], 'link');
    assert.equal(jinaRequests[0].headers['x-max-tokens'], '5000');
    assert.equal(requestedGeminiModels.at(-1), 'gemini-9.0-flash');

    await page.click('#cancel-web-research-preview-btn');
    await page.waitForFunction(() => document.querySelector('#web-research-preview-modal').classList.contains('hidden'));
    await page.click('li[data-id="card-1"] .web-research-btn');
    await page.waitForFunction(() => !document.querySelector('#web-research-preview-modal').classList.contains('hidden'));
    assert.equal(webResearchPosts, 1, 'cache hit must not make a second Gemini POST');
    assert.equal(jinaGets, 1, 'cache hit must not make a second Jina request');
    await page.$eval('#web-research-preview-tags input[value="design"]', input => { input.checked = false; });

    await page.evaluate(() => { globalThis.__mockTransactionShouldFail = true; });
    await page.click('#append-web-research-btn');
    await page.waitForFunction(() => !document.querySelector('#append-web-research-btn').disabled);
    assert.equal(await page.$eval('#web-research-preview-modal', element => element.classList.contains('hidden')), false);
    assert.equal(await page.evaluate(() => globalThis.__mockTransactionWrites.length), 0);

    await page.evaluate(() => { globalThis.__mockTransactionShouldFail = false; });
    await page.click('#append-web-research-btn');
    await page.waitForFunction(() => document.querySelector('#web-research-preview-modal').classList.contains('hidden'));
    const writes = await page.evaluate(() => globalThis.__mockTransactionWrites);
    assert.equal(writes.length, 3);
    const noteWrite = writes.find(write => write.path.endsWith('/inbox/card-1/details/note'));
    const cardWrite = writes.find(write => write.path.endsWith('/inbox/card-1'));
    const tagWrite = writes.find(write => write.path.endsWith('/settings/tags'));
    assert.equal(noteWrite.data.data.blocks[0].data.text, '既有筆記');
    assert.match(noteWrite.data.data.blocks[1].data.text, /^AI 網址研讀｜/);
    assert.match(noteWrite.data.data.blocks[2].data.text, /^TL;DR：這是一篇設計工具介紹。/);
    assert.deepEqual(cardWrite.data.tagIds, ['ai', '設計工具']);
    assert.deepEqual(cardWrite.data.tagLabels, ['AI', '設計工具']);
    assert.match(cardWrite.data.searchText, /測試文章/);
    assert.equal(tagWrite.data.items.some(tag => tag.name === '設計工具'), true);
    assert.match(await page.$eval('li[data-id="card-1"]', element => element.innerText), /測試文章/);
    assert.doesNotMatch(await page.$eval('li[data-id="card-1"]', element => element.innerText), /AI 整理結果/);

    await page.click('li[data-id="card-2"] .web-research-btn');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('aiStatus:web') || '{}').status === '冷卻中');
    assert.equal(webResearchPosts, 1, 'cooldown must block a different uncached card');
    assert.equal(await page.$eval('#web-research-preview-modal', element => element.classList.contains('hidden')), true);

    await page.evaluate(() => localStorage.removeItem('lastWebPolishTime'));
    await page.click('li[data-id="card-3"] .web-research-btn');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('aiStatus:web') || '{}').status === '配額不足');
    assert.equal(webResearchPosts, 2);
    const quotaStatus = await page.evaluate(() => JSON.parse(localStorage.getItem('aiStatus:web')));
    assert.match(quotaStatus.detail, /gemini-9\.0-flash/);
    assert.match(quotaStatus.detail, /HTTP 429/);
    assert.match(quotaStatus.detail, /GenerateRequestsPerDayPerProjectPerModel-FreeTier/);
    assert.match(quotaStatus.detail, /21s/);
    assert.equal(await page.$eval('#web-research-preview-modal', element => element.classList.contains('hidden')), true);

    await page.evaluate(() => localStorage.removeItem('lastWebPolishTime'));
    await page.click('li[data-id="card-4"] .web-research-btn');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('aiStatus:web') || '{}').status === '失敗');
    assert.equal(webResearchPosts, 3);
    assert.equal(await page.$eval('#web-research-preview-modal', element => element.classList.contains('hidden')), true);
    assert.match(await page.$eval('li[data-id="card-4"]', element => element.innerText), /錯誤文章/);
    const genericErrorStatus = await page.evaluate(() => JSON.parse(localStorage.getItem('aiStatus:web')));
    assert.doesNotMatch(genericErrorStatus.detail, /AIzaSyDefinitelySecretValue/);
    assert.equal(await page.evaluate(() => globalThis.__xss === true), false);
    assert.equal(await page.$$eval('#toast-container img', images => images.length), 0);
    assert.equal(consoleMessages.some(message => message.includes('AIzaSyDefinitelySecretValue')), false);

    await page.evaluate(() => localStorage.removeItem('lastWebPolishTime'));
    await page.click('li[data-id="card-6"] .web-research-btn');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('aiStatus:web') || '{}').detail?.includes('parts: thought'));
    const emptyStatus = await page.evaluate(() => JSON.parse(localStorage.getItem('aiStatus:web')));
    assert.match(emptyStatus.detail, /HTTP 200/);
    assert.match(emptyStatus.detail, /finishReason: STOP/);
    assert.doesNotMatch(emptyStatus.detail, /private chain of thought/);
    assert.equal(webResearchPosts, 4);

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
    const allNoteWrites = allWrites.filter(write => write.path.endsWith('/details/note'));
    assert.equal(allNoteWrites.length, 2);
    assert.match(allNoteWrites[1].path, /bookmarks\/bookmark-1\/details\/note$/);
    assert.equal(webResearchPosts, 6);

    await page.evaluate(() => localStorage.removeItem('lastWebPolishTime'));
    await page.click('li[data-id="card-7"] .web-research-btn');
    await page.waitForFunction(() => !document.querySelector('#web-research-preview-modal').classList.contains('hidden'));
    assert.match(await page.$eval('#web-research-preview-media-notice', element => element.textContent), /影片內容未解析/);
    assert.match(await page.$eval('#web-research-preview-content', element => element.textContent), /沒有足夠文字可供研讀/);
    assert.equal(await page.$eval('#web-research-preview-tags-container', element => element.classList.contains('hidden')), true);
    assert.equal(webResearchPosts, 6, 'video-only sources must not ask Gemini to invent a summary');
    await page.click('#cancel-web-research-preview-btn');
    await page.waitForFunction(() => document.querySelector('#web-research-preview-modal').classList.contains('hidden'));

    const externalPagePromise = new Promise(resolve => browser.once('targetcreated', async target => {
        const targetPage = await target.page();
        if (targetPage) resolve(targetPage);
    }));
    await page.click('#inbox-list a[href="https://success.example/"]');
    const externalPage = await externalPagePromise;
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(await page.$eval('#editor-modal', element => element.classList.contains('hidden')), true);
    await externalPage.close();

    const getNoteWriteCount = () => page.evaluate(() =>
        (globalThis.__mockSetDocWrites || []).filter(write => write.path.endsWith('/inbox/card-1/details/note')).length
    );
    const waitForNextNoteWrite = previousCount => page.waitForFunction(
        previous => {
            const writes = (globalThis.__mockSetDocWrites || [])
                .filter(write => write.path.endsWith('/inbox/card-1/details/note'));
            return writes.length === previous + 1
                && writes.at(-1).path.endsWith('/inbox/card-1/details/note');
        },
        { timeout: 2_000 },
        previousCount
    );
    const openCardEditorAndWait = async () => {
        const previousCount = await page.evaluate(() => globalThis.__mockEditorConstructCount || 0);
        await page.click('#inbox-list li[data-id="card-1"] .leading-relaxed');
        await page.waitForFunction(() => document.body.classList.contains('editor-open'));
        await page.waitForFunction(
            previous => (globalThis.__mockEditorConstructCount || 0) === previous + 1,
            { timeout: 2_000 },
            previousCount
        );
    };

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
    const noteWritesBeforeBack = await getNoteWriteCount();
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !document.body.classList.contains('editor-open'));
    await waitForNextNoteWrite(noteWritesBeforeBack);
    await page.waitForFunction(
        expected => (globalThis.__mockUpdateDocWrites || []).some(write => write.path.endsWith('/inbox/card-1') && write.data.text === expected),
        { timeout: 2_000 },
        '返回前修改標題'
    );
    await page.waitForFunction(() => document.querySelector('#editor-modal').classList.contains('hidden'));

    await openCardEditorAndWait();
    await page.$eval('#editor-title', element => {
        element.innerText = 'Escape 前修改標題';
        element.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const noteWritesBeforeEscape = await getNoteWriteCount();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.body.classList.contains('editor-open'));
    await waitForNextNoteWrite(noteWritesBeforeEscape);
    await page.waitForFunction(
        expected => (globalThis.__mockUpdateDocWrites || []).some(write => write.path.endsWith('/inbox/card-1') && write.data.text === expected),
        { timeout: 2_000 },
        'Escape 前修改標題'
    );
    await page.waitForFunction(() => document.querySelector('#editor-modal').classList.contains('hidden'));

    await openCardEditorAndWait();
    await page.$eval('#editor-title', element => {
        element.innerText = '關閉鈕前修改標題';
        element.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const noteWritesBeforeCloseButton = await getNoteWriteCount();
    await page.click('#editor-close-btn');
    await page.waitForFunction(() => !document.body.classList.contains('editor-open'));
    await waitForNextNoteWrite(noteWritesBeforeCloseButton);
    await page.waitForFunction(
        expected => (globalThis.__mockUpdateDocWrites || []).some(write => write.path.endsWith('/inbox/card-1') && write.data.text === expected),
        { timeout: 2_000 },
        '關閉鈕前修改標題'
    );
    await page.waitForFunction(() => document.querySelector('#editor-modal').classList.contains('hidden'));

    await openCardEditorAndWait();
    await page.$eval('#editor-title', element => {
        element.innerText = 'Backdrop 前修改標題';
        element.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const noteWritesBeforeBackdrop = await getNoteWriteCount();
    await page.evaluate(() => document.querySelector('#editor-backdrop').click());
    await page.waitForFunction(() => !document.body.classList.contains('editor-open'));
    await waitForNextNoteWrite(noteWritesBeforeBackdrop);
    await page.waitForFunction(
        expected => (globalThis.__mockUpdateDocWrites || []).some(write => write.path.endsWith('/inbox/card-1') && write.data.text === expected),
        { timeout: 2_000 },
        'Backdrop 前修改標題'
    );
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
        webResearchPosts,
        verificationPosts,
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
        allClosePathsSavedPendingTitle: true,
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
