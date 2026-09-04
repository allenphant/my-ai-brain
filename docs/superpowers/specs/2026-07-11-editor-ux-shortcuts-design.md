# Editor UX: Keyboard Layer Stack, Markdown Conversion, Ctrl+A Restoration

Date: 2026-07-11
Status: Approved by user

## Goal

Close the gap between the current EditorJS-based editor and the Notion-like block
editing experience it was designed to imitate. Three workstreams, agreed with the user:

1. Refactor all keyboard shortcut handling into a single layered system that respects
   modal hierarchy (no new shortcuts — existing behavior only).
2. Markdown type-to-convert for block creation, plus a Chinese-searchable `/` menu.
3. Remove the custom Ctrl+A patch and restore EditorJS native two-stage selection.

Out of scope (explicitly deferred): block drag-and-drop reordering, cross-block mouse
selection, full Notion shortcut parity, toggle/table/image tools.

## 1. Keyboard Layer Stack

### Concept

One single `document`-level keydown listener for the whole app, backed by a stack of
"layers". The topmost layer owns the keyboard. Keys not declared by the top layer fall
through to native browser behavior — never to lower layers.

### Layer shape

```js
{
  name: 'editor',                 // matched on pop
  keys: {
    'Escape': (e, ctx) => { ... },
    'mod+a':  (e, ctx) => { ... }, // mod = Ctrl on Win / Cmd on Mac
  },
  onUnhandledKey: 'passthrough'
}
```

`ctx` provides `editableFocus` (whether `document.activeElement` is an
input/textarea/contenteditable or inside one) so handlers don't repeat that check.

### Stack lifecycle

- `base` layer pushed once at startup; never popped.
- Each modal's open function pushes its layer; every close path (button, backdrop,
  Escape, save) goes through a single `closeXxxModal()` that pops it.
  New small helpers `openSettingsModal/closeSettingsModal`, `openCategoryModal/...`,
  etc. replace the scattered inline `classList` toggles for settings, category manager,
  add-card, and edit modals.
- `openEditor` pushes the `editor` layer; `closeEditor` pops it.
- `popKeyLayer(name)` verifies the name of the layer it pops; on mismatch or empty
  stack it logs `console.warn` and no-ops (keyboard must never die from a leaked layer).

### Key tables (existing behavior only, no new keys)

| Layer | Key | Behavior |
|---|---|---|
| base | mod+z / mod+y / mod+shift+z | Card-move undo/redo via historyManager, only when `!ctx.editableFocus` (else passthrough) |
| settings / category / add-card / edit | Escape | Close that modal |
| settings / category / add-card / edit | mod+a | Passthrough when `ctx.editableFocus`; otherwise preventDefault (background text-selection protection) |
| editor | Escape | No-op if an EditorJS popover/settings/inline-toolbar is open (`.ce-settings--opened, .ce-popover--opened, .ce-inline-toolbar--showed`); otherwise `closeEditor()` |
| editor | mod+a | Full passthrough — EditorJS native two-stage selection handles it (see §3) |

### IME safety

If `e.isComposing` is true, the manager passes the event through untouched at the very
top — no layer logic runs during CJK composition.

### Listeners removed by this refactor

All current scattered keydown listeners collapse into the manager: the Escape-to-close
editor listener, the Escape-for-add-card branch, the global undo/redo listener with its
five `getElementById` modal checks, and the custom Ctrl+A patch.

## 2. Markdown Type-to-Convert + `/` Menu

### Trigger

A keydown listener (capture phase) on `#editorjs-container`, attached in `initEditor`
and removed on editor destroy. Two trigger keys:

- **Space** — prefix-style syntax
- **Enter** — whole-line syntax (`---`, ```` ``` ````)

### Conversion conditions (all must hold, otherwise do nothing)

1. Current block type is `paragraph`.
2. The block's entire text equals the syntax token exactly at the moment the trigger
   key is pressed (e.g. the whole line is `##`).
3. `e.isComposing === false`.

### Rule table (data-driven)

| Input + trigger | Converts to | data |
|---|---|---|
| `#` + Space | header | `{ level: 1 }` |
| `##` + Space | header | `{ level: 2 }` |
| `###` + Space | header | `{ level: 3 }` |
| `-` or `*` + Space | list | `{ style: 'unordered' }` |
| `1.` + Space | list | `{ style: 'ordered' }` |
| `[]` + Space | checklist | `{ items: [{ text: '', checked: false }] }` |
| `>` + Space | quote | `{ text: '', caption: '' }` |
| ```` ``` ```` + Enter | code | `{ code: '' }` |
| `---` + Enter | delimiter | `{}` then insert an empty paragraph below and focus it |

### Mechanics

On match: `e.preventDefault()`, then `editorInstance.blocks.convert(blockId, toolName,
data)`, then `caret.setToBlock(index, 'start')`. Official APIs only — no direct DOM
manipulation — so editorjs-undo records the conversion and Ctrl+Z undoes it.

### Degradation

Any thrown error from `blocks.convert` (future API drift) is caught; the key event is
released to native behavior. Worst case: no conversion, the typed character appears.
Never swallow input.

### New tools (installed with this work, pinned)

- `@editorjs/inline-code` — inline toolbar tool (no md trigger)
- `@editorjs/code` — code block, target of ```` ``` ````
- `@editorjs/delimiter` — divider, target of `---`

### `/` menu (native, made Chinese-searchable)

EditorJS natively opens a searchable toolbox popover when `/` is typed in an empty
block; all installed tools appear automatically. Add an `i18n` config to `initEditor`:

- `toolNames`: 標題, 清單, 待辦清單, 引用, 程式碼, 分隔線, 螢光筆, 行內程式碼, 文字
- `ui` strings for toolbar/popover chrome (Add, Move up, Delete, Filter, ...)

so filtering works by typing Chinese. Markdown conversion and the `/` menu coexist:
menu for discoverability, syntax for speed — same as Notion.

## 3. Ctrl+A Restoration

Delete the custom DOM-range select-all patch (currently around app.js:2150). The editor
layer declares `mod+a` as full passthrough, restoring EditorJS native behavior:

- 1st Ctrl+A: select current block's text
- 2nd Ctrl+A: block-selection mode across all blocks (Delete removes all; Ctrl+C copies)

The title field (`#editor-title`, single contenteditable) also gets native Ctrl+A via
passthrough. The background-protection behavior for other modals moves into their
layers' `mod+a` handlers (§1).

## 4. CDN Version Pinning

All EditorJS-related scripts in index.html (5 existing + 3 new) change from `@latest`
to explicit versions verified working at implementation time, with an inline comment
recording the pin date. Upgrades become deliberate manual actions. (Markdown conversion
depends on `blocks.convert`, so EditorJS core must be ≥ 2.30.)

## 5. Verification (manual browser checklist — no test framework in this project)

1. Each md rule: converts correctly; Ctrl+Z reverts to the pre-conversion paragraph.
2. `/` menu: opens on `/`, Chinese filter matches (e.g. 「標」→ 標題).
3. Ctrl+A: two-stage select → Delete all → Ctrl+Z restores.
4. Layers: for every modal, open/close then verify Escape and Ctrl+Z ownership;
   verify no interception during IME composition.
5. Regression: editor open/close, 1s-debounce autosave, title sync, layout toggle
   (modal/side) all unaffected.

## Key decisions

- **Single listener + layer stack** over per-listener guard clauses: hierarchy rules
  live in one structure instead of being re-implemented in every listener.
- **Hand-rolled md interceptor (~60-80 lines)** over community plugins: those are
  largely unmaintained and incompatible with current EditorJS; the rule table keeps
  full control and easy extension.
- **Native two-stage Ctrl+A** over one-shot select-all: zero custom selection code,
  defined delete semantics, lowest risk.
- **No new shortcuts** in this pass (user decision, YAGNI).
