import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cleanupSupabaseNotificationDeliveryState,
  trySupabaseClaimAuditThrottle,
} from './client.ts';

const env = {
  SUPABASE_URL: 'https://synthetic.supabase.co',
  SUPABASE_SECRET_KEY: 'sb_secret_synthetic',
};

function missingRpc(functionName) {
  return new Response(JSON.stringify({
    code: 'PGRST202',
    message: 'Could not find the function public.' + functionName,
  }), { status: 404, headers: { 'Content-Type': 'application/json' } });
}

test('legacy schema skips optional notification delivery cleanup RPC when missing', async () => {
  const fetcher = async (url) => {
    assert.match(String(url), /\/rpc\/cfm_cleanup_notification_delivery_state$/);
    return missingRpc('cfm_cleanup_notification_delivery_state');
  };

  const result = await cleanupSupabaseNotificationDeliveryState(
    env,
    '2026-11-22T00:00:00.000Z',
    { batchSize: 1000, maxBatches: 1 },
    fetcher,
  );
  assert.deepEqual(result, { notification_delivery_state: 0, has_more: false });
});

test('legacy schema allows audit logging to continue when throttle RPC is missing', async () => {
  const fetcher = async (url) => {
    assert.match(String(url), /\/rpc\/cfm_try_claim_audit_throttle$/);
    return missingRpc('cfm_try_claim_audit_throttle');
  };

  const claimed = await trySupabaseClaimAuditThrottle(
    env,
    'cron_cleanup',
    '2026-11-22T00:00:00.000Z',
    60000,
    fetcher,
  );
  assert.equal(claimed, true);
});

test('optional legacy fallbacks do not hide non-missing database failures', async () => {
  const fetcher = async () => new Response('database unavailable', { status: 503 });

  await assert.rejects(
    () => cleanupSupabaseNotificationDeliveryState(
      env,
      '2026-11-22T00:00:00.000Z',
      {},
      fetcher,
    ),
    /503/,
  );

  await assert.rejects(
    () => trySupabaseClaimAuditThrottle(
      env,
      'cron_cleanup',
      '2026-11-22T00:00:00.000Z',
      60000,
      fetcher,
    ),
    /503/,
  );
});
