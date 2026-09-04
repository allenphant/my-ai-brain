const DEFAULT_LOG_LIMIT = 200;
const TRANSIENT_BACKOFF_MS = [15_000, 60_000, 180_000];

const cleanText = value => String(value || '')
    .replace(/AIzaSy[A-Za-z0-9_-]{12,}/g, '[Gemini Key 已隱藏]')
    .replace(/jina_[A-Za-z0-9_-]{8,}/gi, '[Jina Key 已隱藏]')
    .replace(/Bearer\s+[A-Za-z0-9_.-]{12,}/gi, 'Bearer [Key 已隱藏]')
    .replace(/((?:api[_ -]?key|authorization|token)\s*[:=]\s*)[A-Za-z0-9_.-]{12,}/gi, '$1[Key 已隱藏]')
    .replace(/[<>]/g, '')
    .slice(0, 500);

const normalizedCode = error => String(error?.code || error?.name || '')
    .toLowerCase()
    .replace(/^firestore\//, '');

const errorInfo = error => error?.providerInfo || error?.mistral || error?.gemini || error?.jina || error || {};

export function parseResearchRetryAfterMs(value, now = Date.now()) {
    if (Number.isFinite(value)) return Math.max(0, Number(value));
    const text = String(value || '').trim();
    if (!text) return 0;
    if (/^\d+(?:\.\d+)?$/.test(text)) return Math.max(0, Number(text) * 1000);
    const duration = text.match(/(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|sec(?:onds?)?|m|min(?:utes?)?|h|hours?)/i);
    if (duration) {
        const amount = Number(duration[1]);
        const unit = duration[2].toLowerCase();
        if (unit.startsWith('ms')) return amount;
        if (unit.startsWith('s')) return amount * 1000;
        if (unit.startsWith('m')) return amount * 60_000;
        if (unit.startsWith('h')) return amount * 3_600_000;
    }
    const until = text.match(/(?:blocked\s+until|retry\s+after|available\s+after)\s+(.+?)(?:\s+due\b|$)/i);
    const timestamp = Date.parse(until?.[1] || text);
    return Number.isFinite(timestamp) ? Math.max(0, timestamp - now) : 0;
}

function transientDecision({ service, status, detail, attempt }) {
    if (attempt < TRANSIENT_BACKOFF_MS.length) {
        return {
            category: 'transient', action: 'retry', retryAfterMs: TRANSIENT_BACKOFF_MS[attempt],
            title: `${service} 暫時異常`,
            userMessage: `${service} 暫時無法連線，將保留原卡後自動重試。`,
            resolution: `第 ${attempt + 1} 次短暫失敗；最多自動重試 ${TRANSIENT_BACKOFF_MS.length} 次。`,
            status, detail
        };
    }
    return {
        category: 'transient_exhausted', action: 'skip', retryAfterMs: 0,
        title: `${service} 重試仍失敗`,
        userMessage: `${service} 已重試 ${TRANSIENT_BACKOFF_MS.length} 次，這張卡會跳過並保留供日後重試。`,
        resolution: '服務恢復後，從研讀紀錄或待回補清單重新加入。',
        status, detail
    };
}

export function classifyResearchFailure({
    stage = 'provider', provider = '', error = {}, hasJinaKey = false, attempt = 0, now = Date.now()
} = {}) {
    const info = errorInfo(error);
    const status = Number(info?.status || error?.status || 0);
    const code = normalizedCode(info) || normalizedCode(error);
    const detail = cleanText(info?.detail || info?.message || error?.message || '未知錯誤');
    const message = detail.toLowerCase();
    const service = stage === 'jina' ? 'Jina Reader' : provider === 'mistral' ? 'Mistral' : provider === 'gemini' ? 'Gemini' : '研讀服務';
    const explicitRetry = Number(info?.retryAfterMs || 0)
        || parseResearchRetryAfterMs(info?.retryDelay, now)
        || parseResearchRetryAfterMs(detail, now);

    if (stage === 'storage' || stage === 'firestore') {
        if (code.includes('quota') || code.includes('resource-exhausted') || code === 'quotaexceedederror') {
            return { category: 'storage_quota', action: 'stop', retryAfterMs: 0, title: '儲存空間或資料庫配額不足', userMessage: '為避免遺失研讀結果，佇列已停止。', resolution: '清理研讀快取／紀錄，或檢查 Firebase 配額後再繼續。', status, detail };
        }
        if (code.includes('permission-denied') || code.includes('unauthenticated')) {
            return { category: 'storage_auth', action: 'stop', retryAfterMs: 0, title: '資料寫入權限失效', userMessage: '登入或資料庫權限失效，佇列已停止。', resolution: '重新登入並確認 Firestore 規則後再重試。', status, detail };
        }
        if (code.includes('unavailable') || code.includes('deadline-exceeded') || code.includes('aborted')) {
            return transientDecision({ service: 'Firebase', status, detail, attempt });
        }
        return { category: 'storage_unknown', action: 'stop', retryAfterMs: 0, title: '無法保存研讀結果', userMessage: '為避免資料遺失，佇列已停止。', resolution: '保留頁面並查看研讀紀錄中的錯誤細節。', status, detail };
    }

    if (stage === 'jina') {
        if (message.includes('anonymous access')) {
            return {
                category: 'jina_anonymous_block', action: 'stop', retryAfterMs: explicitRetry,
                title: 'Jina 匿名存取被封鎖',
                userMessage: hasJinaKey ? 'Jina 沒有接受已設定的 Key，佇列已停止。' : 'Jina 需要 API Key，佇列已停止。',
                resolution: hasJinaKey ? '重新儲存或更換 Jina Key，並確認狀態顯示已儲存。' : '在設定填入並儲存 Jina API Key 後重新啟動。',
                status, detail
            };
        }
        if (status === 401 || status === 403) {
            return { category: 'jina_auth', action: 'stop', retryAfterMs: 0, title: 'Jina Key 無效或權限不足', userMessage: 'Jina 驗證失敗，佇列已停止。', resolution: '重新建立、儲存 Jina Key，再重新啟動佇列。', status, detail };
        }
        if (status === 429 || message.includes('blocked until') || message.includes('too many requests') || message.includes('ddos')) {
            return { category: 'jina_quota', action: 'pause', retryAfterMs: explicitRetry || 5 * 60_000, title: 'Jina 暫時限制來源擷取', userMessage: 'Jina 額度或來源限制已觸發，將保留原卡等待重試。', resolution: '程式會依回傳時間重試；也可停止佇列後更換 Jina Key。', status, detail };
        }
        if (status === 0 || status === 408 || status === 425 || status >= 500) {
            return transientDecision({ service, status, detail, attempt });
        }
        return { category: 'jina_source', action: 'skip', retryAfterMs: 0, title: '來源無法擷取', userMessage: '這張來源目前無法讀取，將跳過並繼續下一張。', resolution: '確認網址是否公開、仍存在，或日後從待回補重新研讀。', status, detail };
    }

    if (status === 401 || status === 403 || message.includes('api key') && message.includes('invalid')) {
        return { category: 'provider_auth', action: 'stop', retryAfterMs: 0, title: `${service} Key 無效或過期`, userMessage: `${service} 驗證失敗，佇列已停止。`, resolution: `重新建立並儲存 ${service} Key，再查詢可用模型。`, status, detail };
    }
    if (status === 402) {
        return { category: 'provider_billing', action: 'stop', retryAfterMs: 0, title: `${service} 帳務未啟用`, userMessage: `${service} 無可用額度或付款方式，佇列已停止。`, resolution: '至服務控制台確認方案、餘額與付款方式。', status, detail };
    }
    if (status === 404 || code.includes('unknown_model') || message.includes('unknown model') || message.includes('model not found')) {
        return { category: 'provider_model', action: 'stop', retryAfterMs: 0, title: `${service} 模型已失效`, userMessage: '選用模型不存在或已下架，佇列已停止。', resolution: '在設定重新查詢模型並選擇可用版本。', status, detail };
    }
    if (info?.isQuota || status === 429 || message.includes('resource_exhausted') || message.includes('rate limit')) {
        return { category: 'provider_quota', action: 'pause', retryAfterMs: explicitRetry, title: `${service} 配額不足`, userMessage: `${service} 配額不足，將保留原卡等待重試。`, resolution: '依服務回傳時間或 5／15／60 分鐘退避；可停止後切換整理服務。', status, detail };
    }
    if (status === 0 || status === 408 || status === 425 || status >= 500) {
        return transientDecision({ service, status, detail, attempt });
    }
    if (status === 400 || status === 422) {
        return { category: 'provider_request', action: 'skip', retryAfterMs: 0, title: `${service} 無法處理此內容`, userMessage: '請求格式、內容長度或模型能力不相容，這張卡將跳過。', resolution: '縮短來源、重新選模型，或檢查 System Prompt 後再研讀。', status, detail };
    }
    return { category: 'unknown', action: 'skip', retryAfterMs: 0, title: '未知研讀錯誤', userMessage: '這張卡將跳過並繼續下一張。', resolution: '查看研讀紀錄的錯誤細節後再手動重試。', status, detail };
}

export function getResearchLogStorageKey(userId) {
    return `researchRunLog:v1:${String(userId || 'anonymous')}`;
}

export function readResearchLogs(storage, userId) {
    try {
        const parsed = JSON.parse(storage.getItem(getResearchLogStorageKey(userId)) || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

export function appendResearchLog(storage, userId, entry, limit = DEFAULT_LOG_LIMIT) {
    const logs = readResearchLogs(storage, userId);
    const safeEntry = {
        id: entry.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: Number(entry.timestamp) || Date.now(),
        level: ['success', 'warning', 'error', 'info'].includes(entry.level) ? entry.level : 'info',
        stage: cleanText(entry.stage), provider: cleanText(entry.provider), model: cleanText(entry.model),
        status: cleanText(entry.status), action: cleanText(entry.action), title: cleanText(entry.title),
        cardTitle: cleanText(entry.cardTitle), sourceUrl: cleanText(entry.sourceUrl),
        collectionName: cleanText(entry.collectionName), itemId: cleanText(entry.itemId),
        detail: cleanText(entry.detail), resolution: cleanText(entry.resolution),
        retryAt: Number(entry.retryAt) || 0
    };
    const next = [safeEntry, ...logs].slice(0, Math.max(1, limit));
    storage.setItem(getResearchLogStorageKey(userId), JSON.stringify(next));
    return next;
}

export function clearResearchLogs(storage, userId) {
    storage.removeItem(getResearchLogStorageKey(userId));
}
