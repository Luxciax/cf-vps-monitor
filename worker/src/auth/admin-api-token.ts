export const ADMIN_API_SCOPES = [
  'read', 'write', 'backup', 'restore',
  'assets:read', 'assets:write', 'discovery:read', 'discovery:write',
  'config:read', 'config:write', 'knowledge:read', 'knowledge:write',
  'changes:read', 'changes:write', 'baselines:read', 'baselines:write',
  'monitors:read', 'monitors:write', 'settings:read', 'settings:write', 'audit:read',
] as const;
export type AdminApiScope = typeof ADMIN_API_SCOPES[number];

type AdminApiEnv = { ADMIN_API_TOKEN?: string; ADMIN_API_TOKEN_SCOPES?: string };
export type StoredMachineToken = {
  id: string;
  name: string;
  scopes: AdminApiScope[];
  expires_at: string | null;
  revoked_at: string | null;
};
type AdminApiAuthInput = {
  authorization?: string;
  method: string;
  pathname: string;
  env: AdminApiEnv;
  lookupToken?: (digest: string) => Promise<StoredMachineToken | null>;
};
export type AdminApiAuthResult =
  | { ok: true; principal: string; scopes: AdminApiScope[]; requiredScope: AdminApiScope; tokenId?: string }
  | { ok: false; reason: 'not_configured' | 'misconfigured' | 'missing' | 'invalid' | 'forbidden' | 'insufficient_scope'; requiredScope?: AdminApiScope };

const VALID_SCOPES = new Set<string>(ADMIN_API_SCOPES);

export async function machineTokenDigest(value: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
}

export function constantTimeStringEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export function normalizeMachineScopes(value: unknown): AdminApiScope[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > ADMIN_API_SCOPES.length) return null;
  if (value.some(scope => typeof scope !== 'string' || !VALID_SCOPES.has(scope))) return null;
  return [...new Set(value)] as AdminApiScope[];
}

function configuredScopes(raw?: string): AdminApiScope[] | null {
  const value = String(raw || '').trim();
  if (!value) return ['read'];
  if (value === '*') return [...ADMIN_API_SCOPES];
  return normalizeMachineScopes(value.split(',').map(scope => scope.trim().toLowerCase()).filter(Boolean));
}

function relativeApiPath(pathname: string): string {
  return pathname.startsWith('/api/v1') ? pathname.slice('/api/v1'.length) || '/' : pathname;
}

export function requiredAdminApiScope(method: string, pathname: string): AdminApiScope | 'forbidden' {
  const path = relativeApiPath(pathname);
  if (/^\/(account|machine-tokens)(\/|$)/.test(path)) return 'forbidden';
  if (path === '/download/backup') return 'backup';
  if (path === '/upload/backup') return 'restore';
  if (path === '/themes/preview' && method.toUpperCase() === 'POST') return 'settings:read';
  const access = ['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase()) ? 'read' : 'write';
  if (access === 'read' && /^\/assets\/[^/]+\/monitors$/.test(path)) return 'monitors:read';
  const family = path.split('/')[1];
  const groups: Record<string, string> = {
    assets: 'assets', relationships: 'assets', infrastructure: 'assets', relations: 'assets', topology: 'assets', search: 'assets',
    discovery: 'discovery', snapshots: 'config', configuration: 'config',
    documents: 'knowledge', knowledge: 'knowledge', changes: 'changes',
    operations: 'changes', baselines: 'baselines',
  };
  return groups[family] ? `${groups[family]}:${access}` as AdminApiScope : access;
}

export function hasMachineScope(scopes: AdminApiScope[], required: AdminApiScope, pathname = ''): boolean {
  if (scopes.includes(required)) return true;
  if (required.endsWith(':read') && scopes.includes('read')) return true;
  if (required.endsWith(':write') && scopes.includes('write')) return true;
  const path = relativeApiPath(pathname);
  if (['/', '/capabilities', '/openapi.json', '/identity'].includes(path) && required === 'read') return scopes.length > 0;
  if (required === 'read' || required === 'write') {
    const group = /^\/(clients|pings?|websites|notification|record)(\/|$)/.test(path) ? 'monitors'
      : /^\/(settings|themes|site-logo)(\/|$)/.test(path) ? 'settings'
      : path === '/logs' ? 'audit' : null;
    if (group && scopes.includes(`${group}:${required}` as AdminApiScope)) return true;
  }
  return false;
}

export async function authorizeAdminApiRequest(input: AdminApiAuthInput): Promise<AdminApiAuthResult> {
  const expected = String(input.env.ADMIN_API_TOKEN || '').trim();
  if (!expected && !input.lookupToken) return { ok: false, reason: 'not_configured' };
  const provided = /^Bearer[ \t]+([^\s]+)$/i.exec(String(input.authorization || '').trim())?.[1] || '';
  if (!provided) return { ok: false, reason: 'missing' };
  const bytes = new TextEncoder().encode(provided).byteLength;
  if (bytes < 32 || bytes > 1024) return { ok: false, reason: 'invalid' };
  const digest = await machineTokenDigest(provided);
  let principal: string;
  let scopes: AdminApiScope[] | null;
  let tokenId: string | undefined;
  const expectedBytes = new TextEncoder().encode(expected).byteLength;
  const legacyMatches = expectedBytes >= 32 && expectedBytes <= 1024 && constantTimeStringEqual(await machineTokenDigest(expected), digest);
  if (provided.startsWith('cvm_') && input.lookupToken && !legacyMatches) {
    if (!/^cvm_[a-f0-9]{64}$/.test(provided)) return { ok: false, reason: 'invalid' };
    const stored = await input.lookupToken(digest);
    if (!stored || stored.revoked_at || (stored.expires_at !== null && (!Number.isFinite(Date.parse(stored.expires_at)) || Date.parse(stored.expires_at) <= Date.now()))) {
      return { ok: false, reason: 'invalid' };
    }
    tokenId = stored.id;
    principal = `machine:${stored.id}`;
    scopes = normalizeMachineScopes(stored.scopes);
  } else {
    if (!expected) return { ok: false, reason: 'invalid' };
    if (expectedBytes < 32 || expectedBytes > 1024) return { ok: false, reason: 'misconfigured' };
    if (!legacyMatches) return { ok: false, reason: 'invalid' };
    principal = `api:${digest.slice(0, 12)}`;
    scopes = configuredScopes(input.env.ADMIN_API_TOKEN_SCOPES);
  }
  if (!scopes) return { ok: false, reason: 'misconfigured' };
  const requiredScope = requiredAdminApiScope(input.method, input.pathname);
  if (requiredScope === 'forbidden') return { ok: false, reason: 'forbidden' };
  if (!hasMachineScope(scopes, requiredScope, input.pathname)) return { ok: false, reason: 'insufficient_scope', requiredScope };
  return { ok: true, principal, scopes, requiredScope, ...(tokenId ? { tokenId } : {}) };
}
