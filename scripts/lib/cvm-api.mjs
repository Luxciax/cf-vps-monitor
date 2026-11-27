export function apiTarget(base, path) {
  const url = new URL(base);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error('CFVM_URL must use HTTPS (localhost HTTP is allowed)');
  if (url.username || url.password || url.search || url.hash) throw new Error('CFVM_URL must not contain credentials, query or fragment');
  if (url.pathname !== '/') throw new Error('CFVM_URL must be an origin without a path');
  const normalized = path.startsWith('/api/v1/') ? path : '/api/v1/' + path.replace(/^\/+/, '');
  const target = new URL(normalized, url.origin);
  if (target.origin !== url.origin || !target.pathname.startsWith('/api/v1/') || target.hash || /%(?:2f|5c|2e)/i.test(target.pathname) || target.pathname.includes('\\')) throw new Error('Only normalized /api/v1 paths are allowed');
  return target;
}

export async function cvmRequest(path, { method = 'GET', body, env = process.env, fetcher = fetch, signal } = {}) {
  const token = String(env.CFVM_TOKEN || '').trim();
  if (!token || /\s/.test(token)) throw new Error('CFVM_TOKEN is required and must not contain whitespace');
  const target = apiTarget(String(env.CFVM_URL || '').trim(), path);
  const timeout = AbortSignal.timeout(30_000);
  const response = await fetcher(target, {
    method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: signal ? AbortSignal.any([signal,timeout]) : timeout,
  });
  const reader = response.body?.getReader();
  let size = 0;
  const chunks = [];
  if (reader) {
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 1_048_576) { await reader.cancel(); throw new Error('CVM response exceeds 1 MiB; use fields, limit, offset or a narrower time range'); }
        chunks.push(part.value);
      }
    } finally { reader.releaseLock(); }
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  let value;
  try { value = raw ? JSON.parse(raw) : null; } catch { throw new Error(`CVM returned non-JSON HTTP ${response.status}`); }
  if (!response.ok) throw new Error(`CVM HTTP ${response.status}: ${value?.code || 'API_ERROR'} ${String(value?.error || '').slice(0,300)}`);
  return value;
}
