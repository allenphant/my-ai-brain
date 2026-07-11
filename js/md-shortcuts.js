export const MD_RULES = [
    { trigger: 'space', match: '#',   tool: 'header',    data: { level: 1 } },
    { trigger: 'space', match: '##',  tool: 'header',    data: { level: 2 } },
    { trigger: 'space', match: '###', tool: 'header',    data: { level: 3 } },
    { trigger: 'space', match: '-',   tool: 'list',      data: { style: 'unordered', meta: {}, items: [{ content: '', meta: {}, items: [] }] } },
    { trigger: 'space', match: '*',   tool: 'list',      data: { style: 'unordered', meta: {}, items: [{ content: '', meta: {}, items: [] }] } },
    { trigger: 'space', match: '1.',  tool: 'list',      data: { style: 'ordered', meta: {}, items: [{ content: '', meta: {}, items: [] }] } },
    { trigger: 'space', match: '[]',  tool: 'checklist', data: { items: [{ text: '', checked: false }] } },
    { trigger: 'space', match: '>',   tool: 'quote',     data: { text: '', caption: '' } },
    { trigger: 'enter', match: '```', tool: 'code',      data: { code: '' } },
    { trigger: 'enter', match: '---', tool: 'delimiter', data: {} }
];

export function matchMdRule(blockText, trigger) {
    const text = (blockText || '').replace(/ /g, ' ').trim();
    return MD_RULES.find(r => r.trigger === trigger && r.match === text) || null;
}

export function attachMdShortcuts(getEditor, containerEl) {
    const onKeydown = (e) => {
        if (e.isComposing) return;
        const trigger = (e.key === ' ' || e.code === 'Space') ? 'space'
            : (e.key === 'Enter' ? 'enter' : null);
        if (!trigger) return;
        const editor = getEditor();
        if (!editor) return;

        // Phase 1: read + match without suppressing the key. Any throw here
        // falls through to native behavior (the key was never prevented).
        let idx, block, rule;
        try {
            idx = editor.blocks.getCurrentBlockIndex();
            if (idx < 0) return;
            block = editor.blocks.getBlockByIndex(idx);
            if (!block || block.name !== 'paragraph') return;
            rule = matchMdRule(block.holder ? block.holder.innerText : '', trigger);
        } catch (err) {
            console.warn('[md-shortcuts] match skipped:', err);
            return;
        }
        if (!rule) return;

        // Phase 2: committed to conversion. Suppress the trigger key, then mutate.
        e.preventDefault();
        e.stopPropagation();
        try {
            editor.blocks.insert(rule.tool, rule.data, undefined, idx, true, true);
            if (rule.tool === 'delimiter') {
                editor.blocks.insert('paragraph', {}, undefined, idx + 1, true);
                editor.caret.setToBlock(idx + 1, 'start');
            } else {
                editor.caret.setToBlock(idx, 'start');
            }
        } catch (err) {
            console.warn('[md-shortcuts] conversion failed:', err);
        }
    };
    containerEl.addEventListener('keydown', onKeydown, true);
    return () => containerEl.removeEventListener('keydown', onKeydown, true);
}
