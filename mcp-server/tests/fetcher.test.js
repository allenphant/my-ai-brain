import test from 'node:test';
import assert from 'node:assert/strict';
import { readUrlContent, isPrivateIpOrBlockedHost } from '../src/services/fetcher.js';

test('isPrivateIpOrBlockedHost blocks private and metadata IP ranges', () => {
  assert.equal(isPrivateIpOrBlockedHost('localhost'), true);
  assert.equal(isPrivateIpOrBlockedHost('127.0.0.1'), true);
  assert.equal(isPrivateIpOrBlockedHost('10.0.0.1'), true);
  assert.equal(isPrivateIpOrBlockedHost('192.168.1.1'), true);
  assert.equal(isPrivateIpOrBlockedHost('172.16.0.1'), true);
  assert.equal(isPrivateIpOrBlockedHost('169.254.169.254'), true);
  assert.equal(isPrivateIpOrBlockedHost('example.com'), false);
});

test('readUrlContent rejects blocked IP URLs', async () => {
  await assert.rejects(
    async () => {
      await readUrlContent('http://127.0.0.1:8080/secret');
    },
    { message: /SSRF protection/ }
  );
});
