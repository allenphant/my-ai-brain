export const AUTO_RESEARCH_INTERVALS = Object.freeze({
    off: 0,
    '6h': 6 * 60 * 60_000,
    '12h': 12 * 60 * 60_000,
    daily: 24 * 60 * 60_000,
    '3d': 3 * 24 * 60 * 60_000,
    weekly: 7 * 24 * 60 * 60_000
});

export const AUTO_RESEARCH_MAX_UNCHANGED_FAILURES = 3;

const hashText = value => {
    let hash = 2166136261;
    for (const char of String(value || '').trim()) {
        hash ^= char.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
};

const normalizeState = value => {
    const failures = value?.failures && typeof value.failures === 'object' ? value.failures : {};
    return {
        lastRunAt: Number(value?.lastRunAt) || 0,
        lastCompletedAt: Number(value?.lastCompletedAt) || 0,
        failures: Object.fromEntries(Object.entries(failures).flatMap(([key, failure]) => {
            const fingerprint = String(failure?.fingerprint || '');
            const attempts = Math.max(0, Number(failure?.attempts) || 0);
            if (!key || !fingerprint || attempts === 0) return [];
            return [[key, {
                fingerprint,
                attempts,
                reason: String(failure?.reason || '').slice(0, 240),
                updatedAt: Number(failure?.updatedAt) || 0
            }]];
        }))
    };
};

export function getAutoResearchStateKey(userId) {
    return `autoResearchSchedule:v1:${String(userId || 'anonymous')}`;
}

export function readAutoResearchState(storage, userId) {
    try {
        return normalizeState(JSON.parse(storage.getItem(getAutoResearchStateKey(userId)) || '{}'));
    } catch {
        return normalizeState({});
    }
}

export function writeAutoResearchState(storage, userId, state) {
    const normalized = normalizeState(state);
    storage.setItem(getAutoResearchStateKey(userId), JSON.stringify(normalized));
    return normalized;
}

export function getAutoResearchIntervalMs(value) {
    return AUTO_RESEARCH_INTERVALS[String(value)] || 0;
}

export function getAutoResearchDue({ interval = 'off', lastRunAt = 0, now = Date.now() } = {}) {
    const intervalMs = getAutoResearchIntervalMs(interval);
    if (!intervalMs) return { enabled: false, due: false, nextRunAt: 0, remainingMs: 0 };
    const nextRunAt = Number(lastRunAt) > 0 ? Number(lastRunAt) + intervalMs : now;
    return {
        enabled: true,
        due: now >= nextRunAt,
        nextRunAt,
        remainingMs: Math.max(0, nextRunAt - now)
    };
}

export function getAutoResearchFingerprint(sourceText) {
    return hashText(sourceText);
}

export function recordAutoResearchFailure(state, {
    key,
    sourceText,
    reason = '',
    now = Date.now()
} = {}) {
    const next = normalizeState(state);
    const fingerprint = getAutoResearchFingerprint(sourceText);
    const previous = next.failures[key];
    const attempts = previous?.fingerprint === fingerprint ? previous.attempts + 1 : 1;
    next.failures[key] = { fingerprint, attempts, reason: String(reason).slice(0, 240), updatedAt: now };
    return {
        state: next,
        attempts,
        blocked: attempts >= AUTO_RESEARCH_MAX_UNCHANGED_FAILURES
    };
}

export function clearAutoResearchFailure(state, key) {
    const next = normalizeState(state);
    delete next.failures[key];
    return next;
}

export function selectAutoResearchCandidates(groups = [], state = {}) {
    const normalized = normalizeState(state);
    const runnable = [];
    const blocked = [];
    for (const group of Array.isArray(groups) ? groups : []) {
        for (const item of Array.isArray(group?.items) ? group.items : []) {
            const key = `${group.id}/${item.id}`;
            const failure = normalized.failures[key];
            const unchanged = failure?.fingerprint === getAutoResearchFingerprint(item?.text);
            const entry = { key, group, item, failure: unchanged ? failure : null };
            if (unchanged && failure.attempts >= AUTO_RESEARCH_MAX_UNCHANGED_FAILURES) blocked.push(entry);
            else runnable.push(entry);
        }
    }
    return { runnable, blocked };
}
