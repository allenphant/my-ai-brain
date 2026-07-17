import test from 'node:test';
import assert from 'node:assert/strict';
import {
    getResearchReviewStorageKey,
    readResearchReviews,
    removeResearchReview,
    upsertResearchReview
} from '../research-review.mjs';

function createStorage() {
    const values = new Map();
    return {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, String(value))
    };
}

const review = {
    id: 'inbox/card-1',
    itemId: 'card-1',
    collectionName: 'inbox',
    sourceText: 'https://example.com',
    cardTagIds: ['existing'],
    result: {
        note: 'TL;DR：測試',
        matchedTags: [{ id: 'existing', name: '既有' }],
        suggestedTags: [{ id: 'new:工具', name: '工具', isNew: true }]
    },
    createdAt: 123
};

test('research reviews persist per user and survive malformed storage', () => {
    const storage = createStorage();
    assert.match(getResearchReviewStorageKey('user-a'), /user-a$/);
    assert.deepEqual(readResearchReviews(storage, 'user-a'), []);
    storage.setItem(getResearchReviewStorageKey('user-a'), '{bad json');
    assert.deepEqual(readResearchReviews(storage, 'user-a'), []);
    const saved = upsertResearchReview(storage, 'user-a', review);
    assert.equal(saved.length, 1);
    assert.deepEqual(readResearchReviews(storage, 'user-b'), []);
    assert.equal(readResearchReviews(storage, 'user-a')[0].result.suggestedTags[0].isNew, true);
});

test('upsert replaces the same card and remove clears only the selected review', () => {
    const storage = createStorage();
    upsertResearchReview(storage, 'user-a', review);
    upsertResearchReview(storage, 'user-a', {
        ...review,
        result: { ...review.result, note: '新版結果' },
        createdAt: 456
    });
    upsertResearchReview(storage, 'user-a', {
        ...review,
        id: 'ideas/card-2',
        itemId: 'card-2',
        collectionName: 'ideas'
    });
    assert.equal(readResearchReviews(storage, 'user-a').length, 2);
    assert.equal(readResearchReviews(storage, 'user-a')[1].result.note, '新版結果');
    const remaining = removeResearchReview(storage, 'user-a', 'inbox/card-1');
    assert.deepEqual(remaining.map(item => item.id), ['ideas/card-2']);
});
