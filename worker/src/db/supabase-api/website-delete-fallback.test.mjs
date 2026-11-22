import assert from 'node:assert/strict';
import test from 'node:test';
import { deleteSupabaseWebsiteMonitor } from './client.ts';

const env = {
  SUPABASE_URL: 'https://synthetic.supabase.co',
  SUPABASE_SECRET_KEY: 'sb_secret_synthetic',
};

test('new batch-delete RPC stops after a bounded number of steps and reports progress', async () => {
  let calls = 0;
  const fetcher = async (url) => {
    calls += 1;
    assert.match(String(url), /\/rpc\/cfm_delete_website_monitor_batch$/);
    return Response.json({ deleted: false, deleted_checks: 1000 });
  };

  const result = await deleteSupabaseWebsiteMonitor(env, 16, fetcher);
  assert.deepEqual(result, { deleted: false, deleted_checks: 12000 });
  assert.equal(calls, 12);
});

test('legacy schema tombstones then deletes history in bounded table batches', async () => {
  const calls = [];
  let page = 0;
  const fetcher = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/rpc/cfm_delete_website_monitor_batch')) {
      return new Response(JSON.stringify({
        code: 'PGRST202',
        message: 'Could not find the function public.cfm_delete_website_monitor_batch(input_id)',
      }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    if (String(url).includes('/rest/v1/website_monitors?id=eq.16') && init.method === 'PATCH') {
      const body = JSON.parse(String(init.body));
      assert.equal(body.enabled, false);
      assert.equal(body.hidden, true);
      assert.equal(body.status, 'paused');
      return new Response(null, { status: 204 });
    }
    if (String(url).includes('/rest/v1/website_checks?select=id&monitor_id=eq.16')) {
      assert.equal(init.method, 'GET');
      page += 1;
      return Response.json(page === 1 ? [{ id: 101 }, { id: 102 }] : []);
    }
    if (String(url).includes('/rest/v1/website_checks?id=in.(101,102)')) {
      assert.equal(init.method, 'DELETE');
      return new Response(null, { status: 204 });
    }
    if (String(url).includes('/rest/v1/website_monitors?id=eq.16') && init.method === 'DELETE') {
      return new Response(null, { status: 204 });
    }
    throw new Error('unexpected URL ' + url);
  };

  const result = await deleteSupabaseWebsiteMonitor(env, 16, fetcher);
  assert.deepEqual(result, { deleted: true, deleted_checks: 2 });
  assert.equal(calls.length, 6);
});

test('legacy schema returns resumable progress before hitting subrequest limits', async () => {
  let listCalls = 0;
  const fetcher = async (url, init = {}) => {
    if (String(url).endsWith('/rpc/cfm_delete_website_monitor_batch')) {
      return new Response(JSON.stringify({
        code: 'PGRST202',
        message: 'Could not find the function public.cfm_delete_website_monitor_batch(input_id)',
      }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    if (String(url).includes('/rest/v1/website_monitors?id=eq.16') && init.method === 'PATCH') {
      return new Response(null, { status: 204 });
    }
    if (String(url).includes('/rest/v1/website_checks?select=id&monitor_id=eq.16')) {
      listCalls += 1;
      return Response.json([{ id: listCalls }]);
    }
    if (String(url).includes('/rest/v1/website_checks?id=in.(')) {
      return new Response(null, { status: 204 });
    }
    throw new Error('unexpected URL ' + url);
  };

  const result = await deleteSupabaseWebsiteMonitor(env, 16, fetcher);
  assert.deepEqual(result, { deleted: false, deleted_checks: 12 });
  assert.equal(listCalls, 12);
});

test('website delete does not hide non-missing batch RPC failures', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return new Response('database unavailable', { status: 503 });
  };

  await assert.rejects(
    () => deleteSupabaseWebsiteMonitor(env, 16, fetcher),
    /503/,
  );
  assert.equal(calls, 1);
});
