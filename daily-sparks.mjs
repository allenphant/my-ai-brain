/**
 * Daily Sparks Module
 * 首頁「今日大腦切片」三軌主動喚醒機制
 * 軌道 1：待辦喚醒（todos: 超過 3 天未完成任務）
 * 軌道 2：深度記憶（memory: 超過 14 天之高價值/學習/研讀卡片）
 * 軌道 3：靈感碰撞（sparks: 稍後閱讀或隨手點子隨機碰撞）
 */

import { getCardTimestamp, getCardPreviewText, getCardDisplayName } from './timeline-browser.mjs';

/**
 * 取得 ISO 日期字串 YYYY-MM-DD（依本地時間）
 */
export function getTodayDateString(date = new Date()) {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * 確定性雜湊函式（FNV-1a 32-bit）
 */
export function hashString(str) {
    let hash = 2166136261;
    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return Math.abs(hash >>> 0);
}

/**
 * 自候選清單中以確定性種子挑選卡片
 */
export function pickCandidate(candidates, seedKey) {
    if (!Array.isArray(candidates) || candidates.length === 0) return null;
    const hash = hashString(seedKey);
    const index = hash % candidates.length;
    return candidates[index];
}

/**
 * 收集並標準化所有卡片
 */
export function extractAllCards({ inboxItems = [], itemsByCollection = new Map(), categories = [] } = {}) {
    const categoryMap = new Map();
    categoryMap.set('inbox', { id: 'inbox', name: '收件匣', type: 'inbox' });
    if (Array.isArray(categories)) {
        categories.forEach(cat => {
            if (cat && cat.id) {
                categoryMap.set(cat.id, cat);
            }
        });
    }

    const cards = [];

    // 收件匣
    if (Array.isArray(inboxItems)) {
        inboxItems.forEach(item => {
            if (!item || !item.id) return;
            const ts = getCardTimestamp(item);
            cards.push({
                ...item,
                collection: 'inbox',
                collectionName: '收件匣',
                collectionType: 'inbox',
                timestamp: ts,
                displayName: getCardDisplayName(item),
                previewText: getCardPreviewText(item)
            });
        });
    }

    // 各分類
    const entries = itemsByCollection instanceof Map ? itemsByCollection.entries() : Object.entries(itemsByCollection || {});
    for (const [colId, items] of entries) {
        if (!Array.isArray(items)) continue;
        const cat = categoryMap.get(colId) || { id: colId, name: colId, type: 'text' };
        items.forEach(item => {
            if (!item || !item.id) return;
            const ts = getCardTimestamp(item);
            cards.push({
                ...item,
                collection: colId,
                collectionName: cat.name || colId,
                collectionType: cat.type || 'text',
                timestamp: ts,
                displayName: getCardDisplayName(item),
                previewText: getCardPreviewText(item)
            });
        });
    }

    return cards;
}

/**
 * 主動喚醒演算法：挑選今日大腦切片三軌卡片
 */
export function selectDailySparks({
    inboxItems = [],
    itemsByCollection = new Map(),
    categories = [],
    dateStr = '',
    offsets = {},
    now = Date.now()
} = {}) {
    const todayStr = dateStr || getTodayDateString(now);
    const nowTs = typeof now === 'number' ? now : new Date(now).getTime();
    const allCards = extractAllCards({ inboxItems, itemsByCollection, categories });

    const todosOffset = Number(offsets.todos || 0);
    const memoryOffset = Number(offsets.memory || 0);
    const sparksOffset = Number(offsets.sparks || 0);

    // ==========================================
    // 軌道 1：待辦喚醒（todos）
    // 優先挑選建立超過 3 天（>= 259200000 ms）未完成的事項
    // ==========================================
    const allUncompletedTodos = allCards.filter(card => {
        const isTodoCat = card.collection === 'todos' || card.collectionType === 'todo';
        const isUncompleted = !card.completed && card.type !== 'completed';
        return isTodoCat && isUncompleted;
    });

    const THREE_DAYS_MS = 3 * 86400000;
    const staleTodos = allUncompletedTodos.filter(card => (nowTs - card.timestamp) >= THREE_DAYS_MS);

    let todoCandidate = null;
    let todoStatus = 'empty';
    if (staleTodos.length > 0) {
        todoCandidate = pickCandidate(staleTodos, `${todayStr}:todos:${todosOffset}`);
        todoStatus = 'ready';
    } else if (allUncompletedTodos.length > 0) {
        todoCandidate = pickCandidate(allUncompletedTodos, `${todayStr}:todos:${todosOffset}`);
        todoStatus = 'fallback';
    } else {
        todoStatus = 'all_completed';
    }

    // ==========================================
    // 軌道 2：深度記憶（memory）
    // 優先挑選 learning 分類或具備 AI 研讀 TL;DR 且超過 14 天（>= 1209600000 ms）的卡片
    // ==========================================
    const deepCards = allCards.filter(card => {
        const isLearning = card.collection === 'learning' || (card.collectionName && card.collectionName.includes('學習'));
        const hasResearch = Boolean(card.researchTldr || card.researchSummary || card.researchTitle || card.noteData);
        return isLearning || hasResearch;
    });

    const FOURTEEN_DAYS_MS = 14 * 86400000;
    const matureDeepCards = deepCards.filter(card => (nowTs - card.timestamp) >= FOURTEEN_DAYS_MS);

    let memoryCandidate = null;
    let memoryStatus = 'empty';
    if (matureDeepCards.length > 0) {
        memoryCandidate = pickCandidate(matureDeepCards, `${todayStr}:memory:${memoryOffset}`);
        memoryStatus = 'ready';
    } else if (deepCards.length > 0) {
        memoryCandidate = pickCandidate(deepCards, `${todayStr}:memory:${memoryOffset}`);
        memoryStatus = 'fallback';
    } else if (allCards.length > 0) {
        // 全庫無深度筆記時，挑選建立時間較早的卡片複習
        const sortedOlder = [...allCards].sort((a, b) => a.timestamp - b.timestamp);
        memoryCandidate = pickCandidate(sortedOlder.slice(0, Math.max(1, Math.ceil(sortedOlder.length * 0.5))), `${todayStr}:memory:${memoryOffset}`);
        memoryStatus = 'fallback';
    } else {
        memoryStatus = 'empty';
    }

    // ==========================================
    // 軌道 3：靈感碰撞（sparks）
    // 優先挑選 bookmarks 或 ideas 分類的卡片，碰撞隨機靈感
    // ==========================================
    const sparkCards = allCards.filter(card => {
        return card.collection === 'bookmarks' ||
            card.collection === 'ideas' ||
            card.collectionType === 'bookmark' ||
            (card.collectionName && (card.collectionName.includes('靈感') || card.collectionName.includes('閱讀')));
    });

    let sparkCandidate = null;
    let sparkStatus = 'empty';
    if (sparkCards.length > 0) {
        sparkCandidate = pickCandidate(sparkCards, `${todayStr}:sparks:${sparksOffset}`);
        sparkStatus = 'ready';
    } else if (allCards.length > 0) {
        sparkCandidate = pickCandidate(allCards, `${todayStr}:sparks:${sparksOffset}`);
        sparkStatus = 'fallback';
    } else {
        sparkStatus = 'empty';
    }

    return {
        dateStr: todayStr,
        tracks: [
            {
                trackId: 'todos',
                title: '待辦喚醒',
                subtitle: todoStatus === 'ready' ? '超過 3 天未完成任務' : '目前待辦事項',
                status: todoStatus,
                item: todoCandidate,
                daysAgo: todoCandidate ? Math.floor(Math.max(0, nowTs - todoCandidate.timestamp) / 86400000) : 0,
                emptyMessage: todoStatus === 'all_completed' ? '目前所有待辦事項皆已搞定。' : '目前尚無待辦事項。'
            },
            {
                trackId: 'memory',
                title: '深度記憶',
                subtitle: memoryStatus === 'ready' ? '溫故知新（已建檔 14 天以上）' : '知識複習',
                status: memoryStatus,
                item: memoryCandidate,
                daysAgo: memoryCandidate ? Math.floor(Math.max(0, nowTs - memoryCandidate.timestamp) / 86400000) : 0,
                emptyMessage: '尚無足夠的學習筆記或卡片可供複習。'
            },
            {
                trackId: 'sparks',
                title: '靈感碰撞',
                subtitle: sparkStatus === 'ready' ? '稍後閱讀與隨手靈感' : '隨機卡片探索',
                status: sparkStatus,
                item: sparkCandidate,
                daysAgo: sparkCandidate ? Math.floor(Math.max(0, nowTs - sparkCandidate.timestamp) / 86400000) : 0,
                emptyMessage: '尚無任何卡片可碰撞靈感。'
            }
        ]
    };
}
