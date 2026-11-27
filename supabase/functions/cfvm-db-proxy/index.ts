import { ALLOWED_RPC_FUNCTIONS } from './allowed-rpc.ts';

const ALLOWED_TABLES = new Set(['settings', 'website_monitors', 'website_checks']);
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PATCH', 'DELETE']);
const ALLOWED_PREFER = new Set(['', 'return=minimal', 'resolution=merge-duplicates,return=minimal']);
// Preserve the existing 5 MiB configuration-restore envelope plus RPC framing.
const MAX_REQUEST_BYTES = 6 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
type Environment = { get(name: string): string | undefined };

function constantTimeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function boundedBytes(stream: ReadableStream<Uint8Array> | null, max: number): Promise<Uint8Array> {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > max) { await reader.cancel(); throw new RangeError('Payload too large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

function serverKey(env: Environment): string {
  const modern = env.get('SUPABASE_SECRET_KEYS');
  if (modern) {
    try {
      const parsed = JSON.parse(modern);
      if (typeof parsed?.default === 'string' && parsed.default.trim()) return parsed.default.trim();
    } catch { /* Supabase legacy projects provide the service-role key below. */ }
  }
  return (env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim();
}

export function createProxyHandler(env: Environment, fetcher: typeof fetch = fetch) {
  return async (req: Request): Promise<Response> => {
    const reply = (message: string, status: number) => new Response(message, { status, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain', 'X-Content-Type-Options': 'nosniff' } });
    if (req.method !== 'POST') return reply('method not allowed', 405);
    const expected = (env.get('CFVM_PROXY_TOKEN_SHA256') || '').trim();
    if (!/^[a-f0-9]{64}$/.test(expected)) return reply('proxy authentication not configured', 503);
    const provided = req.headers.get('x-cfvm-proxy-token') || '';
    if (provided.length < 32 || provided.length > 256) return reply('forbidden', 403);
    const digest = await sha256Hex(provided);
    const previous = (env.get('CFVM_PROXY_PREVIOUS_TOKEN_SHA256') || '').trim();
    const previousUntil = Date.parse(env.get('CFVM_PROXY_PREVIOUS_TOKEN_EXPIRES_AT') || '');
    const previousActive = /^[a-f0-9]{64}$/.test(previous) && Number.isFinite(previousUntil) && previousUntil > Date.now() && previousUntil <= Date.now() + 7 * 86400_000;
    if (!constantTimeEqual(digest, expected) && !(previousActive && constantTimeEqual(digest, previous))) return reply('forbidden', 403);
    if (Number(req.headers.get('content-length')) > MAX_REQUEST_BYTES) return reply('payload too large', 413);
    let payload: Record<string, unknown>;
    try {
      const value = JSON.parse(new TextDecoder().decode(await boundedBytes(req.body, MAX_REQUEST_BYTES)));
      if (!value || typeof value !== 'object' || Array.isArray(value)) return reply('JSON object required', 400);
      payload = value;
    } catch (error) { return reply(error instanceof RangeError ? 'payload too large' : 'invalid json', error instanceof RangeError ? 413 : 400); }
    const key = serverKey(env);
    const base = (env.get('SUPABASE_URL') || '').replace(/\/+$/, '');
    if (!key || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(base)) return reply('supabase runtime credentials unavailable', 503);
    let target: string;
    let method = 'POST';
    let body: string | undefined;
    let prefer = '';
    if (payload.kind === 'rpc') {
      const name = typeof payload.functionName === 'string' ? payload.functionName : '';
      if (!ALLOWED_RPC_FUNCTIONS.has(name)) return reply('rpc forbidden', 403);
      if (payload.body !== undefined && (!payload.body || typeof payload.body !== 'object' || Array.isArray(payload.body))) return reply('invalid rpc body', 400);
      target = `${base}/rest/v1/rpc/${name}`;
      body = JSON.stringify(payload.body || {});
    } else if (payload.kind === 'table') {
      const path = typeof payload.path === 'string' ? payload.path : '';
      if (!path || /[#\\\x00-\x20]/.test(path) || path.includes('..')) return reply('table path forbidden', 403);
      const i = path.indexOf('?');
      const table = i < 0 ? path : path.slice(0, i);
      if (!ALLOWED_TABLES.has(table)) return reply('table forbidden', 403);
      method = String(payload.method || 'GET').toUpperCase();
      if (!ALLOWED_METHODS.has(method)) return reply('method forbidden', 405);
      const incoming = payload.headers && typeof payload.headers === 'object' ? payload.headers as Record<string, unknown> : {};
      prefer = String(incoming.prefer || incoming.Prefer || '');
      if (!ALLOWED_PREFER.has(prefer)) return reply('prefer forbidden', 403);
      const url = new URL(`${base}/rest/v1/${table}`);
      if (i >= 0) url.search = path.slice(i + 1);
      target = url.toString();
      if (typeof payload.body === 'string') body = payload.body;
    } else return reply('operation forbidden', 403);
    const headers = new Headers({ apikey: key, 'Content-Type': 'application/json', Accept: 'application/json' });
    if (!key.startsWith('sb_secret_')) headers.set('Authorization', `Bearer ${key}`);
    if (prefer) headers.set('Prefer', prefer);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);
    try {
      const upstream = await fetcher(target, { method, headers, redirect: 'error', signal: controller.signal, ...(!body || method === 'GET' || method === 'DELETE' ? {} : { body }) });
      const responseHeaders = new Headers({ 'Cache-Control': 'no-store', 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' });
      const range = upstream.headers.get('content-range');
      if (range) responseHeaders.set('Content-Range', range);
      if (upstream.status === 204) return new Response(null, { status: 204, headers: responseHeaders });
      const data = await boundedBytes(upstream.body, MAX_RESPONSE_BYTES);
      return new Response(data, { status: upstream.status, headers: responseHeaders });
    } catch { return reply('database proxy request failed', 502); }
    finally { clearTimeout(timeout); }
  };
}

if (typeof Deno !== 'undefined') Deno.serve(createProxyHandler(Deno.env));
