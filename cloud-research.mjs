const CLOUD_RESEARCH_INTERVALS = new Set(['6h', '12h', 'daily', '3d', 'weekly']);

function normalizeText(value) {
    return String(value || '').trim();
}

function timestampToMillis(value) {
    if (typeof value?.toMillis === 'function') return value.toMillis();
    if (Number.isFinite(value?.seconds)) return value.seconds * 1000;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : Date.now();
}

function uniqueBy(items, keyFn) {
    const seen = new Set();
    return items.filter(item => {
        const key = keyFn(item);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

export function buildCloudAutomationPayload(interval, { approvalMode = 'manual' } = {}) {
    const normalizedInterval = CLOUD_RESEARCH_INTERVALS.has(interval) ? interval : 'daily';
    return {
        enabled: CLOUD_RESEARCH_INTERVALS.has(interval),
        interval: normalizedInterval,
        approvalMode: approvalMode === 'auto' ? 'auto' : 'manual',
        maxJobsPerRun: 20,
        maxJobsPerDay: 50,
        monthlyBudgetCents: 500,
        maxVideoMinutesPerDay: 60
    };
}

export function formatCloudResearchNote(result = {}) {
    const sections = [];
    const tldr = normalizeText(result.tldr);
    const verdict = normalizeText(result.verdict);
    const notes = normalizeText(result.notes);
    const limitations = normalizeText(result.limitations);
    const sourceUrl = normalizeText(result.sourceUrl);
    if (tldr) sections.push(`TL;DR：${tldr}`);
    if (verdict) sections.push(`一句話評價：${verdict}`);
    if (notes) sections.push(notes);
    if (limitations) sections.push(`限制：${limitations}`);
    if (sourceUrl) sections.push(`來源：${sourceUrl}`);
    return sections.join('\n\n').trim() || '雲端研讀沒有回傳可用內容。';
}

export function mapCloudResearchJobToReview({ jobId, job = {}, card = {}, tags = [] }) {
    const catalog = (Array.isArray(tags) ? tags : [])
        .map(tag => ({ id: normalizeText(tag?.id), name: normalizeText(tag?.name) }))
        .filter(tag => tag.id && tag.name);
    const catalogByName = new Map(
        catalog.map(tag => [tag.name.toLocaleLowerCase('zh-Hant'), tag])
    );
    const tagNames = uniqueBy(
        (Array.isArray(job.result?.suggestedTags) ? job.result.suggestedTags : [])
            .map(normalizeText)
            .filter(Boolean)
            .filter(name => !/^tag-[a-z0-9]{5,}(?:-\d+)?$/i.test(name)),
        name => name.toLocaleLowerCase('zh-Hant')
    );
    const matchedTags = [];
    const suggestedTags = [];
    tagNames.forEach(name => {
        const existing = catalogByName.get(name.toLocaleLowerCase('zh-Hant'));
        if (existing) matchedTags.push({ ...existing, isNew: false });
        else suggestedTags.push({ id: `new:${name}`, name, isNew: true });
    });
    const sourceText = normalizeText(card.text) || normalizeText(job.sourceUrl);
    const titleWithoutUrl = sourceText
        .replace(/https?:\/\/[^\s<>"'`）)】\]]+/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    return {
        id: `cloud:${jobId}`,
        cloudManaged: true,
        cloudJobId: jobId,
        itemId: normalizeText(job.cardId),
        collectionName: normalizeText(job.collectionName),
        sourceText,
        sourceTitle: titleWithoutUrl || normalizeText(job.sourceUrl) || '雲端研讀結果',
        sourceUrl: normalizeText(job.sourceUrl),
        cardTagIds: Array.isArray(card.tagIds) ? card.tagIds : [],
        result: {
            note: formatCloudResearchNote(job.result),
            matchedTags,
            suggestedTags,
            mediaNotice: normalizeText(job.result?.limitations)
        },
        provider: normalizeText(job.provider),
        createdAt: timestampToMillis(job.completedAt || job.createdAt)
    };
}

export function mergeResearchReviews(localReviews = [], cloudReviews = []) {
    const cloudCardKeys = new Set(
        cloudReviews.map(review => `${review.collectionName}/${review.itemId}`)
    );
    return [
        ...cloudReviews,
        ...localReviews.filter(review => !cloudCardKeys.has(`${review.collectionName}/${review.itemId}`))
    ].sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
}
