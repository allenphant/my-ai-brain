import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildTagUsageCounts,
    groupCardsByTagFilter,
    matchesTagFilter
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
