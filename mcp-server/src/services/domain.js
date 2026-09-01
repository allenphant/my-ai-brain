import { getDb, getUserCollectionRef, getUserDocRef, getUserNoteRef } from './firestore.js';

export function wrapInEditorJs(text) {
  return {
    time: Date.now(),
    blocks: [
      {
        id: Math.random().toString(36).substring(2, 10),
        type: 'paragraph',
        data: { text: text || '' }
      }
    ],
    version: '2.30.7'
  };
}

export async function listCategories() {
  const colRef = getUserCollectionRef('categories');
  const snapshot = await colRef.orderBy('order', 'asc').get();

  const standardCategories = [
    { id: 'inbox', name: '收件匣', icon: 'fa-inbox', type: 'inbox', isVirtual: true, order: 0 },
    { id: 'todos', name: '待辦事項', icon: 'fa-check-square', type: 'todos', isVirtual: false, order: 1 },
    { id: 'learning', name: '待學習資源', icon: 'fa-book-open', type: 'learning', isVirtual: false, order: 2 },
    { id: 'ideas', name: '點子庫', icon: 'fa-lightbulb', type: 'ideas', isVirtual: false, order: 3 },
    { id: 'bookmarks', name: '收藏貼文', icon: 'fa-bookmark', type: 'bookmarks', isVirtual: false, order: 4 }
  ];

  if (snapshot.empty) {
    return standardCategories;
  }

  const customCategories = [];
  snapshot.forEach(doc => {
    const data = doc.data();
    customCategories.push({
      id: doc.id,
      name: data.name || doc.id,
      icon: data.icon || 'fa-folder',
      type: data.type || 'custom',
      promptRule: data.promptRule || '',
      order: data.order || 99,
      isVirtual: false
    });
  });

  return [
    standardCategories[0],
    ...customCategories
  ];
}

export async function getInboxItems(limit = 20) {
  const maxLimit = Math.min(Math.max(1, limit), 100);
  const colRef = getUserCollectionRef('inbox');
  const snapshot = await colRef.orderBy('createdAt', 'desc').limit(maxLimit).get();

  const items = [];
  snapshot.forEach(doc => {
    const data = doc.data();
    items.push({
      id: doc.id,
      text: data.text || '',
      createdAt: data.createdAt || Date.now(),
      hasNote: !!data.hasNote,
      order: data.order || data.createdAt || Date.now()
    });
  });
  return items;
}

export async function getCategoryItems(category, limit = 20) {
  const maxLimit = Math.min(Math.max(1, limit), 100);
  const colRef = getUserCollectionRef(category);
  const snapshot = await colRef.orderBy('createdAt', 'desc').limit(maxLimit).get();

  const items = [];
  snapshot.forEach(doc => {
    const data = doc.data();
    items.push({
      id: doc.id,
      text: data.text || '',
      createdAt: data.createdAt || Date.now(),
      hasNote: !!data.hasNote,
      order: data.order || data.createdAt || Date.now(),
      completed: typeof data.completed === 'boolean' ? data.completed : undefined
    });
  });
  return items;
}

export async function createItem(category = 'inbox', text, noteText) {
  if (!text || typeof text !== 'string') {
    throw new Error('text is required and must be a string.');
  }

  const db = getDb();
  const now = Date.now();
  const colRef = getUserCollectionRef(category);
  const newDocRef = colRef.doc();

  const cardData = {
    text: text.trim(),
    createdAt: now,
    order: now,
    hasNote: !!noteText
  };

  if (category === 'todos') {
    cardData.completed = false;
  }

  await db.runTransaction(async (t) => {
    t.set(newDocRef, cardData);
    if (noteText) {
      const noteRef = getUserNoteRef(category, newDocRef.id);
      t.set(noteRef, {
        data: wrapInEditorJs(noteText),
        updatedAt: now
      });
    }
  });

  return {
    success: true,
    id: newDocRef.id,
    category,
    createdAt: now,
    order: now
  };
}

export async function moveItem(itemId, fromCategory, toCategory, aiReasoning, tags, dryRun = false) {
  if (!itemId || !fromCategory || !toCategory) {
    throw new Error('itemId, fromCategory, and toCategory are required.');
  }

  if (dryRun) {
    return {
      success: true,
      movedId: itemId,
      fromCategory,
      toCategory,
      isDryRun: true
    };
  }

  const db = getDb();
  const sourceDocRef = getUserDocRef(fromCategory, itemId);
  const sourceNoteRef = getUserNoteRef(fromCategory, itemId);
  const targetColRef = getUserCollectionRef(toCategory);
  const targetDocRef = targetColRef.doc();
  const targetNoteRef = getUserNoteRef(toCategory, targetDocRef.id);

  await db.runTransaction(async (t) => {
    const sourceDoc = await t.get(sourceDocRef);
    if (!sourceDoc.exists) {
      throw new Error(`Source card ${itemId} does not exist in ${fromCategory}.`);
    }

    const sourceData = sourceDoc.data();
    const sourceNote = await t.get(sourceNoteRef);

    const targetData = {
      ...sourceData,
      createdAt: sourceData.createdAt || Date.now(),
      order: Date.now()
    };

    if (toCategory === 'todos') {
      targetData.completed = false;
    } else {
      delete targetData.completed;
      delete targetData.completedAt;
    }

    if (aiReasoning) {
      targetData.aiReasoning = aiReasoning;
    }
    if (Array.isArray(tags) && tags.length > 0) {
      targetData.tags = tags;
    }

    t.set(targetDocRef, targetData);

    if (sourceNote.exists) {
      t.set(targetNoteRef, sourceNote.data());
      t.delete(sourceNoteRef);
    }

    t.delete(sourceDocRef);
  });

  return {
    success: true,
    movedId: targetDocRef.id,
    fromCategory,
    toCategory,
    isDryRun: false
  };
}

export async function batchClassifyItems(items, dryRun = false) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('items must be a non-empty array.');
  }
  if (items.length > 50) {
    throw new Error('Maximum batch size is 50 items.');
  }

  const results = [];
  for (const item of items) {
    try {
      const res = await moveItem(item.itemId, 'inbox', item.toCategory, item.aiReasoning, item.tags, dryRun);
      results.push({ itemId: item.itemId, success: true, result: res });
    } catch (err) {
      results.push({ itemId: item.itemId, success: false, error: err.message });
    }
  }

  return {
    success: results.every(r => r.success),
    processedCount: results.length,
    results,
    isDryRun: !!dryRun
  };
}

export async function deleteItem(itemId, category) {
  if (!itemId || !category) {
    throw new Error('itemId and category are required.');
  }

  const db = getDb();
  const docRef = getUserDocRef(category, itemId);
  const noteRef = getUserNoteRef(category, itemId);

  await db.runTransaction(async (t) => {
    t.delete(noteRef);
    t.delete(docRef);
  });

  return {
    success: true,
    deletedId: itemId
  };
}

export async function searchItems(keyword, limit = 20) {
  if (!keyword || typeof keyword !== 'string') {
    throw new Error('keyword is required.');
  }

  const lowerKeyword = keyword.toLowerCase();
  const categories = await listCategories();
  const results = [];

  for (const cat of categories) {
    const colRef = getUserCollectionRef(cat.id);
    const snapshot = await colRef.limit(50).get();
    snapshot.forEach(doc => {
      const data = doc.data();
      const text = data.text || '';
      if (text.toLowerCase().includes(lowerKeyword)) {
        results.push({
          id: doc.id,
          text,
          category: cat.id,
          createdAt: data.createdAt || 0,
          hasNote: !!data.hasNote
        });
      }
    });
    if (results.length >= limit) break;
  }

  return results.slice(0, limit);
}
