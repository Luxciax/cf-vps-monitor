export type AdminApiScope = 'read' | 'write' | 'backup' | 'restore';

type AdminApiEnv = {
  ADMIN_API_TOKEN?: string;
  ADMIN_API_TOKEN_SCOPES?: string;
};

type AdminApiAuthInput = {
  authorization?: string;
  method: string;
  pathname: string;
  env: AdminApiEnv;
};

export type AdminApiAuthResult =
  | {
      ok: true;
      principal: string;
      scopes: AdminApiScope[];
      requiredScope: AdminApiScope;
    }
  | {
      ok: false;
      reason: 'not_configured' | 'misconfigured' | 'missing' | 'invalid' | 'forbidden' | 'insufficient_scope';
      requiredScope?: AdminApiScope;
    };

const MIN_ADMIN_API_TOKEN_BYTES = 32;
const MAX_ADMIN_API_TOKEN_BYTES = 1024;
const VALID_SCOPES = new Set<AdminApiScope>(['read', 'write', 'backup', 'restore']);

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

async function sha256(value: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return new Uint8Array(digest);
}

function constantTimeBytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.byteLength ^ b.byteLength;
  const length = Math.max(a.byteLength, b.byteLength);
  for (let i = 0; i < length; i += 1) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

function readBearerToken(value: string | undefined): string {
  const match = /^Bearer[ \t]+([^\s]+)$/i.exec(String(value || '').trim());
  return match?.[1] || '';
}

function configuredScopes(raw: string | undefined): { ok: true; scopes: AdminApiScope[] } | { ok: false } {
  const normalized = String(raw || '').trim();
  if (!normalized) return { ok: true, scopes: ['read'] };

  const requested = normalized
    .split(',')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);

  if (requested.length === 1 && requested[0] === '*') {
    return { ok: true, scopes: ['read', 'write', 'backup', 'restore'] };
  }
  if (requested.length === 0 || requested.includes('*')) return { ok: false };

  const scopes: AdminApiScope[] = [];
  for (const scope of requested) {
    if (!VALID_SCOPES.has(scope as AdminApiScope)) return { ok: false };
    if (!scopes.includes(scope as AdminApiScope)) scopes.push(scope as AdminApiScope);
  }
  return scopes.length > 0 ? { ok: true, scopes } : { ok: false };
}

function relativeApiPath(pathname: string): string {
  const prefix = '/api/v1';
  return pathname.startsWith(prefix) ? pathname.slice(prefix.length) || '/' : pathname;
}

function requiredScope(method: string, pathname: string): AdminApiScope | 'forbidden' {
  const path = relativeApiPath(pathname);

  if (path === '/account' || path.startsWith('/account/')) return 'forbidden';
  if (path === '/download/backup') return 'backup';
  if (path === '/upload/backup') return 'restore';

  return ['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase()) ? 'read' : 'write';
}

function fingerprint(digest: Uint8Array): string {
  return Array.from(digest.slice(0, 6), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function authorizeAdminApiRequest(input: AdminApiAuthInput): Promise<AdminApiAuthResult> {
  const expected = String(input.env.ADMIN_API_TOKEN || '').trim();
  if (!expected) return { ok: false, reason: 'not_configured' };

  const expectedBytes = byteLength(expected);
  if (expectedBytes < MIN_ADMIN_API_TOKEN_BYTES || expectedBytes > MAX_ADMIN_API_TOKEN_BYTES) {
    return { ok: false, reason: 'misconfigured' };
  }

  const provided = readBearerToken(input.authorization);
  if (!provided) return { ok: false, reason: 'missing' };

  const providedBytes = byteLength(provided);
  if (providedBytes < MIN_ADMIN_API_TOKEN_BYTES || providedBytes > MAX_ADMIN_API_TOKEN_BYTES) {
    return { ok: false, reason: 'invalid' };
  }

  const [expectedDigest, providedDigest] = await Promise.all([sha256(expected), sha256(provided)]);
  if (!constantTimeBytesEqual(expectedDigest, providedDigest)) {
    return { ok: false, reason: 'invalid' };
  }

  const required = requiredScope(input.method, input.pathname);
  if (required === 'forbidden') {
    return { ok: false, reason: 'forbidden' };
  }

  const configured = configuredScopes(input.env.ADMIN_API_TOKEN_SCOPES);
  if (!configured.ok) return { ok: false, reason: 'misconfigured' };
  if (!configured.scopes.includes(required)) {
    return { ok: false, reason: 'insufficient_scope', requiredScope: required };
  }

  return {
    ok: true,
    principal: `api:${fingerprint(expectedDigest)}`,
    scopes: configured.scopes,
    requiredScope: required,
  };
}
