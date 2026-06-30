# Notion-like Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a Notion-like rich text editor modal that opens when a card is clicked, supporting block-based editing, lazy-loading, and auto-saving to Firestore.

**Architecture:** A custom HTML modal will overlay the dashboard. `Editor.js` will be loaded via CDN. Card clicks will trigger the modal, load the card's details subcollection, and bind the editor. An auto-save debouncer will write changes back to Firestore.

**Tech Stack:** Vanilla HTML/JS, Tailwind CSS, Firebase Firestore, Editor.js (via CDN).

## Global Constraints

- Must not break existing drag-and-drop or category sorting.
- Todo items must still be toggleable via their exact checkbox without opening the modal.
- No new build tools; use vanilla JS and CDN imports inside `index.html`.

---

### Task 1: Add Modal HTML Structure & CSS

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: Existing DOM.
- Produces: A hidden modal with ID `editor-modal`, a title input `editor-title`, a container `editorjs-container`, and close/layout toggle buttons.

- [ ] **Step 1: Add HTML for the Editor Modal**
Insert right before the closing `</body>` tag:
```html
    <!-- Editor Modal -->
    <div id="editor-modal" class="fixed inset-0 z-[100] hidden flex items-center justify-center pointer-events-none">
        <!-- Backdrop -->
        <div id="editor-backdrop" class="absolute inset-0 bg-slate-900/40 backdrop-blur-sm opacity-0 transition-opacity pointer-events-auto"></div>
        <!-- Modal Content -->
        <div id="editor-container" class="relative bg-white w-full max-w-4xl h-[90vh] md:h-[85vh] md:rounded-2xl shadow-2xl flex flex-col transform scale-95 opacity-0 transition-all pointer-events-auto overflow-hidden">
            <!-- Header -->
            <div class="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                <div class="flex items-center gap-3">
                    <button id="editor-close-btn" class="text-slate-400 hover:text-slate-600 transition-colors w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-50"><i class="fas fa-times text-lg"></i></button>
                    <div id="editor-save-status" class="text-xs text-slate-400 font-medium opacity-0 transition-opacity"><i class="fas fa-check-circle text-emerald-500 mr-1"></i>已儲存</div>
                </div>
                <div class="flex items-center gap-2">
                    <button id="editor-layout-btn" class="text-slate-400 hover:text-indigo-600 transition-colors w-8 h-8 flex items-center justify-center rounded-lg hover:bg-indigo-50" title="切換版面"><i class="fas fa-columns"></i></button>
                </div>
            </div>
            <!-- Body -->
            <div class="flex-1 overflow-y-auto custom-scrollbar p-8 md:px-16 md:py-12 flex flex-col">
                <textarea id="editor-title" class="w-full text-3xl md:text-4xl font-bold text-slate-800 placeholder-slate-300 border-none outline-none resize-none overflow-hidden mb-8 bg-transparent" rows="1" placeholder="無標題"></textarea>
                <div id="editorjs-container" class="flex-1"></div>
            </div>
        </div>
    </div>
```

- [ ] **Step 2: Add basic JS logic for opening/closing the modal**
Add to the script section:
```javascript
        let activeEditorCardId = null;
        let activeEditorCollection = null;

        function closeEditor() {
            const modal = document.getElementById('editor-modal');
            const backdrop = document.getElementById('editor-backdrop');
            const container = document.getElementById('editor-container');
            
            backdrop.classList.remove('opacity-100');
            container.classList.remove('scale-100', 'opacity-100');
            setTimeout(() => modal.classList.add('hidden'), 300);
            activeEditorCardId = null;
            activeEditorCollection = null;
        }

        document.getElementById('editor-close-btn').addEventListener('click', closeEditor);
        document.getElementById('editor-backdrop').addEventListener('click', closeEditor);
```

- [ ] **Step 3: Commit**
```bash
git add index.html
git commit -m "feat: add HTML and basic JS structure for Notion-like editor modal"
```

---

### Task 2: Import Editor.js & Initialize Instance

**Files:**
- Modify: `index.html`

**Interfaces:**
- Produces: Global `editor` instance and `initEditor` / `destroyEditor` functions.

- [ ] **Step 1: Import Editor.js and Plugins**
Add to the `<head>` or before `</body>`:
```html
    <!-- Editor.js Core and Plugins -->
    <script src="https://cdn.jsdelivr.net/npm/@editorjs/editorjs@latest"></script>
    <script src="https://cdn.jsdelivr.net/npm/@editorjs/header@latest"></script>
    <script src="https://cdn.jsdelivr.net/npm/@editorjs/list@latest"></script>
    <script src="https://cdn.jsdelivr.net/npm/@editorjs/checklist@latest"></script>
    <script src="https://cdn.jsdelivr.net/npm/@editorjs/quote@latest"></script>
    <script src="https://cdn.jsdelivr.net/npm/@editorjs/marker@latest"></script>
```

- [ ] **Step 2: Write JS to initialize Editor.js**
Add this JS function:
```javascript
        let editorInstance = null;

        function initEditor(initialData = {}, onChangeCallback = null) {
            if (editorInstance) {
                editorInstance.destroy();
                editorInstance = null;
            }
            
            editorInstance = new EditorJS({
                holder: 'editorjs-container',
                placeholder: '在這裡開始輸入你的想法... (輸入 / 顯示選單)',
                data: initialData,
                onChange: () => {
                    if (onChangeCallback) onChangeCallback();
                },
                tools: {
                    header: { class: Header, inlineToolbar: true, config: { placeholder: '輸入標題', levels: [1, 2, 3], defaultLevel: 2 } },
                    list: { class: List, inlineToolbar: true },
                    checklist: { class: Checklist, inlineToolbar: true },
                    quote: { class: Quote, inlineToolbar: true },
                    Marker: { class: Marker, inlineToolbar: true }
                }
            });
        }
```

- [ ] **Step 3: Update `closeEditor` to destroy instance**
```javascript
        function closeEditor() {
            // ... existing close code ...
            if (editorInstance) {
                editorInstance.destroy();
                editorInstance = null;
            }
        }
```

- [ ] **Step 4: Commit**
```bash
git add index.html
git commit -m "feat: integrate Editor.js and plugins via CDN"
```

---

### Task 3: Refactor Card Click Logic

**Files:**
- Modify: `index.html`

**Interfaces:**
- Modifies: `renderList` and `renderTodos` to bind click events to open the editor.

- [ ] **Step 1: Create `openEditor` function**
```javascript
        async function openEditor(itemId, itemText, collectionName) {
            const modal = document.getElementById('editor-modal');
            const backdrop = document.getElementById('editor-backdrop');
            const container = document.getElementById('editor-container');
            const titleInput = document.getElementById('editor-title');
            
            activeEditorCardId = itemId;
            activeEditorCollection = collectionName;
            
            // Set UI
            titleInput.value = itemText;
            modal.classList.remove('hidden');
            // Force reflow
            void modal.offsetWidth;
            backdrop.classList.add('opacity-100');
            container.classList.add('scale-100', 'opacity-100');

            // Initialize editor with empty data for now
            initEditor({}, handleEditorChange);
        }

        function handleEditorChange() {
            // Placeholder for auto-save
        }
```

- [ ] **Step 2: Bind clicks in `renderList`**
Inside `renderList`, after creating `li`:
```javascript
                // Instead of no click action, add:
                const contentDiv = li.querySelector('.flex-col');
                contentDiv.classList.add('cursor-pointer');
                contentDiv.addEventListener('click', (e) => {
                    if (justDropped) return;
                    if (e.target.tagName.toLowerCase() === 'button' || e.target.closest('button')) return;
                    openEditor(item.id, item.text, collectionName);
                });
```

- [ ] **Step 3: Refactor clicks in `renderTodos`**
Inside `renderTodos`:
```javascript
                // Replace the existing click listener on todoContent with this:
                todoContent.addEventListener('click', async (e) => {
                    if (justDropped) return; 
                    if (e.target.tagName.toLowerCase() === 'img') return;
                    
                    // If exactly clicking checkbox, do not open editor
                    if (e.target === checkbox) return; 
                    
                    openEditor(item.id, item.text, containerEl.getAttribute('data-col'));
                });
```

- [ ] **Step 4: Commit**
```bash
git add index.html
git commit -m "feat: wire up card clicks to open the Editor modal"
```

---

### Task 4: Lazy Loading & Auto-save to Firestore

**Files:**
- Modify: `index.html`

**Interfaces:**
- Modifies: `openEditor` to fetch data. `handleEditorChange` to debounce save.

- [ ] **Step 1: Add lazy loading logic**
Modify `openEditor`:
```javascript
        async function openEditor(itemId, itemText, collectionName) {
            // ... existing UI setup ...
            
            // Fetch existing note from Firestore
            let noteData = {};
            try {
                const noteRef = doc(db, 'artifacts', appId, 'users', currentUser.uid, collectionName, itemId, 'details', 'note');
                const noteSnap = await getDoc(noteRef);
                if (noteSnap.exists()) {
                    noteData = noteSnap.data().data || {};
                }
            } catch (err) {
                console.error("Failed to load note details:", err);
            }

            initEditor(noteData, handleEditorChange);
        }
```

- [ ] **Step 2: Implement auto-save debounce**
```javascript
        let editorSaveTimeout = null;
        
        function showSaveStatus(text, iconClass) {
            const status = document.getElementById('editor-save-status');
            status.innerHTML = `<i class="${iconClass} mr-1"></i>${text}`;
            status.classList.remove('opacity-0');
            setTimeout(() => status.classList.add('opacity-0'), 2000);
        }

        async function saveEditorContent() {
            if (!activeEditorCardId || !editorInstance) return;
            try {
                const outputData = await editorInstance.save();
                const noteRef = doc(db, 'artifacts', appId, 'users', currentUser.uid, activeEditorCollection, activeEditorCardId, 'details', 'note');
                
                // Use setDoc with merge:true in case details/note doesn't exist yet
                await setDoc(noteRef, { 
                    data: outputData,
                    updatedAt: Date.now()
                }, { merge: true });
                
                showSaveStatus('已儲存', 'fas fa-check-circle text-emerald-500');
            } catch (err) {
                console.error("Save failed:", err);
                showSaveStatus('儲存失敗', 'fas fa-exclamation-circle text-red-500');
            }
        }

        function handleEditorChange() {
            clearTimeout(editorSaveTimeout);
            editorSaveTimeout = setTimeout(saveEditorContent, 1000);
        }
```

- [ ] **Step 3: Save title changes**
```javascript
        document.getElementById('editor-title').addEventListener('input', (e) => {
            clearTimeout(editorSaveTimeout);
            editorSaveTimeout = setTimeout(async () => {
                if (!activeEditorCardId) return;
                const newTitle = e.target.value.trim();
                if (!newTitle) return; // Prevent empty title
                
                try {
                    const cardRef = doc(db, 'artifacts', appId, 'users', currentUser.uid, activeEditorCollection, activeEditorCardId);
                    await updateDoc(cardRef, { text: newTitle });
                    saveEditorContent(); // Also save body
                } catch(err) {
                    console.error("Failed to update title:", err);
                }
            }, 1000);
        });
```

- [ ] **Step 4: Commit**
```bash
git add index.html
git commit -m "feat: implement Editor.js auto-save and lazy loading with Firestore"
```
