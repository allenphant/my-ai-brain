import test from 'node:test';
import assert from 'node:assert/strict';

import {
    WEB_RESEARCH_CACHE_TTL_MS,
    WEB_RESEARCH_COOLDOWN_MS,
    buildWebResearchAppendData,
    canUseWebResearch,
    extractUrls,
    getWebResearchCacheKey,
    getWebResearchCooldownRemaining,
    isInteractiveCardTarget,
    readWebResearchCache,
    writeWebResearchCache
} from '../web-research.mjs';

class MemoryStorage {
    constructor() {
        this.values = new Map();
    }

    getItem(key) {
        return this.values.has(key) ? this.values.get(key) : null;
    }

    setItem(key, value) {
        this.values.set(key, String(value));
    }

    removeItem(key) {
        this.values.delete(key);
    }
}

test('web research eligibility requires exactly one unique URL', () => {
    assert.deepEqual(canUseWebResearch('沒有連結'), { ok: false, reason: 'no_url' });
    assert.deepEqual(canUseWebResearch('https://one.example'), { ok: true, reason: 'ok' });
    assert.deepEqual(
        canUseWebResearch('https://one.example 再看 https://one.example'),
        { ok: true, reason: 'ok' }
    );
    assert.deepEqual(
        canUseWebResearch('https://one.example https://two.example'),
        { ok: false, reason: 'multiple_urls' }
    );
    assert.deepEqual(extractUrls('a https://one.example\nb https://two.example'), [
        'https://one.example',
        'https://two.example'
    ]);
});

test('web research eligibility accepts 1200 characters and rejects 1201', () => {
    const url = 'https://one.example';
    const atLimit = `${url}${'x'.repeat(1200 - url.length)}`;
    const overLimit = `${atLimit}x`;

    assert.equal(canUseWebResearch(atLimit).ok, true);
    assert.deepEqual(canUseWebResearch(overLimit), { ok: false, reason: 'too_long' });
});

test('cache keys normalize surrounding and repeated whitespace', () => {
    assert.equal(
        getWebResearchCacheKey('  note   https://one.example  '),
        getWebResearchCacheKey('note https://one.example')
    );
    assert.notEqual(
        getWebResearchCacheKey('https://one.example'),
        getWebResearchCacheKey('https://two.example')
    );
});

test('cache reads valid values and removes expired, malformed, or incomplete entries', () => {
    const storage = new MemoryStorage();
    const text = 'https://one.example';
    const now = 1_800_000_000_000;

    writeWebResearchCache(storage, text, '研讀結果', now);
    assert.equal(readWebResearchCache(storage, text, now + WEB_RESEARCH_CACHE_TTL_MS), '研讀結果');

    assert.equal(readWebResearchCache(storage, text, now + WEB_RESEARCH_CACHE_TTL_MS + 1), null);
    assert.equal(storage.getItem(getWebResearchCacheKey(text)), null);

    storage.setItem(getWebResearchCacheKey(text), '{broken');
    assert.equal(readWebResearchCache(storage, text, now), null);
    assert.equal(storage.getItem(getWebResearchCacheKey(text)), null);

    storage.setItem(getWebResearchCacheKey(text), JSON.stringify({ savedAt: now }));
    assert.equal(readWebResearchCache(storage, text, now), null);
    assert.equal(storage.getItem(getWebResearchCacheKey(text)), null);
});

test('cooldown reports remaining milliseconds without going below zero', () => {
    const storage = new MemoryStorage();
    const now = 1_800_000_000_000;

    assert.equal(getWebResearchCooldownRemaining(storage, now), 0);
    storage.setItem('lastWebPolishTime', String(now - 1_000));
    assert.equal(
        getWebResearchCooldownRemaining(storage, now),
        WEB_RESEARCH_COOLDOWN_MS - 1_000
    );
    assert.equal(getWebResearchCooldownRemaining(storage, now + WEB_RESEARCH_COOLDOWN_MS), 0);
});

test('append data preserves existing metadata and blocks and escapes AI content', () => {
    const now = new Date(2026, 6, 14, 14, 30).getTime();
    const existing = {
        time: 123,
        version: '2.30.0',
        blocks: [{ type: 'paragraph', data: { text: '既有筆記' } }]
    };

    const result = buildWebResearchAppendData(existing, '<script>& "quote"\n下一行', now);

    assert.equal(result.time, 123);
    assert.equal(result.version, '2.30.0');
    assert.deepEqual(result.blocks[0], existing.blocks[0]);
    assert.deepEqual(result.blocks[1], {
        type: 'header',
        data: { text: 'AI 網址研讀｜2026/07/14 14:30', level: 2 }
    });
    assert.deepEqual(result.blocks[2], {
        type: 'paragraph',
        data: { text: '&lt;script&gt;&amp; &quot;quote&quot;<br>下一行' }
    });
    assert.equal(existing.blocks.length, 1);
});

test('append data creates a valid empty note when details do not exist', () => {
    const now = new Date(2026, 6, 14, 14, 30).getTime();
    const result = buildWebResearchAppendData(null, '研讀結果', now);

    assert.equal(result.time, now);
    assert.equal(result.blocks.length, 2);
    assert.equal(result.blocks[1].data.text, '研讀結果');
});

test('interactive card targets include anchors and buttons and their descendants', () => {
    const anchorChild = { closest: selector => selector === 'a, button, [data-card-interactive]' ? {} : null };
    const plainText = { closest: () => null };

    assert.equal(isInteractiveCardTarget(anchorChild), true);
    assert.equal(isInteractiveCardTarget(plainText), false);
    assert.equal(isInteractiveCardTarget(null), false);
});
