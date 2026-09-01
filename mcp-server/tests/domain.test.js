import test from 'node:test';
import assert from 'node:assert/strict';
import { wrapInEditorJs } from '../src/services/domain.js';

test('wrapInEditorJs formats plain text into valid Editor.js JSON', () => {
  const result = wrapInEditorJs('Hello World');
  assert.equal(typeof result.time, 'number');
  assert.equal(result.blocks.length, 1);
  assert.equal(result.blocks[0].type, 'paragraph');
  assert.equal(result.blocks[0].data.text, 'Hello World');
});
