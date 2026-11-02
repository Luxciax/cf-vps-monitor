import assert from 'node:assert/strict';
import test from 'node:test';
import { deleteSupabaseWebsiteMonitor } from './client.ts';

const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-key' };

test('deletes batches for the requested monitor and preserves other IDs', async () => {
  const originalFetch = globalThis.fetch;
  const remaining = new Map([[29, 2500], [30, 7]]);
  const requests = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(new URL(url).pathname, '/rest/v1/rpc/cfm_delete_website_monitor_batch');
    const { input_id: id } = JSON.parse(options.body);
    requests.push(id);
    const count = remaining.get(id);
    if (count === 0) {
      remaining.delete(id);
      return Response.json({ deleted: true, deleted_checks: 0 });
    }
    const removed = Math.min(count, 1000);
    remaining.set(id, count - removed);
    return Response.json({ deleted: false, deleted_checks: removed });
  };
  try {
    await deleteSupabaseWebsiteMonitor(env, 29);
    assert.deepEqual(requests, [29, 29, 29, 29]);
    assert.equal(remaining.has(29), false);
    assert.equal(remaining.get(30), 7);
  } finally { globalThis.fetch = originalFetch; }
});

for (const failure of ['network', 'rpc']) {
  test(`${failure} failure can be retried after a completed batch`, async () => {
    const originalFetch = globalThis.fetch;
    let remaining = 1200;
    let calls = 0;
    globalThis.fetch = async (_url, options) => {
      assert.equal(JSON.parse(options.body).input_id, 29);
      calls++;
      if (calls === 2) {
        if (failure === 'network') throw new Error('network failure');
        return new Response('temporary database failure', { status: 503 });
      }
      if (!remaining) return Response.json({ deleted: true, deleted_checks: 0 });
      const removed = Math.min(remaining, 1000);
      remaining -= removed;
      return Response.json({ deleted: false, deleted_checks: removed });
    };
    try {
      await assert.rejects(deleteSupabaseWebsiteMonitor(env, 29));
      assert.equal(remaining, 200);
      await deleteSupabaseWebsiteMonitor(env, 29);
      assert.equal(remaining, 0);
      assert.equal(calls, 4);
    } finally { globalThis.fetch = originalFetch; }
  });
}

test('stops on a response that makes no progress', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ deleted: false, deleted_checks: 0 });
  };
  try {
    await assert.rejects(deleteSupabaseWebsiteMonitor(env, 29), /no progress/i);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; }
});
