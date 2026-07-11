export const MD_RULES = [
    { trigger: 'space', match: '#',   tool: 'header',    data: { level: 1 } },
    { trigger: 'space', match: '##',  tool: 'header',    data: { level: 2 } },
    { trigger: 'space', match: '###', tool: 'header',    data: { level: 3 } },
    { trigger: 'space', match: '-',   tool: 'list',      data: { style: 'unordered' } },
    { trigger: 'space', match: '*',   tool: 'list',      data: { style: 'unordered' } },
    { trigger: 'space', match: '1.',  tool: 'list',      data: { style: 'ordered' } },
    { trigger: 'space', match: '[]',  tool: 'checklist', data: { items: [{ text: '', checked: false }] } },
    { trigger: 'space', match: '>',   tool: 'quote',     data: { text: '', caption: '' } },
    { trigger: 'enter', match: '```', tool: 'code',      data: { code: '' } },
    { trigger: 'enter', match: '---', tool: 'delimiter', data: {} }
];

export function matchMdRule(blockText, trigger) {
    const text = (blockText || '').replace(/ /g, ' ').trim();
    return MD_RULES.find(r => r.trigger === trigger && r.match === text) || null;
}

export function attachMdShortcuts(getEditor, containerEl) {
    const onKeydown = async (e) => {
        if (e.isComposing) return;
        const trigger = (e.key === ' ' || e.code === 'Space') ? 'space'
            : (e.key === 'Enter' ? 'enter' : null);
        if (!trigger) return;
        const editor = getEditor();
        if (!editor) return;
        try {
            const idx = editor.blocks.getCurrentBlockIndex();
            if (idx < 0) return;
            const block = editor.blocks.getBlockByIndex(idx);
            if (!block || block.name !== 'paragraph') return;
            const rule = matchMdRule(block.holder ? block.holder.innerText : '', trigger);
            if (!rule) return;
            e.preventDefault();
            e.stopPropagation();
            // insert-with-replace avoids per-tool conversionConfig requirements
            editor.blocks.insert(rule.tool, rule.data, undefined, idx, true, true);
            if (rule.tool === 'delimiter') {
                editor.blocks.insert('paragraph', {}, undefined, idx + 1, true);
                editor.caret.setToBlock(idx + 1, 'start');
            } else {
                editor.caret.setToBlock(idx, 'start');
            }
        } catch (err) {
            // degrade: let the key behave natively, never swallow input
            console.warn('[md-shortcuts] conversion skipped:', err);
        }
    };
    containerEl.addEventListener('keydown', onKeydown, true);
    return () => containerEl.removeEventListener('keydown', onKeydown, true);
}