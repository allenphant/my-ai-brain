# Editor UX (Keyboard Layers, MD Conversion, Ctrl+A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace scattered keyboard listeners with a layered manager, add markdown type-to-convert + Chinese `/` menu to the EditorJS editor, and restore native two-stage Ctrl+A.

**Architecture:** Two new ES modules (`js/keyboard-layers.js`, `js/md-shortcuts.js`) hold the pure logic, unit-tested with `node --test`. `app.js` imports them and wires DOM/EditorJS integration. `index.html` pins all EditorJS CDN versions and adds three tools (inline-code, code, delimiter).

**Tech Stack:** Vanilla ES modules, EditorJS ≥ 2.30 (needs `blocks.insert` with replace), node:test for pure-logic tests. No build step; files served as-is (GitHub Pages).

**Spec:** `docs/superpowers/specs/2026-07-11-editor-ux-shortcuts-design.md`

## Global Constraints

- No new user-facing shortcuts — existing behavior only (user decision).
- All EditorJS-related CDN scripts pinned to explicit versions with a `<!-- pinned YYYY-MM-DD -->` comment; EditorJS core must be ≥ 2.30.
- All user-visible copy in Traditional Chinese (zh-TW).
- During IME composition (`e.isComposing === true`) no custom key handling may run.
- Errors in md conversion must degrade to native input (never swallow typed characters).
- Code style: match app.js (4-space indent, single quotes, semicolons).

---

### Task 1: Keyboard layer core module

**Files:**
- Create: `js/keyboard-layers.js`
- Test: `tests/keyboard-layers.test.mjs`

**Interfaces:**
- Produces: `normalizeCombo(e) -> string` (e.g. `'mod+a'`, `'Escape'`, `'mod+shift+z'`);
  `createLayerStack() -> { push(layer), pop(name), top(), depth() }` where `layer = { name: string, keys: { [combo]: (e, ctx) => void } }`. `push` replaces the top layer when `top.name === layer.name` (idempotent re-open). `pop(name)` warns and removes by name if the top doesn't match; never throws.
  `attachKeyboardManager(stack, doc) -> void` — single keydown listener; builds `ctx = { editableFocus: boolean }`; skips entirely when `e.isComposing`; unhandled combos pass through natively.

- [ ] **Step 1: Write the failing test**

```js
// tests/keyboard-layers.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCombo, createLayerStack } from '../js/keyboard-layers.js';

test('normalizeCombo: plain key', () => {
    assert.equal(normalizeCombo({ key: 'Escape', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false }), 'Escape');
});

test('normalizeCombo: ctrl+letter lowercases', () => {
    assert.equal(normalizeCombo({ key: 'A', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false }), 'mod+a');
});

test('normalizeCombo: meta acts as mod, shift ordered before key', () => {
    assert.equal(normalizeCombo({ key: 'Z', ctrlKey: false, metaKey: true, shiftKey: true, altKey: false }), 'mod+shift+z');
});

test('stack: top layer wins, base reachable when alone', () => {
    const s = createLayerStack();
    s.push({ name: 'base', keys: {} });
    s.push({ name: 'editor', keys: {} });
    assert.equal(s.top().name, 'editor');
    s.pop('editor');
    assert.equal(s.top().name, 'base');
});

test('stack: push with same name replaces top (re-open)', () => {
    const s = createLayerStack();
    s.push({ name: 'base', keys: {} });
    s.push({ name: 'editor', keys: { 'Escape': () => 'v1' } });
    s.push({ name: 'editor', keys: { 'Escape': () => 'v2' } });
    assert.equal(s.depth(), 2);
    assert.equal(s.top().keys['Escape'](), 'v2');
});

test('stack: mismatched pop warns and removes by name, never throws', () => {
    const s = createLayerStack();
    s.push({ name: 'base', keys: {} });
    s.push({ name: 'settings', keys: {} });
    s.push({ name: 'editor', keys: {} });
    s.pop('settings'); // out of order
    assert.equal(s.depth(), 2);
    assert.equal(s.top().name, 'editor');
    s.pop('nonexistent'); // no-op, no throw
    assert.equal(s.depth(), 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/keyboard-layers.test.mjs`
Expected: FAIL — `Cannot find module '../js/keyboard-layers.js'`

- [ ] **Step 3: Write the implementation**

```js
// js/keyboard-layers.js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/keyboard-layers.test.mjs`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add js/keyboard-layers.js tests/keyboard-layers.test.mjs
git commit -m "feat(keyboard): add layered key manager core with tests"
```

---

### Task 2: Markdown rule matcher module

**Files:**
- Create: `js/md-shortcuts.js`
- Test: `tests/md-shortcuts.test.mjs`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `MD_RULES` (array), `matchMdRule(blockText, trigger) -> rule | null` where
  `trigger` is `'space' | 'enter'` and `rule = { trigger, match, tool, data }`;
  `attachMdShortcuts(getEditor, containerEl) -> cleanupFn` (DOM part, exercised in browser in Task 5).

- [ ] **Step 1: Write the failing test**

```js
// tests/md-shortcuts.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchMdRule } from '../js/md-shortcuts.js';

test('## + space -> header level 2', () => {
    const r = matchMdRule('##', 'space');
    assert.equal(r.tool, 'header');
    assert.deepEqual(r.data, { level: 2 });
});

test('- and * + space -> unordered list', () => {
    assert.equal(matchMdRule('-', 'space').data.style, 'unordered');
    assert.equal(matchMdRule('*', 'space').data.style, 'unordered');
});

test('1. + space -> ordered list', () => {
    assert.equal(matchMdRule('1.', 'space').data.style, 'ordered');
});

test('[] + space -> checklist with one empty item', () => {
    const r = matchMdRule('[]', 'space');
    assert.equal(r.tool, 'checklist');
    assert.deepEqual(r.data.items, [{ text: '', checked: false }]);
});

test('> + space -> quote', () => {
    assert.equal(matchMdRule('>', 'space').tool, 'quote');
});

test('``` + enter -> code; --- + enter -> delimiter', () => {
    assert.equal(matchMdRule('```', 'enter').tool, 'code');
    assert.equal(matchMdRule('---', 'enter').tool, 'delimiter');
});

test('wrong trigger or extra text does not match', () => {
    assert.equal(matchMdRule('##', 'enter'), null);
    assert.equal(matchMdRule('## title', 'space'), null);
    assert.equal(matchMdRule('text ##', 'space'), null);
});

test('nbsp and surrounding whitespace tolerated', () => {
    assert.equal(matchMdRule('\u00a0##\u00a0', 'space').tool, 'header');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/md-shortcuts.test.mjs`
Expected: FAIL — `Cannot find module '../js/md-shortcuts.js'`

- [ ] **Step 3: Write the implementation**

```js
// js/md-shortcuts.js
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
    const text = (blockText || '').replace(/\u00a0/g, ' ').trim();
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/md-shortcuts.test.mjs`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add js/md-shortcuts.js tests/md-shortcuts.test.mjs
git commit -m "feat(editor): add markdown rule matcher module with tests"
```

---

### Task 3: Pin EditorJS CDN versions and add three tools

**Files:**
- Modify: `index.html:14-20` (the EditorJS script tags)

**Interfaces:**
- Produces: globals `CodeTool` (@editorjs/code), `Delimiter` (@editorjs/delimiter), `InlineCode` (@editorjs/inline-code) available to Task 5. Existing globals stay: `EditorJS`, `Header`, `EditorjsList`, `Checklist`, `Quote`, `Marker`, `Undo`.

- [ ] **Step 1: Resolve current versions from jsdelivr**

Run for each package (`@editorjs/editorjs`, `@editorjs/header`, `@editorjs/list`, `@editorjs/checklist`, `@editorjs/quote`, `@editorjs/marker`, `@editorjs/inline-code`, `@editorjs/code`, `@editorjs/delimiter`, `editorjs-undo`):

```bash
curl -s "https://data.jsdelivr.com/v1/packages/npm/@editorjs/editorjs/resolved" # -> {"version":"2.3x.x"}
```

Record each resolved version. If the API is unreachable, use these known-good fallbacks: editorjs 2.30.8, header 2.8.8, list 2.0.8, checklist 1.6.0, quote 2.7.6, marker 1.4.0, inline-code 1.5.1, code 2.9.3, delimiter 1.4.2, editorjs-undo 3.0.20. Editorjs core MUST be ≥ 2.30.

- [ ] **Step 2: Replace the `@latest` script tags**

Replace index.html lines 14-20 with (substituting resolved versions):

```html
    <!-- EditorJS pinned 2026-07-11 — bump versions deliberately, never @latest -->
    <script src="https://cdn.jsdelivr.net/npm/@editorjs/editorjs@2.30.8"></script>
    <script src="https://cdn.jsdelivr.net/npm/@editorjs/header@2.8.8"></script>
    <script src="https://cdn.jsdelivr.net/npm/@editorjs/list@2.0.8"></script>
    <script src="https://cdn.jsdelivr.net/npm/@editorjs/checklist@1.6.0"></script>
    <script src="https://cdn.jsdelivr.net/npm/@editorjs/quote@2.7.6"></script>
    <script src="https://cdn.jsdelivr.net/npm/@editorjs/marker@1.4.0"></script>
    <script src="https://cdn.jsdelivr.net/npm/@editorjs/inline-code@1.5.1"></script>
    <script src="https://cdn.jsdelivr.net/npm/@editorjs/code@2.9.3"></script>
    <script src="https://cdn.jsdelivr.net/npm/@editorjs/delimiter@1.4.2"></script>
    <script src="https://cdn.jsdelivr.net/npm/editorjs-undo@3.0.20"></script>
```

- [ ] **Step 3: Verify every pinned URL serves 200**

```bash
for u in editorjs@2.30.8 header@2.8.8 list@2.0.8 checklist@1.6.0 quote@2.7.6 marker@1.4.0 inline-code@1.5.1 code@2.9.3 delimiter@1.4.2; do
  curl -s -o /dev/null -w "%{http_code} @editorjs/$u\n" "https://cdn.jsdelivr.net/npm/@editorjs/$u"
done
curl -s -o /dev/null -w "%{http_code} editorjs-undo\n" "https://cdn.jsdelivr.net/npm/editorjs-undo@3.0.20"
```

Expected: all `200`.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "build: pin all EditorJS CDN versions; add inline-code, code, delimiter tools"
```

---

### Task 4: Wire the keyboard layer manager into app.js

**Files:**
- Modify: `app.js` — imports at top; modal open/close sites (see anchors below); delete old document-level keydown listeners.

**Interfaces:**
- Consumes: `createLayerStack`, `attachKeyboardManager` from `js/keyboard-layers.js` (Task 1).
- Produces: module-level `keyLayers` stack; `modalKeys(closeFn)` helper; `closeSettingsModal()`, `closeCategoryModal()`, `closeEditCardModal()` used by every close path. `openEditor`/`closeEditor` push/pop the `editor` layer (Task 5 relies on the layer existing).

**Anchors in current app.js (verify with grep before editing — earlier tasks don't shift them):**
- Settings open: `document.getElementById('settings-btn').addEventListener` (~line 1673); closes at close-modal-btn (~1687), backdrop (~1681), save-settings (~1708).
- Category open: `manage-categories-btn` (~289); closes at `close-category-modal-btn` (~294), `cat-cancel-btn` (~295), backdrop (~299). Also grep `categoryModal.classList.add('hidden')` for any other close site.
- Add-card: `window.openAddCardModal` (~1190) / `window.closeAddCardModal` (~1199).
- Edit modal open: `editModal.classList.remove('hidden')` (~896); closes at ~1268 (cancel) and ~1295 (save finally).
- Editor: `openEditor` (~1901) / `closeEditor` (~2029).
- DELETE: standalone editor-Escape listener (~2081-2087) and the entire combined keydown listener (~2131-2207, from `// --- Keyboard Shortcuts for Undo/Redo ---` comment through its closing `});`) — this removes the old Ctrl+A patch (spec §3).

- [ ] **Step 1: Add imports and bootstrap the stack**

At the top of app.js (after the Firebase imports):

```js
        import { createLayerStack, attachKeyboardManager } from './js/keyboard-layers.js';
        import { attachMdShortcuts } from './js/md-shortcuts.js';
```

Near the `historyManager` definition (grep `const historyManager`), add:

```js
        const keyLayers = createLayerStack();
        attachKeyboardManager(keyLayers);

        keyLayers.push({
            name: 'base',
            keys: {
                'mod+z': (e, ctx) => { if (!ctx.editableFocus) { e.preventDefault(); historyManager.undo(); } },
                'mod+y': (e, ctx) => { if (!ctx.editableFocus) { e.preventDefault(); historyManager.redo(); } },
                'mod+shift+z': (e, ctx) => { if (!ctx.editableFocus) { e.preventDefault(); historyManager.redo(); } }
            }
        });

        const modalKeys = (closeFn) => ({
            'Escape': (e) => { e.preventDefault(); closeFn(); },
            'mod+a': (e, ctx) => { if (!ctx.editableFocus) e.preventDefault(); }
        });
```

Note: base-layer handlers keep the old editable-focus guard so typing in the main
input never triggers card undo — identical behavior to the deleted listener.

- [ ] **Step 2: Settings modal — single close function + layer push/pop**

In the settings-btn open listener, after `classList.remove('hidden')` add:
`keyLayers.push({ name: 'settings', keys: modalKeys(closeSettingsModal) });`

Add next to it:

```js
        function closeSettingsModal() {
            document.getElementById('settings-modal').classList.add('hidden');
            keyLayers.pop('settings');
        }
```

Replace the three existing close sites (close-modal-btn listener, backdrop-click branch, end of save-settings-btn listener) so each calls `closeSettingsModal()` instead of `classList.add('hidden')`.

- [ ] **Step 3: Category modal — same pattern**

```js
        function closeCategoryModal() {
            categoryModal.classList.add('hidden');
            keyLayers.pop('category');
        }
```

Open site (`manage-categories-btn` listener): add `keyLayers.push({ name: 'category', keys: modalKeys(closeCategoryModal) });` after `classList.remove('hidden')`. Route close-category-modal-btn, cat-cancel-btn, backdrop click, and any other `categoryModal.classList.add('hidden')` site through `closeCategoryModal()` (keep their extra statements like `resetCategoryForm()`).

- [ ] **Step 4: Add-card modal — push/pop inside existing global functions**

In `window.openAddCardModal`, after `classList.remove('hidden')`:
`keyLayers.push({ name: 'add-card', keys: modalKeys(window.closeAddCardModal) });`
In `window.closeAddCardModal`, after `classList.add('hidden')`:
`keyLayers.pop('add-card');`
(The old combined listener's Escape-for-add-card branch dies with the listener in Step 6; the input's own Enter-to-submit keydown is element-level and stays.)

- [ ] **Step 5: Edit modal — wrap the three inline sites**

```js
        function openEditCardModal() {
            editModal.classList.remove('hidden');
            keyLayers.push({ name: 'edit', keys: modalKeys(closeEditCardModal) });
        }
        function closeEditCardModal() {
            editModal.classList.add('hidden');
            pendingEditTarget = null;
            keyLayers.pop('edit');
        }
```

Replace the open site (~896: `editModal.classList.remove('hidden')` → `openEditCardModal()`), the cancel listener (~1268), and the save `finally` close (~1295) accordingly (keep button-state restore lines).

- [ ] **Step 6: Editor layer + delete the old listeners**

In `openEditor`, right after `modal.classList.remove('hidden')`:

```js
            keyLayers.push({
                name: 'editor',
                keys: {
                    'Escape': (e) => {
                        if (document.querySelector('.ce-settings--opened, .ce-popover--opened, .ce-inline-toolbar--showed')) return;
                        e.preventDefault();
                        closeEditor();
                    }
                    // no 'mod+a' entry: passthrough -> EditorJS native two-stage select (spec §3)
                }
            });
```

(`push` replaces the top layer on same-name re-push, so re-opening the editor over itself is safe.)

In `closeEditor`, after `document.body.classList.remove('editor-open')`:
`keyLayers.pop('editor');`

DELETE both old blocks:
1. The standalone Escape listener (`document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && activeEditorCardId) ...`).
2. The entire combined listener from the `// --- Keyboard Shortcuts for Undo/Redo ---` comment to its closing `});` — this includes the custom Ctrl+A DOM-range patch being removed per spec §3.

- [ ] **Step 7: Syntax check + browser smoke test**

```bash
node --check app.js
```

Expected: exit 0. Then serve locally (`python -m http.server 8532`), open http://localhost:8532 in the Browser pane, and verify in console: `keyLayers` errors absent on load; open/close settings modal → Escape closes it once and a second Escape does nothing; Ctrl+Z on the main page with nothing focused logs no errors.

- [ ] **Step 8: Commit**

```bash
git add app.js
git commit -m "refactor(keyboard): route all shortcuts through layered manager; remove ctrl+a patch"
```

---

### Task 5: Editor upgrades — new tools, i18n, md shortcuts hookup

**Files:**
- Modify: `app.js` — `initEditor` (~1994) and `closeEditor` (~2029).

**Interfaces:**
- Consumes: `attachMdShortcuts` (imported in Task 4 Step 1); globals `CodeTool`, `Delimiter`, `InlineCode` (Task 3).
- Produces: module-level `mdShortcutsCleanup` used by `initEditor`/`closeEditor`.

- [ ] **Step 1: Extend initEditor tools + i18n**

In `initEditor`'s `config.tools`, add after the `Marker` entry:

```js
                    inlineCode: { class: InlineCode },
                    code: { class: CodeTool, config: { placeholder: '輸入程式碼' } },
                    delimiter: { class: Delimiter }
```

Add an `i18n` key to `config` (sibling of `tools`):

```js
                i18n: {
                    messages: {
                        ui: {
                            'blockTunes': { 'toggler': { 'Click to tune': '點擊調整', 'or drag to move': '或拖曳移動' } },
                            'inlineToolbar': { 'converter': { 'Convert to': '轉換為' } },
                            'toolbar': { 'toolbox': { 'Add': '新增區塊' } },
                            'popover': { 'Filter': '搜尋', 'Nothing found': '找不到項目', 'Convert to': '轉換為' }
                        },
                        toolNames: {
                            'Text': '文字', 'Heading': '標題', 'List': '清單',
                            'Unordered List': '項目清單', 'Ordered List': '數字清單',
                            'Checklist': '待辦清單', 'Quote': '引用', 'Code': '程式碼',
                            'Delimiter': '分隔線', 'Marker': '螢光筆', 'InlineCode': '行內程式碼',
                            'Bold': '粗體', 'Italic': '斜體', 'Link': '連結'
                        },
                        tools: {
                            'list': { 'Unordered': '項目符號', 'Ordered': '數字編號' },
                            'quote': { 'Enter a quote': '輸入引用內容', "Quote's author": '輸入來源' },
                            'header': { 'Heading 1': '標題 1', 'Heading 2': '標題 2', 'Heading 3': '標題 3' }
                        },
                        blockTunes: {
                            'delete': { 'Delete': '刪除', 'Click to delete': '點擊確認刪除' },
                            'moveUp': { 'Move up': '上移' },
                            'moveDown': { 'Move down': '下移' }
                        }
                    }
                }
```

- [ ] **Step 2: Attach/detach md shortcuts with the editor lifecycle**

Add module-level state next to `let editorInstance = null;`:

```js
        let mdShortcutsCleanup = null;
```

At the top of `initEditor` (inside, before creating the instance) and inside `closeEditor` (before `editorInstance.destroy()`), add:

```js
            if (mdShortcutsCleanup) { mdShortcutsCleanup(); mdShortcutsCleanup = null; }
```

At the end of `initEditor`, after `editorInstance = new EditorJS(config);`:

```js
            mdShortcutsCleanup = attachMdShortcuts(() => editorInstance, document.getElementById('editorjs-container'));
```

- [ ] **Step 3: Syntax check**

Run: `node --check app.js`
Expected: exit 0.

- [ ] **Step 4: Browser verification of md conversion + slash menu**

Serve locally, open the editor on any card (requires login; if no session available, temporarily verify with a standalone HTML harness that loads the same pinned CDN scripts + `js/md-shortcuts.js` and an EditorJS holder div, then delete the harness). Verify:
- `## ` → H2; `- ` → bullet list; `1. ` → ordered list; `[] ` → checklist; `> ` → quote; ` ``` `+Enter → code block; `---`+Enter → delimiter with an empty focused paragraph below.
- Each conversion undoes with Ctrl+Z back to the syntax text.
- `/` in an empty block opens the toolbox; typing `標` filters to 標題.
- Typing `## 標題文字` then space mid-way does NOT convert (text ≠ token).
- With a Chinese IME composing, space/Enter never triggers conversion.

- [ ] **Step 5: Commit**

```bash
git add app.js
git commit -m "feat(editor): add code/delimiter/inline-code tools, zh-TW i18n, md type-to-convert"
```

---

### Task 6: Full verification pass (spec §5)

**Files:** none created — fix regressions in place if found.

- [ ] **Step 1: Unit tests green**

Run: `node --test "tests/**/*.test.mjs"`
(Note: the bare directory form `node --test tests/` misresolves as a module path on Windows — use the glob form above.)
Expected: all pass.

- [ ] **Step 2: Manual checklist in the Browser pane (localhost server)**

1. Every md rule converts and Ctrl+Z reverts (Task 5 Step 4 list, re-run end-to-end).
2. `/` menu Chinese filtering works.
3. Ctrl+A in editor: 1st selects block text, 2nd selects all blocks; Delete removes all; Ctrl+Z restores. Ctrl+A in the title field selects title only.
4. Layer ownership: for each of settings/category/add-card/edit modals — open, press Escape (closes), press Escape again (nothing), Ctrl+A with focus outside inputs (blocked), Ctrl+A inside an input (native select). With editor open, Ctrl+Z inside content is EditorJS undo, and card-move undo never fires.
5. Regression: editor open/close animation, 1s autosave (`已儲存` status appears), title sync to card, layout toggle button, add-card Enter submit, card drag-and-drop undo/redo on main page.

- [ ] **Step 3: Fix anything found, re-run the failing item, then commit**

```bash
git add -A
git commit -m "test(editor): verification pass fixes"  # only if fixes were needed
```

---

## Self-review notes

- Spec coverage: §1 → Tasks 1+4; §2 → Tasks 2+3+5; §3 → Task 4 Step 6 + Task 6; §4 → Task 3; §5 → Task 6. No gaps.
- `insert(replace)` chosen over `blocks.convert` so tools without `conversionConfig` (checklist, delimiter, code) work uniformly; undo still records it (official API).
- Line anchors are hints; every step also gives a grep-able content anchor since Tasks 1-3 don't touch app.js.
