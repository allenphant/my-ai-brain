import test from 'node:test';
import assert from 'node:assert/strict';

import {
    getTodayDateString,
    hashString,
    pickCandidate,
    selectDailySparks
} from '../daily-sparks.mjs';

test('getTodayDateString produces YYYY-MM-DD', () => {
    const d = new Date(2026, 8, 17); // 2026-09-17
    assert.equal(getTodayDateString(d), '2026-09-17');
});

test('hashString and pickCandidate are deterministic for same seed', () => {
    const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const pick1 = pickCandidate(list, '2026-09-17:todos:0');
    const pick2 = pickCandidate(list, '2026-09-17:todos:0');
    assert.equal(pick1.id, pick2.id);

    // 不同的 seed 或 offset 運作正常
    const pickOther = pickCandidate(list, '2026-09-17:todos:1');
    assert.ok(pickOther);
});

test('selectDailySparks track 1 selects stale uncompleted todos (>3 days) and falls back safely', () => {
    const now = new Date('2026-09-17T12:00:00.000Z').getTime();
    const fourDaysAgo = now - (4 * 86400000);
    const oneDayAgo = now - (1 * 86400000);

    const categories = [{ id: 'todos', name: '待辦事項', type: 'todo' }];
    const itemsByCollection = new Map([
        ['todos', [
            { id: 'todo-stale', text: '報稅', completed: false, createdAt: fourDaysAgo },
            { id: 'todo-recent', text: '買牛奶', completed: false, createdAt: oneDayAgo },
            { id: 'todo-done', text: '繳電話費', completed: true, createdAt: fourDaysAgo }
        ]]
    ]);

    const result = selectDailySparks({
        itemsByCollection,
        categories,
        now,
        dateStr: '2026-09-17'
    });

    const todoTrack = result.tracks.find(t => t.trackId === 'todos');
    assert.equal(todoTrack.status, 'ready');
    assert.equal(todoTrack.item.id, 'todo-stale');
    assert.equal(todoTrack.daysAgo, 4);

    // 若將 stale 的待辦標記為已完成，只剩 recent，應進入 fallback
    const itemsRecentOnly = new Map([
        ['todos', [
            { id: 'todo-recent', text: '買牛奶', completed: false, createdAt: oneDayAgo },
            { id: 'todo-done', text: '報稅', completed: true, createdAt: fourDaysAgo }
        ]]
    ]);
    const resultFallback = selectDailySparks({
        itemsByCollection: itemsRecentOnly,
        categories,
        now,
        dateStr: '2026-09-17'
    });
    const todoFallbackTrack = resultFallback.tracks.find(t => t.trackId === 'todos');
    assert.equal(todoFallbackTrack.status, 'fallback');
    assert.equal(todoFallbackTrack.item.id, 'todo-recent');

    // 若全部完成，應回傳 all_completed
    const itemsAllDone = new Map([
        ['todos', [
            { id: 'todo-done', text: '報稅', completed: true, createdAt: fourDaysAgo }
        ]]
    ]);
    const resultAllDone = selectDailySparks({
        itemsByCollection: itemsAllDone,
        categories,
        now,
        dateStr: '2026-09-17'
    });
    const todoAllDoneTrack = resultAllDone.tracks.find(t => t.trackId === 'todos');
    assert.equal(todoAllDoneTrack.status, 'all_completed');
    assert.equal(todoAllDoneTrack.item, null);
});

test('selectDailySparks track 2 prioritizes mature learning cards (>14 days) or cards with research TL;DR', () => {
    const now = new Date('2026-09-17T12:00:00.000Z').getTime();
    const twentyDaysAgo = now - (20 * 86400000);
    const twoDaysAgo = now - (2 * 86400000);

    const categories = [{ id: 'learning', name: '學習筆記', type: 'text' }];
    const itemsByCollection = new Map([
        ['learning', [
            { id: 'learn-old', text: 'GraphQL Schema 設計', createdAt: twentyDaysAgo, researchTldr: 'GraphQL 設計重點' },
            { id: 'learn-new', text: 'Vue 3 Composition API', createdAt: twoDaysAgo }
        ]]
    ]);

    const result = selectDailySparks({
        itemsByCollection,
        categories,
        now,
        dateStr: '2026-09-17'
    });

    const memoryTrack = result.tracks.find(t => t.trackId === 'memory');
    assert.equal(memoryTrack.status, 'ready');
    assert.equal(memoryTrack.item.id, 'learn-old');
    assert.equal(memoryTrack.daysAgo, 20);
});

test('selectDailySparks track 3 selects from bookmarks/ideas and supports offset cycling', () => {
    const now = new Date('2026-09-17T12:00:00.000Z').getTime();
    const categories = [
        { id: 'bookmarks', name: '稍後閱讀', type: 'bookmark' },
        { id: 'ideas', name: '靈感與想法', type: 'text' }
    ];
    const itemsByCollection = new Map([
        ['bookmarks', [
            { id: 'bm-1', text: 'https://example.com/article1', createdAt: now }
        ]],
        ['ideas', [
            { id: 'idea-1', text: '做一個自動摘要外掛', createdAt: now }
        ]]
    ]);

    const res0 = selectDailySparks({
        itemsByCollection,
        categories,
        dateStr: '2026-09-17',
        offsets: { sparks: 0 },
        now
    });
    const sparksTrack0 = res0.tracks.find(t => t.trackId === 'sparks');
    assert.equal(sparksTrack0.status, 'ready');
    assert.ok(sparksTrack0.item.id === 'bm-1' || sparksTrack0.item.id === 'idea-1');

    const res1 = selectDailySparks({
        itemsByCollection,
        categories,
        dateStr: '2026-09-17',
        offsets: { sparks: 1 },
        now
    });
    const sparksTrack1 = res1.tracks.find(t => t.trackId === 'sparks');
    assert.ok(sparksTrack1.item);
});

test('selectDailySparks handles completely empty database gracefully without throwing', () => {
    const result = selectDailySparks({
        inboxItems: [],
        itemsByCollection: new Map(),
        categories: []
    });

    assert.equal(result.tracks.length, 3);
    result.tracks.forEach(track => {
        assert.equal(track.item, null);
        assert.ok(track.emptyMessage.length > 0);
    });
});
