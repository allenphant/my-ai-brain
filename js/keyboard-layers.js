export function normalizeCombo(e) {
    const parts = [];
    if (e.ctrlKey || e.metaKey) parts.push('mod');
    if (e.shiftKey) parts.push('shift');
    if (e.altKey) parts.push('alt');
    parts.push(e.key.length === 1 ? e.key.toLowerCase() : e.key);
    return parts.join('+');
}

export function createLayerStack() {
    const stack = [];
    return {
        push(layer) {
            const top = stack[stack.length - 1];
            if (top && top.name === layer.name) {
                stack[stack.length - 1] = layer;
            } else {
                stack.push(layer);
            }
        },
        pop(name) {
            const top = stack[stack.length - 1];
            if (top && top.name === name) {
                stack.pop();
                return;
            }
            console.warn(`[keyboard-layers] pop mismatch: top is "${top ? top.name : '(empty)'}", asked "${name}"`);
            const idx = stack.map(l => l.name).lastIndexOf(name);
            if (idx >= 0) stack.splice(idx, 1);
        },
        top() { return stack[stack.length - 1] || null; },
        depth() { return stack.length; }
    };
}

export function attachKeyboardManager(stack, doc = document) {
    const editableFocus = () => {
        const el = doc.activeElement;
        return !!(el && (
            el.tagName === 'INPUT' ||
            el.tagName === 'TEXTAREA' ||
            el.isContentEditable ||
            (el.closest && el.closest('[contenteditable]'))
        ));
    };
    doc.addEventListener('keydown', (e) => {
        if (e.isComposing) return;
        const layer = stack.top();
        if (!layer) return;
        const handler = layer.keys[normalizeCombo(e)];
        if (handler) handler(e, { editableFocus: editableFocus() });
    });
}
