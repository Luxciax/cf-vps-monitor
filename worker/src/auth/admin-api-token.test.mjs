import assert from 'node:assert/strict';
import test from 'node:test';

import { authorizeAdminApiRequest } from './admin-api-token.ts';

const TOKEN = 'a'.repeat(64);

function auth(pathname, method = 'GET', scopes, provided = TOKEN) {
  return authorizeAdminApiRequest({
    authorization: provided ? `Bearer ${provided}` : undefined,
    method,
    pathname,
    env: {
      ADMIN_API_TOKEN: TOKEN,
      ADMIN_API_TOKEN_SCOPES: scopes,
    },
  });
}

test('machine API is disabled unless the deployment configures a token', async () => {
  const result = await authorizeAdminApiRequest({
    method: 'GET',
    pathname: '/api/v1/clients',
    env: {},
  });
  assert.deepEqual(result, { ok: false, reason: 'not_configured' });
});

test('machine API defaults to read-only and rejects writes', async () => {
  const read = await auth('/api/v1/clients');
  assert.equal(read.ok, true);
  if (read.ok) assert.equal(read.requiredScope, 'read');

  const write = await auth('/api/v1/clients/add', 'POST');
  assert.deepEqual(write, { ok: false, reason: 'insufficient_scope', requiredScope: 'write' });
});

test('machine API separates write, backup and restore privileges', async () => {
  assert.equal((await auth('/api/v1/clients/add', 'POST', 'read,write')).ok, true);
  assert.deepEqual(
    await auth('/api/v1/download/backup', 'POST', 'read,write'),
    { ok: false, reason: 'insufficient_scope', requiredScope: 'backup' },
  );
  assert.equal((await auth('/api/v1/download/backup', 'POST', 'backup')).ok, true);
  assert.equal((await auth('/api/v1/upload/backup', 'POST', 'restore')).ok, true);
});

test('machine API never exposes human account or MFA endpoints', async () => {
  assert.deepEqual(
    await auth('/api/v1/account/chpasswd', 'POST', '*'),
    { ok: false, reason: 'forbidden' },
  );
  assert.deepEqual(
    await auth('/api/v1/account/mfa/disable', 'POST', '*'),
    { ok: false, reason: 'forbidden' },
  );
});

test('machine API rejects missing, malformed and incorrect bearer credentials', async () => {
  assert.deepEqual(await auth('/api/v1/clients', 'GET', 'read', ''), { ok: false, reason: 'missing' });
  assert.deepEqual(await auth('/api/v1/clients', 'GET', 'read', 'short'), { ok: false, reason: 'invalid' });
  assert.deepEqual(await auth('/api/v1/clients', 'GET', 'read', 'b'.repeat(64)), { ok: false, reason: 'invalid' });
});
