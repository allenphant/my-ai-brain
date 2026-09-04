import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('README.md includes ImgBB security & privacy warnings without emoji', () => {
    const content = readFileSync('README.md', 'utf8');

    // Emoji check
    const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B50}-\u{2B55}\u{203C}\u{2049}\u{25AA}\u{25AB}\u{25B6}\u{25C0}\u{25FB}-\u{25FE}]/u;
    assert.equal(emojiRegex.test(content), false, 'README should contain zero emoji');

    // Risk warning keywords
    assert.ok(content.includes('ImgBB 免費圖床隱私與可用性警示'), 'Should contain ImgBB warning title');
    assert.ok(content.includes('公開存取風險'), 'Should contain public access risk warning');
    assert.ok(content.includes('無 SLA 與被動清除風險'), 'Should contain retention policy / SLA warning');
    assert.ok(content.includes('嚴禁上傳包含密碼'), 'Should explicitly forbid uploading credentials');
});
