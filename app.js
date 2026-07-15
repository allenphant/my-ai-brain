        import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
        import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
        import { getFirestore, collection, addDoc, onSnapshot, deleteDoc, doc, updateDoc, getDoc, setDoc, runTransaction } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
        import { createLayerStack, attachKeyboardManager } from './js/keyboard-layers.js';
        import { attachMdShortcuts } from './js/md-shortcuts.js';
        import {
            DEFAULT_WEB_RESEARCH_MODEL,
            DEFAULT_WEB_RESEARCH_SYSTEM_PROMPT,
            buildWebResearchAppendData,
            buildGeminiResearchRequest,
            buildCardMoveData,
            buildJinaReaderRequest,
            canUseWebResearch,
            classifyJinaResearchSource,
            describeGeminiApiError,
            describeGeminiResponseIssue,
            extractGeminiResponseText,
            extractUrls,
            getWebResearchCooldownRemaining,
            getWebResearchModelOptions,
            isInteractiveCardTarget,
            normalizeHttpUrl,
            parseGeminiResearchResult,
            parseJinaReaderResponse,
            readWebResearchCache,
            readWebResearchModelVerification,
            resolveSelectedTags,
            writeWebResearchModelVerification,
            writeWebResearchCache
        } from './web-research.mjs';

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
        let currentTags = [];
        let draftTags = [];
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
                            if (docSnap.exists()) {
                                const editorUrl = `${window.location.pathname}?editor=${encodeURIComponent(editorId)}&col=${encodeURIComponent(editorCol)}`;
                                history.replaceState({ overlay: null }, '', window.location.pathname);
                                history.pushState({ overlay: 'editor', itemId: editorId, collectionName: editorCol }, '', editorUrl);
                                openEditor(editorId, docSnap.data().text || '無標題', editorCol, { fromHistory: true });
                            } else {
                                history.replaceState({ overlay: null }, '', window.location.pathname);
                            }
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

            onSnapshot(doc(db, 'artifacts', appId, 'users', userId, 'settings', 'tags'), (snapshot) => {
                const tags = snapshot.exists() ? snapshot.data().items : [];
                currentTags = Array.isArray(tags)
                    ? tags.filter(tag => tag?.id && tag?.name).map(tag => ({ id: String(tag.id), name: String(tag.name) }))
                    : [];
            });

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

        function getWebResearchButtonHTML(item) {
            if (!canUseWebResearch(item?.text).ok) return '';
            return `
                <div class="flex justify-end mt-1" data-card-interactive>
                    <button type="button" class="web-research-btn inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 hover:border-indigo-300 text-xs font-bold transition-colors" title="AI 研讀這張卡片的網址">
                        <i class="fas fa-wand-magic-sparkles"></i>
                        <span>AI 研讀</span>
                    </button>
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
            li.querySelector('.web-research-btn')?.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                runCardWebResearch(item, collectionName, event.currentTarget);
            });
        }

        function escapeHtml(unsafe) { 
            if (!unsafe) return '';
            return String(unsafe).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); 
        }

        function getImageHTML(imageUrl) {
            const normalizedUrl = normalizeHttpUrl(imageUrl);
            if (!normalizedUrl) return '';
            const safeUrl = escapeHtml(normalizedUrl);
            return `<div class="mt-2 w-full"><a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="pointer-events-auto"><img src="${safeUrl}" class="w-full max-h-48 object-cover rounded-lg border border-slate-200 hover:opacity-90 transition-opacity pointer-events-auto"></a></div>`;
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
                const url = normalizeHttpUrl(urlMatch[0]);
                if (!url) return { previewHTML, textWithoutUrl };
                const escapedUrl = escapeHtml(url);
                const ytMatch = url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);
                if (ytMatch) {
                    previewHTML = `<a href="${escapedUrl}" target="_blank" rel="noopener noreferrer" class="block w-full mt-2 rounded-xl overflow-hidden border border-slate-200 hover:border-rose-300 transition-colors relative group/preview pointer-events-auto"><img src="https://img.youtube.com/vi/${escapeHtml(ytMatch[1])}/mqdefault.jpg" class="w-full h-auto object-cover aspect-video"><div class="absolute inset-0 bg-black/20 flex items-center justify-center opacity-80 group-hover/preview:opacity-100 transition-opacity"><i class="fab fa-youtube text-red-500 text-5xl drop-shadow-md bg-white rounded-full"></i></div></a>`;
                } else if (url.includes('github.com')) {
                    const repoParts = new URL(url).pathname.replace(/^\//, '').split('/');
                    const repoPath = repoParts.slice(0, 2).join('/');
                    previewHTML = `<a href="${escapedUrl}" target="_blank" rel="noopener noreferrer" class="flex items-center gap-3 p-3 w-full mt-2 rounded-xl border border-slate-200 hover:border-slate-400 hover:bg-slate-50 transition-colors text-slate-700 pointer-events-auto"><i class="fab fa-github text-2xl shrink-0"></i><div class="flex flex-col overflow-hidden w-full"><span class="text-xs text-slate-400">GitHub Repository</span><span class="text-sm font-bold truncate">${escapeHtml(repoPath || 'GitHub Link')}</span></div></a>`;
                } else {
                    previewHTML = `<a href="${escapedUrl}" target="_blank" rel="noopener noreferrer" class="flex items-center gap-3 p-3 w-full mt-2 rounded-xl border border-slate-200 hover:border-blue-300 hover:bg-blue-50 transition-colors text-slate-700 pointer-events-auto"><div class="w-8 h-8 rounded-full bg-blue-100 text-blue-500 flex items-center justify-center shrink-0"><i class="fas fa-link"></i></div><div class="flex flex-col overflow-hidden w-full"><span class="text-sm font-semibold truncate text-blue-600">${escapedUrl}</span><span class="text-xs text-slate-400 truncate">外部網站</span></div></a>`;
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
                    ${getWebResearchButtonHTML(item)}
                    <div class="absolute right-2 top-2 bg-white/95 backdrop-blur-md shadow-sm border border-slate-200/60 rounded-full pointer-events-auto p-0.5 md:opacity-0 md:group-hover:opacity-100 transition-all z-10">
                        ${getActionButtonsHTML()}
                    </div>`;
                attachItemListeners(li, item, collectionName);
                
                li.classList.add('cursor-pointer');
                li.addEventListener('click', (e) => {
                    if (justDropped) return; 
                    if (isInteractiveCardTarget(e.target)) return;
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
                    ${getWebResearchButtonHTML(item)}
                    <div class="absolute right-2 top-2 bg-white/95 backdrop-blur-md shadow-sm border border-slate-200/60 rounded-full pointer-events-auto p-0.5 md:opacity-0 md:group-hover:opacity-100 transition-all z-10">
                        ${getActionButtonsHTML()}
                    </div>`;
                
                const checkbox = li.querySelector('.todo-checkbox');
                
                li.addEventListener('click', async (e) => {
                    if (justDropped) return; 
                    if (e.target.tagName.toLowerCase() === 'img') return;
                    if (isInteractiveCardTarget(e.target)) return;
                    
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
                    ${getWebResearchButtonHTML(item)}
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

        window.openAddCardModal = function(colId, colName) {
            activeAddCardColId = colId;
            document.getElementById('add-card-modal-cat-name').textContent = colName;
            addCardInput.value = '';
            addCardModal.classList.remove('hidden');
            keyLayers.push({ name: 'add-card', keys: modalKeys(window.closeAddCardModal) });
            setTimeout(() => addCardInput.focus(), 100);
        };

        window.closeAddCardModal = function() {
            addCardModal.classList.add('hidden');
            keyLayers.pop('add-card');
            activeAddCardColId = null;
            addCardInput.value = '';
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
        const imageUploadInput = document.getElementById('image-upload-input');
        const imagePreviewContainer = document.getElementById('image-preview-container');
        const imagePreviewImg = document.getElementById('image-preview-img');
        const removeImageBtn = document.getElementById('remove-image-btn');
        const aiWebStatusEl = document.getElementById('ai-web-status');
        const aiSortStatusEl = document.getElementById('ai-sort-status');
        const webResearchPreviewModal = document.getElementById('web-research-preview-modal');
        const webResearchPreviewContent = document.getElementById('web-research-preview-content');
        const webResearchPreviewMediaNotice = document.getElementById('web-research-preview-media-notice');
        const webResearchPreviewTagsContainer = document.getElementById('web-research-preview-tags-container');
        const webResearchPreviewTags = document.getElementById('web-research-preview-tags');
        const appendWebResearchBtn = document.getElementById('append-web-research-btn');
        const AI_SORT_COOLDOWN_MS = 5 * 60 * 1000;
        let pendingWebResearch = null;

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
            try {
                localStorage.setItem(`aiStatus:${type}`, JSON.stringify({
                    status,
                    detail,
                    timestamp: Date.now()
                }));
            } catch (error) {
                console.warn('無法儲存 AI 狀態：', error);
            }
        }

        function readAiStatus(type) {
            try {
                const raw = localStorage.getItem(`aiStatus:${type}`);
                if (!raw) return null;
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

        function openWebResearchPreview(payload, { fromHistory = false } = {}) {
            pendingWebResearch = payload;
            const result = typeof payload.result === 'string'
                ? { note: payload.result, matchedTags: [], suggestedTags: [] }
                : payload.result;
            pendingWebResearch.result = result;
            webResearchPreviewContent.textContent = result.note;
            const mediaNotice = result.mediaNotice || '';
            webResearchPreviewMediaNotice.textContent = mediaNotice;
            webResearchPreviewMediaNotice.classList.toggle('hidden', !mediaNotice);
            const suggestions = [...(result.matchedTags || []), ...(result.suggestedTags || [])];
            webResearchPreviewTags.replaceChildren();
            suggestions.forEach(tag => {
                const label = document.createElement('label');
                label.className = 'inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-indigo-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:border-indigo-300';
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.checked = true;
                checkbox.value = tag.id;
                checkbox.className = 'h-4 w-4 accent-indigo-600';
                checkbox.setAttribute('data-web-research-tag', '');
                const text = document.createElement('span');
                text.textContent = tag.name;
                label.append(checkbox, text);
                if (tag.isNew) {
                    const badge = document.createElement('span');
                    badge.className = 'rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700';
                    badge.textContent = '新';
                    label.appendChild(badge);
                }
                webResearchPreviewTags.appendChild(label);
            });
            webResearchPreviewTagsContainer.classList.toggle('hidden', suggestions.length === 0);
            webResearchPreviewModal.classList.remove('hidden');
            keyLayers.push({
                name: 'web-research-preview',
                keys: modalKeys(closeWebResearchPreview)
            });
            if (!fromHistory) {
                history.pushState({ overlay: 'web-research-preview' }, '', window.location.href);
            }
        }

        function closeWebResearchPreview({ fromHistory = false } = {}) {
            if (!fromHistory && history.state?.overlay === 'web-research-preview') {
                history.back();
                return;
            }
            webResearchPreviewModal.classList.add('hidden');
            webResearchPreviewContent.textContent = '';
            webResearchPreviewMediaNotice.textContent = '';
            webResearchPreviewMediaNotice.classList.add('hidden');
            webResearchPreviewTags.replaceChildren();
            webResearchPreviewTagsContainer.classList.add('hidden');
            pendingWebResearch = null;
            keyLayers.pop('web-research-preview');
        }

        async function runCardWebResearch(item, collectionName, button) {
            const normalizedText = (item?.text || '').trim();
            const eligibility = canUseWebResearch(normalizedText);
            if (!eligibility.ok) {
                if (eligibility.reason === 'no_url') showToast('沒有偵測到網址，無法執行 AI 研讀。', 'fas fa-link');
                else if (eligibility.reason === 'multiple_urls') showToast('一次只支援研讀 1 個網址，請先精簡輸入。', 'fas fa-link');
                else if (eligibility.reason === 'too_long') showToast('這段內容太長，請先縮短後再執行 AI 研讀。', 'fas fa-align-left');
                return null;
            }

            let apiKey = null;
            let targetModel = DEFAULT_WEB_RESEARCH_MODEL;
            let jinaApiKey = '';
            let systemPrompt = DEFAULT_WEB_RESEARCH_SYSTEM_PROMPT;
            try {
                apiKey = localStorage.getItem('geminiApiKey');
                targetModel = localStorage.getItem('geminiWebResearchModel') || targetModel;
                jinaApiKey = localStorage.getItem('jinaApiKey') || '';
                systemPrompt = localStorage.getItem('webResearchSystemPrompt') || systemPrompt;
            } catch (error) {
                console.warn('無法讀取 AI 設定：', error);
            }
            if (!apiKey) {
                openSettingsModal();
                showToast('請先設定 Gemini API Key，才能使用 AI 研讀。', 'fas fa-key');
                return null;
            }

            const cacheContext = {
                model: targetModel,
                prompt: systemPrompt,
                tags: currentTags.map(tag => `${tag.id}:${tag.name}`)
            };
            const cached = readWebResearchCache(localStorage, normalizedText, Date.now(), cacheContext);
            if (cached) {
                saveAiStatus('web', '使用快取', '相同內容直接套用快取結果');
                updateAiStatusPanel();
                openWebResearchPreview({
                    itemId: item.id,
                    collectionName,
                    sourceText: normalizedText,
                    cardTagIds: Array.isArray(item.tagIds) ? item.tagIds : [],
                    result: cached
                });
                showToast('已載入先前的 AI 研讀結果供預覽。', 'fas fa-clock-rotate-left');
                return;
            }

            const cooldownRemaining = getWebResearchCooldownRemaining(localStorage);
            if (cooldownRemaining > 0) {
                saveAiStatus('web', '冷卻中', `剩餘 ${formatCooldown(cooldownRemaining)}`);
                updateAiStatusPanel();
                showToast(`AI 研讀冷卻中，請 ${formatCooldown(cooldownRemaining)} 後再試。`, 'fas fa-hourglass-half');
                return;
            }

            const restoreButton = setButtonLoading(button, '<div class="loader w-4 h-4 border-2 border-t-transparent mx-auto"></div>');

            try {
                try {
                    localStorage.setItem('lastWebPolishTime', Date.now().toString());
                } catch (storageError) {
                    console.warn('無法儲存 AI 研讀冷卻時間：', storageError);
                }
                showToast('正在用 Jina Reader 擷取原文，再交給 Gemini 整理...', 'fas fa-robot');
                const sourceUrl = extractUrls(normalizedText)[0];
                const userNote = normalizedText.replace(sourceUrl, '').trim();
                const source = await readUrlWithJina(sourceUrl, jinaApiKey);
                const media = classifyJinaResearchSource(source);
                const researchSource = {
                    ...source,
                    mediaStatus: media.status,
                    mediaNotice: media.notice
                };
                const polished = media.canSummarize
                    ? await polishJinaContentWithGemini({
                        source: researchSource,
                        userNote,
                        tags: currentTags,
                        apiKey,
                        model: targetModel,
                        systemPrompt
                    })
                    : {
                        note: `${media.notice}\n\n來源：${source.url || sourceUrl}`,
                        matchedTags: [],
                        suggestedTags: []
                    };
                polished.mediaNotice = media.notice;
                let cacheWritten = true;
                try {
                    writeWebResearchCache(localStorage, normalizedText, polished, Date.now(), cacheContext);
                } catch (storageError) {
                    cacheWritten = false;
                    console.warn('無法寫入 AI 研讀快取：', storageError);
                }
                saveAiStatus(
                    'web',
                    '成功',
                    cacheWritten ? '已完成網址研讀並寫入快取' : '已完成網址研讀（瀏覽器未允許寫入快取）'
                );
                updateAiStatusPanel();
                openWebResearchPreview({
                    itemId: item.id,
                    collectionName,
                    sourceText: normalizedText,
                    cardTagIds: Array.isArray(item.tagIds) ? item.tagIds : [],
                    result: polished
                });
                showToast('AI 研讀完成，請預覽後確認追加。', 'fas fa-wand-magic-sparkles');
            } catch (error) {
                const rawMessage = error?.message || '未知錯誤';
                const geminiError = error?.gemini;
                const jinaError = error?.jina;
                console.error('AI 網頁研讀潤飾失敗', geminiError ? {
                    model: geminiError.model,
                    status: geminiError.status,
                    quotaId: geminiError.quotaId,
                    retryDelay: geminiError.retryDelay
                } : { stage: jinaError ? 'jina' : 'unknown', message: rawMessage });
                if (jinaError) {
                    saveAiStatus('web', '來源擷取失敗', jinaError.detail);
                    showToast(`Jina Reader 擷取失敗：${jinaError.message}`, 'fas fa-file-circle-xmark');
                } else if (geminiError?.isQuota) {
                    saveAiStatus('web', '配額不足', geminiError.detail);
                    const retryText = geminiError.retryDelay ? `，約 ${geminiError.retryDelay} 後可重試` : '';
                    showToast(`網址研讀模型 ${geminiError.model} 配額不足${retryText}。`, 'fas fa-gauge-high');
                } else {
                    const detail = geminiError?.detail || `模型 ${targetModel}｜${rawMessage}`;
                    saveAiStatus('web', '失敗', detail);
                    showToast(`AI 網頁研讀失敗：${geminiError?.message || rawMessage}`, 'fas fa-exclamation-triangle');
                }
                updateAiStatusPanel();
            } finally {
                restoreButton();
            }
        }

        async function readUrlWithJina(sourceUrl, apiKey = '') {
            const request = buildJinaReaderRequest(sourceUrl, apiKey);
            const response = await fetch(request.url, request.options);
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                const message = String(payload?.message || payload?.data?.message || `HTTP ${response.status}`).slice(0, 300);
                const error = new Error(message);
                error.jina = {
                    status: response.status,
                    message,
                    detail: `Jina Reader｜HTTP ${response.status}｜${message}`
                };
                throw error;
            }
            try {
                return parseJinaReaderResponse(payload, sourceUrl);
            } catch (cause) {
                const error = new Error(cause.message);
                error.jina = { status: response.status, message: cause.message, detail: `Jina Reader｜HTTP ${response.status}｜${cause.message}` };
                throw error;
            }
        }

        async function appendPendingWebResearch() {
            if (!currentUser || !pendingWebResearch) return;
            const payload = pendingWebResearch;
            const restoreButton = setButtonLoading(
                appendWebResearchBtn,
                '<div class="loader w-4 h-4 border-2 border-t-transparent mx-auto"></div>',
                '追加到詳細筆記'
            );
            const noteRef = doc(
                db,
                'artifacts',
                appId,
                'users',
                currentUser.uid,
                payload.collectionName,
                payload.itemId,
                'details',
                'note'
            );
            const cardRef = doc(
                db,
                'artifacts',
                appId,
                'users',
                currentUser.uid,
                payload.collectionName,
                payload.itemId
            );
            const tagsRef = doc(db, 'artifacts', appId, 'users', currentUser.uid, 'settings', 'tags');
            const selectedSuggestionIds = [...webResearchPreviewTags.querySelectorAll('input[data-web-research-tag]:checked')]
                .map(input => input.value);
            const suggestions = [...(payload.result.matchedTags || []), ...(payload.result.suggestedTags || [])];

            try {
                await runTransaction(db, async transaction => {
                    const [noteSnapshot, cardSnapshot, tagsSnapshot] = await Promise.all([
                        transaction.get(noteRef),
                        transaction.get(cardRef),
                        transaction.get(tagsRef)
                    ]);
                    const existingData = noteSnapshot.exists() ? noteSnapshot.data().data : null;
                    const cardData = cardSnapshot.exists() ? cardSnapshot.data() : {};
                    const serverTags = tagsSnapshot.exists() && Array.isArray(tagsSnapshot.data().items)
                        ? tagsSnapshot.data().items
                        : currentTags;
                    const resolvedTags = resolveSelectedTags({
                        catalog: serverTags,
                        existingCardTagIds: Array.isArray(cardData.tagIds) ? cardData.tagIds : payload.cardTagIds,
                        suggestions,
                        selectedSuggestionIds
                    });
                    const now = Date.now();
                    transaction.set(noteRef, {
                        data: buildWebResearchAppendData(existingData, payload.result.note, now),
                        updatedAt: now
                    }, { merge: true });
                    transaction.set(cardRef, {
                        tagIds: resolvedTags.cardTagIds,
                        tagLabels: resolvedTags.cardTagLabels,
                        searchText: `${payload.sourceText}\n${payload.result.note}`.toLocaleLowerCase('zh-Hant'),
                        updatedAt: now
                    }, { merge: true });
                    transaction.set(tagsRef, { items: resolvedTags.catalog, updatedAt: now }, { merge: true });
                });
                closeWebResearchPreview();
                showToast('AI 研讀結果與勾選的 tag 已儲存。', 'fas fa-check-circle');
            } catch (error) {
                console.error('追加 AI 研讀結果失敗：', error);
                showToast(`追加失敗：${error?.message || '未知錯誤'}`, 'fas fa-exclamation-triangle');
            } finally {
                restoreButton();
            }
        }

        document.getElementById('cancel-web-research-preview-btn').addEventListener('click', closeWebResearchPreview);
        document.getElementById('close-web-research-preview-btn').addEventListener('click', closeWebResearchPreview);
        appendWebResearchBtn.addEventListener('click', appendPendingWebResearch);
        webResearchPreviewModal.addEventListener('click', event => {
            if (event.target === webResearchPreviewModal) closeWebResearchPreview();
        });

        ideaInput.addEventListener('input', function() {
            this.style.height = '40px';
            this.style.height = (this.scrollHeight) + 'px';
        });
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
                openSettingsModal();
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

        async function polishJinaContentWithGemini({ source, userNote, tags, apiKey, model, systemPrompt }) {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(buildGeminiResearchRequest({ source, userNote, tags, systemPrompt }))
            });
            
            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                const info = describeGeminiApiError(errData, response.status, model);
                const requestError = new Error(info.message);
                requestError.gemini = info;
                throw requestError;
            }
            
            const data = await response.json();
            if (data.error) {
                const info = describeGeminiApiError(data, data.error.code, model);
                const requestError = new Error(info.message);
                requestError.gemini = info;
                throw requestError;
            }
            
            const candidate = data.candidates?.[0];
            if (!candidate) {
                const info = describeGeminiResponseIssue(data, model);
                const responseError = new Error(info.message);
                responseError.gemini = info;
                throw responseError;
            }
            
            if (candidate.finishReason && candidate.finishReason !== 'STOP') {
                const info = describeGeminiResponseIssue(data, model);
                const responseError = new Error(`生成中斷，原因: ${candidate.finishReason}`);
                responseError.gemini = info;
                throw responseError;
            }
            
            const partText = extractGeminiResponseText(data);
            if (!partText) {
                const info = describeGeminiResponseIssue(data, model);
                const responseError = new Error(info.message);
                responseError.gemini = info;
                throw responseError;
            }
            
            return parseGeminiResearchResult(partText, tags, source);
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
                btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane text-xs"></i>'; ideaInput.focus();
            }
        });

        // ==========================================
        // ✨ 設定邏輯與 AI 分類
        // ==========================================
        let availableGeminiModels = [];
        let modelSettingsApiKey = '';

        function replaceSelectOptions(select, models, selectedValue, emptyLabel = '目前沒有可用模型') {
            select.innerHTML = '';
            if (!models.length) {
                const option = document.createElement('option');
                option.value = '';
                option.textContent = emptyLabel;
                select.appendChild(option);
                select.disabled = true;
                return;
            }
            select.disabled = false;
            models.forEach(model => {
                const option = document.createElement('option');
                option.value = model.id;
                option.textContent = model.label;
                select.appendChild(option);
            });
            if (selectedValue && models.some(model => model.id === selectedValue)) {
                select.value = selectedValue;
            }
        }

        function populateGeminiModelSettings(models, apiKey, preferredWebModel = null) {
            availableGeminiModels = Array.isArray(models) ? models : [];
            modelSettingsApiKey = apiKey;
            const generalModels = availableGeminiModels
                .filter(model => model.supportedGenerationMethods?.includes('generateContent'))
                .map(model => ({ id: model.name.replace(/^models\//, ''), label: model.displayName || model.name }));
            const verificationStatuses = Object.fromEntries(generalModels.map(model => [
                model.id,
                readWebResearchModelVerification(localStorage, apiKey, model.id)
            ]));
            const researchModels = getWebResearchModelOptions(availableGeminiModels, verificationStatuses);
            const currentGeneralModel = document.getElementById('model-select').value;
            const savedGeneralModel = currentGeneralModel
                || localStorage.getItem('geminiModel')
                || DEFAULT_WEB_RESEARCH_MODEL;
            const savedWebModel = preferredWebModel
                || document.getElementById('web-research-model-select').value
                || localStorage.getItem('geminiWebResearchModel')
                || DEFAULT_WEB_RESEARCH_MODEL;

            replaceSelectOptions(document.getElementById('model-select'), generalModels, savedGeneralModel);
            replaceSelectOptions(
                document.getElementById('web-research-model-select'),
                generalModels,
                savedWebModel,
                '目前沒有可用的生成模型'
            );
            replaceSelectOptions(
                document.getElementById('web-research-candidate-select'),
                researchModels.unknown,
                null,
                '沒有可測試的模型'
            );
            document.getElementById('verify-web-research-model-btn').disabled = researchModels.unknown.length === 0;
            document.getElementById('model-select-container').classList.remove('hidden');
            document.getElementById('web-research-model-select-container').classList.remove('hidden');
            return researchModels;
        }

        async function loadGeminiModels(key) {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${key}`);
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                const info = describeGeminiApiError(data, response.status, 'models.list');
                const error = new Error(info.message);
                error.gemini = info;
                throw error;
            }
            return Array.isArray(data.models) ? data.models : [];
        }

        async function probeWebResearchModel(apiKey, model) {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: '請使用 Google Search 查詢今天是星期幾，只回覆「SEARCH_OK」。' }] }],
                    tools: [{ google_search: {} }],
                    generationConfig: { maxOutputTokens: 16, temperature: 0 }
                })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || data.error) {
                const info = describeGeminiApiError(data, response.status, model);
                const error = new Error(info.message);
                error.gemini = info;
                throw error;
            }
            if (!data.candidates?.length) throw new Error('測試請求成功，但模型沒有回傳候選結果');
            return true;
        }

        function renderTagManager() {
            const container = document.getElementById('tag-manager-list');
            container.replaceChildren();
            if (!draftTags.length) {
                const empty = document.createElement('span');
                empty.className = 'text-xs text-slate-400';
                empty.textContent = '尚未建立 tag';
                container.appendChild(empty);
                return;
            }
            draftTags.forEach(tag => {
                const pill = document.createElement('span');
                pill.className = 'inline-flex min-h-10 items-center gap-1 rounded-full border border-slate-200 bg-white pl-3 pr-1 text-sm text-slate-700 focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-100';
                const name = document.createElement('input');
                name.type = 'text';
                name.maxLength = 40;
                name.value = tag.name;
                name.size = Math.max(2, Math.min(16, [...tag.name].length));
                name.className = 'min-w-8 max-w-40 bg-transparent outline-none';
                name.setAttribute('aria-label', `重新命名 tag ${tag.name}`);
                name.addEventListener('input', () => {
                    const nextName = name.value.replace(/\s+/g, ' ').slice(0, 40);
                    tag.name = nextName;
                    name.size = Math.max(2, Math.min(16, [...nextName].length));
                });
                name.addEventListener('blur', () => {
                    tag.name = tag.name.trim() || '未命名';
                    name.value = tag.name;
                });
                const remove = document.createElement('button');
                remove.type = 'button';
                remove.className = 'flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-rose-50 hover:text-rose-600 focus:outline-none focus:ring-2 focus:ring-rose-200';
                remove.setAttribute('aria-label', `刪除 tag ${tag.name}`);
                remove.innerHTML = '<i class="fas fa-times text-xs"></i>';
                remove.addEventListener('click', () => {
                    draftTags = draftTags.filter(item => item.id !== tag.id);
                    renderTagManager();
                });
                pill.append(name, remove);
                container.appendChild(pill);
            });
        }

        function addDraftTag() {
            const input = document.getElementById('new-tag-input');
            const name = input.value.trim().replace(/\s+/g, ' ').slice(0, 40);
            if (!name) return;
            const resolved = resolveSelectedTags({
                catalog: draftTags,
                suggestions: [{ id: `new:${name}`, name, isNew: true }],
                selectedSuggestionIds: [`new:${name}`]
            });
            if (resolved.catalog.length === draftTags.length) {
                showToast('這個 tag 已經存在。', 'fas fa-tag');
                return;
            }
            draftTags = resolved.catalog;
            input.value = '';
            renderTagManager();
        }

        function closeSettingsModal() {
            document.getElementById('settings-modal').classList.add('hidden');
            keyLayers.pop('settings');
        }

        function openSettingsModal() {
            document.getElementById('api-key-input').value = localStorage.getItem('geminiApiKey') || '';
            document.getElementById('jina-api-key-input').value = localStorage.getItem('jinaApiKey') || '';
            document.getElementById('imgbb-key-input').value = localStorage.getItem('imgbbApiKey') || '';
            document.getElementById('web-research-system-prompt').value = localStorage.getItem('webResearchSystemPrompt') || DEFAULT_WEB_RESEARCH_SYSTEM_PROMPT;
            document.getElementById('auto-sort-select').value = localStorage.getItem('autoSortSetting') || 'off';
            document.getElementById('auto-newline-toggle').checked = localStorage.getItem('autoNewlineAfterUrl') !== 'off';
            draftTags = currentTags.map(tag => ({ ...tag }));
            renderTagManager();
            updateAiStatusPanel();
            document.getElementById('settings-modal').classList.remove('hidden');
            keyLayers.push({ name: 'settings', keys: modalKeys(closeSettingsModal) });
        }

        document.getElementById('settings-btn').addEventListener('click', () => {
            closeSidebar();
            openSettingsModal();
        });
        document.getElementById('add-tag-btn').addEventListener('click', addDraftTag);
        document.getElementById('new-tag-input').addEventListener('keydown', event => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            addDraftTag();
        });
        document.getElementById('reset-web-research-prompt-btn').addEventListener('click', () => {
            document.getElementById('web-research-system-prompt').value = DEFAULT_WEB_RESEARCH_SYSTEM_PROMPT;
        });
        document.getElementById('settings-modal').addEventListener('click', (e) => {
            const settingsModal = document.getElementById('settings-modal');
            if (e.target === settingsModal) {
                closeSettingsModal();
            }
        });
        document.getElementById('close-modal-btn').addEventListener('click', () => closeSettingsModal());

        document.getElementById('api-key-input').addEventListener('input', (event) => {
            if (!modelSettingsApiKey || event.target.value.trim() === modelSettingsApiKey) return;
            modelSettingsApiKey = '';
            availableGeminiModels = [];
            document.getElementById('model-select-container').classList.add('hidden');
            document.getElementById('web-research-model-select-container').classList.add('hidden');
            document.getElementById('web-research-model-verification-status').textContent = 'API Key 已變更，請重新查詢這把 Key 的可用模型。';
        });
        
        document.getElementById('verify-key-btn').addEventListener('click', async () => {
            const key = document.getElementById('api-key-input').value.trim(); if(!key) return;
            const btn = document.getElementById('verify-key-btn'); btn.disabled = true; btn.innerHTML = '<div class="loader w-4 h-4 border-2 border-t-indigo-700 mx-auto"></div>';
            try {
                const models = await loadGeminiModels(key);
                if (document.getElementById('api-key-input').value.trim() !== key) {
                    document.getElementById('web-research-model-verification-status').textContent = 'API Key 已變更，已丟棄舊 Key 的模型查詢結果。';
                    return;
                }
                populateGeminiModelSettings(models, key);
                document.getElementById('web-research-model-verification-status').textContent = `已即時取得 ${models.length} 個 Gemini 模型。`;
            } catch(error) {
                if (document.getElementById('api-key-input').value.trim() !== key) {
                    document.getElementById('web-research-model-verification-status').textContent = 'API Key 已變更，已丟棄舊 Key 的模型查詢錯誤。';
                    return;
                }
                const detail = error?.gemini?.detail || error?.message || '無法取得模型清單';
                document.getElementById('web-research-model-verification-status').textContent = detail;
                showToast(`查詢模型失敗：${error?.gemini?.message || error?.message}`, 'fas fa-exclamation-triangle');
            } finally { btn.disabled = false; btn.innerText = '重新查詢可用模型'; }
        });

        document.getElementById('verify-web-research-model-btn').addEventListener('click', async () => {
            const apiKey = document.getElementById('api-key-input').value.trim();
            const model = document.getElementById('web-research-candidate-select').value;
            if (!apiKey || !model) return;
            const button = document.getElementById('verify-web-research-model-btn');
            const status = document.getElementById('web-research-model-verification-status');
            button.disabled = true;
            button.textContent = '測試中…';
            status.textContent = `正在用 ${model} 送出一次最小 Search 測試…`;
            try {
                await probeWebResearchModel(apiKey, model);
                if (document.getElementById('api-key-input').value.trim() !== apiKey
                    || document.getElementById('web-research-candidate-select').value !== model) {
                    status.textContent = 'API Key 或待測模型已變更，已丟棄這次測試結果。';
                    return;
                }
                writeWebResearchModelVerification(localStorage, apiKey, model, 'supported');
                populateGeminiModelSettings(availableGeminiModels, apiKey, model);
                status.textContent = `${model} 已確認支援 Search；結果會保留 7 天。`;
            } catch (error) {
                if (document.getElementById('api-key-input').value.trim() !== apiKey
                    || document.getElementById('web-research-candidate-select').value !== model) {
                    status.textContent = 'API Key 或待測模型已變更，已丟棄這次測試結果。';
                    return;
                }
                const info = error?.gemini;
                const unsupported = info?.status === 400
                    && /(?:google[_ ]search|google search).{0,120}(?:not supported|unsupported|not available|does not support|不支援)|(?:not supported|unsupported|not available|不支援).{0,120}(?:google[_ ]search|google search)/i.test(info.message);
                if (unsupported) {
                    writeWebResearchModelVerification(localStorage, apiKey, model, 'unsupported');
                    populateGeminiModelSettings(availableGeminiModels, apiKey);
                    status.textContent = `${model} 明確回覆不支援 Search。`;
                } else {
                    status.textContent = info?.isQuota
                        ? `${model} 暫時無法驗證：${info.detail}。這不代表模型不支援，可稍後重試。`
                        : `${model} 暫時無法驗證：${info?.detail || error.message}。`;
                }
            } finally {
                button.disabled = document.getElementById('web-research-candidate-select').disabled;
                button.textContent = '測試 Search';
            }
        });

        document.getElementById('save-settings-btn').addEventListener('click', async () => {
            const geminiKey = document.getElementById('api-key-input').value.trim();
            const jinaKey = document.getElementById('jina-api-key-input').value.trim();
            const imgbbKey = document.getElementById('imgbb-key-input').value.trim();
            const cleanedTags = draftTags
                .map(tag => ({ id: String(tag.id), name: String(tag.name || '').trim().replace(/\s+/g, ' ').slice(0, 40) }))
                .filter(tag => tag.id && tag.name);
            const normalizedTagNames = cleanedTags.map(tag => tag.name.toLocaleLowerCase('zh-Hant'));
            if (new Set(normalizedTagNames).size !== normalizedTagNames.length) {
                showToast('Tag 名稱不可重複，請先調整後再儲存。', 'fas fa-tags');
                return;
            }
            draftTags = cleanedTags;
            if(geminiKey) {
                const storedGeminiKey = localStorage.getItem('geminiApiKey') || '';
                if (geminiKey !== storedGeminiKey && modelSettingsApiKey !== geminiKey) {
                    showToast('API Key 已變更，請先查詢這把 Key 的可用模型。', 'fas fa-key');
                    return;
                }
                localStorage.setItem('geminiApiKey', geminiKey);
                if (modelSettingsApiKey === geminiKey) {
                    if (document.getElementById('model-select').value) localStorage.setItem('geminiModel', document.getElementById('model-select').value);
                    if (document.getElementById('web-research-model-select').value) localStorage.setItem('geminiWebResearchModel', document.getElementById('web-research-model-select').value);
                }
            }
            if (jinaKey) localStorage.setItem('jinaApiKey', jinaKey);
            else localStorage.removeItem('jinaApiKey');
            if(imgbbKey) { localStorage.setItem('imgbbApiKey', imgbbKey); }
            const systemPrompt = document.getElementById('web-research-system-prompt').value.trim() || DEFAULT_WEB_RESEARCH_SYSTEM_PROMPT;
            localStorage.setItem('webResearchSystemPrompt', systemPrompt);
            localStorage.setItem('autoSortSetting', document.getElementById('auto-sort-select').value);
            localStorage.setItem('autoNewlineAfterUrl', document.getElementById('auto-newline-toggle').checked ? 'on' : 'off');
            try {
                if (currentUser) {
                    await setDoc(
                        doc(db, 'artifacts', appId, 'users', currentUser.uid, 'settings', 'tags'),
                        { items: draftTags, updatedAt: Date.now() },
                        { merge: true }
                    );
                }
                currentTags = draftTags.map(tag => ({ ...tag }));
                closeSettingsModal();
            } catch (error) {
                console.error('儲存 tag 設定失敗：', error);
                showToast('Tag 設定儲存失敗，請稍後重試。', 'fas fa-exclamation-triangle');
            }
        });

        async function runAiSort() {
            if (isSorting || currentInboxItems.length === 0 || !currentUser) return false;
            const apiKey = localStorage.getItem('geminiApiKey'); const targetModel = localStorage.getItem('geminiModel') || 'gemini-2.5-flash';
            if (!apiKey) { openSettingsModal(); return false; }
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
                    
                    const docData = buildCardMoveData(item);
                    
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
                                const docData = buildCardMoveData(m.data);
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
        let mdShortcutsCleanup = null;
        let pendingEditorTitle = null;

        async function openEditor(itemId, itemText, collectionName, { fromHistory = false } = {}) {
            const loadId = ++currentEditorLoadId;
            const modal = document.getElementById('editor-modal');
            const backdrop = document.getElementById('editor-backdrop');
            const container = document.getElementById('editor-container');
            const titleInput = document.getElementById('editor-title');
            
            // Force save if pending
            if (editorSaveTimeout) {
                await flushPendingEditorChanges();
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
            if (!fromHistory) {
                const editorUrl = `${window.location.pathname}?editor=${encodeURIComponent(itemId)}&col=${encodeURIComponent(collectionName)}`;
                history.pushState({ overlay: 'editor', itemId, collectionName }, '', editorUrl);
            }
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

        async function savePendingEditorTitle() {
            if (!activeEditorCardId || !activeEditorCollection || !pendingEditorTitle) return;
            const cardId = activeEditorCardId;
            const collectionName = activeEditorCollection;
            const title = pendingEditorTitle;
            pendingEditorTitle = null;

            try {
                const cardRef = doc(db, 'artifacts', appId, 'users', currentUser.uid, collectionName, cardId);
                await updateDoc(cardRef, { text: title });
            } catch (error) {
                console.error('Failed to update title:', error);
                showSaveStatus('標題儲存失敗', 'fas fa-exclamation-circle text-red-500');
            }
        }

        async function flushPendingEditorChanges() {
            if (editorSaveTimeout) {
                clearTimeout(editorSaveTimeout);
                editorSaveTimeout = null;
            }
            await Promise.all([
                savePendingEditorTitle(),
                saveEditorContent()
            ]);
        }

        function handleEditorChange() {
            clearTimeout(editorSaveTimeout);
            editorSaveTimeout = setTimeout(flushPendingEditorChanges, 1000);
        }

        function initEditor(initialData = null, onChangeCallback = null) {
            if (mdShortcutsCleanup) { mdShortcutsCleanup(); mdShortcutsCleanup = null; }
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
                    // debounceTimer 預設 200ms:每次觸發都會全文序列化以記錄復原點,打字時吃主執行緒。
                    // 拉長到 500ms 減少序列化頻率(復原顆粒度稍粗,換取打字順暢)。
                    new Undo({ editor: editorInstance, config: { debounceTimer: 500 } });
                },
                tools: {
                    header: { class: Header, inlineToolbar: true, config: { placeholder: '輸入標題', levels: [1, 2, 3], defaultLevel: 2 } },
                    list: { class: EditorjsList, inlineToolbar: true },
                    checklist: { class: Checklist, inlineToolbar: true },
                    quote: { class: Quote, inlineToolbar: true },
                    Marker: { class: Marker, inlineToolbar: true },
                    inlineCode: { class: InlineCode },
                    code: { class: CodeTool, config: { placeholder: '輸入程式碼' } },
                    delimiter: { class: Delimiter }
                },
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
            };
            
            if (initialData && initialData.blocks && initialData.blocks.length > 0) {
                config.data = initialData;
            }
            
            editorInstance = new EditorJS(config);
            mdShortcutsCleanup = attachMdShortcuts(() => editorInstance, document.getElementById('editorjs-container'));
        }

        function closeEditor({ fromHistory = false } = {}) {
            if (!fromHistory && history.state?.overlay === 'editor') {
                history.back();
                return;
            }
            currentEditorLoadId += 1;
            void flushPendingEditorChanges();
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
            
            if (mdShortcutsCleanup) { mdShortcutsCleanup(); mdShortcutsCleanup = null; }
            if (editorInstance) {
                editorInstance.destroy();
                editorInstance = null;
            }
        }

        document.getElementById('editor-close-btn').addEventListener('click', () => closeEditor());
        document.getElementById('editor-backdrop').addEventListener('click', () => closeEditor());

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

        window.addEventListener('popstate', async (event) => {
            const targetOverlay = event.state?.overlay || null;

            if (!webResearchPreviewModal.classList.contains('hidden') && targetOverlay !== 'web-research-preview') {
                closeWebResearchPreview({ fromHistory: true });
                return;
            }
            if (activeEditorCardId && targetOverlay !== 'editor') {
                closeEditor({ fromHistory: true });
                return;
            }

            if (targetOverlay === 'editor' && !activeEditorCardId && currentUser) {
                const itemId = event.state?.itemId;
                const collectionName = event.state?.collectionName;
                if (!itemId || !collectionName) {
                    history.replaceState({ overlay: null }, '', window.location.pathname);
                    return;
                }
                try {
                    const cardSnapshot = await getDoc(doc(
                        db,
                        'artifacts',
                        appId,
                        'users',
                        currentUser.uid,
                        collectionName,
                        itemId
                    ));
                    if (history.state?.overlay !== 'editor') return;
                    if (cardSnapshot.exists()) {
                        openEditor(
                            itemId,
                            cardSnapshot.data().text || '無標題',
                            collectionName,
                            { fromHistory: true }
                        );
                    } else {
                        history.replaceState({ overlay: null }, '', window.location.pathname);
                    }
                } catch (error) {
                    console.error('無法從瀏覽紀錄重新開啟卡片：', error);
                    history.replaceState({ overlay: null }, '', window.location.pathname);
                }
                return;
            }

            if (targetOverlay === 'web-research-preview' && webResearchPreviewModal.classList.contains('hidden')) {
                // Preview content is intentionally ephemeral; discard unusable Forward state.
                history.replaceState({ overlay: null }, '', window.location.pathname);
            }
        });
        document.getElementById('editor-title').addEventListener('input', (e) => {
            clearTimeout(editorSaveTimeout);
            const newTitle = e.target.innerText.trim();
            pendingEditorTitle = newTitle || null;
            if (!newTitle) return; // Prevent empty title
            editorSaveTimeout = setTimeout(flushPendingEditorChanges, 1000);
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
            const iconElement = document.createElement('i');
            iconElement.className = String(icon);
            const messageElement = document.createElement('span');
            messageElement.textContent = String(message);
            toast.append(iconElement, messageElement);
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
