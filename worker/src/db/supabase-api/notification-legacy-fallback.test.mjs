import assert from 'node:assert/strict';
import test from 'node:test';
import {
  claimSupabaseNotificationDelivery,
  completeSupabaseNotificationDelivery,
} from './client.ts';

const env = {
  SUPABASE_URL: 'https://synthetic.supabase.co',
  SUPABASE_SECRET_KEY: 'sb_secret_synthetic',
};

const missingRpc = (name) => new Response(JSON.stringify({
  code: 'PGRST202',
  message: 'Could not find the function public.' + name,
}), { status: 404, headers: { 'Content-Type': 'application/json' } });

test('legacy schema skips notification delivery lease instead of aborting scheduled checks', async () => {
  const claim = await claimSupabaseNotificationDelivery(
    env,
    'website:16',
    'down:16',
    '2026-11-22T10:00:00.000Z',
    0,
    async (url) => {
      assert.match(String(url), /\/rpc\/cfm_claim_notification_delivery$/);
      return missingRpc('cfm_claim_notification_delivery');
    },
  );
  assert.deepEqual(claim, { claimed: false, delivered: false, token: null });
});

test('legacy schema tolerates missing completion RPC', async () => {
  const ok = await completeSupabaseNotificationDelivery(
    env,
    'website:16',
    'down:16',
    'legacy-token',
    true,
    '2026-11-22T10:00:01.000Z',
    0,
    async (url) => {
      assert.match(String(url), /\/rpc\/cfm_complete_notification_delivery$/);
      return missingRpc('cfm_complete_notification_delivery');
    },
  );
  assert.equal(ok, true);
});
