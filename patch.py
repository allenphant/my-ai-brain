import re
import os

with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update variables
content = content.replace(
    'let currentUser = null;',
    'let currentUser = null;\n        let currentCategories = [];'
)

# 2. Add saveCategory and deleteCategoryFunc
crud_code = """
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

        function setupCategoryListener(catId, catType, catName, catIcon) {
            const listEl = document.getElementById(`list-${catId}`);
            if (!listEl) return;
            onSnapshot(collection(db, 'artifacts', appId, 'users', currentUser.uid, catId), (snapshot) => {
                const items = []; snapshot.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
                items.sort((a, b) => getOrder(b) - getOrder(a));
                
                if (catType === 'todo') {
                    // Update global currentTodoItems if needed, but since it's dynamic, maybe not.
                    // For now, let's just render todos
                    renderTodos(items, listEl, catId);
                } else {
                    renderList(items, listEl, catId, `${catIcon} text-slate-400`);
                }
            });
        }
"""
content = content.replace('const initDragAndDrop = () => {', crud_code + '\n        const initDragAndDrop = () => {')

# 3. Modify setupRealtimeListeners to use categories
listeners_orig = """            onSnapshot(getCol('todos'), (snapshot) => {
                const items = []; snapshot.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
                sortItems(items); currentTodoItems = items; 
                const deleteBtn = document.getElementById('delete-completed-btn');
                if (items.some(item => item.completed)) { deleteBtn.classList.remove('opacity-50', 'cursor-not-allowed'); deleteBtn.classList.add('cursor-pointer'); } 
                else { deleteBtn.classList.add('opacity-50', 'cursor-not-allowed'); deleteBtn.classList.remove('cursor-pointer'); }
                renderTodos(items, document.getElementById('todos-list'));
            });

            onSnapshot(getCol('learning'), (snapshot) => renderCollection(snapshot, document.getElementById('learning-list'), 'learning', 'fas fa-book text-purple-300'));
            onSnapshot(getCol('ideas'), (snapshot) => renderCollection(snapshot, document.getElementById('ideas-list'), 'ideas', 'fas fa-bolt text-amber-400'));
            onSnapshot(getCol('bookmarks'), (snapshot) => {
                const items = []; snapshot.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
                sortItems(items); renderBookmarks(items, document.getElementById('bookmarks-list'));
            });"""
listeners_new = """            onSnapshot(getCol('categories'), (snapshot) => {
                currentCategories = [];
                snapshot.forEach(doc => currentCategories.push({ id: doc.id, ...doc.data() }));
                currentCategories.sort((a, b) => a.order - b.order);
                
                renderCategoryManagerList(currentCategories);
                renderMainGrid(currentCategories);
                updateCategorySelectOptions(currentCategories);
            });"""
content = content.replace(listeners_orig, listeners_new)

# 4. Add dynamic grid and modal logic
dynamic_code = """
        const categoryModal = document.getElementById('category-manager-modal');
        const catIcons = ['fas fa-folder', 'fas fa-star', 'fas fa-heart', 'fas fa-bolt', 'fas fa-shopping-cart', 'fas fa-book', 'fas fa-briefcase', 'fas fa-graduation-cap', 'fas fa-plane', 'fas fa-music', 'fas fa-video', 'fas fa-gamepad', 'fas fa-dumbbell', 'fas fa-utensils', 'fas fa-coffee'];
        
        document.getElementById('manage-categories-btn').addEventListener('click', () => {
            categoryModal.classList.remove('hidden');
            resetCategoryForm();
        });
        document.getElementById('close-category-modal-btn').addEventListener('click', () => categoryModal.classList.add('hidden'));
        document.getElementById('cat-cancel-btn').addEventListener('click', resetCategoryForm);
        document.getElementById('add-category-btn').addEventListener('click', resetCategoryForm);

        function renderIconPicker() {
            const picker = document.getElementById('cat-icon-picker');
            picker.innerHTML = '';
            catIcons.forEach(icon => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = `w-10 h-10 rounded-xl border flex items-center justify-center text-lg transition-all ${document.getElementById('cat-icon-input').value === icon ? 'bg-indigo-100 border-indigo-500 text-indigo-600' : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'}`;
                btn.innerHTML = `<i class="${icon}"></i>`;
                btn.onclick = () => {
                    document.getElementById('cat-icon-input').value = icon;
                    renderIconPicker();
                };
                picker.appendChild(btn);
            });
        }

        document.querySelectorAll('.cat-type-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.cat-type-btn').forEach(b => {
                    b.classList.remove('border-indigo-500', 'bg-indigo-50', 'text-indigo-600', 'active-type');
                    b.classList.add('border-slate-200', 'text-slate-600');
                });
                const target = e.currentTarget;
                target.classList.remove('border-slate-200', 'text-slate-600');
                target.classList.add('border-indigo-500', 'bg-indigo-50', 'text-indigo-600', 'active-type');
                document.getElementById('cat-type-input').value = target.getAttribute('data-type');
            });
        });

        function resetCategoryForm() {
            document.getElementById('cat-id-input').value = '';
            document.getElementById('cat-name-input').value = '';
            document.getElementById('cat-prompt-rule-input').value = '';
            document.getElementById('cat-icon-input').value = 'fas fa-folder';
            document.getElementById('cat-delete-btn').classList.add('hidden');
            document.getElementById('category-form-title').innerText = '新增分類';
            document.querySelector('.cat-type-btn[data-type="text"]').click();
            renderIconPicker();
        }

        document.getElementById('cat-save-btn').addEventListener('click', async (e) => {
            const name = document.getElementById('cat-name-input').value;
            if (!name) return alert('請輸入分類名稱');
            const btn = e.currentTarget;
            btn.disabled = true;
            btn.innerHTML = '<div class="loader w-4 h-4 border-t-white border-2"></div>';
            
            const id = document.getElementById('cat-id-input').value;
            const data = {
                name,
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

        document.getElementById('cat-delete-btn').addEventListener('click', async () => {
            if(!confirm('確定要刪除這個分類嗎？該分類底下的筆記將不會被刪除，但會需要重新分類。')) return;
            const id = document.getElementById('cat-id-input').value;
            await deleteCategoryFunc(id);
            resetCategoryForm();
        });

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
            // We should ideally add SortableJS here to manage category order, but for simplicity we rely on manual list for now.
            // Let's initialize Sortable on the manager list
            new Sortable(listEl, {
                animation: 150,
                onEnd: async function(evt) {
                    const itemEl = evt.item;
                    const oldIndex = evt.oldIndex;
                    const newIndex = evt.newIndex;
                    if (oldIndex === newIndex) return;
                    
                    // Update all orders sequentially for simplicity
                    const newOrderList = Array.from(listEl.children);
                    for (let i = 0; i < newOrderList.length; i++) {
                        const catName = newOrderList[i].querySelector('span').innerText.trim();
                        const cat = currentCategories.find(c => c.name === catName);
                        if(cat) await saveCategory({id: cat.id, order: i * 1000});
                    }
                }
            });
        }

        function populateCategoryForm(cat) {
            document.getElementById('category-form-title').innerText = '編輯分類';
            document.getElementById('cat-id-input').value = cat.id;
            document.getElementById('cat-name-input').value = cat.name;
            document.getElementById('cat-icon-input').value = cat.icon;
            document.querySelector(`.cat-type-btn[data-type="${cat.type}"]`).click();
            document.getElementById('cat-prompt-rule-input').value = cat.promptRule || '';
            document.getElementById('cat-delete-btn').classList.remove('hidden');
            renderIconPicker();
        }

        document.getElementById('ai-suggest-rule-btn').addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            const catName = document.getElementById('cat-name-input').value;
            if(!catName) return alert('請先輸入分類名稱！');
            
            const apiKey = document.getElementById('api-key-input').value || localStorage.getItem('geminiApiKey');
            if (!apiKey) return alert("請先設定 Gemini API Key！");
            
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            
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
                btn.innerHTML = '<i class="fas fa-sparkles"></i> AI 幫我寫';
            }
        });

        function renderMainGrid(categories) {
            const grid = document.getElementById('main-grid-container');
            grid.innerHTML = '';
            categories.forEach(cat => {
                const wrapper = document.createElement('div');
                wrapper.className = 'bg-surface border border-slate-200 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col h-full';
                
                const header = document.createElement('h2');
                header.className = 'text-lg font-bold text-slate-800 mb-4 flex items-center justify-between';
                
                let titleHtml = `<div class="flex items-center"><i class="${cat.icon} text-indigo-500 mr-2 text-xl"></i>${escapeHtml(cat.name)}</div>`;
                if (cat.type === 'todo') {
                    titleHtml += `
                    <div class="flex items-center gap-2">
                        <button class="delete-completed-btn-dynamic text-xs font-normal text-rose-500 hover:text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100 px-2 py-1 rounded-md transition-colors flex items-center gap-1 focus:outline-none shadow-sm" data-col="${cat.id}">
                            <i class="fas fa-trash-alt"></i> <span class="hidden sm:inline">清空已完成</span>
                        </button>
                    </div>`;
                }
                header.innerHTML = titleHtml;
                wrapper.appendChild(header);
                
                const list = document.createElement('ul');
                list.id = `list-${cat.id}`;
                list.className = 'sortable-list space-y-3 max-h-96 overflow-y-auto custom-scrollbar pr-2 flex-1';
                list.setAttribute('data-col', cat.id);
                list.setAttribute('data-name', cat.name);
                wrapper.appendChild(list);
                
                grid.appendChild(wrapper);
                setupCategoryListener(cat.id, cat.type, cat.name, cat.icon);
                
                if (cat.type === 'todo') {
                    const delBtn = wrapper.querySelector('.delete-completed-btn-dynamic');
                    if(delBtn) {
                        delBtn.addEventListener('click', async () => {
                            if(!confirm('清空所有已完成的項目？')) return;
                            const itemsEl = list.querySelectorAll('.todo-item-completed');
                            for(const el of itemsEl) {
                                await deleteDoc(doc(db, 'artifacts', appId, 'users', currentUser.uid, cat.id, el.getAttribute('data-id')));
                            }
                        });
                    }
                }
            });
            
            // Re-init sortable for new lists
            initDragAndDrop();
        }

        function updateCategorySelectOptions(categories) {
            const select = document.getElementById('category-select');
            const val = select.value;
            select.innerHTML = '<option value="inbox">📥 收件匣 (由 AI 分類)</option>';
            categories.forEach(cat => {
                select.innerHTML += `<option value="${cat.id}">📁 ${escapeHtml(cat.name)}</option>`;
            });
            // restore selection if possible
            if (val && Array.from(select.options).some(o => o.value === val)) {
                select.value = val;
            }
        }
"""
content = content.replace("        onAuthStateChanged(auth, (user) => {", dynamic_code + "\n        onAuthStateChanged(auth, (user) => {")

# 5. Fix renderTodos to accept variable target container instead of fixed 'todos'
render_todos_orig = """                attachItemListeners(li, item, 'todos'); containerEl.appendChild(li);"""
render_todos_new = """                attachItemListeners(li, item, containerEl.getAttribute('data-col')); containerEl.appendChild(li);"""
content = content.replace(render_todos_orig, render_todos_new)
content = content.replace("await updateDoc(doc(db, 'artifacts', appId, 'users', currentUser.uid, 'todos', item.id)", "await updateDoc(doc(db, 'artifacts', appId, 'users', currentUser.uid, containerEl.getAttribute('data-col'), item.id)")

# 6. Refactor AI Sorting logic
ai_sort_orig = """            let promptText = "請分類以下 JSON Array：1. todos 2. learning 3. ideas 4. bookmarks。請保留原換行符號。\\n\\n";
            const fragments = currentInboxItems.map(item => item.text);
            promptText += JSON.stringify(fragments);

            try {
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: promptText }] }],
                        generationConfig: {
                            responseMimeType: "application/json",
                            responseSchema: {
                                type: "OBJECT",
                                properties: {
                                    todos: { type: "ARRAY", items: { type: "STRING" } },
                                    learning: { type: "ARRAY", items: { type: "STRING" } },
                                    ideas: { type: "ARRAY", items: { type: "STRING" } },
                                    bookmarks: { type: "ARRAY", items: { type: "STRING" } }
                                }
                            }
                        }
                    })
                });

                const data = await response.json();
                if (data.error) throw new Error(data.error.message);

                const result = JSON.parse(data.candidates[0].content.parts[0].text);
                
                for (const [category, items] of Object.entries(result)) {
                    if (!items) continue;
                    for (const text of items) {
                        const originalItem = currentInboxItems.find(i => i.text === text);
                        if (originalItem) {
                            await setDoc(doc(db, 'artifacts', appId, 'users', currentUser.uid, category, originalItem.id), { ...originalItem, order: Date.now() });
                            await deleteDoc(doc(db, 'artifacts', appId, 'users', currentUser.uid, 'inbox', originalItem.id));
                        }
                    }
                }"""
ai_sort_new = """            const fragments = currentInboxItems.map(item => ({ id: item.id, content: item.text }));

            let promptText = "你是一個智能分類助理。請根據以下可用分類，將輸入的項目進行歸類。若符合多個分類，請選擇最精確的一個。若都不符合，請歸入 'unclassified'。\\n【可用分類定義】\\n";
            const dynamicProperties = { unclassified: { type: "ARRAY", items: { type: "STRING" } } };

            currentCategories.forEach(cat => {
                promptText += `* ID: ${cat.id}，名稱：「${cat.name}」`;
                if(cat.promptRule) promptText += `，規則：「${cat.promptRule}」`;
                promptText += "\\n";
                dynamicProperties[cat.id] = { type: "ARRAY", items: { type: "STRING", description: "請填入對應的項目 ID" } };
            });

            promptText += `\\n【待分類項目清單】\\n${JSON.stringify(fragments)}\\n\\n**注意：請在 JSON 結構中，只回傳項目的 id。**`;

            try {
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: promptText }] }],
                        generationConfig: {
                            responseMimeType: "application/json",
                            responseSchema: {
                                type: "OBJECT",
                                properties: dynamicProperties
                            }
                        }
                    })
                });

                const data = await response.json();
                if (data.error) throw new Error(data.error.message);

                const result = JSON.parse(data.candidates[0].content.parts[0].text);
                
                for (const [catId, docIds] of Object.entries(result)) {
                    if (catId === 'unclassified' || !docIds) continue;
                    for (const docId of docIds) {
                        const originalItem = currentInboxItems.find(i => i.id === docId);
                        if (originalItem) {
                            await setDoc(doc(db, 'artifacts', appId, 'users', currentUser.uid, catId, originalItem.id), { ...originalItem, order: Date.now() });
                            await deleteDoc(doc(db, 'artifacts', appId, 'users', currentUser.uid, 'inbox', originalItem.id));
                        }
                    }
                }"""
content = content.replace(ai_sort_orig, ai_sort_new)

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("Patch applied successfully.")
