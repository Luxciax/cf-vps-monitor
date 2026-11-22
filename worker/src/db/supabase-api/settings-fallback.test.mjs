import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getSupabaseSettingsByKeys,
  setSupabaseSettings,
} from './client.ts';

const env = {
  SUPABASE_URL: 'https://synthetic.supabase.co',
  SUPABASE_SECRET_KEY: 'sb_secret_synthetic',
};

test('settings reader falls back to direct table access only when RPC is missing', async () => {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/rpc/cfm_settings_by_keys')) {
      return new Response(JSON.stringify({
        code: 'PGRST202',
        message: 'Could not find the function public.cfm_settings_by_keys(input_keys) in the schema cache',
      }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    assert.match(String(url), /\/rest\/v1\/settings\?select=key,value$/);
    assert.equal(init.method, 'GET');
    return Response.json([
      { key: 'record_enabled', value: 'true' },
      { key: 'unrelated_secret', value: 'must-not-leak' },
    ]);
  };

  const result = await getSupabaseSettingsByKeys(env, ['record_enabled', 'missing'], fetcher);
  assert.deepEqual(result, { record_enabled: 'true' });
  assert.equal(calls.length, 2);
});

test('settings writer falls back to table upsert when cfm_set_settings is missing', async () => {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/rpc/cfm_set_settings')) {
      return new Response(JSON.stringify({
        code: 'PGRST202',
        message: 'Could not find the function public.cfm_set_settings(input_settings) in the schema cache',
      }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    assert.match(String(url), /\/rest\/v1\/settings\?on_conflict=key$/);
    assert.equal(init.method, 'POST');
    assert.equal(new Headers(init.headers).get('Prefer'), 'resolution=merge-duplicates,return=minimal');
    assert.deepEqual(JSON.parse(String(init.body)), [
      { key: 'scheduled_cursors', value: '{"websites":"9"}' },
    ]);
    return new Response(null, { status: 204 });
  };

  await setSupabaseSettings(env, { scheduled_cursors: '{"websites":"9"}' }, fetcher);
  assert.equal(calls.length, 2);
});

test('non-missing RPC errors do not silently fall back to table access', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return new Response('database unavailable', { status: 503 });
  };

  await assert.rejects(
    () => getSupabaseSettingsByKeys(env, ['record_enabled'], fetcher),
    /503/,
  );
  assert.equal(calls, 1);
});

test('empty settings operations do not perform network calls', async () => {
  const fetcher = async () => {
    throw new Error('network call should not happen');
  };
  assert.deepEqual(await getSupabaseSettingsByKeys(env, [], fetcher), {});
  await setSupabaseSettings(env, {}, fetcher);
});
