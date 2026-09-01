import test from 'node:test';
import assert from 'node:assert/strict';
import { createMcpServer } from '../src/server.js';

test('createMcpServer initializes correctly', () => {
  const server = createMcpServer();
  assert.ok(server);
});
