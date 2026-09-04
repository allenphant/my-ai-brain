import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildCloudAutomationPayload,
    formatCloudResearchNote,
    mapCloudResearchJobToReview,
    mergeResearchReviews
} from '../cloud-research.mjs';

test('cloud automation keeps safe server-side limits and disables unknown intervals', () => {
    assert.deepEqual(buildCloudAutomationPayload('6h'), {
        enabled: true,
        interval: '6h',
        approvalMode: 'manual',
        maxJobsPerRun: 20,
        maxJobsPerDay: 50,
        monthlyBudgetCents: 500,
        maxVideoMinutesPerDay: 60
    });
    assert.equal(buildCloudAutomationPayload('off').enabled, false);
    assert.equal(buildCloudAutomationPayload('unexpected').interval, 'daily');
});

test('cloud result becomes the existing review payload and reuses matching tags', () => {
    const review = mapCloudResearchJobToReview({
        jobId: 'job-1',
        job: {
            collectionName: 'inbox',
            cardId: 'card-1',
            sourceUrl: 'https://example.com/post',
            completedAt: { seconds: 123 },
            provider: 'jina+gemini',
            result: {
                tldr: '摘要',
                verdict: '值得閱讀',
                notes: '詳細內容',
                limitations: '只讀到公開文字',
                suggestedTags: ['軟體開發', '新工具', 'tag-5wcwmz']
            }
        },
        card: {
            text: '原始標題 https://example.com/post',
            tagIds: ['existing']
        },
        tags: [{ id: 'software', name: '軟體開發' }]
    });
    assert.equal(review.sourceTitle, '原始標題');
    assert.equal(review.createdAt, 123000);
    assert.match(review.result.note, /TL;DR：摘要/);
    assert.match(review.result.note, /限制：只讀到公開文字/);
    assert.deepEqual(review.result.matchedTags, [
        { id: 'software', name: '軟體開發', isNew: false }
    ]);
    assert.deepEqual(review.result.suggestedTags, [
        { id: 'new:新工具', name: '新工具', isNew: true }
    ]);
});

test('cloud review supersedes the same local card while keeping other local reviews', () => {
    const merged = mergeResearchReviews(
        [
            { id: 'inbox/card-1', collectionName: 'inbox', itemId: 'card-1', createdAt: 1 },
            { id: 'ideas/card-2', collectionName: 'ideas', itemId: 'card-2', createdAt: 2 }
        ],
        [
            { id: 'cloud:job-1', collectionName: 'inbox', itemId: 'card-1', createdAt: 3 }
        ]
    );
    assert.deepEqual(merged.map(item => item.id), ['cloud:job-1', 'ideas/card-2']);
    assert.match(formatCloudResearchNote({ tldr: '只有摘要' }), /只有摘要/);
});
