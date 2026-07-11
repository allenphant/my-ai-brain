import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchMdRule } from '../js/md-shortcuts.js';

test('## + space -> header level 2', () => {
    const r = matchMdRule('##', 'space');
    assert.equal(r.tool, 'header');
    assert.deepEqual(r.data, { level: 2 });
});

test('- and * + space -> unordered list', () => {
    assert.equal(matchMdRule('-', 'space').data.style, 'unordered');
    assert.equal(matchMdRule('*', 'space').data.style, 'unordered');
});

test('1. + space -> ordered list', () => {
    assert.equal(matchMdRule('1.', 'space').data.style, 'ordered');
});

test('[] + space -> checklist with one empty item', () => {
    const r = matchMdRule('[]', 'space');
    assert.equal(r.tool, 'checklist');
    assert.deepEqual(r.data.items, [{ text: '', checked: false }]);
});

test('> + space -> quote', () => {
    assert.equal(matchMdRule('>', 'space').tool, 'quote');
});

test('\`\`\` + enter -> code; --- + enter -> delimiter', () => {
    assert.equal(matchMdRule('\`\`\`', 'enter').tool, 'code');
    assert.equal(matchMdRule('---', 'enter').tool, 'delimiter');
});

test('wrong trigger or extra text does not match', () => {
    assert.equal(matchMdRule('##', 'enter'), null);
    assert.equal(matchMdRule('## title', 'space'), null);
    assert.equal(matchMdRule('text ##', 'space'), null);
});

test('nbsp and surrounding whitespace tolerated', () => {
    assert.equal(matchMdRule(' ## ', 'space').tool, 'header');
});
