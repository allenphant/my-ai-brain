import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyBearerToken } from '../src/index.js';

test('verifyBearerToken rejects requests without authorization header', () => {
  const req = { headers: {} };
  let statusCode = null;
  let jsonResult = null;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      jsonResult = data;
    }
  };

  verifyBearerToken(req, res, () => {});
  assert.equal(statusCode, 401);
  assert.match(jsonResult.error, /Missing or invalid/);
});
