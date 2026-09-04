import test from 'node:test';
import assert from 'node:assert/strict';

import {
    clearAutoResearchFailure,
    getAutoResearchDue,
    getAutoResearchIntervalMs,
    readAutoResearchState,
    recordAutoResearchFailure,
    selectAutoResearchCandidates,
    writeAutoResearchState
} from '../auto-research-schedule.mjs';

const storage = () => {
    const values = new Map();
    return {
        getItem: key => values.get(key) || null,
        setItem: (key, value) => values.set(key, value)
    };
};

test('schedule intervals are off by default and become due deterministically', () => {
    const now = Date.parse('2026-07-23T00:00:00Z');
    assert.equal(getAutoResearchIntervalMs('daily'), 86_400_000);
    assert.deepEqual(getAutoResearchDue({ interval: 'off', now }).enabled, false);
    assert.equal(getAutoResearchDue({ interval: 'daily', lastRunAt: now - 86_400_001, now }).due, true);
    assert.equal(getAutoResearchDue({ interval: 'daily', lastRunAt: now - 1_000, now }).due, false);
});

test('unchanged cards are isolated after three scheduled failures and edits unblock them', () => {
    let state = {};
    for (let attempt = 1; attempt <= 3; attempt += 1) {
        const result = recordAutoResearchFailure(state, {
            key: 'inbox/card-1',
            sourceText: 'https://private.example original',
            reason: '登入牆'
        });
        state = result.state;
        assert.equal(result.attempts, attempt);
        assert.equal(result.blocked, attempt === 3);
    }
    const groups = [{ id: 'inbox', items: [{ id: 'card-1', text: 'https://private.example original' }] }];
    assert.equal(selectAutoResearchCandidates(groups, state).blocked.length, 1);
    groups[0].items[0].text = 'https://public.example edited';
    assert.equal(selectAutoResearchCandidates(groups, state).runnable.length, 1);
});

test('success clears the failure ledger and state remains isolated by user', () => {
    const store = storage();
    let state = recordAutoResearchFailure({}, {
        key: 'inbox/card-1',
        sourceText: 'https://example.com'
    }).state;
    writeAutoResearchState(store, 'user-a', state);
    assert.equal(readAutoResearchState(store, 'user-a').failures['inbox/card-1'].attempts, 1);
    assert.deepEqual(readAutoResearchState(store, 'user-b').failures, {});
    state = clearAutoResearchFailure(state, 'inbox/card-1');
    assert.deepEqual(state.failures, {});
});
