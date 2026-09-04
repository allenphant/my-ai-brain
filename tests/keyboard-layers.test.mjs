import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCombo, createLayerStack } from '../js/keyboard-layers.js';

test('normalizeCombo: plain key', () => {
    assert.equal(normalizeCombo({ key: 'Escape', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false }), 'Escape');
});

test('normalizeCombo: ctrl+letter lowercases', () => {
    assert.equal(normalizeCombo({ key: 'A', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false }), 'mod+a');
});

test('normalizeCombo: meta acts as mod, shift ordered before key', () => {
    assert.equal(normalizeCombo({ key: 'Z', ctrlKey: false, metaKey: true, shiftKey: true, altKey: false }), 'mod+shift+z');
});

test('stack: top layer wins, base reachable when alone', () => {
    const s = createLayerStack();
    s.push({ name: 'base', keys: {} });
    s.push({ name: 'editor', keys: {} });
    assert.equal(s.top().name, 'editor');
    s.pop('editor');
    assert.equal(s.top().name, 'base');
});

test('stack: push with same name replaces top (re-open)', () => {
    const s = createLayerStack();
    s.push({ name: 'base', keys: {} });
    s.push({ name: 'editor', keys: { 'Escape': () => 'v1' } });
    s.push({ name: 'editor', keys: { 'Escape': () => 'v2' } });
    assert.equal(s.depth(), 2);
    assert.equal(s.top().keys['Escape'](), 'v2');
});

test('stack: mismatched pop warns and removes by name, never throws', () => {
    const s = createLayerStack();
    s.push({ name: 'base', keys: {} });
    s.push({ name: 'settings', keys: {} });
    s.push({ name: 'editor', keys: {} });
    s.pop('settings'); // out of order
    assert.equal(s.depth(), 2);
    assert.equal(s.top().name, 'editor');
    s.pop('nonexistent'); // no-op, no throw
    assert.equal(s.depth(), 2);
});
