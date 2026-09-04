import admin from 'firebase-admin';
import fs from 'node:fs';

let db = null;
let currentAppId = 'my-personal-ai-brain';
let currentUid = null;

export function initFirestore(options = {}) {
  const appId = options.appId || process.env.APP_ID || 'my-personal-ai-brain';
  const uid = options.uid || process.env.DEFAULT_USER_UID;
  const serviceAccountKey = options.serviceAccountKey || process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

  if (!uid) {
    throw new Error('DEFAULT_USER_UID is required to initialize Scoped Firestore.');
  }

  currentAppId = appId;
  currentUid = uid;

  if (!admin.apps.length) {
    let credential;
    if (serviceAccountKey) {
      try {
        let parsedKey = serviceAccountKey;
        if (typeof serviceAccountKey === 'string') {
          const trimmed = serviceAccountKey.trim();
          if (trimmed.startsWith('{')) {
            parsedKey = JSON.parse(trimmed);
          } else if (fs.existsSync(trimmed)) {
            parsedKey = JSON.parse(fs.readFileSync(trimmed, 'utf8'));
          }
        }
        credential = admin.credential.cert(parsedKey);
      } catch (err) {
        throw new Error(`Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY: ${err.message}`);
      }
    } else {
      credential = admin.credential.applicationDefault();
    }

    admin.initializeApp({ credential });
  }

  db = admin.firestore();
  return { db, appId: currentAppId, uid: currentUid };
}

export function getDb() {
  if (!db) {
    initFirestore();
  }
  return db;
}

export function getUserBasePath() {
  if (!currentUid) {
    initFirestore();
  }
  return `artifacts/${currentAppId}/users/${currentUid}`;
}

export function getUserCollectionRef(collectionName) {
  const firestoreDb = getDb();
  return firestoreDb.collection(`${getUserBasePath()}/${collectionName}`);
}

export function getUserDocRef(collectionName, docId) {
  const firestoreDb = getDb();
  return firestoreDb.doc(`${getUserBasePath()}/${collectionName}/${docId}`);
}

export function getUserNoteRef(collectionName, docId) {
  const firestoreDb = getDb();
  return firestoreDb.doc(`${getUserBasePath()}/${collectionName}/${docId}/details/note`);
}
