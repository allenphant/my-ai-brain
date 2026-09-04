import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFirebaseConfig } from '../firebase-config.mjs';

test('parseFirebaseConfig handles valid JSON string', () => {
    const input = JSON.stringify({
        apiKey: 'test-api-key',
        projectId: 'test-project',
        authDomain: 'test-project.firebaseapp.com'
    });
    const parsed = parseFirebaseConfig(input);
    assert.equal(parsed?.apiKey, 'test-api-key');
    assert.equal(parsed?.projectId, 'test-project');
});

test('parseFirebaseConfig handles JS snippet with const and trailing semicolon', () => {
    const input = `
        const firebaseConfig = {
            apiKey: "AIzaSyTest123",
            authDomain: "my-brain.firebaseapp.com",
            projectId: "my-brain",
            storageBucket: "my-brain.appspot.com",
            messagingSenderId: "123456",
            appId: "1:123456:web:abcdef"
        };
    `;
    const parsed = parseFirebaseConfig(input);
    assert.equal(parsed?.apiKey, 'AIzaSyTest123');
    assert.equal(parsed?.projectId, 'my-brain');
});

test('parseFirebaseConfig handles unquoted keys and single quotes', () => {
    const input = `{
        apiKey: 'single-quote-key',
        projectId: 'single-quote-project'
    }`;
    const parsed = parseFirebaseConfig(input);
    assert.equal(parsed?.apiKey, 'single-quote-key');
    assert.equal(parsed?.projectId, 'single-quote-project');
});

test('parseFirebaseConfig rejects empty or null inputs', () => {
    assert.equal(parseFirebaseConfig(null), null);
    assert.equal(parseFirebaseConfig(''), null);
    assert.equal(parseFirebaseConfig('   '), null);
});

test('parseFirebaseConfig rejects invalid configs without apiKey or projectId', () => {
    assert.equal(parseFirebaseConfig('{"other": "value"}'), null);
    assert.equal(parseFirebaseConfig('{"apiKey": "only-key"}'), null);
    assert.equal(parseFirebaseConfig('{"projectId": "only-project"}'), null);
    assert.equal(parseFirebaseConfig('invalid javascript syntax !!!'), null);
});
