import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { groupCardsBySearch } from '../card-search.mjs';

const categories = [
    { id: 'projects', name: '專案', icon: 'fas fa-code', type: 'text' },
    { id: 'todos', name: '待辦', icon: 'fas fa-check-square', type: 'todo' }
];
const itemsByCollection = new Map([
    ['projects', [
        {
            id: 'project-1',
            text: 'System Design Primer',
            cardSearchText: 'system design primer',
            researchSearchText: '分散式系統與可擴展架構',
            tagIds: ['software'],
            createdAt: 10
        }
    ]],
    ['todos', [
        { id: 'todo-1', text: '準備面試', tagIds: ['interview'], completed: false, createdAt: 20 }
    ]]
]);
const tags = [
    { id: 'software', name: '軟體開發' },
    { id: 'interview', name: '面試準備' }
];

test('search groups results by original category and matches title, research, and tags', () => {
    assert.deepEqual(
        groupCardsBySearch({ categories, itemsByCollection, tags, query: 'system' })
            .map(group => [group.id, group.items.map(item => item.id)]),
        [['projects', ['project-1']]]
    );
    assert.deepEqual(
        groupCardsBySearch({ categories, itemsByCollection, tags, query: '分散式 架構' })[0]
            .items[0].searchMatchTypes,
        ['research']
    );
    assert.deepEqual(
        groupCardsBySearch({ categories, itemsByCollection, tags, query: '面試準備' })[0]
            .items[0].searchMatchTypes,
        ['tag']
    );
});

test('search is case-insensitive, requires every term, and returns no default flood', () => {
    assert.equal(groupCardsBySearch({ categories, itemsByCollection, tags, query: '' }).length, 0);
    assert.equal(
        groupCardsBySearch({ categories, itemsByCollection, tags, query: 'SYSTEM 軟體' })[0].items[0].id,
        'project-1'
    );
    assert.equal(
        groupCardsBySearch({ categories, itemsByCollection, tags, query: 'system 不存在' }).length,
        0
    );
});

test('higher title relevance ranks ahead of research-only matches', () => {
    const groups = groupCardsBySearch({
        inboxItems: [
            { id: 'research', text: '普通卡片', researchSearchText: 'alpha 說明', createdAt: 30 },
            { id: 'title', text: 'Alpha 專案', researchSearchText: '', createdAt: 10 }
        ],
        query: 'alpha'
    });
    assert.deepEqual(groups[0].items.map(item => item.id), ['title', 'research']);
    assert.match(groups[0].items[1].searchSnippet, /alpha/i);
});

test('production markup exposes the accessible global search and visible Mistral key entry', async () => {
    const [html, appSource] = await Promise.all([
        readFile(new URL('../index.html', import.meta.url), 'utf8'),
        readFile(new URL('../app.js', import.meta.url), 'utf8')
    ]);
    assert.match(html, /id="global-search-btn"/);
    assert.match(html, /id="global-search-modal"[^>]+role="dialog"/);
    assert.match(html, /id="global-search-input"/);
    assert.match(html, /id="mistral-settings-container"/);
    assert.match(html, /id="save-gemini-key-btn"/);
    assert.match(html, /id="save-mistral-key-btn"/);
    assert.match(html, /id="save-jina-key-btn"/);
    assert.match(html, /id="mistral-key-save-status"[^>]+aria-live="polite"/);
    assert.match(appSource, /groupCardsBySearch/);
    assert.match(appSource, /localStorage\.setItem\(config\.storageKey, value\)/);
    assert.match(appSource, /history\.pushState\(\{ overlay: 'global-search'/);
    assert.match(appSource, /getElementById\('mistral-settings-container'\)\.classList\.remove\('hidden'\)/);
});

test('search matches card ID and prioritizes exact ID match with highest rank', () => {
    const groups = groupCardsBySearch({
        inboxItems: [
            { id: 'card-abc-123', text: '普通說明內容', researchSearchText: '', createdAt: 10 },
            { id: 'card-xyz-999', text: '其他文字內容', researchSearchText: '', createdAt: 20 }
        ],
        query: 'card-abc-123'
    });
    assert.equal(groups.length, 1);
    assert.equal(groups[0].items.length, 1);
    assert.equal(groups[0].items[0].id, 'card-abc-123');
    assert.ok(groups[0].items[0].searchMatchTypes.includes('id'));
});

test('search matches card ID case-insensitively and partial prefix ID', () => {
    const groups = groupCardsBySearch({
        inboxItems: [
            { id: '9mYE5sLe5Xav7Z3cRop2', text: '粒子動畫網頁prompt', createdAt: 10 }
        ],
        query: '9mye5sle'
    });
    assert.equal(groups.length, 1);
    assert.equal(groups[0].items.length, 1);
    assert.equal(groups[0].items[0].id, '9mYE5sLe5Xav7Z3cRop2');
    assert.ok(groups[0].items[0].searchMatchTypes.includes('id'));
});
