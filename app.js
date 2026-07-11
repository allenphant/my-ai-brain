        import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
        import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
        import { getFirestore, collection, addDoc, onSnapshot, deleteDoc, doc, updateDoc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
        import { createLayerStack, attachKeyboardManager } from './js/keyboard-layers.js';
        import { attachMdShortcuts } from './js/md-shortcuts.js';

        // --- Firebase 初始化 ---
        let firebaseConfig;
        let appId = 'my-personal-ai-brain'; 
        if (typeof __firebase_config !== 'undefined') {
            firebaseConfig = JSON.parse(__firebase_config);
            appId = typeof __app_id !== 'undefined' ? __app_id : appId;
        } else {
            firebaseConfig = {
                apiKey: "AIzaSyC30YPS_CkGVBS8IBrq74sBW0pkP1-ev6w",
                authDomain: "my-ai-brain-6867e.firebaseapp.com",
                projectId: "my-ai-brain-6867e",
                storageBucket: "my-ai-brain-6867e.firebasestorage.app",
                messagingSenderId: "755512158785",
                appId: "1:755512158785:web:8376054556e01717f9b4c0"
            };
        }

        const app = initializeApp(firebaseConfig);
        const auth = getAuth(app);
        const provider = new GoogleAuthProvider();
        const db = getFirestore(app);

        let currentUser = null;
        let currentCategories = [];
        let currentInboxItems = []; 
        let currentTodoItems = [];
        let pendingDeleteTarget = null;
        let pendingMoveTarget = null;
        let pendingEditTarget = null;
        let isHideCompleted = false;
        let isSorting = false; 
        let isInitialInboxLoad = true; 
        let justDropped = false;

        // --- History Manager for Undo/Redo ---
        class HistoryManager {
            constructor() {
                this.undoStack = [];
                this.redoStack = [];
            }
            push(action) {
                this.undoStack.push(action);
                this.redoStack = [];
                if (this.undoStack.length > 50) this.undoStack.shift();
            }
            async undo() {
                if (this.undoStack.length === 0) {
                    showToast('沒有可還原的操作', 'fas fa-info-circle');
                    return;
                }
                const action = this.undoStack.pop();
                try {
                    await action.undo();
                    this.redoStack.push(action);
                } catch (e) {
                    console.error("Undo failed:", e);
                    showToast('還原操作失敗', 'fas fa-exclamation-triangle');
                }
            }
            async redo() {
                if (this.redoStack.length === 0) {
                    showToast('沒有可重做的操作', 'fas fa-info-circle');
                    return;
                }
                const action = this.redoStack.pop();
                try {
                    await action.redo();
                    this.undoStack.push(action);
                } catch (e) {
                    console.error("Redo failed:", e);
                    showToast('重做操作失敗', 'fas fa-exclamation-triangle');
                }
            }
        }
        const historyManager = new HistoryManager();

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

        async function copyCardDetails(oldCol, newCol, oldId, newId) {
            try {
                const oldNoteRef = doc(db, 'artifacts', appId, 'users', currentUser.uid, oldCol, oldId, 'details', 'note');
                const oldNoteSnap = await getDoc(oldNoteRef);
                if (oldNoteSnap.exists()) {
                    const newNoteRef = doc(db, 'artifacts', appId, 'users', currentUser.uid, newCol, newId, 'details', 'note');
                    await setDoc(newNoteRef, oldNoteSnap.data());
                    await deleteDoc(oldNoteRef);
                }
            } catch (e) {
                console.error("Failed to copy card details:", e);
            }
        }

        function getCollectionName(colId) {
            if (colId === 'inbox') return '收件匣';
            if (colId === 'todos') return '待辦事項';
            if (colId === 'learning') return '學習筆記';
            if (colId === 'ideas') return '靈感與想法';
            if (colId === 'bookmarks') return '稍後閱讀';
            const cat = currentCategories.find(c => c.id === colId);
            return cat ? cat.name : '未知分類';
        }

        function getShortText(text, maxLen = 10) {
            const cleanText = (text || '').trim();
            if (!cleanText) return '空內容';
            return cleanText.length > maxLen ? cleanText.substring(0, maxLen) + '...' : cleanText;
        }

        let stagedImageFile = null;

        const confirmModal = document.getElementById('confirm-modal');
        const moveModal = document.getElementById('move-modal');
        const editModal = document.getElementById('edit-modal');
        const editInput = document.getElementById('edit-input');

        function openEditCardModal() {
            editModal.classList.remove('hidden');
            keyLayers.push({ name: 'edit', keys: modalKeys(closeEditCardModal) });
        }
        function closeEditCardModal() {
            editModal.classList.add('hidden');
            pendingEditTarget = null;
            keyLayers.pop('edit');
        }

        const getOrder = (item) => item.order !== undefined ? item.order : item.createdAt;

        
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
            showToast('已刪除分類');
        }

        function setupCategoryListener(catId, catType, catName, catIcon) {
            const listEl = document.getElementById(`list-${catId}`);
            if (!listEl) return;
            onSnapshot(collection(db, 'artifacts', appId, 'users', currentUser.uid, catId), (snapshot) => {
                const items = []; snapshot.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
                items.sort((a, b) => getOrder(b) - getOrder(a));
                
                const countEl = document.getElementById(`count-${catId}`);
                if (countEl) {
                    countEl.innerText = items.length;
                }
                
                if (catType === 'todo') {
                    renderTodos(items, listEl, catId);
                } else if (catType === 'bookmark') {
                    renderBookmarks(items, listEl, catId);
                } else {
                    renderList(items, listEl, catId, `${catIcon} text-slate-400`);
                }
            });
        }

        const initDragAndDrop = () => {
            document.querySelectorAll('.sortable-list').forEach(list => {
                new Sortable(list, {
                    group: 'shared', animation: 150, delay: 150, delayOnTouchOnly: true, fallbackTolerance: 5, forceFallback: true, fallbackClass: 'sortable-fallback',
                    ghostClass: 'sortable-ghost', dragClass: 'sortable-drag', filter: '.ignore-drag',
                    onStart: function () { document.body.classList.add('is-dragging'); },
                    onChange: function (evt) {
                        document.querySelectorAll('.is-dragover').forEach(el => el.classList.remove('is-dragover'));
                        if(evt.to && evt.to !== evt.from) {
                            const wrapper = evt.to.closest('.category-wrapper');
                            if(wrapper) wrapper.classList.add('is-dragover');
                        }
                    },
                    onLeave: function (evt) {
                        const listEl = evt.el || evt.from;
                        if (listEl) {
                            const wrapper = listEl.closest('.category-wrapper');
                            if (wrapper) wrapper.classList.remove('is-dragover');
                        }
                    },
                    onEnd: async function (evt) {
                        document.body.classList.remove('is-dragging');
                        document.querySelectorAll('.is-dragover').forEach(el => el.classList.remove('is-dragover'));
                        
                        justDropped = true; setTimeout(() => justDropped = false, 100);
                        
                        const itemEl = evt.item; const id = itemEl.getAttribute('data-id');
                        const oldCol = evt.from.getAttribute('data-col'); 
                        let newCol = evt.to.getAttribute('data-col');
                        let droppedOnSidebar = false;

                        if (evt.originalEvent) {
                            const touch = evt.originalEvent.touches ? (evt.originalEvent.touches[0] || evt.originalEvent.changedTouches[0]) : evt.originalEvent;
                            if (touch) {
                                const targetEl = document.elementFromPoint(touch.clientX, touch.clientY);
                                const sidebarLink = targetEl ? targetEl.closest('.sidebar-link') : null;
                                if (sidebarLink) {
                                    const targetCol = sidebarLink.getAttribute('data-target');
                                    if (targetCol && targetCol !== oldCol) {
                                        newCol = targetCol;
                                        droppedOnSidebar = true;
                                        itemEl.remove();
                                    } else if (targetCol === oldCol) {
                                        return;
                                    }
                                }
                            }
                        }

                        if(!id || !currentUser) return;

                        let newOrder = Date.now(); 
                        if (!droppedOnSidebar) {
                            const prevEl = itemEl.previousElementSibling; const nextEl = itemEl.nextElementSibling;
                            const isValid = (el) => el && el.hasAttribute('data-order');
                            const prevOrder = isValid(prevEl) ? parseFloat(prevEl.getAttribute('data-order')) : null;
                            const nextOrder = isValid(nextEl) ? parseFloat(nextEl.getAttribute('data-order')) : null;

                            if (prevOrder !== null && nextOrder !== null) newOrder = (prevOrder + nextOrder) / 2;
                            else if (prevOrder !== null) newOrder = prevOrder - 1000;
                            else if (nextOrder !== null) newOrder = nextOrder + 1000;
                        }

                        try {
                            const docRef = doc(db, 'artifacts', appId, 'users', currentUser.uid, oldCol, id);
                            if (oldCol === newCol) {
                                if (evt.oldIndex !== evt.newIndex) await updateDoc(docRef, { order: newOrder });
                            } else {
                                const oldSnap = await getDoc(docRef);
                                if (oldSnap.exists()) {
                                    let data = oldSnap.data(); data.order = newOrder;
                                    const targetCat = currentCategories.find(c => c.id === newCol);
                                    const isTodoCol = newCol === 'todos' || (targetCat && targetCat.type === 'todo');
                                    if(!isTodoCol) delete data.completed;
                                    
                                    const oldData = oldSnap.data();
                                    const oldOrder = oldData.order || Date.now();
                                    const shortText = getShortText(data.text);
                                    const oldName = getCollectionName(oldCol);
                                    const newName = getCollectionName(newCol);
                                    
                                    historyManager.push({
                                        undo: async () => {
                                            await setDoc(doc(db, 'artifacts', appId, 'users', currentUser.uid, oldCol, id), oldData);
                                            await copyCardDetails(newCol, oldCol, id, id);
                                            await deleteDoc(doc(db, 'artifacts', appId, 'users', currentUser.uid, newCol, id));
                                            showToast(`已還原：將「${shortText}」放回 [${oldName}]`, 'fas fa-undo');
                                        },
                                        redo: async () => {
                                            await setDoc(doc(db, 'artifacts', appId, 'users', currentUser.uid, newCol, id), data);
                                            await copyCardDetails(oldCol, newCol, id, id);
                                            await deleteDoc(doc(db, 'artifacts', appId, 'users', currentUser.uid, oldCol, id));
                                            showToast(`已重做：將「${shortText}」移至 [${newName}]`, 'fas fa-redo');
                                        }
                                    });

                                    await setDoc(doc(db, 'artifacts', appId, 'users', currentUser.uid, newCol, id), data);
                                    await copyCardDetails(oldCol, newCol, id, id);
                                    await deleteDoc(docRef);
                                    showToast(`已將「${shortText}」移至 [${newName}]`, 'fas fa-exchange-alt');
                                }
                            }
                        } catch(err) { console.error(err); }
                    }
                });
            });
        };
        initDragAndDrop();


        const initAuth = async () => { if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) try { await signInWithCustomToken(auth, __initial_auth_token); } catch (e) {} };
        initAuth();

        document.getElementById('login-btn').addEventListener('click', async () => { try { await signInWithPopup(auth, provider); } catch (e) { alert("登入失敗：" + e.message); } });
        document.getElementById('logout-btn').addEventListener('click', async () => { try { await signOut(auth); window.location.reload(); } catch (e) {} });


        const categoryModal = document.getElementById('category-manager-modal');
        const catIcons = [
            'fas fa-folder', 'fas fa-star', 'fas fa-heart', 'fas fa-bolt', 'fas fa-check-square', 'fas fa-lightbulb', 'fas fa-bookmark', 'fas fa-book',
            'fas fa-briefcase', 'fas fa-graduation-cap', 'fas fa-laptop-code', 'fas fa-chart-line', 'fas fa-bullseye', 'fas fa-code', 'fas fa-server', 'fas fa-robot',
            'fas fa-shopping-cart', 'fas fa-shirt', 'fas fa-glasses', 'fas fa-shopping-bag', 'fas fa-tag', 'fas fa-wallet', 'fas fa-dollar-sign',
            'fas fa-plane', 'fas fa-music', 'fas fa-video', 'fas fa-gamepad', 'fas fa-dumbbell', 'fas fa-utensils', 'fas fa-coffee',
            'fas fa-pen', 'fas fa-sticky-note', 'fas fa-list', 'fas fa-focus-open', 'fas fa-tasks', 'fas fa-calendar-alt', 'fas fa-clock', 'fas fa-microphone', 'fas fa-camera',
            'fas fa-piggy-bank', 'fas fa-car', 'fas fa-house', 'fas fa-gift', 'fas fa-paw', 'fas fa-seedling', 'fas fa-map-marker-alt', 'fas fa-fire',
            'fas fa-headphones', 'fas fa-tv', 'fas fa-film', 'fas fa-heartbeat', 'fas fa-pills', 'fas fa-apple-alt', 'fas fa-key', 'fas fa-database',
            'fas fa-mobile-alt', 'fas fa-wifi', 'fas fa-tools', 'fas fa-user', 'fas fa-users', 'fas fa-comments', 'fas fa-sun', 'fas fa-moon', 'fas fa-cloud'
        ];
        
        function closeCategoryModal() {
            categoryModal.classList.add('hidden');
            keyLayers.pop('category');
        }

        document.getElementById('manage-categories-btn').addEventListener('click', () => {
            closeSidebar();
            categoryModal.classList.remove('hidden');
            keyLayers.push({ name: 'category', keys: modalKeys(closeCategoryModal) });
            resetCategoryForm();
        });
        document.getElementById('close-category-modal-btn').addEventListener('click', () => closeCategoryModal());
        document.getElementById('cat-cancel-btn').addEventListener('click', () => {
            resetCategoryForm();
            closeCategoryModal();
        });
        categoryModal.addEventListener('click', (e) => {
            if (e.target === categoryModal) {
                closeCategoryModal();
            }
        });
        document.getElementById('add-category-btn').addEventListener('click', resetCategoryForm);

        function renderIconPicker() {
            const picker = document.getElementById('cat-icon-picker');
            picker.innerHTML = '';
            catIcons.forEach(icon => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = `aspect-square w-full sm:max-w-[3rem] mx-auto rounded-xl border flex items-center justify-center text-xl transition-all ${document.getElementById('cat-icon-input').value === icon ? 'bg-indigo-100 border-indigo-500 text-indigo-600 shadow-sm scale-110 z-10' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50 hover:scale-105'}`;
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
                animation: 150, delay: 150, delayOnTouchOnly: true, fallbackTolerance: 5, forceFallback: true, fallbackClass: 'sortable-fallback',
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

        // ✨ Sidebar Index
        function renderSidebar(categories) {
            const nav = document.getElementById('sidebar-nav');
            if (!nav) return;
            nav.innerHTML = '';

            // Static: Inbox
            nav.appendChild(createSidebarLink('inbox', 'fas fa-inbox', '收件匣'));

            // Divider
            if (categories.length > 0) {
                const divider = document.createElement('div');
                divider.className = 'my-2 border-t border-slate-100';
                nav.appendChild(divider);
            }

            // Dynamic categories
            categories.forEach(cat => {
                nav.appendChild(createSidebarLink(cat.id, cat.icon, cat.name));
            });
        }

        function createSidebarLink(targetId, iconClass, labelText) {
            const btn = document.createElement('button');
            btn.className = 'sidebar-link';
            btn.setAttribute('data-target', targetId);
            const icon = document.createElement('i');
            iconClass.split(' ').filter(Boolean).forEach(cls => icon.classList.add(cls));
            icon.classList.add('sidebar-link-icon');
            const span = document.createElement('span');
            span.className = 'sidebar-link-text';
            span.textContent = labelText;
            btn.appendChild(icon);
            btn.appendChild(span);
            btn.addEventListener('click', () => {
                const targetEl = targetId === 'inbox'
                    ? document.querySelector('[data-col="inbox"]')?.closest('.category-wrapper')
                    : document.getElementById(`list-${targetId}`)?.closest('.category-wrapper');
                if (targetEl) {
                    targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
                closeSidebar();
            });
            return btn;
        }

        function openSidebar() {
            document.getElementById('sidebar')?.classList.add('is-open');
            document.getElementById('sidebar-backdrop')?.classList.remove('hidden');
        }

        function closeSidebar() {
            document.getElementById('sidebar')?.classList.remove('is-open');
            document.getElementById('sidebar-backdrop')?.classList.add('hidden');
        }

        let sidebarObserver = null;

        function initSidebarObserver() {
            if (sidebarObserver) sidebarObserver.disconnect();

            const wrappers = document.querySelectorAll('.category-wrapper');
            if (wrappers.length === 0) return;

            sidebarObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (!entry.isIntersecting) return;
                    const listEl = entry.target.querySelector('[data-col]');
                    const colId = listEl ? listEl.getAttribute('data-col') : null;
                    if (!colId) return;

                    document.querySelectorAll('.sidebar-link').forEach(link => {
                        link.classList.toggle('is-active', link.getAttribute('data-target') === colId);
                    });
                });
            }, {
                rootMargin: '-10% 0px -60% 0px',
                threshold: 0
            });

            wrappers.forEach(wrapper => sidebarObserver.observe(wrapper));
        }

        document.getElementById('sidebar-toggle-btn')?.addEventListener('click', openSidebar);
        document.getElementById('sidebar-close-btn')?.addEventListener('click', closeSidebar);
        document.getElementById('sidebar-backdrop')?.addEventListener('click', closeSidebar);

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
                const targetModel = localStorage.getItem('geminiModel') || 'gemini-2.5-flash';
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: `你是一個 AI 助理。請為一個名為「${catName}」的筆記本分類，寫出一句簡短的分類判斷規則。例如：「只要提到買、補貨、超市、五金行，就放這裡。」。請直接輸出規則字串，不要加引號。` }] }]
                    })
                });
                const data = await response.json();
                if(data.error) throw new Error(data.error.message);
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
                wrapper.className = 'category-wrapper bg-surface border border-slate-200 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col h-full';
                wrapper.setAttribute('data-name', cat.name);
                
                const header = document.createElement('h2');
                header.className = 'text-lg font-bold text-slate-800 mb-4 flex items-center justify-between';
                
                const addBtnHtml = `
                    <button class="add-item-btn-dynamic text-slate-400 hover:text-indigo-600 bg-slate-50 hover:bg-indigo-50 border border-slate-200 w-7 h-7 rounded-md transition-colors flex flex-shrink-0 items-center justify-center focus:outline-none shadow-sm" data-col="${cat.id}" data-name="${escapeHtml(cat.name || '')}" title="在此分類新增">
                        <i class="fas fa-plus text-xs"></i>
                    </button>
                `;

                let controlsHtml = '';
                if (cat.type === 'todo') {
                    controlsHtml = `
                    <div class="flex items-center gap-2">
                        ${addBtnHtml}
                        <button class="toggle-completed-btn-dynamic text-xs font-normal text-slate-500 hover:text-indigo-600 bg-slate-50 border border-slate-200 hover:bg-indigo-50 px-2 py-1 rounded-md transition-colors flex items-center gap-1 focus:outline-none shadow-sm" data-col="${cat.id}">
                            <i class="fas fa-eye-slash toggle-icon"></i> <span class="hidden sm:inline toggle-text">隱藏已完成</span>
                        </button>
                        <button class="delete-completed-btn-dynamic text-xs font-normal text-rose-500 hover:text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100 px-2 py-1 rounded-md transition-colors flex items-center gap-1 focus:outline-none shadow-sm" data-col="${cat.id}">
                            <i class="fas fa-trash-alt"></i> <span class="hidden sm:inline">清空已完成</span>
                        </button>
                    </div>`;
                } else {
                    controlsHtml = `<div class="flex items-center gap-2">${addBtnHtml}</div>`;
                }
                
                let titleHtml = `<div class="flex items-center"><i class="${cat.icon || 'fas fa-folder'} text-indigo-500 mr-2 text-xl"></i>${escapeHtml(cat.name || '')} <span id="count-${cat.id}" class="bg-indigo-100 text-indigo-800 text-xs px-2 py-0.5 rounded-full font-bold ml-2">0</span></div>` + controlsHtml;
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
                    const toggleBtn = wrapper.querySelector('.toggle-completed-btn-dynamic');
                    if (toggleBtn) {
                        let isHidden = false;
                        toggleBtn.addEventListener('click', () => {
                            isHidden = !isHidden;
                            const icon = toggleBtn.querySelector('.toggle-icon');
                            const text = toggleBtn.querySelector('.toggle-text');
                            if (isHidden) {
                                list.classList.add('hide-completed-mode');
                                icon.className = 'fas fa-eye text-indigo-500 toggle-icon';
                                text.innerText = '顯示已完成';
                                text.classList.add('text-indigo-600', 'font-semibold');
                            } else {
                                list.classList.remove('hide-completed-mode');
                                icon.className = 'fas fa-eye-slash toggle-icon';
                                text.innerText = '隱藏已完成';
                                text.classList.remove('text-indigo-600', 'font-semibold');
                            }
                        });
                    }

                    const delBtn = wrapper.querySelector('.delete-completed-btn-dynamic');
                    if(delBtn) {
                        delBtn.addEventListener('click', async () => {
                            if(!confirm('清空所有已完成的項目？')) return;
                            const itemsEl = list.querySelectorAll('.todo-item-completed');
                            const count = itemsEl.length;
                            if (count === 0) {
                                showToast('沒有已完成的項目可以刪除', 'fas fa-info-circle');
                                return;
                            }
                            
                            const itemsToDelete = [];
                            for(const el of itemsEl) {
                                const itemId = el.getAttribute('data-id');
                                const docRef = doc(db, 'artifacts', appId, 'users', currentUser.uid, cat.id, itemId);
                                const docSnap = await getDoc(docRef);
                                if (docSnap.exists()) {
                                    itemsToDelete.push({ id: itemId, data: docSnap.data() });
                                }
                                await deleteDoc(docRef);
                            }
                            
                            if (itemsToDelete.length > 0) {
                                historyManager.push({
                                    undo: async () => {
                                        for (const item of itemsToDelete) {
                                            await setDoc(doc(db, 'artifacts', appId, 'users', currentUser.uid, cat.id, item.id), item.data);
                                        }
                                        showToast(`已還原：放回 ${itemsToDelete.length} 個已完成項目`, 'fas fa-undo');
                                    },
                                    redo: async () => {
                                        for (const item of itemsToDelete) {
                                            await deleteDoc(doc(db, 'artifacts', appId, 'users', currentUser.uid, cat.id, item.id));
                                        }
                                        showToast(`已重做：刪除 ${itemsToDelete.length} 個已完成項目`, 'fas fa-redo');
                                    }
                                });
                            }
                            showToast(`已清空已完成項目，共刪除 ${count} 項`, 'fas fa-trash-alt');
                        });
                    }
                }
                
                const addBtn = wrapper.querySelector('.add-item-btn-dynamic');
                if (addBtn) {
                    addBtn.addEventListener('click', () => {
                        const colId = addBtn.getAttribute('data-col');
                        const colName = addBtn.getAttribute('data-name');
                        openAddCardModal(colId, colName);
                    });
                }
            });
            
            // Re-init sortable for new lists
            initDragAndDrop();
        }

        function setupCustomSelect() {
            const btn = document.getElementById('custom-category-btn');
            const menu = document.getElementById('custom-category-menu');
            
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                menu.classList.toggle('hidden');
            });
            
            document.addEventListener('click', (e) => {
                if (!menu.contains(e.target) && !btn.contains(e.target)) {
                    menu.classList.add('hidden');
                }
            });
            
            menu.addEventListener('click', (e) => {
                const optionBtn = e.target.closest('button[data-value]');
                if (optionBtn) {
                    const value = optionBtn.getAttribute('data-value');
                    const text = optionBtn.querySelector('span').innerText;
                    const iconClass = optionBtn.querySelector('i').className;
                    
                    document.getElementById('category-select').value = value;
                    document.getElementById('custom-category-text').innerText = text;
                    document.getElementById('custom-category-btn').querySelector('i').className = iconClass;
                    
                    menu.classList.add('hidden');
                }
            });
        }
        setupCustomSelect();

        function updateCategorySelectOptions(categories) {
            const select = document.getElementById('category-select');
            const menu = document.getElementById('custom-category-menu');
            const val = select.value;
            
            let html = `
                <button type="button" class="w-full text-left px-4 py-2 hover:bg-indigo-50 text-slate-700 flex items-center gap-2 text-sm transition-colors" data-value="inbox">
                    <i class="fas fa-inbox text-indigo-500 w-4 text-center"></i> <span>收件匣 (由 AI 分類)</span>
                </button>
            `;
            
            categories.forEach(cat => {
                const icon = cat.icon || 'fas fa-folder';
                html += `
                    <button type="button" class="w-full text-left px-4 py-2 hover:bg-indigo-50 text-slate-700 flex items-center gap-2 text-sm transition-colors" data-value="${cat.id}">
                        <i class="${icon} text-indigo-500 w-4 text-center"></i> <span>${escapeHtml(cat.name)}</span>
                    </button>
                `;
            });
            
            menu.innerHTML = html;
            
            const selectedBtn = menu.querySelector(`button[data-value="${val}"]`) || menu.querySelector(`button[data-value="inbox"]`);
            if (selectedBtn) {
                select.value = selectedBtn.getAttribute('data-value');
                document.getElementById('custom-category-text').innerText = selectedBtn.querySelector('span').innerText;
                document.getElementById('custom-category-btn').querySelector('i').className = selectedBtn.querySelector('i').className;
            }
        }

        async function handleIncomingShare() {
            const params = new URLSearchParams(window.location.search);
            const title = params.get('title');
            const text = params.get('text');
            const url = params.get('url');
            
            if (title || text || url) {
                let sharedContent = '';
                if (title) sharedContent += `${title}\n`;
                if (text) sharedContent += `${text}\n`;
                if (url) sharedContent += url;
                sharedContent = sharedContent.trim();
                if (localStorage.getItem('autoNewlineAfterUrl') !== 'off') {
                    sharedContent = insertNewlineAfterGluedUrls(sharedContent);
                }
                
                if (sharedContent) {
                    const inputArea = document.getElementById('idea-input');
                    if (inputArea) {
                        inputArea.value = sharedContent;
                        inputArea.style.height = 'auto';
                        inputArea.style.height = inputArea.scrollHeight + 'px';
                        updateWebPolishButtonsState();
                        inputArea.focus();
                        showToast('已匯入分享內容到輸入框，可編輯後送出！', 'fas fa-share-alt');
                    } else {
                        localStorage.setItem('pendingShare', sharedContent);
                    }
                }
                
                const cleanUrl = window.location.origin + window.location.pathname;
                window.history.replaceState({}, document.title, cleanUrl);
            }
        }

        async function processPendingShare() {
            const pendingShare = localStorage.getItem('pendingShare');
            if (pendingShare) {
                localStorage.removeItem('pendingShare');
                const inputArea = document.getElementById('idea-input');
                if (inputArea) {
                    inputArea.value = pendingShare;
                    inputArea.style.height = 'auto';
                    inputArea.style.height = inputArea.scrollHeight + 'px';
                    updateWebPolishButtonsState();
                    inputArea.focus();
                    showToast('已自動載入先前分享的內容！', 'fas fa-share-alt');
                }
            }
        }

        onAuthStateChanged(auth, (user) => {
            if (user) {
                currentUser = user;
                document.getElementById('auth-status').classList.replace('bg-amber-500', 'bg-emerald-500');
                document.getElementById('auth-text').innerText = user.displayName ? `嗨，${user.displayName}` : "已登入";
                document.getElementById('login-btn').classList.add('hidden'); document.getElementById('logout-btn').classList.remove('hidden');
                setupRealtimeListeners(user.uid);
                
                const urlParams = new URLSearchParams(window.location.search);
                const editorId = urlParams.get('editor');
                const editorCol = urlParams.get('col');
                if (editorId && editorCol) {
                    getDoc(doc(db, 'artifacts', appId, 'users', user.uid, editorCol, editorId))
                        .then(docSnap => {
                            if (docSnap.exists()) openEditor(editorId, docSnap.data().text || '無標題', editorCol);
                            else history.replaceState(null, '', window.location.pathname);
                        }).catch(err => console.error(err));
                }
                
                handleIncomingShare();
                processPendingShare();
            } else {
                currentUser = null;
                document.getElementById('auth-status').classList.replace('bg-emerald-500', 'bg-amber-500');
                document.getElementById('auth-text').innerText = "請先登入";
                document.getElementById('login-btn').classList.remove('hidden'); document.getElementById('logout-btn').classList.add('hidden');
                document.getElementById('main-grid-container').innerHTML = '';
                document.getElementById('inbox-list').innerHTML = `
                    <li class="bg-white/80 p-6 rounded-xl border border-indigo-100 text-slate-500 text-sm text-center ignore-drag backdrop-blur-sm">
                        <i class="fas fa-right-to-bracket text-indigo-300 text-xl mb-2"></i>
                        <div>請先登入才能查看你的收件匣</div>
                        <button id="inbox-login-prompt-btn" class="mt-3 text-indigo-600 font-semibold hover:underline">立即登入</button>
                    </li>`;
                document.getElementById('inbox-login-prompt-btn').addEventListener('click', () => document.getElementById('login-btn').click());
                handleIncomingShare();
            }
        });

        function checkAutoSortCondition() {
            if (isSorting || currentInboxItems.length === 0) return; 
            const apiKey = localStorage.getItem('geminiApiKey'); const autoSetting = localStorage.getItem('autoSortSetting') || 'off';
            if (!apiKey || autoSetting === 'off') return;
            const now = Date.now(); const lastSortTime = parseInt(localStorage.getItem('lastAutoSortTime') || '0', 10);
            if (autoSetting === 'always' || (autoSetting === 'daily' && now - lastSortTime > 86400000)) {
                runAiSort().then(success => {
                    if (success) localStorage.setItem('lastAutoSortTime', now.toString());
                });
            }
        }

        function setupRealtimeListeners(userId) {
            const getCol = (colName) => collection(db, 'artifacts', appId, 'users', userId, colName);
            const sortItems = (items) => items.sort((a, b) => getOrder(b) - getOrder(a));

            onSnapshot(getCol('inbox'), (snapshot) => {
                currentInboxItems = []; snapshot.forEach(doc => currentInboxItems.push({ id: doc.id, ...doc.data() }));
                sortItems(currentInboxItems); renderList(currentInboxItems, document.getElementById('inbox-list'), 'inbox');
                document.getElementById('inbox-count').innerText = currentInboxItems.length;
                document.getElementById('ai-sort-btn').disabled = currentInboxItems.length === 0;
                if (isInitialInboxLoad) { isInitialInboxLoad = false; setTimeout(checkAutoSortCondition, 800); }
                setTimeout(initSidebarObserver, 100);
            });

            onSnapshot(getCol('categories'), async (snapshot) => {
                currentCategories = [];
                snapshot.forEach(doc => currentCategories.push({ id: doc.id, ...doc.data() }));
                
                if (currentCategories.length === 0 && !localStorage.getItem('hasMigratedDefaultCategories')) {
                    localStorage.setItem('hasMigratedDefaultCategories', 'true');
                    const catCol = getCol('categories');
                    await setDoc(doc(catCol, 'todos'), { name: '待辦事項', icon: 'fas fa-check-square', type: 'todo', promptRule: '只要是需要執行、完成的任務、計畫、待辦事項就放這裡', order: 1000 });
                    await setDoc(doc(catCol, 'learning'), { name: '學習筆記', icon: 'fas fa-book', type: 'text', promptRule: '學習過程的筆記、知識點、重點整理', order: 2000 });
                    await setDoc(doc(catCol, 'ideas'), { name: '靈感與想法', icon: 'fas fa-lightbulb', type: 'text', promptRule: '突然想到的點子、創意、隨筆', order: 3000 });
                    await setDoc(doc(catCol, 'bookmarks'), { name: '稍後閱讀', icon: 'fas fa-bookmark', type: 'bookmark', promptRule: '只要是網址或想稍後看的文章就放這裡', order: 4000 });
                    return;
                }

                currentCategories.sort((a, b) => a.order - b.order);
                
                renderCategoryManagerList(currentCategories);
                renderMainGrid(currentCategories);
                updateCategorySelectOptions(currentCategories);
                renderSidebar(currentCategories);
                setTimeout(initSidebarObserver, 100);
            });
        }

        function renderCollection(snapshot, containerEl, collectionName, iconClass) {
            const items = []; snapshot.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
            items.sort((a, b) => getOrder(b) - getOrder(a)); renderList(items, containerEl, collectionName, iconClass);
        }

        function getActionButtonsHTML() {
            return `
                <div class="flex items-center gap-0.5 shrink-0 z-10">
                    <button class="copy-btn text-slate-400 hover:text-indigo-600 hover:bg-slate-100 transition-all cursor-pointer p-1.5 bg-transparent rounded-full" title="複製"><i class="fas fa-copy"></i></button>
                    <button class="edit-btn text-slate-400 hover:text-indigo-600 hover:bg-slate-100 transition-all cursor-pointer p-1.5 bg-transparent rounded-full" title="編輯"><i class="fas fa-pen"></i></button>
                    <button class="move-btn text-slate-400 hover:text-indigo-600 hover:bg-slate-100 transition-all cursor-pointer p-1.5 bg-transparent rounded-full" title="移動分類"><i class="fas fa-folder-open"></i></button>
                    <button class="delete-btn text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all cursor-pointer p-1.5 bg-transparent rounded-full" title="刪除"><i class="fas fa-trash-alt"></i></button>
                </div>`;
        }

        function attachItemListeners(li, item, collectionName) {
            const copyBtn = li.querySelector('.copy-btn');
            if (copyBtn) {
                copyBtn.addEventListener('click', () => {
                    const textArea = document.createElement("textarea"); textArea.value = item.text;
                    document.body.appendChild(textArea); textArea.select();
                    try { document.execCommand('copy'); const icon = copyBtn.querySelector('i'); icon.className = 'fas fa-check text-emerald-500'; setTimeout(() => icon.className = 'fas fa-copy', 2000); } 
                    catch (err) {} document.body.removeChild(textArea);
                });
            }
            li.querySelector('.delete-btn')?.addEventListener('click', () => { 
                pendingDeleteTarget = { id: item.id, col: collectionName }; 
                confirmModal.classList.remove('hidden'); 
            });
            li.querySelector('.move-btn')?.addEventListener('click', () => {
                showMoveModal(item, collectionName);
            });
            li.querySelector('.edit-btn')?.addEventListener('click', () => {
                pendingEditTarget = { id: item.id, col: collectionName }; editInput.value = item.text; openEditCardModal();
            });
        }

        function escapeHtml(unsafe) { 
            if (!unsafe) return '';
            return String(unsafe).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); 
        }

        function getImageHTML(imageUrl) {
            if (!imageUrl) return '';
            return `<div class="mt-2 w-full"><a href="${imageUrl}" target="_blank" class="pointer-events-auto"><img src="${imageUrl}" class="w-full max-h-48 object-cover rounded-lg border border-slate-200 hover:opacity-90 transition-opacity pointer-events-auto"></a></div>`;
        }

        function buildUrlBoundaryRegex(flags = '') {
            // Stops a URL match at whitespace or CJK ideographs/kana/fullwidth punctuation,
            // since those glue directly onto URLs with no separating space in normal typing.
            return new RegExp('https?:\\/\\/[^\\s　-〿぀-ヿ㐀-鿿＀-￯]+', flags);
        }

        function insertNewlineAfterGluedUrls(text) {
            return text.replace(buildUrlBoundaryRegex('g'), (match, offset, fullString) => {
                const nextChar = fullString[offset + match.length];
                return (nextChar && !/\s/.test(nextChar)) ? match + '\n' : match;
            });
        }

        function getLinkPreviewData(text) {
            const safeText = text || '';
            const urlMatch = safeText.match(buildUrlBoundaryRegex());
            let previewHTML = '';
            let textWithoutUrl = safeText;

            if (urlMatch) {
                const url = urlMatch[0]; 
                const ytMatch = url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);
                if (ytMatch) {
                    previewHTML = `<a href="${url}" target="_blank" class="block w-full mt-2 rounded-xl overflow-hidden border border-slate-200 hover:border-rose-300 transition-colors relative group/preview pointer-events-auto"><img src="https://img.youtube.com/vi/${ytMatch[1]}/mqdefault.jpg" class="w-full h-auto object-cover aspect-video"><div class="absolute inset-0 bg-black/20 flex items-center justify-center opacity-80 group-hover/preview:opacity-100 transition-opacity"><i class="fab fa-youtube text-red-500 text-5xl drop-shadow-md bg-white rounded-full"></i></div></a>`;
                } else if (url.includes('github.com')) {
                    const repoParts = url.replace('https://github.com/', '').split('/');
                    const repoPath = repoParts.slice(0, 2).join('/');
                    previewHTML = `<a href="${url}" target="_blank" class="flex items-center gap-3 p-3 w-full mt-2 rounded-xl border border-slate-200 hover:border-slate-400 hover:bg-slate-50 transition-colors text-slate-700 pointer-events-auto"><i class="fab fa-github text-2xl shrink-0"></i><div class="flex flex-col overflow-hidden w-full"><span class="text-xs text-slate-400">GitHub Repository</span><span class="text-sm font-bold truncate">${repoPath || 'GitHub Link'}</span></div></a>`;
                } else {
                    previewHTML = `<a href="${url}" target="_blank" class="flex items-center gap-3 p-3 w-full mt-2 rounded-xl border border-slate-200 hover:border-blue-300 hover:bg-blue-50 transition-colors text-slate-700 pointer-events-auto"><div class="w-8 h-8 rounded-full bg-blue-100 text-blue-500 flex items-center justify-center shrink-0"><i class="fas fa-link"></i></div><div class="flex flex-col overflow-hidden w-full"><span class="text-sm font-semibold truncate text-blue-600">${url}</span><span class="text-xs text-slate-400 truncate">外部網站</span></div></a>`;
                }
                textWithoutUrl = safeText.replace(urlMatch[0], '').trim();
            }
            return { previewHTML, textWithoutUrl };
        }

        function renderList(items, containerEl, collectionName, iconClass = 'fas fa-circle text-[8px] text-indigo-400') {
            if (items.length === 0) {
                containerEl.innerHTML = collectionName === 'inbox' ? `<li class="bg-white/80 p-4 rounded-xl border border-indigo-100 text-slate-500 text-sm text-center ignore-drag">空空如也，丟點東西給我吧！</li>` : `<li class="text-sm text-slate-400 italic ignore-drag">目前沒有項目</li>`;
                return;
            }
            containerEl.innerHTML = '';
            items.forEach(item => {
                const { previewHTML, textWithoutUrl } = getLinkPreviewData(item.text);
                const li = document.createElement('li');
                li.className = 'bg-white p-3 rounded-xl border border-slate-100 text-slate-700 text-sm flex flex-col gap-2 relative shadow-sm group hover:shadow-md transition-shadow cursor-grab active:cursor-grabbing w-full';
                li.setAttribute('data-id', item.id); li.setAttribute('data-order', getOrder(item));
                li.innerHTML = `
                    <div class="flex items-start justify-between w-full min-w-0">
                        <div class="flex items-start gap-2 flex-1 min-w-0 flex-col">
                            <div class="flex items-start gap-2 w-full mt-0.5">
                                <i class="${iconClass} shrink-0 mr-1 mt-1"></i>
                                <div class="leading-relaxed break-words break-all pr-2 line-clamp-3 text-left flex-1 whitespace-pre-wrap">${escapeHtml(textWithoutUrl || item.text || '')}</div>
                            </div>
                        </div>
                    </div>
                    ${getImageHTML(item.imageUrl)}
                    ${previewHTML}
                    <div class="absolute right-2 top-2 bg-white/95 backdrop-blur-md shadow-sm border border-slate-200/60 rounded-full pointer-events-auto p-0.5 md:opacity-0 md:group-hover:opacity-100 transition-all z-10">
                        ${getActionButtonsHTML()}
                    </div>`;
                attachItemListeners(li, item, collectionName);
                
                li.classList.add('cursor-pointer');
                li.addEventListener('click', (e) => {
                    if (justDropped) return; 
                    if (e.target.tagName.toLowerCase() === 'button' || e.target.closest('button')) return;
                    openEditor(item.id, item.text, collectionName);
                });
                
                containerEl.appendChild(li);
            });
        }

        function renderTodos(items, containerEl) {
            if (items.length === 0) { containerEl.innerHTML = `<li class="text-sm text-slate-400 italic ignore-drag">目前沒有項目</li>`; return; }
            containerEl.innerHTML = '';
            items.forEach(item => {
                const { previewHTML, textWithoutUrl } = getLinkPreviewData(item.text);
                const isCompleted = item.completed || false; const textClass = isCompleted ? 'todo-checked' : '';
                const li = document.createElement('li');
                li.className = `bg-white p-3 rounded-xl border border-slate-100 text-slate-700 text-sm flex flex-col gap-2 relative shadow-sm group hover:shadow-md transition-shadow cursor-grab active:cursor-grabbing ${isCompleted ? 'todo-item-completed' : ''} w-full`;
                li.setAttribute('data-id', item.id); li.setAttribute('data-order', getOrder(item));
                
                li.innerHTML = `
                    <div class="flex items-start justify-between w-full min-w-0">
                        <div class="todo-content flex items-start gap-3 flex-1 min-w-0 cursor-pointer flex-col">
                            <div class="flex items-start gap-3 w-full mt-0.5">
                                <input type="checkbox" ${isCompleted ? 'checked' : ''} class="todo-checkbox w-4 h-4 text-emerald-500 rounded border-slate-300 focus:ring-emerald-500 cursor-pointer shrink-0 pointer-events-auto mt-[0.3rem]">
                                <div class="leading-relaxed break-words break-all pr-2 flex-1 transition-all line-clamp-3 whitespace-pre-wrap ${textClass}">${escapeHtml(textWithoutUrl || item.text || '')}</div>
                            </div>
                        </div>
                    </div>
                    ${getImageHTML(item.imageUrl)}
                    ${previewHTML}
                    <div class="absolute right-2 top-2 bg-white/95 backdrop-blur-md shadow-sm border border-slate-200/60 rounded-full pointer-events-auto p-0.5 md:opacity-0 md:group-hover:opacity-100 transition-all z-10">
                        ${getActionButtonsHTML()}
                    </div>`;
                
                const checkbox = li.querySelector('.todo-checkbox');
                
                li.addEventListener('click', async (e) => {
                    if (justDropped) return; 
                    if (e.target.tagName.toLowerCase() === 'img') return;
                    if (e.target === checkbox || e.target.closest('button')) return; 
                    
                    openEditor(item.id, item.text, containerEl.getAttribute('data-col'));
                });
                
                checkbox.addEventListener('click', (e) => e.stopPropagation());
                checkbox.addEventListener('change', async (e) => {
                    if(currentUser) try { await updateDoc(doc(db, 'artifacts', appId, 'users', currentUser.uid, containerEl.getAttribute('data-col'), item.id), { completed: e.target.checked }); } catch(err) {}
                });

                attachItemListeners(li, item, containerEl.getAttribute('data-col')); containerEl.appendChild(li);
            });
        }

        function renderBookmarks(items, containerEl, collectionName) {
            if (items.length === 0) { containerEl.innerHTML = `<li class="text-sm text-slate-400 italic ignore-drag">目前沒有項目</li>`; return; }
            containerEl.innerHTML = '';
            items.forEach(item => {
                const { previewHTML, textWithoutUrl } = getLinkPreviewData(item.text);
                const li = document.createElement('li');
                li.className = 'bg-white p-3 rounded-xl border border-slate-100 shadow-sm group hover:shadow-md transition-shadow flex flex-col gap-2 relative cursor-grab active:cursor-grabbing w-full';
                li.setAttribute('data-id', item.id); li.setAttribute('data-order', getOrder(item));
                
                let textHTML = textWithoutUrl ? `<div class="leading-relaxed break-words break-all text-slate-700 text-sm flex-1 line-clamp-3 pr-2 whitespace-pre-wrap">${escapeHtml(textWithoutUrl || '')}</div>` : '';

                li.innerHTML = `
                    <div class="flex items-start justify-between gap-2 w-full min-w-0 flex-col">
                        <div class="flex items-start gap-2 flex-1 w-full min-w-0">
                            <i class="fas fa-star text-rose-300 shrink-0 mt-1"></i>
                            ${textHTML}
                        </div>
                    </div>
                    ${getImageHTML(item.imageUrl)}
                    ${previewHTML}
                    <div class="absolute right-2 top-2 bg-white/95 backdrop-blur-md shadow-sm border border-slate-200/60 rounded-full pointer-events-auto p-0.5 md:opacity-0 md:group-hover:opacity-100 transition-all z-10">
                        ${getActionButtonsHTML()}
                    </div>`;
                attachItemListeners(li, item, collectionName); containerEl.appendChild(li);
            });
        }

        document.getElementById('cancel-delete-btn').addEventListener('click', () => { confirmModal.classList.add('hidden'); pendingDeleteTarget = null; });
        document.getElementById('confirm-delete-btn').addEventListener('click', async () => {
            if (currentUser && pendingDeleteTarget) {
                const btn = document.getElementById('confirm-delete-btn'); const originalHTML = btn.innerHTML; btn.innerHTML = '<div class="loader w-4 h-4 mx-auto border-t-white border-2"></div>'; btn.disabled = true;
                try { 
                    const col = pendingDeleteTarget.col;
                    const id = pendingDeleteTarget.id;
                    const docRef = doc(db, 'artifacts', appId, 'users', currentUser.uid, col, id);
                    const docSnap = await getDoc(docRef);
                    if (docSnap.exists()) {
                        const data = docSnap.data();
                        const shortText = getShortText(data.text);
                        const colName = getCollectionName(col);
                        historyManager.push({
                            undo: async () => {
                                await setDoc(doc(db, 'artifacts', appId, 'users', currentUser.uid, col, id), data);
                                showToast(`已還原：將「${shortText}」放回 [${colName}]`, 'fas fa-undo');
                            },
                            redo: async () => {
                                await deleteDoc(doc(db, 'artifacts', appId, 'users', currentUser.uid, col, id));
                                showToast(`已重做：將「${shortText}」移至垃圾桶`, 'fas fa-redo');
                            }
                        });
                        await deleteDoc(docRef); 
                        showToast(`已將「${shortText}」移至垃圾桶`, 'fas fa-trash-alt'); 
                    }
                } catch(err) {} finally { btn.innerHTML = originalHTML; btn.disabled = false; confirmModal.classList.add('hidden'); pendingDeleteTarget = null; }
            }
        });

        function showMoveModal(item, currentCollection) {
            pendingMoveTarget = { id: item.id, col: currentCollection, data: item };
            
            const container = document.getElementById('move-options-container');
            container.innerHTML = '';
            
            const targets = [];
            if (currentCollection !== 'inbox') {
                targets.push({ id: 'inbox', name: '收件匣', icon: 'fas fa-inbox', colorClass: 'hover:border-indigo-500 hover:bg-indigo-50 text-indigo-500' });
            }
            
            currentCategories.forEach(cat => {
                if (cat.id !== currentCollection) {
                    let colorClass = 'hover:border-indigo-500 hover:bg-indigo-50 text-indigo-500';
                    if (cat.type === 'todo') colorClass = 'hover:border-emerald-500 hover:bg-emerald-50 text-emerald-500';
                    if (cat.type === 'bookmark') colorClass = 'hover:border-rose-500 hover:bg-rose-50 text-rose-500';
                    
                    targets.push({
                        id: cat.id,
                        name: cat.name,
                        icon: cat.icon || 'fas fa-folder',
                        colorClass: colorClass
                    });
                }
            });
            
            targets.forEach(target => {
                const btn = document.createElement('button');
                btn.className = `move-option-btn w-full p-3 text-left rounded-xl border border-slate-200 flex items-center gap-3 transition-colors ${target.colorClass}`;
                btn.setAttribute('data-target', target.id);
                btn.innerHTML = `<i class="${target.icon} w-6 text-center text-lg"></i><span class="font-semibold text-slate-700">${escapeHtml(target.name)}</span>`;
                
                btn.addEventListener('click', async (e) => {
                    const targetBtn = e.currentTarget; 
                    const targetCol = targetBtn.getAttribute('data-target');
                    if (currentUser && pendingMoveTarget) {
                        const originalHTML = targetBtn.innerHTML; 
                        targetBtn.innerHTML = '<div class="loader w-5 h-5 mx-auto border-t-slate-500"></div>';
                        try {
                            const { id, ...dataToMove } = pendingMoveTarget.data;
                            const oldCol = pendingMoveTarget.col;
                            const targetCat = currentCategories.find(c => c.id === targetCol);
                            const isTodoCol = targetCol === 'todos' || (targetCat && targetCat.type === 'todo');
                            if (!isTodoCol && dataToMove.completed !== undefined) delete dataToMove.completed;
                            const oldOrder = dataToMove.order || Date.now();
                            const newOrder = Date.now();
                            dataToMove.order = newOrder; 
                            
                            const shortText = getShortText(dataToMove.text);
                            const oldName = getCollectionName(oldCol);
                            const newName = getCollectionName(targetCol);
                            
                            historyManager.push({
                                undo: async () => {
                                    const oldData = { ...dataToMove, order: oldOrder };
                                    await setDoc(doc(db, 'artifacts', appId, 'users', currentUser.uid, oldCol, id), oldData);
                                    await copyCardDetails(targetCol, oldCol, id, id);
                                    await deleteDoc(doc(db, 'artifacts', appId, 'users', currentUser.uid, targetCol, id));
                                    showToast(`已還原：將「${shortText}」放回 [${oldName}]`, 'fas fa-undo');
                                },
                                redo: async () => {
                                    await setDoc(doc(db, 'artifacts', appId, 'users', currentUser.uid, targetCol, id), dataToMove);
                                    await copyCardDetails(oldCol, targetCol, id, id);
                                    await deleteDoc(doc(db, 'artifacts', appId, 'users', currentUser.uid, oldCol, id));
                                    showToast(`已重做：將「${shortText}」移至 [${newName}]`, 'fas fa-redo');
                                }
                            });

                            await setDoc(doc(db, 'artifacts', appId, 'users', currentUser.uid, targetCol, id), dataToMove);
                            await copyCardDetails(oldCol, targetCol, id, id);
                            await deleteDoc(doc(db, 'artifacts', appId, 'users', currentUser.uid, oldCol, id));
                            showToast(`已將「${shortText}」移至 [${newName}]`, 'fas fa-exchange-alt');
                        } catch(err) { 
                            console.error(err); 
                        } finally { 
                            targetBtn.innerHTML = originalHTML; 
                            moveModal.classList.add('hidden'); 
                            pendingMoveTarget = null; 
                        }
                    }
                });
                
                container.appendChild(btn);
            });
            
            moveModal.classList.remove('hidden');
        }

        document.getElementById('cancel-move-btn').addEventListener('click', () => { 
            moveModal.classList.add('hidden'); 
            pendingMoveTarget = null; 
        });
        
        moveModal.addEventListener('click', (e) => {
            if (e.target === moveModal) {
                moveModal.classList.add('hidden');
                pendingMoveTarget = null;
            }
        });

        let activeAddCardColId = null;
        const addCardModal = document.getElementById('add-card-modal');
        const addCardInput = document.getElementById('add-card-input');
        const polishAddCardBtn = document.getElementById('polish-add-card-btn');

        window.openAddCardModal = function(colId, colName) {
            activeAddCardColId = colId;
            document.getElementById('add-card-modal-cat-name').textContent = colName;
            addCardInput.value = '';
            addCardModal.classList.remove('hidden');
            keyLayers.push({ name: 'add-card', keys: modalKeys(window.closeAddCardModal) });
            updateWebPolishButtonsState();
            setTimeout(() => addCardInput.focus(), 100);
        };

        window.closeAddCardModal = function() {
            addCardModal.classList.add('hidden');
            keyLayers.pop('add-card');
            activeAddCardColId = null;
            addCardInput.value = '';
            updateWebPolishButtonsState();
        };

        document.getElementById('cancel-add-card-btn').addEventListener('click', closeAddCardModal);
        
        addCardModal.addEventListener('click', (e) => {
            if (e.target === addCardModal) {
                closeAddCardModal();
            }
        });

        addCardInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
                if (isTouchDevice) return; 
                e.preventDefault();
                document.getElementById('confirm-add-card-btn').click();
            }
        });

        document.getElementById('confirm-add-card-btn').addEventListener('click', async () => {
            if (!currentUser || !activeAddCardColId) return;
            let text = addCardInput.value.trim();
            if (!text) return;

            const targetCollection = activeAddCardColId;
            const btn = document.getElementById('confirm-add-card-btn');
            btn.disabled = true;
            btn.innerHTML = '<div class="loader w-4 h-4 mx-auto border-t-white border-2"></div>';

            try {
                const newDocData = { 
                    text: text, 
                    createdAt: Date.now(), 
                    order: Date.now() 
                };

                const docRef = await addDoc(collection(db, 'artifacts', appId, 'users', currentUser.uid, targetCollection), newDocData);
                const newId = docRef.id;
                const shortText = getShortText(newDocData.text);
                const colName = getCollectionName(targetCollection);
                
                historyManager.push({
                    undo: async () => {
                        await deleteDoc(doc(db, 'artifacts', appId, 'users', currentUser.uid, targetCollection, newId));
                        showToast(`已還原：移除新增的卡片「${shortText}」`, 'fas fa-undo');
                    },
                    redo: async () => {
                        await setDoc(doc(db, 'artifacts', appId, 'users', currentUser.uid, targetCollection, newId), newDocData);
                        showToast(`已重做：將卡片「${shortText}」新增至 [${colName}]`, 'fas fa-redo');
                    }
                });
                
                showToast(`已新增卡片「${shortText}」至 [${colName}]`, 'fas fa-plus');
                closeAddCardModal();
            } catch (error) {
                console.error("新增卡片失敗", error);
                alert("新增卡片失敗：" + error.message);
            } finally {
                btn.disabled = false;
                btn.innerText = '新增';
                updateWebPolishButtonsState();
            }
        });

        document.getElementById('cancel-edit-btn').addEventListener('click', () => { closeEditCardModal(); });
        document.getElementById('confirm-edit-btn').addEventListener('click', async () => {
            if (currentUser && pendingEditTarget) {
                const newText = document.getElementById('edit-input').value.trim(); if (!newText) return;
                const btn = document.getElementById('confirm-edit-btn'); const originalHTML = btn.innerHTML; btn.innerHTML = '<div class="loader w-4 h-4 mx-auto border-t-white border-2"></div>'; btn.disabled = true;
                try { 
                    const col = pendingEditTarget.col;
                    const id = pendingEditTarget.id;
                    const docRef = doc(db, 'artifacts', appId, 'users', currentUser.uid, col, id);
                    const docSnap = await getDoc(docRef);
                    if (docSnap.exists()) {
                        const oldText = docSnap.data().text;
                        const shortOldText = getShortText(oldText);
                        const shortNewText = getShortText(newText);
                        historyManager.push({
                            undo: async () => {
                                await updateDoc(doc(db, 'artifacts', appId, 'users', currentUser.uid, col, id), { text: oldText });
                                showToast(`已還原編輯：內容改回「${shortOldText}」`, 'fas fa-undo');
                            },
                            redo: async () => {
                                await updateDoc(doc(db, 'artifacts', appId, 'users', currentUser.uid, col, id), { text: newText });
                                showToast(`已重做編輯：內容改為「${shortNewText}」`, 'fas fa-redo');
                            }
                        });
                        await updateDoc(docRef, { text: newText }); 
                        showToast(`已將內容修改為「${shortNewText}」`, 'fas fa-edit');
                    }
                } catch(err) {} finally { btn.innerHTML = originalHTML; btn.disabled = false; closeEditCardModal(); }
            }
        });

        // ==========================================
        // ✨ ImgBB API 圖片上傳與表單提交流程
        // ==========================================
        const ideaInput = document.getElementById('idea-input');
        const polishLinkBtn = document.getElementById('polish-link-btn');
        const imageUploadInput = document.getElementById('image-upload-input');
        const imagePreviewContainer = document.getElementById('image-preview-container');
        const imagePreviewImg = document.getElementById('image-preview-img');
        const removeImageBtn = document.getElementById('remove-image-btn');
        const aiWebStatusEl = document.getElementById('ai-web-status');
        const aiSortStatusEl = document.getElementById('ai-sort-status');
        const WEB_POLISH_COOLDOWN_MS = 60 * 1000;
        const WEB_POLISH_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
        const WEB_POLISH_CACHE_PREFIX = 'webPolishCache:';
        const AI_SORT_COOLDOWN_MS = 5 * 60 * 1000;

        function extractUrls(text) {
            return [...new Set((text.match(buildUrlBoundaryRegex('g')) || []).map(url => url.trim()))];
        }

        function canUseWebPolish(text) {
            const normalizedText = (text || '').trim();
            const urls = extractUrls(normalizedText);
            if (urls.length !== 1) {
                return { ok: false, reason: urls.length === 0 ? 'no_url' : 'multiple_urls' };
            }
            if (normalizedText.length > 1200) {
                return { ok: false, reason: 'too_long' };
            }
            return { ok: true, reason: 'ok' };
        }

        function hashString(value) {
            let hash = 2166136261;
            for (let i = 0; i < value.length; i++) {
                hash ^= value.charCodeAt(i);
                hash = Math.imul(hash, 16777619);
            }
            return (hash >>> 0).toString(36);
        }

        function getWebPolishCacheKey(text) {
            return `${WEB_POLISH_CACHE_PREFIX}${hashString((text || '').trim().replace(/\s+/g, ' '))}`;
        }

        function getCachedWebPolish(text) {
            const raw = localStorage.getItem(getWebPolishCacheKey(text));
            if (!raw) return null;
            try {
                const parsed = JSON.parse(raw);
                if (!parsed?.value || !parsed?.savedAt) return null;
                if (Date.now() - parsed.savedAt > WEB_POLISH_CACHE_TTL_MS) {
                    localStorage.removeItem(getWebPolishCacheKey(text));
                    return null;
                }
                return parsed.value;
            } catch (error) {
                localStorage.removeItem(getWebPolishCacheKey(text));
                return null;
            }
        }

        function cacheWebPolishResult(text, value) {
            localStorage.setItem(getWebPolishCacheKey(text), JSON.stringify({
                value,
                savedAt: Date.now()
            }));
        }

        function getWebPolishCooldownRemaining() {
            const lastRun = parseInt(localStorage.getItem('lastWebPolishTime') || '0', 10);
            return Math.max(0, WEB_POLISH_COOLDOWN_MS - (Date.now() - lastRun));
        }

        function formatCooldown(ms) {
            return `${Math.ceil(ms / 1000)} 秒`;
        }

        function formatStatusTime(timestamp) {
            if (!timestamp) return '尚無紀錄';
            try {
                return new Date(timestamp).toLocaleString('zh-TW', {
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                });
            } catch (error) {
                return '尚無紀錄';
            }
        }

        function saveAiStatus(type, status, detail) {
            localStorage.setItem(`aiStatus:${type}`, JSON.stringify({
                status,
                detail,
                timestamp: Date.now()
            }));
        }

        function readAiStatus(type) {
            const raw = localStorage.getItem(`aiStatus:${type}`);
            if (!raw) return null;
            try {
                return JSON.parse(raw);
            } catch (error) {
                return null;
            }
        }

        function updateAiStatusPanel() {
            const webStatus = readAiStatus('web');
            const sortStatus = readAiStatus('sort');
            aiWebStatusEl.textContent = webStatus
                ? `網址研讀狀態：${webStatus.status}，${webStatus.detail}（${formatStatusTime(webStatus.timestamp)}）`
                : '網址研讀狀態：尚無紀錄';
            aiSortStatusEl.textContent = sortStatus
                ? `AI 整理狀態：${sortStatus.status}，${sortStatus.detail}（${formatStatusTime(sortStatus.timestamp)}）`
                : 'AI 整理狀態：尚無紀錄';
        }

        function setButtonLoading(button, loadingHTML, idleHTML) {
            const originalHTML = idleHTML || button.innerHTML;
            button.disabled = true;
            button.innerHTML = loadingHTML;
            return () => {
                button.disabled = false;
                button.innerHTML = originalHTML;
            };
        }

        function updateWebPolishButtonsState() {
            polishLinkBtn.disabled = !canUseWebPolish(ideaInput.value).ok;
            polishAddCardBtn.disabled = !canUseWebPolish(addCardInput.value).ok;
        }

        async function runManualWebPolish(text, button) {
            const normalizedText = (text || '').trim();
            const eligibility = canUseWebPolish(normalizedText);
            if (!eligibility.ok) {
                if (eligibility.reason === 'no_url') showToast('沒有偵測到網址，無法執行 AI 研讀。', 'fas fa-link');
                else if (eligibility.reason === 'multiple_urls') showToast('一次只支援研讀 1 個網址，請先精簡輸入。', 'fas fa-link');
                else if (eligibility.reason === 'too_long') showToast('這段內容太長，請先縮短後再執行 AI 研讀。', 'fas fa-align-left');
                return null;
            }

            const apiKey = localStorage.getItem('geminiApiKey');
            const targetModel = localStorage.getItem('geminiModel') || 'gemini-2.5-flash';
            if (!apiKey) {
                document.getElementById('settings-modal').classList.remove('hidden');
                showToast('請先設定 Gemini API Key，才能使用 AI 研讀。', 'fas fa-key');
                return null;
            }

            const cached = getCachedWebPolish(normalizedText);
            if (cached) {
                saveAiStatus('web', '使用快取', '相同內容直接套用快取結果');
                updateAiStatusPanel();
                showToast('已套用先前的 AI 研讀結果。', 'fas fa-clock-rotate-left');
                return cached;
            }

            const cooldownRemaining = getWebPolishCooldownRemaining();
            if (cooldownRemaining > 0) {
                saveAiStatus('web', '冷卻中', `剩餘 ${formatCooldown(cooldownRemaining)}`);
                updateAiStatusPanel();
                showToast(`AI 研讀冷卻中，請 ${formatCooldown(cooldownRemaining)} 後再試。`, 'fas fa-hourglass-half');
                return null;
            }

            const restoreButton = setButtonLoading(button, '<div class="loader w-4 h-4 border-2 border-t-transparent mx-auto"></div>');
            localStorage.setItem('lastWebPolishTime', Date.now().toString());
            showToast('AI 正在使用 Google 搜尋研讀網址並潤飾...', 'fas fa-robot');

            try {
                const polished = await polishContentWithWebSearch(normalizedText, apiKey, targetModel);
                if (!polished) throw new Error('AI 沒有回傳內容');
                cacheWebPolishResult(normalizedText, polished);
                saveAiStatus('web', '成功', '已完成網址研讀並寫入快取');
                updateAiStatusPanel();
                showToast('AI 研讀完成，已套用潤飾內容。', 'fas fa-wand-magic-sparkles');
                return polished;
            } catch (error) {
                console.error('AI 網頁研讀潤飾失敗：', error);
                const rawMessage = error?.message || '未知錯誤';
                const lowerMessage = rawMessage.toLowerCase();
                if (lowerMessage.includes('429') || lowerMessage.includes('quota') || lowerMessage.includes('too many requests')) {
                    saveAiStatus('web', '配額不足', 'Gemini 回傳 429 / quota exceeded');
                    showToast('Gemini 配額暫時不足，已保留原始文字，請稍後再試。', 'fas fa-gauge-high');
                } else {
                    saveAiStatus('web', '失敗', rawMessage);
                    showToast(`AI 網頁研讀失敗：${rawMessage}`, 'fas fa-exclamation-triangle');
                }
                updateAiStatusPanel();
                return null;
            } finally {
                restoreButton();
                updateWebPolishButtonsState();
            }
        }

        ideaInput.addEventListener('input', function() {
            this.style.height = '40px';
            this.style.height = (this.scrollHeight) + 'px';
            updateWebPolishButtonsState();
        });

        addCardInput.addEventListener('input', updateWebPolishButtonsState);

        function attachAutoNewlinePaste(textareaEl) {
            textareaEl.addEventListener('paste', (e) => {
                if (localStorage.getItem('autoNewlineAfterUrl') === 'off') return;
                const clipboardText = (e.clipboardData || window.clipboardData)?.getData('text');
                if (!clipboardText) return;
                const processed = insertNewlineAfterGluedUrls(clipboardText);
                if (processed === clipboardText) return;
                e.preventDefault();
                const start = textareaEl.selectionStart;
                const end = textareaEl.selectionEnd;
                const original = textareaEl.value;
                textareaEl.value = original.slice(0, start) + processed + original.slice(end);
                const newCursor = start + processed.length;
                textareaEl.selectionStart = textareaEl.selectionEnd = newCursor;
                textareaEl.dispatchEvent(new Event('input', { bubbles: true }));
            });
        }
        attachAutoNewlinePaste(ideaInput);
        attachAutoNewlinePaste(addCardInput);

        ideaInput.addEventListener('keydown', function(e) { 
            if (e.key === 'Enter' && !e.shiftKey) { 
                // 改用觸控裝置偵測，避免電腦上的小視窗預覽時誤判為手機
                const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
                if (isTouchDevice) return; // 觸控裝置 (手機/平板) 允許預設的換行行為
                
                e.preventDefault(); 
                document.getElementById('submit-btn').click(); // 模擬點擊送出按鈕
            } 
        });
        
        document.getElementById('paste-btn').addEventListener('click', async () => {
            try { const text = await navigator.clipboard.readText(); ideaInput.value += text; ideaInput.dispatchEvent(new Event('input')); ideaInput.focus(); } catch (err) { alert("無法自動讀取剪貼簿，請手動貼上。"); }
        });

        polishLinkBtn.addEventListener('click', async () => {
            const polished = await runManualWebPolish(ideaInput.value, polishLinkBtn);
            if (!polished) return;
            ideaInput.value = polished;
            ideaInput.dispatchEvent(new Event('input'));
            ideaInput.focus();
        });

        polishAddCardBtn.addEventListener('click', async () => {
            const polished = await runManualWebPolish(addCardInput.value, polishAddCardBtn);
            if (!polished) return;
            addCardInput.value = polished;
            addCardInput.dispatchEvent(new Event('input'));
            addCardInput.focus();
        });

        updateWebPolishButtonsState();
        updateAiStatusPanel();

        ideaInput.addEventListener('paste', (e) => {
            const items = (e.clipboardData || e.originalEvent.clipboardData).items;
            for (let index in items) {
                const item = items[index];
                if (item.kind === 'file' && item.type.startsWith('image/')) {
                    const blob = item.getAsFile();
                    e.preventDefault(); 
                    handleImageStaging(blob);
                    break;
                }
            }
        });

        document.getElementById('upload-image-btn').addEventListener('click', () => { imageUploadInput.click(); });
        imageUploadInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) handleImageStaging(e.target.files[0]);
        });

        function handleImageStaging(file) {
            const imgbbKey = localStorage.getItem('imgbbApiKey');
            if (!imgbbKey) {
                alert("請先點擊右上角「⚙️ 系統設定」，填寫免費的 ImgBB API Key 才能解鎖圖片上傳功能！");
                document.getElementById('settings-modal').classList.remove('hidden');
                return;
            }
            
            if (file.size > 32 * 1024 * 1024) { alert("圖片太大了，ImgBB 限制最大 32MB！"); return; }
            
            stagedImageFile = file;
            const reader = new FileReader();
            reader.onload = (e) => {
                imagePreviewImg.src = e.target.result;
                imagePreviewContainer.classList.remove('hidden');
            };
            reader.readAsDataURL(file);
        }

        removeImageBtn.addEventListener('click', () => {
            stagedImageFile = null; imageUploadInput.value = '';
            imagePreviewContainer.classList.add('hidden'); imagePreviewImg.src = '';
        });

        async function polishContentWithWebSearch(text, apiKey, model) {
            const promptText = `使用者輸入了以下內容，其中包含網頁連結：
"""
${text}
"""
請你利用 Google 搜尋功能（Search Grounding）去讀取並研讀這些連結的內容，理解該網頁在講什麼。
接著，結合使用者原本提供的說明文字或備註，潤飾並整理成一段通順、精煉且包含重點的繁體中文筆記。
請注意：
1. 必須保留原本的網頁連結在產出內容中（或者在最後面附上原連結）。
2. 請直接輸出潤飾整理後的筆記內容，不要包含任何前言、引言或『以下是整理後的內容：』等無關字樣。`;

            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: promptText }] }],
                    tools: [{ google_search: {} }] // Enable Google Search Grounding!
                })
            });
            
            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error?.message || `HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            if (data.error) {
                throw new Error(data.error.message);
            }
            
            const candidate = data.candidates?.[0];
            if (!candidate) {
                throw new Error("模型未回傳結果");
            }
            
            if (candidate.finishReason && candidate.finishReason !== 'STOP') {
                throw new Error(`生成中斷，原因: ${candidate.finishReason}`);
            }
            
            const partText = candidate.content?.parts?.[0]?.text;
            if (!partText) {
                throw new Error("回傳結果無內容");
            }
            
            return partText.trim();
        }

        document.getElementById('add-form').addEventListener('submit', async (e) => {
            e.preventDefault(); if (!currentUser) return;
            let text = ideaInput.value.trim(); 
            
            if (!text && !stagedImageFile) return;

            const targetCollection = document.getElementById('category-select').value; 
            const btn = document.getElementById('submit-btn'); 
            btn.disabled = true; btn.innerHTML = '<div class="loader w-4 h-4 border-2"></div>';

            let uploadedImageUrl = null;

            try {
                if (stagedImageFile) {
                    const imgbbKey = localStorage.getItem('imgbbApiKey');
                    const formData = new FormData();
                    formData.append('image', stagedImageFile);

                    const res = await fetch(`https://api.imgbb.com/1/upload?key=${imgbbKey}`, {
                        method: 'POST', body: formData
                    });
                    
                    const data = await res.json();
                    if (data.success) {
                        uploadedImageUrl = data.data.url;
                    } else {
                        throw new Error(data.error?.message || "ImgBB 上傳失敗");
                    }
                }

                const newDocData = { 
                    text: text || "（附加圖片）", 
                    createdAt: Date.now(), order: Date.now() 
                };

                if (uploadedImageUrl) newDocData.imageUrl = uploadedImageUrl;

                const docRef = await addDoc(collection(db, 'artifacts', appId, 'users', currentUser.uid, targetCollection), newDocData);
                const newId = docRef.id;
                const shortText = getShortText(newDocData.text);
                const colName = getCollectionName(targetCollection);
                historyManager.push({
                    undo: async () => {
                        await deleteDoc(doc(db, 'artifacts', appId, 'users', currentUser.uid, targetCollection, newId));
                        showToast(`已還原：移除新增的卡片「${shortText}」`, 'fas fa-undo');
                    },
                    redo: async () => {
                        await setDoc(doc(db, 'artifacts', appId, 'users', currentUser.uid, targetCollection, newId), newDocData);
                        showToast(`已重做：將卡片「${shortText}」新增至 [${colName}]`, 'fas fa-redo');
                    }
                });
                showToast(`已新增卡片「${shortText}」至 [${colName}]`, 'fas fa-plus');
                
                ideaInput.value = ''; ideaInput.style.height = '40px';
                removeImageBtn.click(); 

            } catch (error) { 
                console.error("送出失敗", error); alert("送出失敗：" + error.message);
            } finally { 
                btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane text-xs"></i>'; updateWebPolishButtonsState(); ideaInput.focus(); 
            }
        });

        // ==========================================
        // ✨ 設定邏輯與 AI 分類
        // ==========================================
        function closeSettingsModal() {
            document.getElementById('settings-modal').classList.add('hidden');
            keyLayers.pop('settings');
        }

        document.getElementById('settings-btn').addEventListener('click', () => {
            closeSidebar();
            document.getElementById('api-key-input').value = localStorage.getItem('geminiApiKey') || '';
            document.getElementById('imgbb-key-input').value = localStorage.getItem('imgbbApiKey') || '';
            document.getElementById('auto-sort-select').value = localStorage.getItem('autoSortSetting') || 'off';
            document.getElementById('auto-newline-toggle').checked = localStorage.getItem('autoNewlineAfterUrl') !== 'off';
            updateAiStatusPanel();
            document.getElementById('settings-modal').classList.remove('hidden');
            keyLayers.push({ name: 'settings', keys: modalKeys(closeSettingsModal) });
        });
        document.getElementById('settings-modal').addEventListener('click', (e) => {
            const settingsModal = document.getElementById('settings-modal');
            if (e.target === settingsModal) {
                closeSettingsModal();
            }
        });
        document.getElementById('close-modal-btn').addEventListener('click', () => closeSettingsModal());
        
        document.getElementById('verify-key-btn').addEventListener('click', async () => {
            const key = document.getElementById('api-key-input').value.trim(); if(!key) return;
            const btn = document.getElementById('verify-key-btn'); btn.disabled = true; btn.innerHTML = '<div class="loader w-4 h-4 border-2 border-t-indigo-700 mx-auto"></div>';
            try {
                const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
                const data = await res.json();
                const models = data.models.filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent'));
                const select = document.getElementById('model-select'); select.innerHTML = '';
                models.forEach(m => { const opt = document.createElement('option'); opt.value = m.name.replace('models/', ''); opt.textContent = m.displayName || m.name; select.appendChild(opt); });
                document.getElementById('model-select-container').classList.remove('hidden');
            } catch(e) {} finally { btn.disabled = false; btn.innerText = '查詢並指定可用模型'; }
        });

        document.getElementById('save-settings-btn').addEventListener('click', () => {
            const geminiKey = document.getElementById('api-key-input').value.trim();
            const imgbbKey = document.getElementById('imgbb-key-input').value.trim();
            if(geminiKey) { localStorage.setItem('geminiApiKey', geminiKey); if (document.getElementById('model-select').value) localStorage.setItem('geminiModel', document.getElementById('model-select').value); }
            if(imgbbKey) { localStorage.setItem('imgbbApiKey', imgbbKey); }
            localStorage.setItem('autoSortSetting', document.getElementById('auto-sort-select').value);
            localStorage.setItem('autoNewlineAfterUrl', document.getElementById('auto-newline-toggle').checked ? 'on' : 'off');
            closeSettingsModal();
        });

        async function runAiSort() {
            if (isSorting || currentInboxItems.length === 0 || !currentUser) return false;
            const apiKey = localStorage.getItem('geminiApiKey'); const targetModel = localStorage.getItem('geminiModel') || 'gemini-2.5-flash';
            if (!apiKey) { document.getElementById('settings-modal').classList.remove('hidden'); return false; }
            const lastManualSortTime = parseInt(localStorage.getItem('lastManualSortTime') || '0', 10);
            const sortCooldownRemaining = Math.max(0, AI_SORT_COOLDOWN_MS - (Date.now() - lastManualSortTime));
            if (sortCooldownRemaining > 0) {
                saveAiStatus('sort', '冷卻中', `剩餘 ${formatCooldown(sortCooldownRemaining)}`);
                updateAiStatusPanel();
                showToast(`AI 整理冷卻中，請 ${formatCooldown(sortCooldownRemaining)} 後再試。`, 'fas fa-hourglass-half');
                return false;
            }

            isSorting = true; const btn = document.getElementById('ai-sort-btn'); btn.disabled = true; const originalHTML = btn.innerHTML; btn.innerHTML = `<div class="loader w-4 h-4 border-2 border-t-white"></div> <span id="ai-sort-text">AI 背景整理中...</span>`;
            localStorage.setItem('lastManualSortTime', Date.now().toString());
            try {
                const itemsToCategorize = [...currentInboxItems]; 
                
                const inboxData = itemsToCategorize.map(item => ({ id: item.id, content: item.text }));
                const categoryContext = currentCategories.map(c => `- ID: "${c.id}" (名稱: ${c.name}, 規則: ${c.promptRule || '無'})`).join('\n');
                const categoryIds = currentCategories.map(c => c.id);

                const promptText = `你是一個負責分類筆記的 AI。
請閱讀以下的 Inbox 項目，並根據現有的分類規則，決定每一個項目應該被放入哪一個分類。
絕對不能修改或分割原始項目的內容。你只需要返回每個項目的 itemId 和對應的 categoryId。

現有分類清單與規則：
${categoryContext}

Inbox 項目：
${JSON.stringify(inboxData, null, 2)}`;

                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey}`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: promptText }] }],
                        generationConfig: { 
                            responseMimeType: "application/json", 
                            responseSchema: { 
                                type: "ARRAY", 
                                items: { 
                                    type: "OBJECT", 
                                    properties: { 
                                        itemId: { type: "STRING" }, 
                                        categoryId: { type: "STRING", enum: categoryIds } 
                                    },
                                    required: ["itemId", "categoryId"]
                                } 
                            } 
                        }
                    })
                });
                
                if (!response.ok) {
                    const errData = await response.json().catch(() => ({}));
                    throw new Error(errData.error?.message || `HTTP error! status: ${response.status}`);
                }

                const responseData = await response.json();
                if (responseData.error) throw new Error(responseData.error.message);

                const candidate = responseData.candidates?.[0];
                if (!candidate) throw new Error("模型未回傳結果");
                if (candidate.finishReason && candidate.finishReason !== 'STOP') {
                    throw new Error(`生成中斷，原因: ${candidate.finishReason}`);
                }
                const partText = candidate.content?.parts?.[0]?.text;
                if (!partText) throw new Error("回傳結果無內容");

                const resultMap = JSON.parse(partText);
                const historyMappings = [];
                
                for (const mapping of resultMap) {
                    const item = itemsToCategorize.find(i => i.id === mapping.itemId);
                    if (!item) continue;
                    
                    let targetCol = mapping.categoryId;
                    if (!categoryIds.includes(targetCol)) targetCol = categoryIds[0] || 'inbox';
                    
                    let docData = { text: item.text, createdAt: item.createdAt || Date.now(), order: Date.now() };
                    if (item.imageUrl) docData.imageUrl = item.imageUrl;
                    
                    historyMappings.push({
                        itemId: item.id,
                        newCol: targetCol,
                        data: item
                    });
                    
                    await setDoc(doc(db, 'artifacts', appId, 'users', currentUser.uid, targetCol, item.id), docData);
                    await copyCardDetails('inbox', targetCol, item.id, item.id);
                    await deleteDoc(doc(db, 'artifacts', appId, 'users', currentUser.uid, 'inbox', item.id));
                }
                
                if (historyMappings.length > 0) {
                    historyManager.push({
                        undo: async () => {
                            for (const m of historyMappings) {
                                await setDoc(doc(db, 'artifacts', appId, 'users', currentUser.uid, 'inbox', m.itemId), m.data);
                                await copyCardDetails(m.newCol, 'inbox', m.itemId, m.itemId);
                                await deleteDoc(doc(db, 'artifacts', appId, 'users', currentUser.uid, m.newCol, m.itemId));
                            }
                            showToast(`已還原 AI 整理，共 ${historyMappings.length} 個項目已放回 [收件匣]`, 'fas fa-undo');
                        },
                        redo: async () => {
                            for (const m of historyMappings) {
                                let docData = { text: m.data.text, createdAt: m.data.createdAt || Date.now(), order: Date.now() };
                                if (m.data.imageUrl) docData.imageUrl = m.data.imageUrl;
                                await setDoc(doc(db, 'artifacts', appId, 'users', currentUser.uid, m.newCol, m.itemId), docData);
                                await copyCardDetails('inbox', m.newCol, m.itemId, m.itemId);
                                await deleteDoc(doc(db, 'artifacts', appId, 'users', currentUser.uid, 'inbox', m.itemId));
                            }
                            showToast(`已重做 AI 整理，共 ${historyMappings.length} 個項目已重新分類`, 'fas fa-redo');
                        }
                    });
                }
                saveAiStatus('sort', '成功', `已整理 ${resultMap.length} 個項目`);
                updateAiStatusPanel();
                showToast(`AI 整理完成，已分類 ${resultMap.length} 個項目`, 'fas fa-magic');
                return true;
            } catch (error) {
                console.error(error);
                const rawMessage = error?.message || '未知錯誤';
                const lowerMessage = rawMessage.toLowerCase();
                if (lowerMessage.includes('429') || lowerMessage.includes('quota') || lowerMessage.includes('too many requests')) {
                    saveAiStatus('sort', '配額不足', 'Gemini 回傳 429 / quota exceeded');
                    showToast('AI 整理遇到配額限制，請稍後再試。', 'fas fa-gauge-high');
                } else {
                    saveAiStatus('sort', '失敗', rawMessage);
                }
                updateAiStatusPanel();
                alert("AI 整理失敗：" + error.message);
                return false;
            } finally {
                isSorting = false; btn.disabled = false; btn.innerHTML = originalHTML;
            }
        }

        document.getElementById('ai-sort-btn').addEventListener('click', runAiSort);
        let activeEditorCardId = null;
        let activeEditorCollection = null;

        let currentEditorLoadId = 0;
        let editorInstance = null;

        async function openEditor(itemId, itemText, collectionName) {
            const loadId = ++currentEditorLoadId;
            const modal = document.getElementById('editor-modal');
            const backdrop = document.getElementById('editor-backdrop');
            const container = document.getElementById('editor-container');
            const titleInput = document.getElementById('editor-title');
            
            // Force save if pending
            if (editorSaveTimeout) {
                clearTimeout(editorSaveTimeout);
                editorSaveTimeout = null;
                await saveEditorContent();
            }
            
            if (editorInstance) {
                try {
                    editorInstance.destroy();
                } catch (e) {
                    console.log('Error destroying editor:', e);
                }
                editorInstance = null;
            }
            
            activeEditorCardId = itemId;
            activeEditorCollection = collectionName;
            
            // Set UI
            titleInput.innerText = itemText;
            modal.classList.remove('hidden');
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
            history.replaceState(null, '', `?editor=${itemId}&col=${collectionName}`);
            // Force reflow
            void modal.offsetWidth;
            document.body.classList.add('editor-open');
            backdrop.classList.add('opacity-100');
            container.classList.add('scale-100', 'opacity-100');

            document.getElementById('editorjs-container').innerHTML = '<div class="flex justify-center items-center h-full min-h-[50vh]"><div class="loader w-10 h-10 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin"></div></div>';

            // Fetch existing note from Firestore
            let noteData = null;
            try {
                // Ensure doc and getDoc are imported from firestore, they already should be in index.html
                const noteRef = doc(db, 'artifacts', appId, 'users', currentUser.uid, collectionName, itemId, 'details', 'note');
                const noteSnap = await getDoc(noteRef);
                if (noteSnap.exists()) {
                    noteData = noteSnap.data().data;
                }
            } catch (err) {
                console.error("Failed to load note details:", err);
            }
            if (loadId !== currentEditorLoadId) return; // Abort if user clicked another card
            
            document.getElementById('editorjs-container').innerHTML = '';
            initEditor(noteData, handleEditorChange);
        }

        let editorSaveTimeout = null;
        
        function showSaveStatus(text, iconClass) {
            const status = document.getElementById('editor-save-status');
            status.innerHTML = `<i class="${iconClass} mr-1"></i>${text}`;
            status.classList.remove('opacity-0');
            setTimeout(() => status.classList.add('opacity-0'), 2000);
        }

        async function saveEditorContent() {
            if (!activeEditorCardId || !editorInstance) return;
            const cardId = activeEditorCardId;
            const collectionName = activeEditorCollection;
            const currentEditor = editorInstance;
            
            try {
                const outputData = await currentEditor.save();
                const noteRef = doc(db, 'artifacts', appId, 'users', currentUser.uid, collectionName, cardId, 'details', 'note');
                
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

        function initEditor(initialData = null, onChangeCallback = null) {
            if (editorInstance) {
                try {
                    editorInstance.destroy();
                } catch (e) {
                    console.log('Error destroying editor:', e);
                }
                editorInstance = null;
            }
            
            const config = {
                holder: 'editorjs-container',
                placeholder: '在這裡開始輸入你的想法... (輸入 / 顯示選單)',
                onChange: () => {
                    if (onChangeCallback) onChangeCallback();
                },
                onReady: () => {
                    new Undo({ editor: editorInstance });
                },
                tools: {
                    header: { class: Header, inlineToolbar: true, config: { placeholder: '輸入標題', levels: [1, 2, 3], defaultLevel: 2 } },
                    list: { class: EditorjsList, inlineToolbar: true },
                    checklist: { class: Checklist, inlineToolbar: true },
                    quote: { class: Quote, inlineToolbar: true },
                    Marker: { class: Marker, inlineToolbar: true }
                }
            };
            
            if (initialData && initialData.blocks && initialData.blocks.length > 0) {
                config.data = initialData;
            }
            
            editorInstance = new EditorJS(config);
        }

        function closeEditor() {
            if (editorSaveTimeout) {
                clearTimeout(editorSaveTimeout);
                editorSaveTimeout = null;
                saveEditorContent(); // Fire and forget
            }
            const modal = document.getElementById('editor-modal');
            const backdrop = document.getElementById('editor-backdrop');
            const container = document.getElementById('editor-container');
            
            backdrop.classList.remove('opacity-100');
            container.classList.remove('scale-100', 'opacity-100');
            document.body.classList.remove('editor-open');
            keyLayers.pop('editor');
            setTimeout(() => modal.classList.add('hidden'), 300);
            activeEditorCardId = null;
            activeEditorCollection = null;
            history.replaceState(null, '', window.location.pathname);
            
            if (editorInstance) {
                editorInstance.destroy();
                editorInstance = null;
            }
        }

        document.getElementById('editor-close-btn').addEventListener('click', closeEditor);
        document.getElementById('editor-backdrop').addEventListener('click', closeEditor);

        let isSideLayout = localStorage.getItem('editorLayout') === 'side';
        function updateEditorLayout() {
            const modal = document.getElementById('editor-modal');
            const container = document.getElementById('editor-container');
            if (isSideLayout) {
                document.body.classList.add('side-layout-active');
                modal.classList.remove('justify-center', 'items-center');
                modal.classList.add('justify-end');
                container.classList.remove('max-w-4xl', 'md:rounded-2xl', 'md:h-[85vh]');
                container.classList.add('w-[50vw]', 'rounded-none', 'h-full');
            } else {
                document.body.classList.remove('side-layout-active');
                modal.classList.add('justify-center', 'items-center');
                modal.classList.remove('justify-end');
                container.classList.add('max-w-4xl', 'md:rounded-2xl', 'md:h-[85vh]');
                container.classList.remove('w-[50vw]', 'rounded-none', 'h-full');
            }
        }
        document.getElementById('editor-layout-btn').addEventListener('click', () => {
            isSideLayout = !isSideLayout;
            localStorage.setItem('editorLayout', isSideLayout ? 'side' : 'center');
            updateEditorLayout();
        });
        updateEditorLayout();

        document.getElementById('editor-title').addEventListener('input', (e) => {
            clearTimeout(editorSaveTimeout);
            editorSaveTimeout = setTimeout(async () => {
                if (!activeEditorCardId) return;
                const newTitle = e.target.innerText.trim();
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
        window.addEventListener('beforeunload', (e) => {
            if (editorSaveTimeout) {
                e.preventDefault();
                e.returnValue = ''; // Trigger browser warning
            }
        });

        // Toast System
        window.showToast = function(message, icon = 'fas fa-info-circle') {
            const container = document.getElementById('toast-container');
            const toast = document.createElement('div');
            toast.className = 'bg-slate-800 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 transform transition-all duration-300 translate-y-full opacity-0 text-sm font-medium';
            toast.innerHTML = `<i class="${icon}"></i> <span>${message}</span>`;
            container.appendChild(toast);
            
            requestAnimationFrame(() => {
                toast.classList.remove('translate-y-full', 'opacity-0');
            });
            
            setTimeout(() => {
                toast.classList.add('translate-y-full', 'opacity-0');
                setTimeout(() => toast.remove(), 300);
            }, 3000);
        };

        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('sw.js')
                    .then(reg => console.log('Service Worker registered', reg))
                    .catch(err => console.log('Service Worker registration failed', err));
            });
        }
