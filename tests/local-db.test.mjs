import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {
    openLocalDb,
    ensureDefaultCategories,
    getAllCategories,
    saveCategory,
    deleteCategory,
    addCard,
    getCardsByCollection,
    getAllCards,
    updateCard,
    deleteCard,
    moveCard,
    saveNote,
    getNote,
    deleteNote,
    getTags,
    saveTags,
    getMigrationStatus,
    setMigrationStatus,
    exportAllLocalData,
    clearAllLocalData
} from '../js/local-db.mjs';

test('LocalDB: lifecycle and CRUD operations', async () => {
    await clearAllLocalData();

    // 1. Categories
    const defaultCats = await ensureDefaultCategories();
    assert.equal(defaultCats.length, 4);
    assert.equal(defaultCats[0].id, 'todos');
    assert.equal(defaultCats[1].id, 'learning');
    assert.equal(defaultCats[2].id, 'ideas');
    assert.equal(defaultCats[3].id, 'bookmarks');

    await saveCategory({ id: 'custom-cat', name: '自訂專案', order: 5000, type: 'text', promptRule: '自訂規則' });
    const allCats = await getAllCategories();
    assert.equal(allCats.length, 5);
    const custom = allCats.find(c => c.id === 'custom-cat');
    assert.equal(custom.name, '自訂專案');

    await deleteCategory('custom-cat');
    const catsAfterDelete = await getAllCategories();
    assert.equal(catsAfterDelete.length, 4);

    // 2. Cards
    const newCard = await addCard('inbox', {
        title: '測試靈感卡片',
        url: 'https://example.com',
        tags: ['tech']
    });
    assert.ok(newCard.id);
    assert.equal(newCard.collection, 'inbox');
    assert.equal(newCard.title, '測試靈感卡片');

    const inboxCards = await getCardsByCollection('inbox');
    assert.equal(inboxCards.length, 1);
    assert.equal(inboxCards[0].title, '測試靈感卡片');

    // 3. Update Card
    await updateCard('inbox', newCard.id, { completed: true, title: '更新後的標題' });
    const updatedCards = await getCardsByCollection('inbox');
    assert.equal(updatedCards[0].completed, true);
    assert.equal(updatedCards[0].title, '更新後的標題');

    // 4. Move card
    await moveCard('inbox', 'todos', newCard.id, { ...updatedCards[0], title: '移動到待辦' });
    const updatedInbox = await getCardsByCollection('inbox');
    assert.equal(updatedInbox.length, 0);
    const todosCards = await getCardsByCollection('todos');
    assert.equal(todosCards.length, 1);
    assert.equal(todosCards[0].title, '移動到待辦');
    assert.equal(todosCards[0].collection, 'todos');

    // 5. Notes
    await saveNote(newCard.id, { blocks: [{ type: 'paragraph', data: { text: '詳細筆記' } }] });
    const note = await getNote(newCard.id);
    assert.ok(note);
    assert.equal(note.blocks[0].data.text, '詳細筆記');

    // 6. Tags
    await saveTags([{ id: 't1', name: '技術' }]);
    const tags = await getTags();
    assert.equal(tags.length, 1);
    assert.equal(tags[0].name, '技術');

    // 7. Migration Status
    let migStatus = await getMigrationStatus();
    assert.equal(migStatus.hasMigratedToCloud, false);
    await setMigrationStatus({ hasMigratedToCloud: true, migratedAt: Date.now() });
    migStatus = await getMigrationStatus();
    assert.equal(migStatus.hasMigratedToCloud, true);

    // 8. Export data
    const exported = await exportAllLocalData();
    assert.equal(exported.categories.length, 4);
    assert.equal(exported.cards.length, 1);
    assert.equal(exported.tags.length, 1);
    assert.ok(exported.notes[newCard.id]);

    // 9. Delete card & note
    await deleteCard('todos', newCard.id);
    await deleteNote(newCard.id);
    const emptyTodos = await getCardsByCollection('todos');
    assert.equal(emptyTodos.length, 0);
    const deletedNote = await getNote(newCard.id);
    assert.equal(deletedNote, null);
});
