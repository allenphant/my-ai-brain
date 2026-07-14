export const WEB_RESEARCH_COOLDOWN_MS = 60 * 1000;
export const WEB_RESEARCH_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const WEB_RESEARCH_CACHE_PREFIX = 'webPolishCache:';

export function extractUrls(text) {
    return [...new Set(((text || '').match(/https?:\/\/[^\s]+/g) || []).map(url => url.trim()))];
}

export function canUseWebResearch(text) {
    const normalizedText = (text || '').trim();
    const urls = extractUrls(normalizedText);
    if (urls.length !== 1) {
        return { ok: false, reason: urls.length === 0 ? 'no_url' : 'multiple_urls' };
    }
    if (normalizedText.length > 1200) {
        return { ok: false, reason: 'too_long' };
    }
    return { ok: true, reason: 'ok' };
}

function hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

export function getWebResearchCacheKey(text) {
    const normalizedText = (text || '').trim().replace(/\s+/g, ' ');
    return `${WEB_RESEARCH_CACHE_PREFIX}${hashString(normalizedText)}`;
}

export function readWebResearchCache(storage, text, now = Date.now()) {
    const key = getWebResearchCacheKey(text);
    const raw = storage.getItem(key);
    if (!raw) return null;

    try {
        const parsed = JSON.parse(raw);
        if (!parsed?.value || !parsed?.savedAt) {
            storage.removeItem(key);
            return null;
        }
        if (now - parsed.savedAt > WEB_RESEARCH_CACHE_TTL_MS) {
            storage.removeItem(key);
            return null;
        }
        return parsed.value;
    } catch (error) {
        storage.removeItem(key);
        return null;
    }
}

export function writeWebResearchCache(storage, text, value, now = Date.now()) {
    storage.setItem(getWebResearchCacheKey(text), JSON.stringify({ value, savedAt: now }));
}

export function getWebResearchCooldownRemaining(storage, now = Date.now()) {
    const lastRun = Number.parseInt(storage.getItem('lastWebPolishTime') || '0', 10);
    return Math.max(0, WEB_RESEARCH_COOLDOWN_MS - (now - lastRun));
}

function pad(value) {
    return String(value).padStart(2, '0');
}

function formatResearchTimestamp(now) {
    const date = new Date(now);
    return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function escapeEditorText(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
        .replace(/\r?\n/g, '<br>');
}

export function buildWebResearchAppendData(existingData, result, now = Date.now()) {
    const base = existingData && typeof existingData === 'object'
        ? { ...existingData }
        : { time: now };
    const existingBlocks = Array.isArray(existingData?.blocks) ? existingData.blocks : [];

    return {
        ...base,
        blocks: [
            ...existingBlocks,
            {
                type: 'header',
                data: {
                    text: `AI 網址研讀｜${formatResearchTimestamp(now)}`,
                    level: 2
                }
            },
            {
                type: 'paragraph',
                data: { text: escapeEditorText(result) }
            }
        ]
    };
}

export function isInteractiveCardTarget(target) {
    return Boolean(target?.closest?.('a, button, input, [data-card-interactive]'));
}
