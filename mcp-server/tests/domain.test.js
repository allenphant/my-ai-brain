import test from 'node:test';
import assert from 'node:assert/strict';
import { wrapInEditorJs, sanitizeTags } from '../src/services/domain.js';

test('wrapInEditorJs formats plain text into valid Editor.js JSON', () => {
  const result = wrapInEditorJs('Hello World');
  assert.equal(typeof result.time, 'number');
  assert.equal(result.blocks.length, 1);
  assert.equal(result.blocks[0].type, 'paragraph');
  assert.equal(result.blocks[0].data.text, 'Hello World');
});

test('sanitizeTags normalizes aliases, removes category redundancy, and caps at 2 tags', () => {
  const input = ['AI工具', '本地模型', '提示詞', '生圖', '未知標籤123'];
  const sanitized = sanitizeTags(input, 'AI工具');
  // 'AI工具' is redundant with category -> removed
  // '本地模型' -> 'AI工具' -> but category is 'AI工具' so redundant! Wait:
  // '提示詞' -> 'AI提示詞'
  // '生圖' -> '影片與多媒體'
  // capped at 2
  assert.deepEqual(sanitized, ['AI提示詞', '影片與多媒體']);
});
