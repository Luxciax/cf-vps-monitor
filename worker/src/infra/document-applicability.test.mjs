import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase, rpc } from '../../../scripts/test-support/postgres.mjs';
import { createWorkerLoader } from '../../test-support/worker-module.mjs';

const call = (db, operation, payload = {}) => rpc(db, 'cfm_infra', {
  p_operation: operation, p_payload: payload, p_actor: 'document-regression',
});
const contextReader = db => createWorkerLoader({ overrides: {
  'worker/src/db/supabase-api/client.ts': { callSupabaseRpc: (_env, name, args) => rpc(db, name, args) },
}}).load('worker/src/infra/service.ts').assetContext;
const slugs = context => new Set(context.documents.map(document => document.slug));

test('Cloudflare context selects matching SOPs and explicit links while unknown hosts never imply Linux', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const worker = await call(db, 'assets.save', { kind: 'cloudflare_worker', name: 'Edge service' });
  const custom = await call(db, 'documents.save', {
    slug: 'linked-custom', title: 'Explicit service runbook', content: '# Reviewed service notes',
    asset_ids: [worker.id], asset_kinds: ['vps'], environments: ['linux'],
  });
  const assetContext = contextReader(db);
  const context = await assetContext({}, worker.id, { fields: 'documents', limit: 50 });
  assert.ok(slugs(context).has('cloudflare-services'));
  assert.ok(slugs(context).has(custom.slug), 'an explicit asset link overrides automatic applicability filters');
  for (const slug of ['ssh-safety', 'debian-ubuntu-hardening', 'firewall-fail2ban', 'disk-full'])
    assert.equal(slugs(context).has(slug), false, slug);
  assert.equal(context.documents[0].id, custom.id, 'explicit runbooks are prioritized in bounded context');
  const domain = await call(db, 'assets.save', { kind: 'domain', name: 'Managed domain', metadata: { platform: 'cloudflare' } });
  assert.ok(slugs(await assetContext({}, domain.id, { fields: 'documents' })).has('cloudflare-services'));
  const host = await call(db, 'assets.save', { kind: 'vps', name: 'Unknown OS', provider: 'Amazon' });
  const unknown = await assetContext({}, host.id, { fields: 'documents', limit: 50 });
  assert.equal(slugs(unknown).has('ssh-safety'), false);
  assert.equal(slugs(unknown).has('disk-full'), false);
  await call(db, 'snapshots.save', {
    asset_id: host.id, collected_at: new Date().toISOString(), confidence: 'unknown',
    environment: 'linux', data: { system: { status: 'unavailable', value: { os: 'debian' } } },
  });
  assert.equal(slugs(await assetContext({}, host.id, { fields: 'documents' })).has('ssh-safety'), false,
    'unavailable or unknown evidence must not claim Linux applicability');
});

test('Linux evidence drives SOP selection and document versions preserve applicability filters', async t => {
  const db = await createTestDatabase(); t.after(() => db.close());
  const host = await call(db, 'assets.save', { kind: 'vps', name: 'Debian host' });
  await call(db, 'snapshots.save', {
    asset_id: host.id, collected_at: new Date().toISOString(), confidence: 'observed',
    data: { system: { status: 'available', value: { os: 'Debian GNU/Linux 12', platform: 'linux' } } },
  });
  const assetContext = contextReader(db);
  const context = await assetContext({}, host.id, { fields: 'documents', limit: 50 });
  for (const slug of ['ssh-safety', 'debian-ubuntu-hardening', 'firewall-fail2ban', 'disk-full'])
    assert.ok(slugs(context).has(slug), slug);
  assert.equal(slugs(context).has('cloudflare-services'), false);
  const { documentInput } = createWorkerLoader().load('worker/src/infra/validation.ts');
  assert.throws(() => documentInput({ title: 'Invalid', content: 'text', asset_kinds: ['shell'] }), /Invalid document asset kind/);
  const document = await call(db, 'documents.save', documentInput({
    title: 'Debian storage procedure', content: '# Read before operating', asset_kinds: ['vps'], environments: ['debian'],
  }));
  assert.deepEqual(document.asset_kinds, ['vps']);
  const changed = await call(db, 'documents.save', {
    id: document.id, version: document.version, asset_kinds: ['database'], environments: ['postgresql'],
  });
  assert.deepEqual(changed.asset_kinds, ['database']);
  const restored = await call(db, 'documents.restore', { id: document.id, version: 1 });
  assert.equal(restored.version, 3);
  assert.deepEqual(restored.asset_kinds, ['vps']);
  assert.deepEqual(restored.environments, ['debian']);
  assert.ok((await assetContext({}, host.id, { fields: 'documents', limit: 50 })).documents.some(row => row.id === document.id));
});
