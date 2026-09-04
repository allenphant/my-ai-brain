import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildTagUsageCounts,
    groupResearchBackfillCandidates,
    groupCardsByTagFilter,
    matchesTagFilter,
    needsResearchBackfill
} from '../tag-filter.mjs';

const inboxItems = [
    { id: 'inbox-both', text: 'AI 設計文章', tagIds: ['ai', 'design'], createdAt: 3 },
    { id: 'inbox-ai', text: 'AI 文章', tagIds: ['ai'], createdAt: 2 },
    { id: 'inbox-none', text: '未分類文章', createdAt: 1 }
];

const categories = [
    { id: 'todos', name: '待辦事項', icon: 'fas fa-check-square', type: 'todo', order: 1 },
    { id: 'bookmarks', name: '稍後閱讀', icon: 'fas fa-bookmark', type: 'bookmark', order: 2 }
];

const itemsByCollection = new Map([
    ['todos', [{ id: 'todo-design', text: '設計待辦', tagIds: ['design'], createdAt: 2 }]],
    ['bookmarks', [{ id: 'bookmark-both', text: 'AI 設計書籤', tagIds: ['ai', 'design'], createdAt: 1 }]]
]);

test('matchesTagFilter supports all and any semantics', () => {
    const both = inboxItems[0];
    const aiOnly = inboxItems[1];

    assert.equal(matchesTagFilter(both, ['ai', 'design'], 'all'), true);
    assert.equal(matchesTagFilter(aiOnly, ['ai', 'design'], 'all'), false);
    assert.equal(matchesTagFilter(aiOnly, ['ai', 'design'], 'any'), true);
    assert.equal(matchesTagFilter({ tagIds: [] }, ['ai'], 'any'), false);
});

test('no selected tags shows all tagged cards but excludes untagged cards', () => {
    assert.equal(matchesTagFilter(inboxItems[0], [], 'all'), true);
    assert.equal(matchesTagFilter(inboxItems[2], [], 'all'), false);
});

test('groupCardsByTagFilter groups matches by original collection and hides empty groups', () => {
    const allGroups = groupCardsByTagFilter({
        categories,
        inboxItems,
        itemsByCollection,
        selectedTagIds: ['ai', 'design'],
        matchMode: 'all'
    });
    assert.deepEqual(allGroups.map(group => [group.id, group.items.map(item => item.id)]), [
        ['inbox', ['inbox-both']],
        ['bookmarks', ['bookmark-both']]
    ]);

    const anyGroups = groupCardsByTagFilter({
        categories,
        inboxItems,
        itemsByCollection,
        selectedTagIds: ['ai', 'design'],
        matchMode: 'any'
    });
    assert.deepEqual(anyGroups.map(group => [group.id, group.items.map(item => item.id)]), [
        ['inbox', ['inbox-both', 'inbox-ai']],
        ['todos', ['todo-design']],
        ['bookmarks', ['bookmark-both']]
    ]);
});

test('buildTagUsageCounts counts each tag once per card across all collections', () => {
    const counts = buildTagUsageCounts({ inboxItems, itemsByCollection });
    assert.deepEqual(Object.fromEntries(counts), { ai: 3, design: 3 });
});

test('needsResearchBackfill requires one eligible URL and missing tags or research index', () => {
    assert.deepEqual(
        needsResearchBackfill({ text: '文章 https://example.com', tagIds: [], researchSearchText: '' }),
        { eligible: true, reasons: ['無 Tag', '尚未研讀'] }
    );
    assert.deepEqual(
        needsResearchBackfill({ text: '文章 https://example.com', tagIds: ['ai'], researchSearchText: '' }),
        { eligible: true, reasons: ['尚未研讀'] }
    );
    assert.deepEqual(
        needsResearchBackfill({ text: '文章 https://example.com', tagIds: [], researchSearchText: '已有內容' }),
        { eligible: true, reasons: ['無 Tag'] }
    );
    assert.equal(
        needsResearchBackfill({ text: '文章 https://example.com', tagIds: ['ai'], researchSearchText: '已有內容' }).eligible,
        false
    );
    assert.equal(needsResearchBackfill({ text: '沒有網址', tagIds: [] }).eligible, false);
});

test('groupResearchBackfillCandidates preserves original category order and reasons', () => {
    const groups = groupResearchBackfillCandidates({
        categories,
        inboxItems: [
            { id: 'inbox-needs-both', text: '文章 https://one.example', createdAt: 3 },
            { id: 'inbox-complete', text: '文章 https://two.example', tagIds: ['ai'], researchSearchText: '完成', createdAt: 2 }
        ],
        itemsByCollection: new Map([
            ['todos', [{ id: 'todo-needs-research', text: '待辦 https://todo.example', tagIds: ['design'], createdAt: 2 }]],
            ['bookmarks', [{ id: 'bookmark-no-url', text: '無網址書籤', createdAt: 1 }]]
        ])
    });

    assert.deepEqual(groups.map(group => ({
        id: group.id,
        items: group.items.map(item => ({ id: item.id, reasons: item.backfillReasons }))
    })), [
        { id: 'inbox', items: [{ id: 'inbox-needs-both', reasons: ['無 Tag', '尚未研讀'] }] },
        { id: 'todos', items: [{ id: 'todo-needs-research', reasons: ['尚未研讀'] }] }
    ]);
});
