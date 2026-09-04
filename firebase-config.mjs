/**
 * 解析使用者輸入的 Firebase Config 字串或物件
 * 支援標準 JSON 以及從 Firebase Console 複製之 JavaScript 物件片段
 */
export function parseFirebaseConfig(raw) {
    if (!raw) return null;
    if (typeof raw === 'object') {
        return (raw.apiKey && raw.projectId) ? raw : null;
    }
    if (typeof raw !== 'string') return null;
    let str = raw.trim();
    if (!str) return null;

    const eqIdx = str.indexOf('=');
    if (eqIdx !== -1) {
        const prefix = str.substring(0, eqIdx).trim();
        if (/^(const|let|var)?\s*[a-zA-Z0-9_$]+$/.test(prefix)) {
            str = str.substring(eqIdx + 1).trim();
        }
    }
    if (str.endsWith(';')) {
        str = str.slice(0, -1).trim();
    }

    // 優先使用原生 JSON.parse
    try {
        const parsed = JSON.parse(str);
        if (parsed && typeof parsed === 'object' && parsed.apiKey && parsed.projectId) {
            return parsed;
        }
    } catch (_) {}

    // 處理物件無引號鍵名或單引號
    try {
        const sanitized = str
            .replace(/([{,]\s*)([a-zA-Z0-9_$]+)\s*:/g, '$1"$2":')
            .replace(/'/g, '"');
        const parsed = JSON.parse(sanitized);
        if (parsed && typeof parsed === 'object' && parsed.apiKey && parsed.projectId) {
            return parsed;
        }
    } catch (_) {}

    // 容錯回退：安全物件字面量評估
    try {
        const fn = new Function('return (' + str + ')');
        const parsed = fn();
        if (parsed && typeof parsed === 'object' && parsed.apiKey && parsed.projectId) {
            return parsed;
        }
    } catch (_) {}

    return null;
}
