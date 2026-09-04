const STORAGE_PREFIX = 'aiResearchReviews:v1:';
const MAX_REVIEW_ITEMS = 300;

export function getResearchReviewStorageKey(userId) {
    return `${STORAGE_PREFIX}${String(userId || 'anonymous')}`;
}

function normalizeTag(tag) {
    if (!tag?.id || !tag?.name) return null;
    return {
        id: String(tag.id),
        name: String(tag.name),
        ...(tag.isNew ? { isNew: true } : {})
    };
}

function normalizeReviewItem(item) {
    if (!item?.id || !item?.itemId || !item?.collectionName || !item?.sourceText || !item?.result?.note) {
        return null;
    }
    return {
        id: String(item.id),
        itemId: String(item.itemId),
        collectionName: String(item.collectionName),
        sourceText: String(item.sourceText),
        sourceTitle: String(item.sourceTitle || ''),
        sourceUrl: String(item.sourceUrl || ''),
        cardTagIds: Array.isArray(item.cardTagIds) ? item.cardTagIds.map(String) : [],
        result: {
            note: String(item.result.note),
            matchedTags: (Array.isArray(item.result.matchedTags) ? item.result.matchedTags : []).map(normalizeTag).filter(Boolean),
            suggestedTags: (Array.isArray(item.result.suggestedTags) ? item.result.suggestedTags : []).map(normalizeTag).filter(Boolean),
            mediaNotice: String(item.result.mediaNotice || '')
        },
        createdAt: Number.isFinite(Number(item.createdAt)) ? Number(item.createdAt) : Date.now()
    };
}

export function readResearchReviews(storage, userId) {
    try {
        const parsed = JSON.parse(storage.getItem(getResearchReviewStorageKey(userId)) || '[]');
        if (!Array.isArray(parsed)) return [];
        return parsed.map(normalizeReviewItem).filter(Boolean);
    } catch {
        return [];
    }
}

export function writeResearchReviews(storage, userId, items) {
    const normalized = (Array.isArray(items) ? items : [])
        .map(normalizeReviewItem)
        .filter(Boolean)
        .slice(0, MAX_REVIEW_ITEMS);
    storage.setItem(getResearchReviewStorageKey(userId), JSON.stringify(normalized));
    return normalized;
}

export function upsertResearchReview(storage, userId, item) {
    const normalized = normalizeReviewItem(item);
    if (!normalized) throw new Error('待審核研讀結果格式不完整');
    const existing = readResearchReviews(storage, userId).filter(entry => entry.id !== normalized.id);
    return writeResearchReviews(storage, userId, [normalized, ...existing]);
}

export function removeResearchReview(storage, userId, reviewId) {
    return writeResearchReviews(
        storage,
        userId,
        readResearchReviews(storage, userId).filter(item => item.id !== String(reviewId))
    );
}
