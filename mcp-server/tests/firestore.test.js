import test from 'node:test';
import assert from 'node:assert/strict';
import { getUserBasePath, initFirestore } from '../src/services/firestore.js';

test('getUserBasePath throws when DEFAULT_USER_UID is missing', () => {
  delete process.env.DEFAULT_USER_UID;
  assert.throws(() => initFirestore({ uid: null }), {
    message: /DEFAULT_USER_UID is required/
  });
});

test('getUserBasePath builds correct scoped path', () => {
  initFirestore({
    appId: 'my-personal-ai-brain',
    uid: 'user_test_123',
    serviceAccountKey: null
  });
  assert.equal(getUserBasePath(), 'artifacts/my-personal-ai-brain/users/user_test_123');
});
