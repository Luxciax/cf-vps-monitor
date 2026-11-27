import { Hono } from 'hono';
import type { Bindings, Variables } from '../index';
import { callSupabaseRpc, type SupabaseApiEnv } from '../db/supabase-api/client';
import { ADMIN_API_SCOPES, machineTokenDigest, normalizeMachineScopes, type StoredMachineToken } from './admin-api-token';
import { readJsonWithLimit } from '../utils/request-body';

type TokenRecord = StoredMachineToken & { prefix: string; created_at: string; created_by: string; last_used_at: string | null };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function tokenOperation<T>(env: SupabaseApiEnv, operation: string, payload: Record<string, unknown>, actor = ''): Promise<T> {
  return callSupabaseRpc(env, 'cfm_machine_tokens', { input_operation: operation, input_payload: payload, input_actor: actor });
}

export function lookupMachineToken(env: SupabaseApiEnv, digest: string): Promise<StoredMachineToken | null> {
  return tokenOperation(env, 'authenticate', { token_hash: digest });
}

export const machineTokenAdminRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();
machineTokenAdminRoutes.onError((error,c) => {
  const message = error instanceof Error ? error.message : '';
  if (/54000|capacity reached/.test(message)) return c.json({code:'TOKEN_CAPACITY_REACHED',error:'Revoke unused tokens before creating more'},409);
  return c.json({code:/PGRST202|42P01/.test(message)?'TOKEN_MIGRATION_REQUIRED':'TOKEN_STORE_UNAVAILABLE',error:'Machine token storage is unavailable'},503);
});

machineTokenAdminRoutes.get('/', async c => {
  const tokens = await tokenOperation<TokenRecord[]>(c.env, 'list', {}, c.get('username'));
  return c.json({ tokens, scopes: ADMIN_API_SCOPES, legacy_env_token_configured: Boolean(c.env.ADMIN_API_TOKEN?.trim()) });
});

machineTokenAdminRoutes.post('/', async c => {
  const parsed = await readJsonWithLimit(c.req.raw, 8192);
  if (!parsed.ok) return c.json({ code: 'API_INVALID_REQUEST', error: parsed.reason }, parsed.reason === 'too_large' ? 413 : 400);
  if (!parsed.body || typeof parsed.body !== 'object' || Array.isArray(parsed.body)) return c.json({ code: 'API_INVALID_REQUEST', error: 'JSON object required' }, 400);
  const body = parsed.body as Record<string, unknown>;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const scopes = normalizeMachineScopes(body.scopes);
  if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name) || !scopes) return c.json({ code: 'API_INVALID_REQUEST', error: 'Name (1–80 characters) and explicit valid scopes are required' }, 400);
  const rawExpiry = body.expires_at === undefined ? new Date(Date.now() + 90 * 86_400_000).toISOString() : body.expires_at;
  const maxExpiry = new Date(); maxExpiry.setUTCFullYear(maxExpiry.getUTCFullYear() + 10);
  if (rawExpiry !== null && (typeof rawExpiry !== 'string' || !Number.isFinite(Date.parse(rawExpiry)) || Date.parse(rawExpiry) <= Date.now() || Date.parse(rawExpiry) > maxExpiry.getTime())) {
    return c.json({ code: 'API_INVALID_REQUEST', error: 'expires_at must be a future timestamp within 10 years, or null' }, 400);
  }
  const token = 'cvm_' + Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
  const record = await tokenOperation<TokenRecord>(c.env, 'create', {
    id: crypto.randomUUID(), name, token_hash: await machineTokenDigest(token), prefix: token.slice(0, 12), scopes,
    expires_at: rawExpiry === null ? null : new Date(rawExpiry as string).toISOString(),
  }, c.get('username'));
  c.header('Cache-Control', 'no-store');
  return c.json({ token, record }, 201);
});

machineTokenAdminRoutes.post('/:id/rotate', async c => {
  const id = c.req.param('id');
  if (!UUID_PATTERN.test(id)) return c.json({ code: 'API_INVALID_REQUEST', error: 'Invalid token ID' }, 400);
  const token = 'cvm_' + Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
  const record = await tokenOperation<TokenRecord | null>(c.env, 'rotate', { id, token_hash: await machineTokenDigest(token), prefix: token.slice(0,12) }, c.get('username'));
  if (!record) return c.json({ code: 'TOKEN_NOT_ACTIVE', error: 'Only active, unexpired tokens can be rotated' }, 409);
  c.header('Cache-Control', 'no-store');
  return c.json({ token, record });
});

machineTokenAdminRoutes.post('/:id/revoke', async c => {
  const id = c.req.param('id');
  if (!UUID_PATTERN.test(id)) return c.json({ code: 'API_INVALID_REQUEST', error: 'Invalid token ID' }, 400);
  await tokenOperation(c.env, 'revoke', { id }, c.get('username'));
  return c.json({ success: true });
});
