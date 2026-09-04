import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('index.html markup contains Local Mode indicator and Migration Modal dialog', () => {
    const html = readFileSync('index.html', 'utf8');

    // Emoji check
    const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B50}-\u{2B55}\u{203C}\u{2049}\u{25AA}\u{25AB}\u{25B6}\u{25C0}\u{25FB}-\u{25FE}]/u;
    assert.equal(emojiRegex.test(html), false, 'index.html should contain zero emoji');

    // Migration modal elements
    assert.ok(html.includes('id="migration-modal"'), 'Should contain migration-modal');
    assert.ok(html.includes('id="confirm-migration-btn"'), 'Should contain confirm-migration-btn');
    assert.ok(html.includes('id="dismiss-migration-btn"'), 'Should contain dismiss-migration-btn');
    assert.ok(html.includes('id="migration-count"'), 'Should contain migration-count');
    assert.ok(html.includes('id="migration-progress"'), 'Should contain migration-progress');
});

test('app.js imports local-db / storage-controller and references local mode flow', () => {
    const appJs = readFileSync('app.js', 'utf8');

    // Emoji check
    const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B50}-\u{2B55}\u{203C}\u{2049}\u{25AA}\u{25AB}\u{25B6}\u{25C0}\u{25FB}-\u{25FE}]/u;
    assert.equal(emojiRegex.test(appJs), false, 'app.js should contain zero emoji');

    // Local mode and migration logic
    assert.ok(appJs.includes('local-db.mjs') || appJs.includes('storage-controller.mjs'), 'Should import local-db or storage-controller');
    assert.ok(appJs.includes('initLocalMode'), 'Should contain initLocalMode');
    assert.ok(appJs.includes('checkAndPromptMigration'), 'Should contain checkAndPromptMigration');
    assert.ok(appJs.includes('本機儲存模式'), 'Should contain local storage mode indicator text');
});
