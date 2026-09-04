import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { StorageController } from '../js/storage-controller.mjs';
import { clearAllLocalData, addCard, ensureDefaultCategories } from '../js/local-db.mjs';

test('StorageController: local mode operations, event subscription, and migration detection', async () => {
    await clearAllLocalData();
    const controller = new StorageController();
    assert.equal(controller.getMode(), 'local');

    // 1. Categories
    const cats = await controller.ensureCategories();
    assert.equal(cats.length, 4);

    let catEventFired = false;
    const unsubCat = controller.subscribe('categories_changed', () => {
        catEventFired = true;
    });
    await controller.saveCategory({ id: 'work', name: '工作', order: 6000, type: 'text' });
    assert.equal(catEventFired, true);
    unsubCat();

    // 2. Cards & Event emission
    let cardEventPayload = null;
    const unsubCard = controller.subscribe('cards_changed', (payload) => {
        cardEventPayload = payload;
    });

    const card = await controller.addCard('inbox', { title: '控制器卡片測試' });
    assert.ok(card.id);
    assert.ok(cardEventPayload);
    assert.equal(cardEventPayload.action, 'add');
    assert.equal(cardEventPayload.collection, 'inbox');

    const inboxCards = await controller.getCards('inbox');
    assert.equal(inboxCards.length, 1);
    assert.equal(inboxCards[0].title, '控制器卡片測試');

    await controller.updateCard('inbox', card.id, { title: '更新後的控制器卡片' });
    assert.equal(cardEventPayload.action, 'update');

    await controller.moveCard('inbox', 'todos', card.id, { title: '搬移後的卡片' });
    assert.equal(cardEventPayload.action, 'move');

    const todosCards = await controller.getCards('todos');
    assert.equal(todosCards.length, 1);
    assert.equal(todosCards[0].title, '搬移後的卡片');

    unsubCard();

    // 3. Migration Check
    const migrationInfo = await controller.needsCloudMigration();
    assert.equal(migrationInfo.needed, true);
    assert.equal(migrationInfo.cardCount, 1);

    // 4. Mock Cloud Migration
    const mockFirestoreWrites = [];
    const mockContext = {
        db: {},
        appId: 'test-app',
        userId: 'user-123',
        setDoc: async (docRef, data) => {
            mockFirestoreWrites.push({ docRef, data });
        },
        doc: (db, ...pathParts) => {
            return { path: pathParts.join('/') };
        }
    };

    let reportedProgress = null;
    const migrationResult = await controller.migrateLocalToCloud(mockContext, (progress) => {
        reportedProgress = progress;
    });

    assert.equal(migrationResult.success, true);
    assert.ok(mockFirestoreWrites.length >= 2); // categories + card + tags
    assert.ok(reportedProgress);
    assert.equal(reportedProgress.percentage, 100);

    // After migration, needsCloudMigration should be false
    const afterMigrationCheck = await controller.needsCloudMigration();
    assert.equal(afterMigrationCheck.needed, false);
});
