function normalizeSearchValue(value) {
    return String(value || '')
        .normalize('NFKC')
        .replace(/\s+/g, ' ')
        .trim()
        .toLocaleLowerCase('zh-Hant');
}

function getItemOrder(item) {
    const value = Number(item?.order ?? item?.createdAt ?? 0);
    return Number.isFinite(value) ? value : 0;
}

function buildSnippet(value, terms, maxLength = 150) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    const normalized = normalizeSearchValue(text);
    const firstIndex = terms.reduce((best, term) => {
        const index = normalized.indexOf(term);
        if (index < 0) return best;
        return best < 0 ? index : Math.min(best, index);
    }, -1);
    if (text.length <= maxLength) return text;
    const start = Math.max(0, firstIndex - Math.floor(maxLength / 3));
    const end = Math.min(text.length, start + maxLength);
    return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

function searchItem(item, terms, tagNamesById) {
    const title = normalizeSearchValue(item?.cardSearchText || item?.text);
    const research = normalizeSearchValue(item?.researchSearchText);
    const tagNames = (Array.isArray(item?.tagIds) ? item.tagIds : [])
        .map(id => tagNamesById.get(String(id)) || '')
        .filter(Boolean);
    const tags = normalizeSearchValue(tagNames.join(' '));
    const combined = `${title} ${research} ${tags}`;
    if (!terms.every(term => combined.includes(term))) return null;

    const matchTypes = [];
    if (terms.some(term => title.includes(term))) matchTypes.push('title');
    if (terms.some(term => research.includes(term))) matchTypes.push('research');
    if (terms.some(term => tags.includes(term))) matchTypes.push('tag');
    const score = terms.reduce((total, term) => (
        total
        + (title.startsWith(term) ? 8 : title.includes(term) ? 5 : 0)
        + (tags.includes(term) ? 3 : 0)
        + (research.includes(term) ? 2 : 0)
    ), 0);

    return {
        ...item,
        searchMatchTypes: matchTypes,
        searchSnippet: research && matchTypes.includes('research')
            ? buildSnippet(item.researchSearchText, terms)
            : '',
        searchScore: score
    };
}

export function groupCardsBySearch({
    categories = [],
    inboxItems = [],
    itemsByCollection = new Map(),
    tags = [],
    query = ''
} = {}) {
    const terms = [...new Set(
        normalizeSearchValue(query)
            .split(' ')
            .filter(Boolean)
    )];
    if (terms.length === 0) return [];

    const tagNamesById = new Map(
        (Array.isArray(tags) ? tags : [])
            .map(tag => [String(tag?.id || ''), String(tag?.name || '')])
            .filter(([id, name]) => id && name)
    );
    const searchItems = items => (Array.isArray(items) ? items : [])
        .map(item => searchItem(item, terms, tagNamesById))
        .filter(Boolean)
        .sort((left, right) => (
            right.searchScore - left.searchScore
            || getItemOrder(right) - getItemOrder(left)
        ));
    const groups = [{
        id: 'inbox',
        name: '收件匣',
        icon: 'fas fa-inbox',
        type: 'text',
        items: searchItems(inboxItems)
    }];
    (Array.isArray(categories) ? categories : []).forEach(category => {
        const id = String(category?.id || '');
        groups.push({
            id,
            name: String(category?.name || '未命名分類'),
            icon: String(category?.icon || 'fas fa-folder'),
            type: String(category?.type || 'text'),
            items: searchItems(itemsByCollection instanceof Map ? itemsByCollection.get(id) : [])
        });
    });
    return groups.filter(group => group.items.length > 0);
}
