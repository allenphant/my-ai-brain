import {
    openLocalDb,
    ensureDefaultCategories,
    getAllCategories,
    saveCategory,
    deleteCategory,
    getCardsByCollection,
    getAllCards,
    addCard,
    updateCard,
    deleteCard,
    moveCard,
    getNote,
    saveNote,
    deleteNote,
    getTags,
    saveTags,
    getMigrationStatus,
    setMigrationStatus,
    exportAllLocalData
} from './local-db.mjs';

export class StorageController {
    constructor(mode = 'local') {
        this.mode = mode;
        this.listeners = new Map();
    }

    getMode() {
        return this.mode;
    }

    setMode(mode) {
        this.mode = mode;
    }

    subscribe(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event).add(callback);

        return () => {
            const set = this.listeners.get(event);
            if (set) {
                set.delete(callback);
            }
        };
    }

    emit(event, payload = {}) {
        const callbacks = this.listeners.get(event);
        if (callbacks) {
            callbacks.forEach((cb) => {
                try {
                    cb(payload);
                } catch (err) {
                    console.error(`Error in storage listener for ${event}:`, err);
                }
            });
        }
    }

    async ensureCategories() {
        if (this.mode === 'local') {
            return ensureDefaultCategories();
        }
        return [];
    }

    async getCategories() {
        if (this.mode === 'local') {
            return getAllCategories();
        }
        return [];
    }

    async saveCategory(category) {
        if (this.mode === 'local') {
            const res = await saveCategory(category);
            this.emit('categories_changed', { action: 'save', category: res });
            return res;
        }
        return null;
    }

    async deleteCategory(id) {
        if (this.mode === 'local') {
            await deleteCategory(id);
            this.emit('categories_changed', { action: 'delete', id });
        }
    }

    async getCards(collectionName) {
        if (this.mode === 'local') {
            return getCardsByCollection(collectionName);
        }
        return [];
    }

    async addCard(collectionName, cardData) {
        if (this.mode === 'local') {
            const res = await addCard(collectionName, cardData);
            this.emit('cards_changed', { action: 'add', collection: collectionName, card: res });
            return res;
        }
        return null;
    }

    async updateCard(collectionName, cardId, cardData) {
        if (this.mode === 'local') {
            const res = await updateCard(collectionName, cardId, cardData);
            this.emit('cards_changed', { action: 'update', collection: collectionName, cardId, card: res });
            return res;
        }
        return null;
    }

    async deleteCard(collectionName, cardId) {
        if (this.mode === 'local') {
            await deleteCard(collectionName, cardId);
            this.emit('cards_changed', { action: 'delete', collection: collectionName, cardId });
        }
    }

    async moveCard(fromCol, toCol, cardId, cardData) {
        if (this.mode === 'local') {
            const res = await moveCard(fromCol, toCol, cardId, cardData);
            this.emit('cards_changed', { action: 'move', fromCol, toCol, cardId, card: res });
            return res;
        }
        return null;
    }

    async getNote(cardId) {
        if (this.mode === 'local') {
            return getNote(cardId);
        }
        return null;
    }

    async saveNote(cardId, noteData) {
        if (this.mode === 'local') {
            const res = await saveNote(cardId, noteData);
            this.emit('notes_changed', { action: 'save', cardId, note: res });
            return res;
        }
        return null;
    }

    async deleteNote(cardId) {
        if (this.mode === 'local') {
            await deleteNote(cardId);
            this.emit('notes_changed', { action: 'delete', cardId });
        }
    }

    async getTags() {
        if (this.mode === 'local') {
            return getTags();
        }
        return [];
    }

    async saveTags(tags) {
        if (this.mode === 'local') {
            await saveTags(tags);
            this.emit('tags_changed', { tags });
        }
    }

    async needsCloudMigration() {
        const migrationStatus = await getMigrationStatus();
        if (migrationStatus && migrationStatus.hasMigratedToCloud) {
            return { needed: false, cardCount: 0, categoryCount: 0 };
        }

        const cards = await getAllCards();
        const categories = await getAllCategories();

        if (cards.length > 0) {
            return {
                needed: true,
                cardCount: cards.length,
                categoryCount: categories.length
            };
        }

        return { needed: false, cardCount: 0, categoryCount: 0 };
    }

    async migrateLocalToCloud(firestoreContext, progressCallback = () => {}) {
        const { db, appId, userId, setDoc, doc } = firestoreContext;
        if (!db || !appId || !userId || !setDoc || !doc) {
            throw new Error('Invalid firestoreContext provided for migration');
        }

        const localData = await exportAllLocalData();
        const { categories, cards, tags, notes } = localData;

        const totalItems = 1 + categories.length + cards.length + Object.keys(notes).length;
        let processed = 0;

        const report = (stage) => {
            processed++;
            const percentage = Math.min(100, Math.round((processed / totalItems) * 100));
            progressCallback({ stage, processed, totalItems, percentage });
        };

        // 1. Tags
        if (tags && tags.length > 0) {
            const tagsRef = doc(db, 'artifacts', appId, 'users', userId, 'settings', 'tags');
            await setDoc(tagsRef, { items: tags });
        }
        report('tags');

        // 2. Categories
        for (const cat of categories) {
            const catRef = doc(db, 'artifacts', appId, 'users', userId, 'categories', cat.id);
            await setDoc(catRef, {
                name: cat.name,
                icon: cat.icon,
                type: cat.type,
                promptRule: cat.promptRule || '',
                order: cat.order ?? 1000
            });
            report(`category:${cat.id}`);
        }

        // 3. Cards
        for (const card of cards) {
            const targetCol = card.collection || 'inbox';
            const cardRef = doc(db, 'artifacts', appId, 'users', userId, targetCol, card.id);
            const { id, collection: _c, ...cardPayload } = card;
            await setDoc(cardRef, cardPayload);
            report(`card:${card.id}`);

            // Note if present
            if (notes[card.id]) {
                const noteRef = doc(db, 'artifacts', appId, 'users', userId, targetCol, card.id, 'details', 'note');
                await setDoc(noteRef, notes[card.id]);
                report(`note:${card.id}`);
            }
        }

        await setMigrationStatus({
            hasMigratedToCloud: true,
            migratedAt: Date.now(),
            count: cards.length
        });

        progressCallback({ stage: 'completed', processed: totalItems, totalItems, percentage: 100 });
        return { success: true, count: cards.length };
    }
}
