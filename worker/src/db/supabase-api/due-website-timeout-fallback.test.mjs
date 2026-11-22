import assert from 'node:assert/strict';
import test from 'node:test';
import { listSupabaseDueWebsiteMonitors } from './client.ts';

const env = {
  SUPABASE_URL: 'https://synthetic.supabase.co',
  SUPABASE_SECRET_KEY: 'sb_secret_synthetic',
};

function timeoutResponse() {
  return new Response(JSON.stringify({
    code: '57014',
    message: 'canceling statement due to statement timeout',
  }), { status: 500, headers: { 'Content-Type': 'application/json' } });
}

test('due website monitor RPC timeout falls back to direct table filtering', async () => {
  const calls = [];
  const rows = [
    {
      id: 1,
      config_revision: 'a',
      name: 'due',
      url: 'https://due.example',
      method: 'GET',
      expected_status_min: 200,
      expected_status_max: 399,
      interval_sec: 120,
      timeout_sec: 10,
      grace_period_sec: 60,
      enabled: true,
      hidden: false,
      hide_url: false,
      agent_probe_mode: 'off',
      agent_probe_clients: [],
      agent_probe_limit: 3,
      agent_probe_status_enabled: false,
      description: '',
      category: '',
      tags: [],
      icon: '',
      server_uuid: null,
      domain: 'due.example',
      deployment: '',
      repository_url: '',
      note: '',
      sort_order: 1,
      status: 'up',
      last_checked_at: '2026-11-22T00:00:00.000Z',
      last_success_at: null,
      last_failure_at: null,
      last_status_code: 200,
      last_raw_status_code: 200,
      last_latency_ms: 100,
      last_effective_reason: null,
      last_error: null,
      down_since: null,
      last_notified_at: null,
      created_at: '2026-11-01T00:00:00.000Z',
      updated_at: '2026-11-01T00:00:00.000Z',
    },
    {
      id: 2,
      config_revision: 'b',
      name: 'fresh',
      url: 'https://fresh.example',
      method: 'GET',
      expected_status_min: 200,
      expected_status_max: 399,
      interval_sec: 120,
      timeout_sec: 10,
      grace_period_sec: 60,
      enabled: true,
      hidden: false,
      hide_url: false,
      agent_probe_mode: 'off',
      agent_probe_clients: [],
      agent_probe_limit: 3,
      agent_probe_status_enabled: false,
      description: '',
      category: '',
      tags: [],
      icon: '',
      server_uuid: null,
      domain: 'fresh.example',
      deployment: '',
      repository_url: '',
      note: '',
      sort_order: 2,
      status: 'up',
      last_checked_at: '2026-11-22T00:01:50.000Z',
      last_success_at: null,
      last_failure_at: null,
      last_status_code: 200,
      last_raw_status_code: 200,
      last_latency_ms: 100,
      last_effective_reason: null,
      last_error: null,
      down_since: null,
      last_notified_at: null,
      created_at: '2026-11-01T00:00:00.000Z',
      updated_at: '2026-11-01T00:00:00.000Z',
    },
  ];

  const fetcher = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/rpc/cfm_due_website_monitors')) return timeoutResponse();
    assert.match(String(url), /\/rest\/v1\/website_monitors\?select=\*&enabled=eq\.true/);
    assert.equal(init.method, 'GET');
    return Response.json(rows);
  };

  const result = await listSupabaseDueWebsiteMonitors(
    env,
    '2026-11-22T00:02:00.000Z',
    50,
    fetcher,
  );

  assert.deepEqual(result.map(row => row.id), [1]);
  assert.equal(calls.length, 2);
});

test('non-timeout due monitor RPC errors do not fall back', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return new Response('database unavailable', { status: 503 });
  };

  await assert.rejects(
    () => listSupabaseDueWebsiteMonitors(
      env,
      '2026-11-22T00:02:00.000Z',
      50,
      fetcher,
    ),
    /503/,
  );
  assert.equal(calls, 1);
});
