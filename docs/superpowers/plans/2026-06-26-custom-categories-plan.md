# Custom Categories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the app to support dynamic, user-defined custom categories with UI management and an AI dynamic classification prompt.

**Architecture:** We will add a Category Manager Modal to handle CRUD operations on a `/categories` subcollection. The main UI grid will be dynamically generated based on this collection. The AI sorting engine will be refactored to map document IDs instead of textual fragments.

**Tech Stack:** Vanilla HTML/JS, Tailwind CSS, Firebase Firestore, SortableJS.

## Global Constraints

- Must rely purely on vanilla JS and Firebase CDN (no build tools).
- No CSS margin hacks for alignment; strictly use Tailwind's `items-center`.
- Defensive UI: Asynchronous operations must show loading indicators and disable buttons.
- Verification: Since this is a browser-only app, "tests" will involve adding console assertions and manual DOM verification steps.

---

### Task 1: UI Structure for Category Manager Modal

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: N/A
- Produces: DOM elements `#manage-categories-btn`, `#category-manager-modal`, `#category-list`, `#category-edit-form`.

- [ ] **Step 1: Write the HTML for the Category Manager Modal**

```html
<!-- Insert this near the existing settings-modal in index.html -->
<div id="category-manager-modal" class="hidden fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl w-full max-w-3xl p-6 shadow-xl max-h-[90vh] overflow-y-auto custom-scrollbar flex flex-col md:flex-row gap-6">
        <!-- List View -->
        <div class="flex-1 border-r border-slate-100 pr-4">
            <div class="flex justify-between items-center mb-4">
                <h3 class="text-lg font-bold text-slate-800">🏷️ 管理分類</h3>
                <button id="add-category-btn" class="text-indigo-600 bg-indigo-50 px-3 py-1 rounded-lg text-sm font-bold hover:bg-indigo-100"><i class="fas fa-plus"></i> 新增</button>
            </div>
            <ul id="category-manager-list" class="space-y-2"></ul>
        </div>
        <!-- Edit Form -->
        <div class="flex-1" id="category-edit-form">
            <h4 class="font-bold text-slate-800 mb-4" id="category-form-title">編輯分類</h4>
            <input type="hidden" id="cat-id-input">
            
            <label class="block text-sm font-semibold text-slate-700 mb-1">分類名稱</label>
            <input type="text" id="cat-name-input" class="w-full px-3 py-2 border border-slate-300 rounded-lg mb-4" placeholder="例如：購物清單">
            
            <label class="block text-sm font-semibold text-slate-700 mb-1">選擇圖示</label>
            <div id="cat-icon-picker" class="flex flex-wrap gap-2 mb-4">
                <!-- Icons will be populated via JS -->
            </div>
            <input type="hidden" id="cat-icon-input" value="fas fa-folder">
            
            <label class="block text-sm font-semibold text-slate-700 mb-1">模式切換</label>
            <div class="flex gap-2 mb-4">
                <button type="button" class="cat-type-btn flex-1 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 active-type" data-type="text">📝 純文字</button>
                <button type="button" class="cat-type-btn flex-1 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600" data-type="todo">✅ 待辦清單</button>
            </div>
            <input type="hidden" id="cat-type-input" value="text">
            
            <label class="block text-sm font-semibold text-slate-700 mb-1 flex justify-between items-center">
                <span>AI 魔法規則 (選填)</span>
                <button type="button" id="ai-suggest-rule-btn" class="text-xs text-indigo-600 bg-indigo-50 px-2 py-1 rounded hover:bg-indigo-100">✨ AI 幫我寫</button>
            </label>
            <textarea id="cat-prompt-rule-input" class="w-full px-3 py-2 border border-slate-300 rounded-lg h-24 mb-4 text-sm" placeholder="告訴 AI 什麼樣的內容該被分進來..."></textarea>
            
            <div class="flex justify-between mt-4 pt-4 border-t border-slate-100">
                <button type="button" id="cat-delete-btn" class="text-rose-600 text-sm font-bold hover:text-rose-700 hidden">刪除分類</button>
                <div class="flex gap-2 ml-auto">
                    <button type="button" id="cat-cancel-btn" class="px-4 py-2 rounded-lg font-semibold text-slate-600 hover:bg-slate-100">取消</button>
                    <button type="button" id="cat-save-btn" class="px-4 py-2 rounded-lg font-semibold bg-indigo-600 text-white hover:bg-indigo-700">儲存</button>
                </div>
            </div>
        </div>
        <button id="close-category-modal-btn" class="absolute top-4 right-4 text-slate-400 hover:text-slate-600"><i class="fas fa-times"></i></button>
    </div>
</div>
```

- [ ] **Step 2: Add Entry Point Button**

```html
<!-- Inside the header, before settings-btn -->
<button id="manage-categories-btn" class="md:ml-4 text-indigo-500 hover:text-indigo-700 transition-colors bg-indigo-50 p-2 rounded-full shadow-sm border border-indigo-100"><i class="fas fa-tags"></i></button>
```

- [ ] **Step 3: Verify HTML layout in browser**
Open `index.html` in a browser. Run `document.getElementById('category-manager-modal').classList.remove('hidden')` in console.
Expected: Modal appears with all inputs correctly aligned vertically using flexbox and `items-center`.

- [ ] **Step 4: Commit**
```bash
git add index.html
git commit -m "feat: add category manager modal UI"
```

---

### Task 2: Firestore CRUD for Categories

**Files:**
- Modify: `index.html`

**Interfaces:**
- Produces: `currentCategories` array, `saveCategory(data)`, `deleteCategory(id)` functions in the JS module scope.

- [ ] **Step 1: Add JS variables and onSnapshot for categories**

```javascript
// Add to variables section in <script type="module">
let currentCategories = [];

// Add to setupRealtimeListeners
onSnapshot(collection(db, 'artifacts', appId, 'users', userId, 'categories'), (snapshot) => {
    currentCategories = [];
    snapshot.forEach(doc => currentCategories.push({ id: doc.id, ...doc.data() }));
    currentCategories.sort((a, b) => a.order - b.order);
    renderCategoryManagerList(currentCategories);
    renderMainGrid(currentCategories);
    updateCategorySelectOptions(currentCategories);
});
```

- [ ] **Step 2: Implement CRUD functions**

```javascript
async function saveCategory(categoryData) {
    if (!currentUser) return;
    const catCol = collection(db, 'artifacts', appId, 'users', currentUser.uid, 'categories');
    if (categoryData.id) {
        const { id, ...data } = categoryData;
        await updateDoc(doc(catCol, id), data);
    } else {
        await addDoc(catCol, categoryData);
    }
}

async function deleteCategoryFunc(id) {
    if (!currentUser) return;
    await deleteDoc(doc(db, 'artifacts', appId, 'users', currentUser.uid, 'categories', id));
}
```

- [ ] **Step 3: Run console tests to verify DB connection**
Open browser console. Run:
```javascript
// Expose for testing
window.saveCategory = saveCategory;
```
Run `await window.saveCategory({ name: "測試分類", icon: "fas fa-star", type: "text", order: 100 })`
Expected: Execution succeeds, document is written to Firestore.

- [ ] **Step 4: Commit**
```bash
git add index.html
git commit -m "feat: implement firestore CRUD for custom categories"
```

---

### Task 3: Category Manager Modal Logic

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `saveCategory`, `deleteCategoryFunc`, `currentCategories`

- [ ] **Step 1: Implement Modal Open/Close & Form binding**

```javascript
const categoryModal = document.getElementById('category-manager-modal');
document.getElementById('manage-categories-btn').addEventListener('click', () => {
    categoryModal.classList.remove('hidden');
    resetCategoryForm();
});
document.getElementById('close-category-modal-btn').addEventListener('click', () => categoryModal.classList.add('hidden'));
document.getElementById('cat-cancel-btn').addEventListener('click', resetCategoryForm);

function resetCategoryForm() {
    document.getElementById('cat-id-input').value = '';
    document.getElementById('cat-name-input').value = '';
    document.getElementById('cat-prompt-rule-input').value = '';
    document.getElementById('cat-delete-btn').classList.add('hidden');
    document.getElementById('category-form-title').innerText = '新增分類';
}

document.getElementById('cat-save-btn').addEventListener('click', async (e) => {
    const btn = e.target;
    btn.disabled = true;
    btn.innerHTML = '<div class="loader w-4 h-4 border-t-white border-2"></div>';
    
    const id = document.getElementById('cat-id-input').value;
    const data = {
        name: document.getElementById('cat-name-input').value,
        icon: document.getElementById('cat-icon-input').value,
        type: document.getElementById('cat-type-input').value,
        promptRule: document.getElementById('cat-prompt-rule-input').value,
        order: id ? currentCategories.find(c => c.id === id).order : Date.now()
    };
    if(id) data.id = id;
    
    await saveCategory(data);
    resetCategoryForm();
    btn.disabled = false;
    btn.innerText = '儲存';
});
```

- [ ] **Step 2: Implement Category List Rendering and Edit Population**

```javascript
function renderCategoryManagerList(categories) {
    const listEl = document.getElementById('category-manager-list');
    listEl.innerHTML = '';
    categories.forEach(cat => {
        const li = document.createElement('li');
        li.className = 'p-3 bg-slate-50 rounded-lg flex items-center justify-between cursor-pointer hover:bg-slate-100 border border-slate-200';
        li.innerHTML = `<span><i class="${cat.icon} mr-2 text-slate-500"></i> ${escapeHtml(cat.name)}</span> <i class="fas fa-edit text-slate-400"></i>`;
        li.addEventListener('click', () => populateCategoryForm(cat));
        listEl.appendChild(li);
    });
}

function populateCategoryForm(cat) {
    document.getElementById('category-form-title').innerText = '編輯分類';
    document.getElementById('cat-id-input').value = cat.id;
    document.getElementById('cat-name-input').value = cat.name;
    document.getElementById('cat-icon-input').value = cat.icon;
    document.getElementById('cat-type-input').value = cat.type;
    document.getElementById('cat-prompt-rule-input').value = cat.promptRule || '';
    document.getElementById('cat-delete-btn').classList.remove('hidden');
    // Also update UI for type buttons and icon picker...
}
```

- [ ] **Step 3: Add Delete Logic**
```javascript
document.getElementById('cat-delete-btn').addEventListener('click', async (e) => {
    if(!confirm('確定要刪除這個分類嗎？該分類底下的筆記將不會被刪除，但會需要重新分類。')) return;
    const id = document.getElementById('cat-id-input').value;
    await deleteCategoryFunc(id);
    resetCategoryForm();
});
```

- [ ] **Step 4: Verify Modal Interaction**
Open browser, open category manager, create a new category, click to edit, click delete.
Expected: UI updates immediately (thanks to `onSnapshot`).

- [ ] **Step 5: Commit**
```bash
git add index.html
git commit -m "feat: implement category modal interaction and rendering"
```

---

### Task 4: AI "Suggest Rule" Feature

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: Gemini API fetch logic (similar to existing AI Sort).

- [ ] **Step 1: Implement AI Suggestion Function**

```javascript
document.getElementById('ai-suggest-rule-btn').addEventListener('click', async (e) => {
    const btn = e.target;
    const catName = document.getElementById('cat-name-input').value;
    if(!catName) return alert('請先輸入分類名稱！');
    
    const apiKey = document.getElementById('api-key-input').value || localStorage.getItem('geminiApiKey');
    if (!apiKey) return alert("請先設定 Gemini API Key！");
    
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 生成中';
    
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: `你是一個 AI 助理。請為一個名為「${catName}」的筆記本分類，寫出一句簡短的分類判斷規則。例如：「只要提到買、補貨、超市、五金行，就放這裡。」。請直接輸出規則字串，不要加引號。` }] }]
            })
        });
        const data = await response.json();
        const rule = data.candidates[0].content.parts[0].text.trim();
        document.getElementById('cat-prompt-rule-input').value = rule;
    } catch(err) {
        alert('生成失敗：' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerText = '✨ AI 幫我寫';
    }
});
```

- [ ] **Step 2: Verify AI Generation**
Enter a name like "食譜", click "✨ AI 幫我寫".
Expected: Textarea is populated with a generated rule.

- [ ] **Step 3: Commit**
```bash
git add index.html
git commit -m "feat: add AI suggest rule feature"
```

---

### Task 5: Dynamic Main UI Grid

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `currentCategories` array, `onSnapshot` for fragments.

- [ ] **Step 1: Remove hardcoded categories in HTML**
Remove the elements inside `<div class="grid grid-cols-1 md:grid-cols-2 gap-6">` that contain "待辦事項", "待學習/探討", "點子庫", "收藏". Leave the grid container empty with `id="main-grid-container"`.

- [ ] **Step 2: Write renderMainGrid function**

```javascript
function renderMainGrid(categories) {
    const grid = document.getElementById('main-grid-container');
    grid.innerHTML = '';
    categories.forEach(cat => {
        const wrapper = document.createElement('div');
        wrapper.className = 'bg-surface border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col h-full';
        
        const header = document.createElement('h2');
        header.className = 'text-lg font-bold text-slate-800 mb-4 flex items-center justify-between';
        header.innerHTML = `<div class="flex items-center"><i class="${cat.icon} text-indigo-500 mr-2 text-xl"></i>${escapeHtml(cat.name)}</div>`;
        wrapper.appendChild(header);
        
        const list = document.createElement('ul');
        list.id = `list-${cat.id}`;
        list.className = 'sortable-list space-y-3 max-h-96 overflow-y-auto custom-scrollbar pr-2 flex-1';
        list.setAttribute('data-col', cat.id);
        list.setAttribute('data-name', cat.name);
        wrapper.appendChild(list);
        
        grid.appendChild(wrapper);
        
        // Ensure onSnapshot is set up for this category ID
        setupCategoryListener(cat.id, cat.type);
    });
    
    initDragAndDrop(); // Re-initialize SortableJS
}
```

- [ ] **Step 3: Dynamic Dropdown in Input**
```javascript
function updateCategorySelectOptions(categories) {
    const select = document.getElementById('category-select');
    select.innerHTML = '<option value="inbox">📥 收件匣 (由 AI 分類)</option>';
    categories.forEach(cat => {
        select.innerHTML += `<option value="${cat.id}">📁 ${escapeHtml(cat.name)}</option>`;
    });
}
```

- [ ] **Step 4: Update Listeners and Verify**
Modify `setupRealtimeListeners` to call `setupCategoryListener(catId, type)` dynamically instead of the hardcoded collections.
Verify in browser that custom categories show up as columns.

- [ ] **Step 5: Commit**
```bash
git add index.html
git commit -m "feat: render main grid and dropdown dynamically from custom categories"
```

---

### Task 6: ID Mapping for AI Auto-Sorting

**Files:**
- Modify: `index.html`

**Interfaces:**
- Refactor `ai-sort-btn` click handler.

- [ ] **Step 1: Construct Dynamic Prompt and Schema**

```javascript
// Inside the ai-sort-btn click handler
const fragments = currentInboxItems.map(item => ({ id: item.id, content: item.text }));

let promptText = "你是一個智能分類助理。請根據以下可用分類，將輸入的項目進行歸類。若符合多個分類，請選擇最精確的一個。若都不符合，請歸入 'unclassified'。\n【可用分類定義】\n";
const dynamicProperties = { unclassified: { type: "ARRAY", items: { type: "STRING" } } };

currentCategories.forEach(cat => {
    promptText += `* ID: ${cat.id}，名稱：「${cat.name}」`;
    if(cat.promptRule) promptText += `，規則：「${cat.promptRule}」`;
    promptText += "\n";
    dynamicProperties[cat.id] = { type: "ARRAY", items: { type: "STRING", description: "填入項目的 ID" } };
});

promptText += `\n【待分類項目清單】\n${JSON.stringify(fragments)}\n\n**注意：請在 JSON 結構中，只回傳項目的 id。**`;

const dynamicSchema = { type: "OBJECT", properties: dynamicProperties };
```

- [ ] **Step 2: Update AI fetch payload and execute batch update**

```javascript
// Update the body of the fetch request
body: JSON.stringify({
    contents: [{ parts: [{ text: promptText }] }],
    generationConfig: {
        responseMimeType: "application/json",
        responseSchema: dynamicSchema
    }
})

// After receiving JSON result
const result = JSON.parse(data.candidates[0].content.parts[0].text);
for (const [catId, docIds] of Object.entries(result)) {
    if (catId === 'unclassified' || !docIds) continue;
    for (const docId of docIds) {
        // Find fragment in inbox
        const item = currentInboxItems.find(i => i.id === docId);
        if (!item) continue;
        
        // Move to new category collection
        await setDoc(doc(db, 'artifacts', appId, 'users', currentUser.uid, catId, docId), {
            ...item,
            order: Date.now()
        });
        await deleteDoc(doc(db, 'artifacts', appId, 'users', currentUser.uid, 'inbox', docId));
    }
}
```

- [ ] **Step 3: Verify AI Auto-Sort**
Create a test category "買菜".
Add item "買高麗菜" to inbox.
Click "AI 魔法整理".
Expected: "買高麗菜" is moved from inbox to the new category.

- [ ] **Step 4: Commit**
```bash
git add index.html
git commit -m "feat: implement ID Mapping and dynamic schema for AI sorting"
```
