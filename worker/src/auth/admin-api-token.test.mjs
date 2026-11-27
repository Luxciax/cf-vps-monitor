import assert from 'node:assert/strict';
import test from 'node:test';

import { authorizeAdminApiRequest } from './admin-api-token.ts';

const TOKEN = 'a'.repeat(64);

test('legacy tokens retain compatibility even when their user-chosen prefix resembles database tokens', async () => {
  const token = 'cvm_' + 'b'.repeat(64);
  const result = await authorizeAdminApiRequest({authorization:`Bearer ${token}`,method:'GET',pathname:'/api/v1/clients',env:{ADMIN_API_TOKEN:token},lookupToken:()=>{throw new Error('legacy token must not require a new migration');}});
  assert.equal(result.ok,true);
  assert.match(result.principal,/^api:/);
});

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

test('theme preview uses settings read scope without granting persistence privileges', async () => {
  const preview = await auth('/api/v1/themes/preview', 'POST', 'settings:read');
  assert.equal(preview.ok, true);
  assert.equal(preview.requiredScope, 'settings:read');
  assert.equal((await auth('/api/v1/themes/settings', 'POST', 'settings:read')).ok, false);
  assert.equal((await auth('/api/v1/themes/preview', 'POST', 'assets:read')).ok, false);
});

test('machine API treats DELETE as write and rejects invalid scope configuration', async () => {
  assert.deepEqual(
    await auth('/api/v1/clients/node-a', 'DELETE', 'read'),
    { ok: false, reason: 'insufficient_scope', requiredScope: 'write' },
  );
  assert.equal((await auth('/api/v1/clients/node-a', 'DELETE', 'read,write')).ok, true);

  for (const scopes of ['read,root', '*,write', 'write,*', ',,,']) {
    assert.deepEqual(await auth('/api/v1/clients', 'GET', scopes), { ok: false, reason: 'misconfigured' });
  }
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
