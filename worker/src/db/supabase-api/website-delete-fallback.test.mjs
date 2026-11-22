import assert from 'node:assert/strict';
import test from 'node:test';
import { deleteSupabaseWebsiteMonitor } from './client.ts';

const env = {
  SUPABASE_URL: 'https://synthetic.supabase.co',
  SUPABASE_SECRET_KEY: 'sb_secret_synthetic',
};

test('website delete falls back to legacy RPC when batch delete RPC is missing', async () => {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/rpc/cfm_delete_website_monitor_batch')) {
      return new Response(JSON.stringify({
        code: 'PGRST202',
        message: 'Could not find the function public.cfm_delete_website_monitor_batch(input_id)',
      }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    assert.match(String(url), /\/rpc\/cfm_delete_website_monitor$/);
    assert.deepEqual(JSON.parse(String(init.body)), { input_id: 16 });
    return new Response(null, { status: 204 });
  };

  await deleteSupabaseWebsiteMonitor(env, 16, fetcher);
  assert.equal(calls.length, 2);
});

test('website delete falls back to bounded table batches when legacy RPC times out', async () => {
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
    if (String(url).endsWith('/rpc/cfm_delete_website_monitor')) {
      return new Response(JSON.stringify({
        code: '57014',
        message: 'canceling statement due to statement timeout',
      }), { status: 500, headers: { 'Content-Type': 'application/json' } });
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
    if (String(url).includes('/rest/v1/website_monitors?id=eq.16')) {
      assert.equal(init.method, 'DELETE');
      return new Response(null, { status: 204 });
    }
    throw new Error('unexpected URL ' + url);
  };

  await deleteSupabaseWebsiteMonitor(env, 16, fetcher);
  assert.equal(calls.length, 6);
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
