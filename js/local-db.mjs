const DB_NAME = 'MyAiBrainLocalDB';
const DB_VERSION = 1;

const DEFAULT_CATEGORIES = [
    {
        id: 'todos',
        name: '待辦事項',
        icon: 'fas fa-check-square',
        type: 'todo',
        promptRule: '只要是需要執行、完成的任務、計畫、待辦事項就放這裡',
        order: 1000
    },
    {
        id: 'learning',
        name: '學習筆記',
        icon: 'fas fa-book',
        type: 'text',
        promptRule: '學習過程的筆記、知識點、重點整理',
        order: 2000
    },
    {
        id: 'ideas',
        name: '靈感與想法',
        icon: 'fas fa-lightbulb',
        type: 'text',
        promptRule: '突然想到的點子、創意、隨筆',
        order: 3000
    },
    {
        id: 'bookmarks',
        name: '稍後閱讀',
        icon: 'fas fa-bookmark',
        type: 'bookmark',
        promptRule: '只要是網址或想稍後看的文章就放這裡',
        order: 4000
    }
];

let dbInstance = null;

export function openLocalDb() {
    if (dbInstance) return Promise.resolve(dbInstance);

    return new Promise((resolve, reject) => {
        const idb = typeof indexedDB !== 'undefined' ? indexedDB : (globalThis && globalThis.indexedDB);
        if (!idb) {
            return reject(new Error('IndexedDB is not available in current environment'));
        }

        const request = idb.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;

            if (!db.objectStoreNames.contains('categories')) {
                db.createObjectStore('categories', { keyPath: 'id' });
            }

            if (!db.objectStoreNames.contains('cards')) {
                const cardStore = db.createObjectStore('cards', { keyPath: 'id' });
                cardStore.createIndex('by_collection', 'collection', { unique: false });
                cardStore.createIndex('by_collection_order', ['collection', 'order'], { unique: false });
            }

            if (!db.objectStoreNames.contains('notes')) {
                db.createObjectStore('notes', { keyPath: 'id' });
            }

            if (!db.objectStoreNames.contains('metadata')) {
                db.createObjectStore('metadata', { keyPath: 'key' });
            }
        };

        request.onsuccess = (event) => {
            dbInstance = event.target.result;
            resolve(dbInstance);
        };

        request.onerror = (event) => {
            reject(event.target.error || new Error('Failed to open IndexedDB'));
        };
    });
}

function runTx(storeName, mode, callback) {
    return openLocalDb().then((db) => {
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, mode);
            const store = tx.objectStore(storeName);
            let result;

            tx.oncomplete = () => resolve(result);
            tx.onerror = () => reject(tx.error || new Error(`Transaction error on ${storeName}`));
            tx.onabort = () => reject(tx.error || new Error(`Transaction aborted on ${storeName}`));

            try {
                result = callback(store);
            } catch (err) {
                reject(err);
            }
        });
    });
}

export async function ensureDefaultCategories() {
    const existing = await getAllCategories();
    if (existing.length > 0) return existing;

    for (const cat of DEFAULT_CATEGORIES) {
        await saveCategory({ ...cat, createdAt: Date.now() });
    }
    return getAllCategories();
}

export function getAllCategories() {
    return runTx('categories', 'readonly', (store) => {
        return new Promise((resolve, reject) => {
            const req = store.getAll();
            req.onsuccess = () => {
                const list = req.result || [];
                list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
                resolve(list);
            };
            req.onerror = () => reject(req.error);
        });
    });
}

export function saveCategory(category) {
    if (!category || !category.id) {
        return Promise.reject(new Error('Category must have an id'));
    }
    const catData = {
        ...category,
        updatedAt: Date.now()
    };
    return runTx('categories', 'readwrite', (store) => {
        store.put(catData);
        return catData;
    });
}

export function deleteCategory(id) {
    return runTx('categories', 'readwrite', (store) => {
        store.delete(id);
    });
}

export function getAllCards() {
    return runTx('cards', 'readonly', (store) => {
        return new Promise((resolve, reject) => {
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    });
}

export function getCardsByCollection(collectionName) {
    return runTx('cards', 'readonly', (store) => {
        return new Promise((resolve, reject) => {
            const index = store.index('by_collection');
            const req = index.getAll(collectionName);
            req.onsuccess = () => {
                const list = req.result || [];
                list.sort((a, b) => (b.order ?? 0) - (a.order ?? 0));
                resolve(list);
            };
            req.onerror = () => reject(req.error);
        });
    });
}

export function addCard(collectionName, cardData = {}) {
    const id = cardData.id || `local_card_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const now = Date.now();
    const docData = {
        title: '',
        tags: [],
        completed: false,
        order: now,
        ...cardData,
        id,
        collection: collectionName,
        createdAt: cardData.createdAt || now,
        updatedAt: now
    };

    return runTx('cards', 'readwrite', (store) => {
        store.put(docData);
        return docData;
    });
}

export function updateCard(collectionName, cardId, cardData = {}) {
    return runTx('cards', 'readwrite', (store) => {
        return new Promise((resolve, reject) => {
            const getReq = store.get(cardId);
            getReq.onsuccess = () => {
                const existing = getReq.result;
                if (!existing) {
                    return reject(new Error(`Card ${cardId} not found in local db`));
                }
                const updated = {
                    ...existing,
                    ...cardData,
                    id: cardId,
                    collection: collectionName || existing.collection,
                    updatedAt: Date.now()
                };
                const putReq = store.put(updated);
                putReq.onsuccess = () => resolve(updated);
                putReq.onerror = () => reject(putReq.error);
            };
            getReq.onerror = () => reject(getReq.error);
        });
    });
}

export function deleteCard(collectionName, cardId) {
    return runTx('cards', 'readwrite', (store) => {
        store.delete(cardId);
    });
}

export function moveCard(fromCol, toCol, cardId, cardData = {}) {
    return runTx('cards', 'readwrite', (store) => {
        return new Promise((resolve, reject) => {
            const getReq = store.get(cardId);
            getReq.onsuccess = () => {
                const existing = getReq.result || {};
                const moved = {
                    ...existing,
                    ...cardData,
                    id: cardId,
                    collection: toCol,
                    updatedAt: Date.now()
                };
                const putReq = store.put(moved);
                putReq.onsuccess = () => resolve(moved);
                putReq.onerror = () => reject(putReq.error);
            };
            getReq.onerror = () => reject(getReq.error);
        });
    });
}

export function getNote(cardId) {
    return runTx('notes', 'readonly', (store) => {
        return new Promise((resolve, reject) => {
            const req = store.get(cardId);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });
    });
}

export function saveNote(cardId, noteData = {}) {
    const payload = {
        id: cardId,
        blocks: noteData.blocks || [],
        time: noteData.time || Date.now(),
        version: noteData.version || '2.30.0',
        updatedAt: Date.now()
    };
    return runTx('notes', 'readwrite', (store) => {
        store.put(payload);
        return payload;
    });
}

export function deleteNote(cardId) {
    return runTx('notes', 'readwrite', (store) => {
        store.delete(cardId);
    });
}

export function getTags() {
    return runTx('metadata', 'readonly', (store) => {
        return new Promise((resolve, reject) => {
            const req = store.get('tags');
            req.onsuccess = () => resolve((req.result && req.result.items) || []);
            req.onerror = () => reject(req.error);
        });
    });
}

export function saveTags(tags = []) {
    return runTx('metadata', 'readwrite', (store) => {
        store.put({ key: 'tags', items: tags, updatedAt: Date.now() });
    });
}

export function getMigrationStatus() {
    return runTx('metadata', 'readonly', (store) => {
        return new Promise((resolve, reject) => {
            const req = store.get('migration_status');
            req.onsuccess = () => {
                resolve((req.result && req.result.value) || { hasMigratedToCloud: false });
            };
            req.onerror = () => reject(req.error);
        });
    });
}

export function setMigrationStatus(status = {}) {
    return runTx('metadata', 'readwrite', (store) => {
        store.put({ key: 'migration_status', value: status, updatedAt: Date.now() });
    });
}

export async function exportAllLocalData() {
    const categories = await getAllCategories();
    const cards = await getAllCards();
    const tags = await getTags();
    const migrationStatus = await getMigrationStatus();

    const notes = {};
    for (const card of cards) {
        const note = await getNote(card.id);
        if (note) {
            notes[card.id] = note;
        }
    }

    return {
        categories,
        cards,
        tags,
        notes,
        migrationStatus
    };
}

export async function clearAllLocalData() {
    await openLocalDb();
    const stores = ['categories', 'cards', 'notes', 'metadata'];
    for (const s of stores) {
        await runTx(s, 'readwrite', (store) => {
            store.clear();
        });
    }
}
