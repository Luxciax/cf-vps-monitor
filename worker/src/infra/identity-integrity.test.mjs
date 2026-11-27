import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase, rpc } from '../../../scripts/test-support/postgres.mjs';
import { createWorkerLoader } from '../../test-support/worker-module.mjs';

const call = (db, operation, payload = {}) => rpc(db, 'cfm_infra', {
  p_operation: operation,
  p_payload: payload,
  p_actor: 'independent-integrity-review',
});

test('a monitored host identity cannot drift through generic asset edits or monitor relinking', async t => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  await db.query("insert into clients(uuid,name,token) values('identity-node','Original host','test-token')");
  const original = (await call(db, 'assets.list')).data.find(a => a.client_id === 'identity-node');
  const other = await call(db, 'assets.save', { kind: 'vps', name: 'Separate inventory identity' });

  await assert.rejects(call(db, 'assets.save', { id: original.id, kind: 'service' }), /CVM_CONFLICT/);
  await assert.rejects(call(db, 'assets.save', { id: original.id, client_id: null }), /CVM_CONFLICT/);
  await call(db, 'monitors.link', { asset_id: original.id, monitor_type: 'client', monitor_id: 'identity-node' });
  await assert.rejects(call(db, 'monitors.link', { asset_id: other.id, monitor_type: 'client', monitor_id: 'identity-node' }), /CVM_CONFLICT/);
  await assert.rejects(call(db, 'monitors.unlink', { asset_id: original.id, monitor_type: 'client', monitor_id: 'identity-node' }), /CVM_CONFLICT/);

  // A rejected inventory edit must not make the next existing Agent/basic-info
  // update fail in the synchronization trigger.
  await db.query("update clients set name='Updated host',os='debian' where uuid='identity-node'");
  assert.equal((await call(db, 'assets.get', { id: original.id })).client_id, 'identity-node');
  assert.equal((await call(db, 'monitors.list', { asset_id: original.id }))[0].monitor_id, 'identity-node');
  assert.equal((await call(db, 'monitors.list', { asset_id: other.id })).length, 0);
});

test('accepted discovery identities remain exportable and restorable at the full identity limit', async t => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  const loader = createWorkerLoader();
  const { discoveryInput } = loader.load('worker/src/infra/validation.ts');
  const { validateInventoryBackup } = loader.load('worker/src/infra/backup.ts');
  const externalId = `container:${'x'.repeat(230)}`;
  const report = discoveryInput({
    schema_version: 1,
    collected_at: new Date().toISOString(),
    complete: true,
    collectors: [{ name: 'external', status: 'available' }],
    assets: [{ external_id: externalId, kind: 'container', name: 'Long stable identity', metadata: {}, evidence: {} }],
  }, 'harness:identity-review');
  await call(db, 'discovery.submit', report);
  const candidate = (await call(db, 'discovery.list')).data[0];
  const resolved = await call(db, 'discovery.resolve', { id: candidate.id, action: 'import' });
  const backup = (await rpc(db, 'cfm_backup_configuration_snapshot')).infrastructure;
  assert.ok(validateInventoryBackup(backup));
  await rpc(db, 'cfm_restore_backup_data', { input_backup: { infrastructure: backup } });
  assert.equal((await call(db, 'assets.get', { id: resolved.asset_id })).external_id, externalId);
});

test('inventory restore rejects dangling monitor and document references atomically', async t => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  const asset = await call(db, 'assets.save', { kind: 'service', name: 'Restore fixture' });
  const document = await call(db, 'documents.save', { title: 'Linked document', content: '# Verify before changing', asset_ids: [asset.id] });
  const backup = (await rpc(db, 'cfm_backup_configuration_snapshot')).infrastructure;
  const siteTitle = (await db.query("select value from settings where key='site_title'")).rows[0]?.value;
  const invalidMonitor = structuredClone(backup);
  invalidMonitor.monitor_links.push({ asset_id: asset.id, monitor_type: 'website', monitor_id: '999999' });
  await assert.rejects(rpc(db, 'cfm_restore_backup_data', { input_backup: { settings: { site_title: 'Must roll back' }, infrastructure: invalidMonitor } }), /CVM_(INVALID|NOT_FOUND|CONFLICT)/);
  assert.equal((await call(db, 'monitors.list', { asset_id: asset.id })).length, 0);
  assert.equal((await db.query("select value from settings where key='site_title'")).rows[0]?.value, siteTitle);

  const invalidDocument = structuredClone(backup);
  invalidDocument.documents.find(d => d.id === document.id).asset_ids = ['5aac455c-29c8-4cac-99aa-d56bfec0cfe6'];
  await assert.rejects(rpc(db, 'cfm_restore_backup_data', { input_backup: { infrastructure: invalidDocument } }), /CVM_(INVALID|NOT_FOUND|CONFLICT)/);
  assert.deepEqual((await call(db, 'documents.get', { id: document.id })).asset_ids, [asset.id]);

  const invalidSop = structuredClone(backup);
  invalidSop.baselines[0].rules[0].sop_id = '5aac455c-29c8-4cac-99aa-d56bfec0cfe6';
  await assert.rejects(rpc(db, 'cfm_restore_backup_data', { input_backup: { infrastructure: invalidSop } }), /CVM_NOT_FOUND/);
  const invalidException = structuredClone(backup);
  invalidException.baselines[0].exceptions = [{ rule_id: invalidException.baselines[0].rules[0].id, asset_id: '5aac455c-29c8-4cac-99aa-d56bfec0cfe6', reason: 'Invalid reference', expires_at: '2027-01-01T00:00:00Z' }];
  await assert.rejects(rpc(db, 'cfm_restore_backup_data', { input_backup: { infrastructure: invalidException } }), /CVM_NOT_FOUND/);
  const invalidVersion = structuredClone(backup);
  invalidVersion.document_versions[0].document.id = '5aac455c-29c8-4cac-99aa-d56bfec0cfe6';
  const { validateInventoryBackup } = createWorkerLoader().load('worker/src/infra/backup.ts');
  assert.throws(() => validateInventoryBackup(invalidVersion), /identity/);
  await assert.rejects(rpc(db, 'cfm_restore_backup_data', { input_backup: { infrastructure: invalidVersion } }), /CVM_INVALID/);
});

test('full restore removes links to omitted monitors while keeping formal inventory assets', async t => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  const backup = (await rpc(db, 'cfm_backup_configuration_snapshot')).infrastructure;
  await db.query("insert into clients(uuid,name,token) values('removed-monitor-host','Host','test-token')");
  await rpc(db, 'cfm_create_website_monitor', { input_monitor: { name: 'Omitted website', url: 'https://omitted.example', server_uuid: 'removed-monitor-host' } });
  const original = (await call(db, 'assets.list')).data;
  assert.equal(original.length, 2);
  await rpc(db, 'cfm_restore_backup_data', { input_backup: { clients: [], website_monitors: [], infrastructure: backup } });
  assert.equal((await call(db, 'assets.list')).total, 2);
  for (const asset of original) assert.deepEqual(await call(db, 'monitors.list', { asset_id: asset.id }), []);
  assert.equal((await call(db, 'relationships.list')).data.some(r => r.source === 'monitor'), false);
});

test('moving or unlinking website monitors immediately reconciles only monitor-derived deployment edges', async t => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  await db.query("insert into clients(uuid,name,token) values('relation-host','Host','test-token')");
  const website = await rpc(db, 'cfm_create_website_monitor', { input_monitor: { name: 'Website', url: 'https://relation.example', server_uuid: 'relation-host' } });
  const assets = (await call(db, 'assets.list')).data;
  const original = assets.find(a => a.kind === 'website');
  const host = assets.find(a => a.client_id === 'relation-host');
  const target = await call(db, 'assets.save', { kind: 'website', name: 'Maintained website identity' });
  await call(db, 'relationships.save', { source_id: original.id, target_id: host.id, kind: 'depends_on' });

  await call(db, 'monitors.link', { asset_id: target.id, monitor_type: 'website', monitor_id: String(website.id) });
  let edges = (await call(db, 'relationships.list')).data;
  assert.equal(edges.some(r => r.source_id === original.id && r.kind === 'runs_on'), false);
  assert.equal(edges.some(r => r.source_id === target.id && r.target_id === host.id && r.kind === 'runs_on'), true);
  assert.equal(edges.some(r => r.source_id === original.id && r.kind === 'depends_on'), true);
  await call(db, 'monitors.unlink', { asset_id: target.id, monitor_type: 'website', monitor_id: String(website.id) });
  edges = (await call(db, 'relationships.list')).data;
  assert.equal(edges.some(r => r.source_id === target.id && r.kind === 'runs_on'), false);
  assert.equal(edges.some(r => r.source_id === original.id && r.kind === 'depends_on'), true);
});

test('late discovery from another source cannot replace newer observed data or provenance', async t => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  const asset = await call(db, 'assets.save', { kind: 'service', name: 'Manually maintained service' });
  const baseTime = Date.now() - 60000;
  const report = (source, offset, version) => ({ source, schema_version: 1, collected_at: new Date(baseTime + offset).toISOString(), complete: true, collectors: [{ name: 'service', status: 'available' }], assets: [{ external_id: 'service:stable', kind: 'service', name: 'Observed service', metadata: { version }, evidence: {} }] });
  const observed = report('agent:actual-host', 30000, '2');
  await call(db, 'discovery.submit', observed);
  let candidate = (await call(db, 'discovery.list')).data.find(c => c.source === observed.source);
  await call(db, 'discovery.resolve', { id: candidate.id, action: 'merge', asset_id: asset.id });
  await call(db, 'discovery.submit', report('harness:late-report', 10000, 'old claim'));
  candidate = (await call(db, 'discovery.list')).data.find(c => c.source === 'harness:late-report');
  await call(db, 'discovery.resolve', { id: candidate.id, action: 'merge', asset_id: asset.id });
  await call(db, 'discovery.submit', report('harness:late-report', 20000, 'another old claim'));
  const current = await call(db, 'assets.get', { id: asset.id });
  assert.equal(current.name, asset.name);
  assert.equal(current.observed.version, '2');
  assert.equal(current.observed_source, observed.source);
  assert.equal(current.observed_confidence, 'observed');
  assert.equal(Date.parse(current.observed_at), Date.parse(observed.collected_at));
});

test('Ping deletion leaves no dangling link and a complete backup restores canonical host bindings into a fresh database', async t => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  await db.query("insert into clients(uuid,name,token) values('recovery-host','Recovery host','test-token')");
  const host = (await call(db, 'assets.list')).data.find(a => a.client_id === 'recovery-host');
  const ping = await rpc(db, 'cfm_create_ping_task', { input_task: { name: 'Read-only ping', type: 'icmp', target: '1.1.1.1', clients: ['recovery-host'], interval_sec: 120 } });
  await call(db, 'monitors.link', { asset_id: host.id, monitor_type: 'ping', monitor_id: String(ping.id) });
  await rpc(db, 'cfm_delete_ping_task', { input_id: ping.id });
  assert.equal((await call(db, 'monitors.list', { asset_id: host.id })).some(link => link.monitor_type === 'ping'), false);
  assert.equal((await call(db, 'assets.get', { id: host.id })).id, host.id);

  const backup = await rpc(db, 'cfm_backup_configuration_snapshot');
  const fresh = await createTestDatabase();
  t.after(() => fresh.close());
  await rpc(fresh, 'cfm_restore_backup_data', { input_backup: backup });
  assert.equal((await call(fresh, 'assets.get', { id: host.id })).client_id, 'recovery-host');
  assert.equal((await call(fresh, 'monitors.list', { asset_id: host.id }))[0].monitor_id, 'recovery-host');
  await fresh.query("update clients set os='debian' where uuid='recovery-host'");
  assert.equal((await call(fresh, 'assets.list')).total, 1);
});

test('older document backups gain unrestricted kind applicability while malformed applicability is rejected', async t => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  const backup = (await rpc(db, 'cfm_backup_configuration_snapshot')).infrastructure;
  for (const document of backup.documents) delete document.asset_kinds;
  for (const version of backup.document_versions) delete version.document.asset_kinds;
  const { validateInventoryBackup } = createWorkerLoader().load('worker/src/infra/backup.ts');
  const normalized = validateInventoryBackup(backup);
  assert.ok(normalized.documents.every(d => Array.isArray(d.asset_kinds)));
  await rpc(db, 'cfm_restore_backup_data', { input_backup: { infrastructure: backup } });
  assert.deepEqual((await call(db, 'documents.get', { id: backup.documents[0].id })).asset_kinds, []);
  const invalid = structuredClone(backup);
  invalid.documents[0].asset_kinds = ['unknown-executable-kind'];
  assert.throws(() => validateInventoryBackup(invalid), /kind/i);
  await assert.rejects(rpc(db, 'cfm_restore_backup_data', { input_backup: { infrastructure: invalid } }), /CVM_INVALID/);
});
