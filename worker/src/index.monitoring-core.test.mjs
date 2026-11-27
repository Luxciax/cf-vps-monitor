import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase, rpc } from '../../scripts/test-support/postgres.mjs';
import { notificationHarness } from '../../scripts/test-support/notifications.mjs';

test('TLS notifications reuse durable delivery retries and mark only the matching observed certificate', async t => {
 const database=await createTestDatabase();t.after(()=>database.close());
 await database.query(`insert into website_monitors(id,name,url,interval_sec,status,agent_probe_mode,check_config,tls_expires_at,tls_observed_at)
 values(1,'Certificate target','https://example.com',60,'up','off',$1,'2026-09-10','2026-09-06')`,[JSON.stringify({tls_warning_days:14})]);
 const calls=[];
 const harness=await notificationHarness(database,async subject=>{calls.push(subject);return calls.length>1;});harness.state.websiteUp=true;
 await harness.run('runWebsiteMonitorChecks',0);
 assert.equal((await rpc(database,'cfm_website_monitors'))[0].tls_notification_expires_at,null);
 await harness.run('runWebsiteMonitorChecks',2);
 let monitor=(await rpc(database,'cfm_website_monitors'))[0];assert.ok(monitor.tls_notification_expires_at);
 await harness.run('runWebsiteMonitorChecks',4);assert.equal(calls.length,2,'delivered expiry must not be resent');
 assert.equal(await rpc(database,'cfm_mark_certificate_notified',{input_monitor_id:1,input_expires_at:'2027-01-01',input_config_revision:monitor.config_revision}),false,'completion for another certificate is rejected');
 await rpc(database,'cfm_update_website_monitor',{input_id:1,input_monitor:{url:'https://new-target.example'}});
 monitor=(await rpc(database,'cfm_website_monitors'))[0];
 assert.equal(monitor.tls_expires_at,null);assert.equal(monitor.tls_observed_at,null);assert.equal(monitor.tls_notification_expires_at,null,'new target cannot inherit the previous certificate evidence');
});
test('maintenance leaves the existing status and history untouched',async t=>{
 const database=await createTestDatabase();t.after(()=>database.close());
 await database.query(`insert into website_monitors(id,name,url,interval_sec,status,agent_probe_mode,check_config) values(1,'Maintenance','https://example.com',60,'down','off',$1)`,[JSON.stringify({maintenance:[{start:'2026-09-06T00:00:00Z',end:'2026-09-06T01:00:00Z'}]})]);
 let calls=0;const harness=await notificationHarness(database,async()=>{calls++;return true;});harness.state.websiteUp=true;
 await harness.run('runWebsiteMonitorChecks',0);
 const monitor=(await rpc(database,'cfm_website_monitors'))[0];assert.equal(monitor.status,'down');assert.equal(monitor.last_checked_at,null);
 assert.equal(await rpc(database,'cfm_record_website_check',{input_check:{monitor_id:1,config_revision:monitor.config_revision,checked_at:'2026-09-06T00:01:00Z',ok:true,effective_status:'up',source_type:'agent',source_client:'late-probe',details:{tls_expires_at:'2027-01-01T00:00:00Z'}}}),null,'late agent observations during maintenance cannot change status or certificate evidence');
 assert.equal((await database.query('select count(*)::int as count from website_checks')).rows[0].count,0);assert.equal(calls,0);
});
test('notification and maintenance policy edits retain observations while semantic checks rotate revision',async t=>{
 const database=await createTestDatabase();t.after(()=>database.close());
 let monitor=await rpc(database,'cfm_create_website_monitor',{input_monitor:{name:'Policy target',url:'https://example.com'}});
 monitor=await rpc(database,'cfm_record_website_check',{input_check:{monitor_id:monitor.id,config_revision:monitor.config_revision,checked_at:'2026-09-06T00:00:00Z',ok:true,effective_status:'up',source_type:'worker',latency_ms:12}});
 const revision=monitor.config_revision;
 const checkConfig={tls_warning_days:14,silenced_until:'2026-09-07T00:00:00Z',maintenance:[{start:'2026-09-08T00:00:00Z',end:'2026-09-08T01:00:00Z'}]};
 monitor=await rpc(database,'cfm_update_website_monitor',{input_id:monitor.id,input_monitor:{check_config:checkConfig}});
 assert.equal(monitor.config_revision,revision);assert.equal(monitor.status,'up');assert.ok(monitor.last_checked_at);
 const checks=await rpc(database,'cfm_website_statistics_checks',{input_monitor_id:monitor.id,input_since:'2026-09-06T00:00:00Z',input_until:'2026-09-06T01:00:00Z'});
 assert.equal(checks.length,1,'a notification policy edit must not hide existing observation history');
 monitor=await rpc(database,'cfm_update_website_monitor',{input_id:monitor.id,input_monitor:{check_config:{...checkConfig,keyword:'ready'}}});
 assert.notEqual(monitor.config_revision,revision);assert.equal(monitor.status,'pending');assert.equal(monitor.last_checked_at,null);
 assert.equal((await database.query('select count(*)::int as count from website_checks')).rows[0].count,1,'changed check semantics preserve historical rows');
});
