import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createTestDatabase, rpc } from '../../../../scripts/test-support/postgres.mjs';

const migrations = new URL('../../../../supabase/migrations/', import.meta.url);
async function run(sql, file) { await sql.exec(`begin;\n${await readFile(new URL(file, migrations), 'utf8')}\ncommit;`); }

for (const upgrade of [false, true]) test(`website assets and privacy: ${upgrade ? 'existing installation upgrade' : 'new installation'}`, async () => {
  const sql = await createTestDatabase({ migrate: !upgrade });
  try {
    if (upgrade) {
      for (const f of ['1_core_schema.sql','2_security_access.sql','3_feature_schema.sql','4_rpc_api.sql','5_runtime_defaults.sql','6_website_assets_dashboard.sql','7_website_delete_batches.sql']) await run(sql, f);
      await rpc(sql, 'cfm_create_website_monitor', { input_monitor: { name: 'Existing', url: 'https://existing.example', description: 'preserved' } });
      await run(sql, '4_rpc_api.sql');
      await run(sql, '8_website_assets_hide_url.sql');
      assert.equal((await sql.query("select description from website_monitors where name='Existing'")).rows[0].description, 'preserved');
    }
    const site = await rpc(sql, 'cfm_create_website_monitor', { input_monitor: { name:'Private', url:'https://private.example', hide_url:true, domain:'private.example', icon:'https://private.example/icon', description:'asset', note:'secret note', tags:['test'] } });
    assert.equal(site.description, 'asset');
    const updated = await rpc(sql, 'cfm_update_website_monitor', { input_id:site.id, input_monitor: { description:'updated', category:'API' } });
    assert.equal(updated.description, 'updated');
    assert.equal(updated.hide_url, true);
    for (const row of [(await rpc(sql, 'cfm_public_websites')).find(x => x.id === site.id), await rpc(sql, 'cfm_public_website_monitor', { input_id:site.id })]) {
      assert.equal(row.url, null); assert.equal(row.domain, ''); assert.equal(row.icon, '');
      assert.equal(row.description, 'updated'); assert.equal('note' in row, false);
    }
    const admin = await rpc(sql, 'cfm_public_website_monitor', { input_id:site.id, input_include_hidden:true });
    assert.equal(admin.url, 'https://private.example'); assert.equal(admin.domain, 'private.example');
    await sql.query("insert into website_checks(monitor_id,checked_at,ok,effective_status,config_revision) values ($1,now(),true,'up',$2),($1,now(),true,'up',null)", [site.id, updated.config_revision]);
    assert.equal((await rpc(sql,'cfm_public_website_monitor',{input_id:site.id})).checks.length, 1);
    assert.equal((await rpc(sql,'cfm_public_websites')).find(x => x.id === site.id).checks.length, 1);
    let result = await rpc(sql, 'cfm_delete_website_monitor_batch', { input_id:site.id });
    assert.equal(result.deleted, false); assert.equal(result.deleted_checks, 2);
    result = await rpc(sql, 'cfm_delete_website_monitor_batch', { input_id:site.id });
    assert.equal(result.deleted, true);
    if (upgrade) assert.equal((await sql.query("select count(*)::int as n from website_monitors where name='Existing'")).rows[0].n, 1);
  } finally { await sql.close(); }
});
