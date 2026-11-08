#!/usr/bin/env node
import { randomBytes } from 'node:crypto';

function usage() {
  console.log(`CF VPS Monitor CLI

Environment:
  CFVM_URL      Panel base URL, for example https://monitor.example.com
  CFVM_TOKEN    ADMIN_API_TOKEN configured on the Worker

Commands:
  token generate
  health
  capacity
  clients list
  clients get <uuid>
  clients add [name]
  clients remove <uuid>
  clients rotate-token <uuid>
  websites list
  websites check <id>
  ping list
  settings get
  get <path>
  post <path> [json]
`);
}

function baseUrl() {
  const raw = String(process.env.CFVM_URL || '').trim().replace(/\/+$/, '');
  if (!raw) throw new Error('CFVM_URL is required');
  const url = new URL(raw);
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('CFVM_URL must use HTTPS (HTTP is allowed only for localhost)');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function token() {
  const value = String(process.env.CFVM_TOKEN || '').trim();
  if (!value) throw new Error('CFVM_TOKEN is required');
  return value;
}

function apiPath(path) {
  const clean = String(path || '').trim();
  if (!clean) return '/api/v1';
  if (clean.startsWith('/api/v1/')) return clean;
  return '/api/v1/' + clean.replace(/^\/+/, '');
}

async function request(path, method = 'GET', body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(baseUrl() + apiPath(path), {
      method,
      headers: {
        Authorization: `Bearer ${token()}`,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error',
      signal: controller.signal,
    });
    const text = await response.text();
    let payload;
    try { payload = text ? JSON.parse(text) : null; }
    catch { payload = text; }

    if (!response.ok) {
      const detail = typeof payload === 'string' ? payload : JSON.stringify(payload);
      throw new Error(`HTTP ${response.status}: ${detail}`);
    }
    if (payload !== null) console.log(typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2));
  } finally {
    clearTimeout(timeout);
  }
}

function positiveInteger(value, label) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`${label} must be a positive integer`);
  return id;
}

async function main() {
  const [group, action, ...rest] = process.argv.slice(2);
  if (!group || group === '-h' || group === '--help' || group === 'help') {
    usage();
    return;
  }

  if (group === 'token' && action === 'generate') {
    console.log(randomBytes(32).toString('hex'));
    return;
  }

  if (group === 'health') return request('/health');
  if (group === 'capacity') return request('/capacity');

  if (group === 'clients') {
    if (action === 'list') return request('/clients');
    if (action === 'get') {
      if (!rest[0]) throw new Error('client uuid is required');
      return request(`/clients/${encodeURIComponent(rest[0])}`);
    }
    if (action === 'add') return request('/clients/add', 'POST', rest[0] ? { name: rest[0] } : {});
    if (action === 'remove') {
      if (!rest[0]) throw new Error('client uuid is required');
      return request(`/clients/${encodeURIComponent(rest[0])}/remove`, 'POST', {});
    }
    if (action === 'rotate-token') {
      if (!rest[0]) throw new Error('client uuid is required');
      return request(`/clients/${encodeURIComponent(rest[0])}/token/rotate`, 'POST', {});
    }
  }

  if (group === 'websites') {
    if (action === 'list') return request('/websites');
    if (action === 'check') return request(`/websites/${positiveInteger(rest[0], 'website id')}/check`, 'POST', {});
  }

  if (group === 'ping' && action === 'list') return request('/ping');
  if (group === 'settings' && action === 'get') return request('/settings');

  if (group === 'get') {
    if (!action) throw new Error('path is required');
    return request(action);
  }
  if (group === 'post') {
    if (!action) throw new Error('path is required');
    let body = {};
    if (rest[0]) {
      try { body = JSON.parse(rest[0]); }
      catch { throw new Error('post body must be valid JSON'); }
    }
    return request(action, 'POST', body);
  }

  usage();
  throw new Error('unknown command');
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
