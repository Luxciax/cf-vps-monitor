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
  assert.deepEqual(result, { deleted: false, deleted_checks: 4000 });
  assert.equal(calls, 4);
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
    if (String(url).endsWith('/rpc/cfm_website_checks')) {
      assert.deepEqual(JSON.parse(String(init.body)), {
        input_monitor_id: 16,
        input_limit: 250,
      });
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
    if (String(url).endsWith('/rpc/cfm_website_checks')) {
      assert.deepEqual(JSON.parse(String(init.body)), {
        input_monitor_id: 16,
        input_limit: 250,
      });
      listCalls += 1;
      return Response.json([{ id: listCalls }]);
    }
    if (String(url).includes('/rest/v1/website_checks?id=in.(')) {
      return new Response(null, { status: 204 });
    }
    throw new Error('unexpected URL ' + url);
  };

  const result = await deleteSupabaseWebsiteMonitor(env, 16, fetcher);
  assert.deepEqual(result, { deleted: false, deleted_checks: 4 });
  assert.equal(listCalls, 4);
});

test('legacy schema falls back to index-aligned REST when cfm_website_checks times out', async () => {
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
    if (String(url).endsWith('/rpc/cfm_website_checks')) {
      return new Response(JSON.stringify({
        code: '57014',
        message: 'canceling statement due to statement timeout',
      }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
    if (String(url).includes('/rest/v1/website_checks?select=id&monitor_id=eq.16&order=checked_at.desc,id.desc&limit=250')) {
      assert.equal(init.method, 'GET');
      listCalls += 1;
      return Response.json(listCalls === 1 ? [{ id: 501 }, { id: 500 }] : []);
    }
    if (String(url).includes('/rest/v1/website_checks?id=in.(501,500)')) {
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
  assert.equal(listCalls, 2);
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
