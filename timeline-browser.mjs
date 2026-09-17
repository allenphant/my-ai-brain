/**
 * Timeline Browser Helper
 * 負責解析卡片時間戳記、跨分類彙整所有卡片，並依加入時間分組
 */

export function getCardTimestamp(card) {
    if (!card) return 0;
    const val = card.createdAt ?? card.order ?? card.updatedAt;
    if (!val) return 0;
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
        const parsed = Date.parse(val);
        return Number.isNaN(parsed) ? 0 : parsed;
    }
    if (typeof val.toDate === 'function') {
        return val.toDate().getTime();
    }
    if (typeof val.seconds === 'number') {
        return val.seconds * 1000 + Math.floor((val.nanoseconds || 0) / 1000000);
    }
    return 0;
}

export function formatTimelineTime(timestamp, referenceDate = new Date()) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '';

    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const timeStr = `${hours}:${minutes}`;

    const ref = new Date(referenceDate);
    const startOfToday = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate()).getTime();
    const startOfYesterday = startOfToday - 86400000;

    if (timestamp >= startOfToday) {
        return timeStr;
    }
    if (timestamp >= startOfYesterday) {
        return `昨天 ${timeStr}`;
    }

    const month = date.getMonth() + 1;
    const day = date.getDate();
    const isSameYear = date.getFullYear() === ref.getFullYear();

    if (isSameYear) {
        return `${month}月${day}日 ${timeStr}`;
    }
    return `${date.getFullYear()}/${month}/${day} ${timeStr}`;
}

export function getCardPreviewText(card) {
    if (!card) return '';
    if (typeof card.text === 'string' && card.text.trim()) {
        const trimmed = card.text.trim();
        // 取前 80 個字元作為摘要
        return trimmed.length > 80 ? `${trimmed.slice(0, 80)}...` : trimmed;
    }
    if (typeof card.researchTitle === 'string' && card.researchTitle.trim()) {
        return card.researchTitle.trim();
    }
    if (typeof card.researchSummary === 'string' && card.researchSummary.trim()) {
        const trimmed = card.researchSummary.trim();
        return trimmed.length > 80 ? `${trimmed.slice(0, 80)}...` : trimmed;
    }
    return '無文字內容';
}

export function getCardDisplayName(card) {
    if (!card) return '未命名卡片';
    if (typeof card.researchTitle === 'string' && card.researchTitle.trim()) {
        return card.researchTitle.trim();
    }
    const rawText = typeof card.text === 'string' ? card.text.trim() : '';
    if (rawText) {
        // 排除 URL 後提取有意義的文字
        const cleanText = rawText.replace(/https?:\/\/[^\s　-〿぀-ヿ㐀-鿿＀-￯]+/g, '').trim();
        if (cleanText) {
            const firstLine = cleanText.split('\n')[0].trim();
            if (firstLine) {
                return firstLine.length > 50 ? `${firstLine.slice(0, 50)}...` : firstLine;
            }
        }
        // 若去除 URL 後沒有文字，則從第一個 URL 推斷名稱
        const urlMatch = rawText.match(/https?:\/\/[^\s　-〿぀-ヿ㐀-鿿＀-￯]+/);
        if (urlMatch) {
            try {
                const u = new URL(urlMatch[0]);
                if (u.hostname.includes('threads.net') || u.hostname.includes('threads.com')) {
                    const postAuthor = u.pathname.match(/@([^/]+)/);
                    return postAuthor ? `Threads 貼文 (@${postAuthor[1]})` : 'Threads 貼文';
                }
                if (u.hostname.includes('twitter.com') || u.hostname.includes('x.com')) {
                    const author = u.pathname.match(/^\/([^/]+)/);
                    return author && author[1] !== 'i' ? `X 貼文 (@${author[1]})` : 'X 貼文';
                }
                if (u.hostname.includes('github.com')) {
                    const parts = u.pathname.replace(/^\//, '').split('/');
                    return parts.length >= 2 && parts[0] && parts[1] ? `${parts[0]}/${parts[1]}` : 'GitHub 專案';
                }
                if (u.hostname.includes('youtube.com') || u.hostname.includes('youtu.be')) {
                    return 'YouTube 影片';
                }
                return `${u.hostname.replace(/^www\./, '')} 連結`;
            } catch {}
        }
    }
    if (typeof card.title === 'string' && card.title.trim()) {
        return card.title.trim();
    }
    return '未命名卡片';
}

/**
 * 彙整所有卡片並計算時間分組桶
 */
export function buildTimelineBuckets({
    inboxItems = [],
    itemsByCollection = new Map(),
    categories = [],
    now = new Date()
} = {}) {
    const categoryNameMap = new Map();
    categoryNameMap.set('inbox', '收件匣');
    if (Array.isArray(categories)) {
        categories.forEach(cat => {
            if (cat && cat.id) {
                categoryNameMap.set(cat.id, cat.name || cat.id);
            }
        });
    }

    const allCards = [];

    // 收集收件匣卡片
    if (Array.isArray(inboxItems)) {
        inboxItems.forEach(item => {
            if (!item || !item.id) return;
            const ts = getCardTimestamp(item);
            allCards.push({
                ...item,
                collection: 'inbox',
                collectionName: '收件匣',
                timestamp: ts,
                formattedTime: formatTimelineTime(ts, now),
                displayName: getCardDisplayName(item),
                previewText: getCardPreviewText(item)
            });
        });
    }

    // 收集各分類卡片
    if (itemsByCollection instanceof Map) {
        for (const [colId, items] of itemsByCollection.entries()) {
            if (!Array.isArray(items)) continue;
            const colName = categoryNameMap.get(colId) || colId;
            items.forEach(item => {
                if (!item || !item.id) return;
                const ts = getCardTimestamp(item);
                allCards.push({
                    ...item,
                    collection: colId,
                    collectionName: colName,
                    timestamp: ts,
                    formattedTime: formatTimelineTime(ts, now),
                    displayName: getCardDisplayName(item),
                    previewText: getCardPreviewText(item)
                });
            });
        }
    } else if (itemsByCollection && typeof itemsByCollection === 'object') {
        Object.entries(itemsByCollection).forEach(([colId, items]) => {
            if (!Array.isArray(items)) return;
            const colName = categoryNameMap.get(colId) || colId;
            items.forEach(item => {
                if (!item || !item.id) return;
                const ts = getCardTimestamp(item);
                allCards.push({
                    ...item,
                    collection: colId,
                    collectionName: colName,
                    timestamp: ts,
                    formattedTime: formatTimelineTime(ts, now),
                    displayName: getCardDisplayName(item),
                    previewText: getCardPreviewText(item)
                });
            });
        });
    }

    // 依時間倒序排列（最新在最前）
    allCards.sort((a, b) => b.timestamp - a.timestamp);

    // 計算分組時間邊界
    const refDate = new Date(now);
    const startOfToday = new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate()).getTime();
    const startOfYesterday = startOfToday - 86400000;

    // ISO 8601 本週起點（週一為一週開始）
    const dayOfWeek = refDate.getDay(); // 0 是週日, 1 是週一...
    const daysSinceMonday = (dayOfWeek + 6) % 7;
    const startOfWeek = startOfToday - (daysSinceMonday * 86400000);

    const buckets = [
        { id: 'today', title: '今天', items: [] },
        { id: 'yesterday', title: '昨天', items: [] },
        { id: 'this_week', title: '本週', items: [] },
        { id: 'earlier', title: '更早', items: [] }
    ];

    allCards.forEach(card => {
        const ts = card.timestamp;
        if (ts >= startOfToday) {
            buckets[0].items.push(card);
        } else if (ts >= startOfYesterday) {
            buckets[1].items.push(card);
        } else if (ts >= startOfWeek) {
            buckets[2].items.push(card);
        } else {
            buckets[3].items.push(card);
        }
    });

    // 僅保留有卡片的分組
    return buckets.filter(b => b.items.length > 0);
}
