import test from 'node:test';
import assert from 'node:assert/strict';

import {
    getCardTimestamp,
    formatTimelineTime,
    getCardPreviewText,
    buildTimelineBuckets
} from '../timeline-browser.mjs';

test('getCardTimestamp resolves numbers, date strings, Firestore timestamps, and falls back gracefully', () => {
    assert.equal(getCardTimestamp({ createdAt: 1600000000000 }), 1600000000000);
    assert.equal(getCardTimestamp({ order: 1500000000000 }), 1500000000000);
    assert.equal(getCardTimestamp({ createdAt: '2026-09-17T12:00:00.000Z' }), Date.parse('2026-09-17T12:00:00.000Z'));
    assert.equal(getCardTimestamp({ createdAt: { seconds: 1700000000, nanoseconds: 500000000 } }), 1700000000500);
    assert.equal(getCardTimestamp({ createdAt: { toDate: () => new Date('2026-09-17T08:00:00Z') } }), new Date('2026-09-17T08:00:00Z').getTime());
    assert.equal(getCardTimestamp(null), 0);
    assert.equal(getCardTimestamp({}), 0);
    assert.equal(getCardTimestamp({ createdAt: 'invalid-date' }), 0);
});

test('formatTimelineTime produces relative and date strings', () => {
    const ref = new Date('2026-09-17T15:30:00.000');
    // 當天 10:20
    const todayTs = new Date('2026-09-17T10:20:00.000').getTime();
    assert.equal(formatTimelineTime(todayTs, ref), '10:20');

    // 昨天 09:15
    const yesterdayTs = new Date('2026-09-16T09:15:00.000').getTime();
    assert.equal(formatTimelineTime(yesterdayTs, ref), '昨天 09:15');

    // 同年更早
    const earlierTs = new Date('2026-08-01T14:05:00.000').getTime();
    assert.equal(formatTimelineTime(earlierTs, ref), '8月1日 14:05');
});

test('getCardPreviewText extracts and truncates text or research summary', () => {
    assert.equal(getCardPreviewText({ text: '這是一張簡單卡片' }), '這是一張簡單卡片');
    assert.equal(getCardPreviewText({ text: 'A'.repeat(100) }), `${'A'.repeat(80)}...`);
    assert.equal(getCardPreviewText({ text: '', researchTitle: 'AI 深度報告' }), 'AI 深度報告');
    assert.equal(getCardPreviewText({ text: '', researchSummary: 'B'.repeat(100) }), `${'B'.repeat(80)}...`);
    assert.equal(getCardPreviewText({}), '無文字內容');
});

test('buildTimelineBuckets groups cards into today, yesterday, this_week, and earlier', () => {
    // 假設目前時間是 2026-09-17 (星期四) 15:00:00
    const now = new Date('2026-09-17T15:00:00.000');
    // 本週一為 2026-09-14 00:00:00
    const todayCard = { id: 'c1', text: '今日卡片', createdAt: new Date('2026-09-17T10:00:00.000').getTime() };
    const yesterdayCard = { id: 'c2', text: '昨日卡片', createdAt: new Date('2026-09-16T18:00:00.000').getTime() };
    const thisWeekCard = { id: 'c3', text: '週二卡片', createdAt: new Date('2026-09-15T09:00:00.000').getTime() };
    const earlierCard = { id: 'c4', text: '上個月卡片', createdAt: new Date('2026-08-10T12:00:00.000').getTime() };

    const categories = [
        { id: 'todos', name: '待辦事項' },
        { id: 'notes', name: '筆記區' }
    ];
    const itemsByCollection = new Map([
        ['todos', [todayCard, earlierCard]],
        ['notes', [thisWeekCard]]
    ]);
    const inboxItems = [yesterdayCard];

    const buckets = buildTimelineBuckets({
        inboxItems,
        itemsByCollection,
        categories,
        now
    });

    assert.equal(buckets.length, 4);
    assert.equal(buckets[0].id, 'today');
    assert.equal(buckets[0].items[0].id, 'c1');
    assert.equal(buckets[0].items[0].collectionName, '待辦事項');

    assert.equal(buckets[1].id, 'yesterday');
    assert.equal(buckets[1].items[0].id, 'c2');
    assert.equal(buckets[1].items[0].collectionName, '收件匣');

    assert.equal(buckets[2].id, 'this_week');
    assert.equal(buckets[2].items[0].id, 'c3');
    assert.equal(buckets[2].items[0].collectionName, '筆記區');

    assert.equal(buckets[3].id, 'earlier');
    assert.equal(buckets[3].items[0].id, 'c4');

    // 項目應依時間倒序
    assert.ok(buckets[0].items[0].timestamp > buckets[1].items[0].timestamp);
});

test('buildTimelineBuckets returns empty array when no cards exist and filters out empty buckets', () => {
    assert.deepEqual(buildTimelineBuckets({ inboxItems: [], itemsByCollection: new Map() }), []);

    const now = new Date('2026-09-17T15:00:00.000');
    const todayCard = { id: 'c1', text: '今日卡片', createdAt: new Date('2026-09-17T10:00:00.000').getTime() };
    const buckets = buildTimelineBuckets({
        inboxItems: [todayCard],
        itemsByCollection: new Map(),
        now
    });
    assert.equal(buckets.length, 1);
    assert.equal(buckets[0].id, 'today');
});
