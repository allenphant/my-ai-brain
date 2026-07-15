export const WEB_RESEARCH_COOLDOWN_MS = 60 * 1000;
export const WEB_RESEARCH_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const WEB_RESEARCH_CACHE_PREFIX = 'webPolishCache:';
export const WEB_RESEARCH_MODEL_VERIFICATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const WEB_RESEARCH_MODEL_VERIFICATION_PREFIX = 'webResearchModelVerification:';
export const DEFAULT_WEB_RESEARCH_MODEL = 'gemini-2.5-flash';

const KNOWN_WEB_RESEARCH_MODEL_IDS = [
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite'
];

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

export function normalizeHttpUrl(value) {
    try {
        const url = new URL(String(value));
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
        return url.href;
    } catch (error) {
        return null;
    }
}

function normalizeSourceText(text) {
    return (text || '').trim().replace(/\s+/g, ' ');
}

function hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

function normalizeModelId(value) {
    return String(value || '').replace(/^models\//, '').trim();
}

function canGenerateContent(model) {
    return Array.isArray(model?.supportedGenerationMethods)
        && model.supportedGenerationMethods.includes('generateContent');
}

export function getWebResearchModelOptions(models, verificationStatuses = {}) {
    const available = (Array.isArray(models) ? models : [])
        .filter(canGenerateContent)
        .map(model => ({
            id: normalizeModelId(model.name),
            label: model.displayName || normalizeModelId(model.name)
        }))
        .filter(model => model.id);
    const byId = new Map(available.map(model => [model.id, model]));
    const verified = [];

    for (const id of KNOWN_WEB_RESEARCH_MODEL_IDS) {
        if (byId.has(id)) verified.push(byId.get(id));
    }
    for (const model of available) {
        if (!KNOWN_WEB_RESEARCH_MODEL_IDS.includes(model.id)
            && verificationStatuses[model.id] === 'supported') {
            verified.push(model);
        }
    }

    return {
        verified,
        unknown: available.filter(model => !KNOWN_WEB_RESEARCH_MODEL_IDS.includes(model.id)
            && verificationStatuses[model.id] !== 'supported'
            && verificationStatuses[model.id] !== 'unsupported'),
        unsupported: available.filter(model => verificationStatuses[model.id] === 'unsupported')
    };
}

export function extractGeminiResponseText(data) {
    const parts = data?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return '';
    return parts
        .filter(part => part?.thought !== true && typeof part?.text === 'string' && part.text.trim())
        .map(part => part.text.trim())
        .join('\n\n');
}

function describePartType(part) {
    if (part?.thought === true) return 'thought';
    if (typeof part?.text === 'string') return 'text';
    if (part?.inlineData) return 'inlineData';
    if (part?.functionCall) return 'functionCall';
    if (part?.functionResponse) return 'functionResponse';
    return 'unknown';
}

export function describeGeminiResponseIssue(data, model) {
    const candidate = data?.candidates?.[0];
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    const finishReason = candidate?.finishReason || 'missing';
    const partTypes = parts.length ? parts.map(describePartType).join(', ') : 'none';
    const normalizedModel = normalizeModelId(model) || '未知模型';
    const message = candidate ? '回傳結果沒有可顯示文字' : '模型未回傳候選結果';
    return {
        isQuota: false,
        status: 200,
        model: normalizedModel,
        message,
        quotaId: null,
        retryDelay: null,
        finishReason,
        partTypes,
        detail: `模型 ${normalizedModel}｜HTTP 200｜${message}｜finishReason: ${finishReason}｜parts: ${partTypes}`
    };
}

function sanitizeGeminiMessage(value) {
    return String(value || '未知錯誤')
        .replace(/AIza[0-9A-Za-z_-]{8,}/g, '[API key 已隱藏]')
        .replace(/([?&]key=)[^\s&]+/gi, '$1[已隱藏]')
        .slice(0, 500);
}

export function describeGeminiApiError(payload, status, model) {
    const details = Array.isArray(payload?.error?.details) ? payload.error.details : [];
    const quotaFailure = details.find(detail => String(detail?.['@type'] || '').endsWith('QuotaFailure'));
    const retryInfo = details.find(detail => String(detail?.['@type'] || '').endsWith('RetryInfo'));
    const normalizedStatus = Number(status) || Number(payload?.error?.code) || 0;
    const normalizedModel = normalizeModelId(model) || '未知模型';
    const message = sanitizeGeminiMessage(payload?.error?.message);
    const quotaId = quotaFailure?.violations?.find(violation => violation?.quotaId)?.quotaId || null;
    const retryDelay = retryInfo?.retryDelay || null;
    const pieces = [
        `模型 ${normalizedModel}`,
        normalizedStatus ? `HTTP ${normalizedStatus}` : null,
        message,
        quotaId ? `quota: ${quotaId}` : null,
        retryDelay ? `可於 ${retryDelay} 後重試` : null
    ].filter(Boolean);

    return {
        isQuota: normalizedStatus === 429 || payload?.error?.status === 'RESOURCE_EXHAUSTED',
        status: normalizedStatus,
        model: normalizedModel,
        message,
        quotaId,
        retryDelay,
        detail: pieces.join('｜')
    };
}

function getWebResearchModelVerificationKey(apiKey, model) {
    return `${WEB_RESEARCH_MODEL_VERIFICATION_PREFIX}${hashString(String(apiKey || ''))}:${normalizeModelId(model)}`;
}

export function readWebResearchModelVerification(storage, apiKey, model, now = Date.now()) {
    const key = getWebResearchModelVerificationKey(apiKey, model);
    let raw;
    try {
        raw = storage.getItem(key);
    } catch (error) {
        return null;
    }
    if (!raw) return null;

    try {
        const parsed = JSON.parse(raw);
        const validStatus = parsed?.status === 'supported' || parsed?.status === 'unsupported';
        const validTime = typeof parsed?.savedAt === 'number'
            && Number.isFinite(parsed.savedAt)
            && parsed.savedAt > 0
            && parsed.savedAt <= now;
        if (!validStatus || !validTime || now - parsed.savedAt > WEB_RESEARCH_MODEL_VERIFICATION_TTL_MS) {
            removeStorageItem(storage, key);
            return null;
        }
        return parsed.status;
    } catch (error) {
        removeStorageItem(storage, key);
        return null;
    }
}

export function writeWebResearchModelVerification(storage, apiKey, model, status, now = Date.now()) {
    if (status !== 'supported' && status !== 'unsupported') {
        throw new TypeError('Web research model verification status must be supported or unsupported');
    }
    storage.setItem(getWebResearchModelVerificationKey(apiKey, model), JSON.stringify({ status, savedAt: now }));
}

export function getWebResearchCacheKey(text) {
    const normalizedText = normalizeSourceText(text);
    return `${WEB_RESEARCH_CACHE_PREFIX}${hashString(normalizedText)}`;
}

function removeStorageItem(storage, key) {
    try {
        storage.removeItem(key);
    } catch (error) {
        // Storage can be unavailable in private/restricted browser contexts.
    }
}

export function readWebResearchCache(storage, text, now = Date.now()) {
    const key = getWebResearchCacheKey(text);
    let raw;
    try {
        raw = storage.getItem(key);
    } catch (error) {
        return null;
    }
    if (!raw) return null;

    try {
        const parsed = JSON.parse(raw);
        const isValid = parsed?.source === normalizeSourceText(text)
            && typeof parsed?.value === 'string'
            && parsed.value.trim().length > 0
            && typeof parsed?.savedAt === 'number'
            && Number.isFinite(parsed.savedAt)
            && parsed.savedAt > 0
            && parsed.savedAt <= now;
        if (!isValid) {
            removeStorageItem(storage, key);
            return null;
        }
        if (now - parsed.savedAt > WEB_RESEARCH_CACHE_TTL_MS) {
            removeStorageItem(storage, key);
            return null;
        }
        return parsed.value;
    } catch (error) {
        removeStorageItem(storage, key);
        return null;
    }
}

export function writeWebResearchCache(storage, text, value, now = Date.now()) {
    storage.setItem(getWebResearchCacheKey(text), JSON.stringify({
        source: normalizeSourceText(text),
        value,
        savedAt: now
    }));
}

export function getWebResearchCooldownRemaining(storage, now = Date.now()) {
    let lastRun = 0;
    try {
        lastRun = Number(storage.getItem('lastWebPolishTime') || 0);
    } catch (error) {
        return 0;
    }
    if (!Number.isFinite(lastRun) || lastRun <= 0 || lastRun > now) return 0;
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
