#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { basename } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';

function usage() {
  console.log(`CF VPS Monitor CLI

Environment:
  CFVM_URL      Panel base URL, for example https://monitor.example.com
  CFVM_TOKEN    ADMIN_API_TOKEN configured on the Worker

Discovery:
  discover
  openapi

System:
  health
  capacity
  logs
  update-check
  maintenance cleanup [json|@file]

Nodes:
  clients list
  clients get <uuid>
  clients add <name|json|@file>
  clients edit <uuid> <json|@file>
  clients remove <uuid>
  clients batch-remove <json|@file>
  clients rotate-token <uuid>
  clients token <uuid>

Ping:
  pings list
  pings add <json|@file>
  pings edit <id> <json|@file>
  pings remove <id>

Websites:
  websites list
  websites checks <id> [limit]
  websites add <json|@file>
  websites edit <id> <json|@file>
  websites remove <id>
  websites check <id>

Settings / assets:
  settings get [site|general|notification]
  settings set <json|@file>
  site-logo upload <file>
  site-logo reset

Notifications:
  notifications offline get
  notifications offline set <json|@file>
  notifications expiry get
  notifications expiry set <json|@file>
  notifications load list
  notifications load add <json|@file>
  notifications load edit <id> <json|@file>
  notifications load remove <id>
  notifications test <json|@file>

Themes:
  themes list
  themes upload <zip>
  themes activate <short>
  themes settings <json|@file>
  themes remove <short>

Records / backup:
  records clear <uuid>
  records clear-all
  backup export [output.json]
  backup restore <json|@file>

Generic:
  request <METHOD> <path> [json|@file]
  get <path>
  post <path> [json|@file]
  patch <path> [json|@file]
  put <path> [json|@file]
  delete <path> [json|@file]

Examples:
  npm run cfvm -- discover
  npm run cfvm -- clients remove node-uuid
  npm run cfvm -- pings remove 12
  npm run cfvm -- websites edit 5 @website.json
  npm run cfvm -- request POST /clients/batch-hide '{"uuids":["node-a"],"hidden":true}'
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
  if (url.username || url.password) throw new Error('CFVM_URL must not contain credentials');
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
  if (!clean) throw new Error('API path is required');
  if (/^https?:\/\//i.test(clean) || clean.startsWith('//')) {
    throw new Error('API path must be relative; full URLs are rejected to protect CFVM_TOKEN');
  }
  if (clean === '/api/v1') return clean;
  if (clean.startsWith('/api/v1/')) return clean;
  return '/api/v1/' + clean.replace(/^\/+/, '');
}

function jsonBody(value, { required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error('JSON body is required');
    return {};
  }
  let raw = String(value);
  if (raw.startsWith('@')) {
    const path = raw.slice(1);
    if (!path) throw new Error('JSON file path after @ is required');
    raw = readFileSync(path, 'utf8');
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('body must be valid JSON or @path-to-json-file');
  }
}

function positiveInteger(value, label) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`${label} must be a positive integer`);
  return id;
}

function contentTypeForFile(path) {
  const lower = path.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.zip')) return 'application/zip';
  return 'application/octet-stream';
}

function multipartFile(path) {
  const bytes = readFileSync(path);
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: contentTypeForFile(path) }), basename(path));
  return form;
}

async function request(path, method = 'GET', body, { print = true } = {}) {
  const normalizedMethod = String(method || 'GET').toUpperCase();
  const allowed = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']);
  if (!allowed.has(normalizedMethod)) throw new Error(`unsupported HTTP method: ${normalizedMethod}`);

  const controller = new AbortController();
  const configuredTimeout = Number(process.env.CFVM_TIMEOUT_MS || '');
  const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout >= 1_000 && configuredTimeout <= 300_000
    ? Math.trunc(configuredTimeout)
    : normalizedMethod === 'DELETE' ? 120_000 : 30_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = {
      Authorization: `Bearer ${token()}`,
      Accept: 'application/json',
    };
    let payload;
    if (body instanceof FormData) {
      payload = body;
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    const response = await fetch(baseUrl() + apiPath(path), {
      method: normalizedMethod,
      headers,
      body: ['GET', 'HEAD'].includes(normalizedMethod) ? undefined : payload,
      redirect: 'error',
      signal: controller.signal,
    });

    const text = await response.text();
    let result;
    try { result = text ? JSON.parse(text) : null; }
    catch { result = text; }

    if (!response.ok) {
      const detail = typeof result === 'string' ? result : JSON.stringify(result);
      throw new Error(`HTTP ${response.status}: ${detail}`);
    }

    if (print && result !== null) {
      console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
    }
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const [group, action, ...rest] = args;
  if (!group || group === '-h' || group === '--help' || group === 'help') {
    usage();
    return;
  }

  if (group === 'token' && action === 'generate') {
    console.log(randomBytes(32).toString('hex'));
    return;
  }

  if (group === 'discover') return request('/capabilities');
  if (group === 'openapi') return request('/openapi.json');
  if (group === 'health') return request('/health');
  if (group === 'capacity') return request('/capacity');
  if (group === 'logs') return request('/logs');
  if (group === 'update-check') return request('/update-check');

  if (group === 'maintenance' && action === 'cleanup') {
    return request('/maintenance/cleanup', 'POST', jsonBody(rest[0], { required: false }));
  }

  if (group === 'clients') {
    if (action === 'list') return request('/clients');
    if (action === 'get') {
      if (!rest[0]) throw new Error('client uuid is required');
      return request(`/clients/${encodeURIComponent(rest[0])}`);
    }
    if (action === 'add') {
      if (!rest[0]) throw new Error('client name or JSON body is required');
      const body = rest[0].startsWith('{') || rest[0].startsWith('@') ? jsonBody(rest[0]) : { name: rest[0] };
      return request('/clients', 'POST', body);
    }
    if (action === 'edit') {
      if (!rest[0]) throw new Error('client uuid is required');
      return request(`/clients/${encodeURIComponent(rest[0])}`, 'PATCH', jsonBody(rest[1]));
    }
    if (action === 'remove') {
      if (!rest[0]) throw new Error('client uuid is required');
      return request(`/clients/${encodeURIComponent(rest[0])}`, 'DELETE');
    }
    if (action === 'batch-remove') return request('/clients/batch-remove', 'POST', jsonBody(rest[0]));
    if (action === 'rotate-token') {
      if (!rest[0]) throw new Error('client uuid is required');
      return request(`/clients/${encodeURIComponent(rest[0])}/token/rotate`, 'POST', {});
    }
    if (action === 'token') {
      if (!rest[0]) throw new Error('client uuid is required');
      return request(`/clients/${encodeURIComponent(rest[0])}/token`, 'POST', {});
    }
  }

  if (group === 'pings') {
    if (action === 'list') return request('/pings');
    if (action === 'add') return request('/pings', 'POST', jsonBody(rest[0]));
    if (action === 'edit') {
      const id = positiveInteger(rest[0], 'ping id');
      return request(`/pings/${id}`, 'PATCH', jsonBody(rest[1]));
    }
    if (action === 'remove') {
      const id = positiveInteger(rest[0], 'ping id');
      return request(`/pings/${id}`, 'DELETE');
    }
  }

  if (group === 'websites') {
    if (action === 'list') return request('/websites');
    if (action === 'checks') {
      const id = positiveInteger(rest[0], 'website id');
      const limit = rest[1] === undefined ? '' : `?limit=${positiveInteger(rest[1], 'limit')}`;
      return request(`/websites/${id}/checks${limit}`);
    }
    if (action === 'add') return request('/websites', 'POST', jsonBody(rest[0]));
    if (action === 'edit') {
      const id = positiveInteger(rest[0], 'website id');
      return request(`/websites/${id}`, 'PATCH', jsonBody(rest[1]));
    }
    if (action === 'remove') {
      const id = positiveInteger(rest[0], 'website id');
      let deletedChecks = 0;
      for (let attempt = 1; attempt <= 64; attempt += 1) {
        const result = await request(`/websites/${id}`, 'DELETE', undefined, { print: false });
        deletedChecks += Number(result?.deleted_checks || 0);
        if (!result?.deletion_pending) {
          const output = {
            ...(result && typeof result === 'object' ? result : { success: true, id }),
            deleted_checks_total: deletedChecks,
            delete_attempts: attempt,
          };
          console.log(JSON.stringify(output, null, 2));
          return output;
        }
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      throw new Error('website deletion did not finish after 64 bounded attempts');
    }
    if (action === 'check') {
      const id = positiveInteger(rest[0], 'website id');
      return request(`/websites/${id}/check`, 'POST', {});
    }
  }

  if (group === 'settings') {
    if (action === 'get') {
      const scope = rest[0] ? `?scope=${encodeURIComponent(rest[0])}` : '';
      return request(`/settings${scope}`);
    }
    if (action === 'set') return request('/settings', 'POST', jsonBody(rest[0]));
  }

  if (group === 'site-logo') {
    if (action === 'upload') {
      if (!rest[0]) throw new Error('logo file path is required');
      return request('/site-logo', 'POST', multipartFile(rest[0]));
    }
    if (action === 'reset') return request('/site-logo/reset', 'POST', {});
  }

  if (group === 'notifications') {
    if (action === 'offline' && rest[0] === 'get') return request('/notification/offline');
    if (action === 'offline' && rest[0] === 'set') return request('/notification/offline/edit', 'POST', jsonBody(rest[1]));
    if (action === 'expiry' && rest[0] === 'get') return request('/notification/expiry');
    if (action === 'expiry' && rest[0] === 'set') return request('/notification/expiry/edit', 'POST', jsonBody(rest[1]));
    if (action === 'load' && rest[0] === 'list') return request('/notification/load');
    if (action === 'load' && rest[0] === 'add') return request('/notification/load/add', 'POST', jsonBody(rest[1]));
    if (action === 'load' && rest[0] === 'edit') {
      const id = positiveInteger(rest[1], 'load notification id');
      return request(`/notification/load/${id}`, 'POST', jsonBody(rest[2]));
    }
    if (action === 'load' && rest[0] === 'remove') {
      const id = positiveInteger(rest[1], 'load notification id');
      return request(`/notification/load/${id}`, 'DELETE');
    }
    if (action === 'test') return request('/test/sendMessage', 'POST', jsonBody(rest[0]));
  }

  if (group === 'themes') {
    if (action === 'list') return request('/themes');
    if (action === 'upload') {
      if (!rest[0]) throw new Error('theme zip path is required');
      return request('/themes/upload', 'POST', multipartFile(rest[0]));
    }
    if (action === 'activate') {
      if (!rest[0]) throw new Error('theme short id is required');
      return request('/themes/set', 'POST', { short: rest[0] });
    }
    if (action === 'settings') return request('/themes/settings', 'POST', jsonBody(rest[0]));
    if (action === 'remove') {
      if (!rest[0]) throw new Error('theme short id is required');
      return request(`/themes/${encodeURIComponent(rest[0])}`, 'DELETE');
    }
  }

  if (group === 'records') {
    if (action === 'clear') {
      if (!rest[0]) throw new Error('client uuid is required');
      return request('/record/clear', 'POST', { uuid: rest[0] });
    }
    if (action === 'clear-all') return request('/record/clear/all', 'POST', {});
  }

  if (group === 'backup') {
    if (action === 'export') {
      const result = await request('/download/backup', 'POST', {}, { print: !rest[0] });
      if (rest[0]) {
        writeFileSync(rest[0], JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
        console.log(`Backup written to ${rest[0]}`);
      }
      return;
    }
    if (action === 'restore') return request('/upload/backup', 'POST', jsonBody(rest[0]));
  }

  if (group === 'request') {
    if (!action || !rest[0]) throw new Error('usage: request <METHOD> <path> [json|@file]');
    return request(rest[0], action, ['GET', 'HEAD'].includes(action.toUpperCase()) ? undefined : jsonBody(rest[1], { required: false }));
  }

  const genericMethods = { get: 'GET', post: 'POST', patch: 'PATCH', put: 'PUT', delete: 'DELETE' };
  if (genericMethods[group]) {
    if (!action) throw new Error('path is required');
    const method = genericMethods[group];
    return request(action, method, ['GET'].includes(method) ? undefined : jsonBody(rest[0], { required: false }));
  }

  usage();
  throw new Error('unknown command');
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
