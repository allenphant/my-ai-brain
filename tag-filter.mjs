import { canUseWebResearch } from './web-research.mjs';

function normalizeTagIds(value) {
    return [...new Set((Array.isArray(value) ? value : [])
        .map(id => String(id || '').trim())
        .filter(Boolean))];
}

export function matchesTagFilter(item, selectedTagIds = [], matchMode = 'all') {
    const cardTagIds = new Set(normalizeTagIds(item?.tagIds));
    const selected = normalizeTagIds(selectedTagIds);
    if (selected.length === 0) return cardTagIds.size > 0;
    if (matchMode === 'any') return selected.some(id => cardTagIds.has(id));
    return selected.every(id => cardTagIds.has(id));
}

export function buildTagUsageCounts({ inboxItems = [], itemsByCollection = new Map() } = {}) {
    const counts = new Map();
    const collections = [
        Array.isArray(inboxItems) ? inboxItems : [],
        ...[...(itemsByCollection instanceof Map ? itemsByCollection.values() : [])]
    ];
    collections.flat().forEach(item => {
        normalizeTagIds(item?.tagIds).forEach(id => counts.set(id, (counts.get(id) || 0) + 1));
    });
    return counts;
}

export function groupCardsByTagFilter({
    categories = [],
    inboxItems = [],
    itemsByCollection = new Map(),
    selectedTagIds = [],
    matchMode = 'all'
} = {}) {
    const filterItems = items => (Array.isArray(items) ? items : [])
        .filter(item => matchesTagFilter(item, selectedTagIds, matchMode));
    const groups = [{
        id: 'inbox',
        name: '收件匣',
        icon: 'fas fa-inbox',
        type: 'text',
        items: filterItems(inboxItems)
    }];
    (Array.isArray(categories) ? categories : []).forEach(category => {
        groups.push({
            id: String(category.id),
            name: String(category.name || '未命名分類'),
            icon: String(category.icon || 'fas fa-folder'),
            type: String(category.type || 'text'),
            items: filterItems(itemsByCollection instanceof Map ? itemsByCollection.get(String(category.id)) : [])
        });
    });
    return groups.filter(group => group.items.length > 0);
}

export function needsResearchBackfill(item) {
    if (!canUseWebResearch(String(item?.text || '').trim()).ok) {
        return { eligible: false, reasons: [] };
    }
    const reasons = [];
    if (normalizeTagIds(item?.tagIds).length === 0) reasons.push('無 Tag');
    if (!String(item?.researchSearchText || '').trim()) reasons.push('尚未研讀');
    return { eligible: reasons.length > 0, reasons };
}

export function groupResearchBackfillCandidates({
    categories = [],
    inboxItems = [],
    itemsByCollection = new Map()
} = {}) {
    const collect = items => (Array.isArray(items) ? items : []).flatMap(item => {
        const status = needsResearchBackfill(item);
        return status.eligible ? [{ ...item, backfillReasons: status.reasons }] : [];
    });
    const groups = [{
        id: 'inbox',
        name: '收件匣',
        icon: 'fas fa-inbox',
        type: 'text',
        items: collect(inboxItems)
    }];
    (Array.isArray(categories) ? categories : []).forEach(category => {
        groups.push({
            id: String(category.id),
            name: String(category.name || '未命名分類'),
            icon: String(category.icon || 'fas fa-folder'),
            type: String(category.type || 'text'),
            items: collect(itemsByCollection instanceof Map ? itemsByCollection.get(String(category.id)) : [])
        });
    });
    return groups.filter(group => group.items.length > 0);
}
