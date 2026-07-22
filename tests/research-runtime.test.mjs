import test from 'node:test';
import assert from 'node:assert/strict';

import {
    appendResearchLog,
    classifyResearchFailure,
    clearResearchLogs,
    parseResearchRetryAfterMs,
    readResearchLogs
} from '../research-runtime.mjs';

const classify = options => classifyResearchFailure(options);

test('dry run: expired keys, billing, retired models, and invalid requests stop or skip safely', () => {
    assert.equal(classify({ provider: 'gemini', error: { providerInfo: { status: 403, message: 'permission denied' } } }).action, 'stop');
    assert.equal(classify({ provider: 'mistral', error: { providerInfo: { status: 402, message: 'payment required' } } }).category, 'provider_billing');
    assert.equal(classify({ provider: 'mistral', error: { providerInfo: { status: 404, message: 'unknown model' } } }).category, 'provider_model');
    assert.equal(classify({ provider: 'gemini', error: { providerInfo: { status: 400, message: 'context too long' } } }).action, 'skip');
});

test('dry run: provider quota pauses the same card and transient failures have bounded retries', () => {
    const quota = classify({ provider: 'gemini', error: { providerInfo: { status: 429, isQuota: true, retryAfterMs: 21_000, message: 'quota' } } });
    assert.deepEqual([quota.action, quota.retryAfterMs], ['pause', 21_000]);
    assert.equal(classify({ provider: 'mistral', error: { providerInfo: { status: 503, message: 'unavailable' } }, attempt: 0 }).retryAfterMs, 15_000);
    assert.equal(classify({ provider: 'mistral', error: { providerInfo: { status: 503, message: 'unavailable' } }, attempt: 2 }).retryAfterMs, 180_000);
    assert.equal(classify({ provider: 'mistral', error: { providerInfo: { status: 503, message: 'unavailable' } }, attempt: 3 }).action, 'skip');
});

test('dry run: Jina anonymous/domain blocks, rate limits, network errors, and dead sources diverge correctly', () => {
    const now = Date.parse('2026-07-21T08:00:00Z');
    const anonymous = classify({ stage: 'jina', hasJinaKey: false, now, error: { jina: { status: 403, message: 'Anonymous access to domain github.com blocked until Tue Jul 21 2026 09:09:28 GMT+0000 due to abuse' } } });
    assert.deepEqual([anonymous.category, anonymous.action], ['jina_anonymous_block', 'stop']);
    assert.equal(anonymous.retryAfterMs, 4_168_000);
    assert.equal(classify({ stage: 'jina', hasJinaKey: true, error: { jina: { status: 429, message: 'Too many requests' } } }).action, 'pause');
    assert.equal(classify({ stage: 'jina', error: { jina: { status: 0, message: 'Failed to fetch' } }, attempt: 0 }).action, 'retry');
    assert.equal(classify({ stage: 'jina', error: { jina: { status: 404, message: 'Not found' } } }).action, 'skip');
});

test('dry run: browser storage and Firestore failures stop before results can be lost', () => {
    assert.equal(classify({ stage: 'storage', error: { name: 'QuotaExceededError' } }).category, 'storage_quota');
    assert.equal(classify({ stage: 'firestore', error: { code: 'permission-denied' } }).action, 'stop');
    assert.equal(classify({ stage: 'firestore', error: { code: 'unavailable' }, attempt: 0 }).action, 'retry');
});

test('retry parsing accepts seconds, durations, HTTP dates, and Jina block timestamps', () => {
    const now = Date.parse('2026-07-21T08:00:00Z');
    assert.equal(parseResearchRetryAfterMs('23', now), 23_000);
    assert.equal(parseResearchRetryAfterMs('21s', now), 21_000);
    assert.equal(parseResearchRetryAfterMs('Tue, 21 Jul 2026 09:00:00 GMT', now), 3_600_000);
    assert.equal(parseResearchRetryAfterMs('blocked until Tue Jul 21 2026 09:09:28 GMT+0000 due to abuse', now), 4_168_000);
});

test('research logs are bounded, newest-first, sanitised, and clearable', () => {
    const values = new Map();
    const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
    appendResearchLog(storage, 'user-1', { status: '失敗', detail: 'AIzaSyDefinitelySecretValue <script>', timestamp: 1 }, 2);
    appendResearchLog(storage, 'user-1', { status: '成功', sourceUrl: 'https://example.com', timestamp: 2 }, 2);
    appendResearchLog(storage, 'user-1', { status: '冷卻', timestamp: 3 }, 2);
    const logs = readResearchLogs(storage, 'user-1');
    assert.deepEqual(logs.map(log => log.timestamp), [3, 2]);
    assert.doesNotMatch(JSON.stringify(logs), /AIzaSyDefinitelySecretValue|<script>/);
    clearResearchLogs(storage, 'user-1');
    assert.deepEqual(readResearchLogs(storage, 'user-1'), []);
});
