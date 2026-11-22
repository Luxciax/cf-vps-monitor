import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { MACHINE_API_ENDPOINTS, buildMachineOpenApiDocument } from './machine-api.ts';

function routeKey(method, path) {
  return method.toUpperCase() + ' ' + path;
}

function routeDeclarations(source, routerName, prefix = '') {
  const re = new RegExp(routerName + '\\.(get|post|put|patch|delete)\\(\\s*[\'\"`]([^\'\"`]+)[\'\"`]', 'g');
  const routes = [];
  let match;
  while ((match = re.exec(source))) {
    const method = match[1].toUpperCase();
    const raw = match[2];
    const path = prefix + (raw === '/' ? '' : raw);
    routes.push({ method, path: path || '/' });
  }
  return routes;
}

test('machine API endpoint manifest has unique method/path pairs and valid scopes', () => {
  const keys = new Set();
  const validScopes = new Set(['read', 'write', 'backup', 'restore']);
  for (const endpoint of MACHINE_API_ENDPOINTS) {
    assert.ok(validScopes.has(endpoint.scope), 'invalid scope for ' + endpoint.method + ' ' + endpoint.path);
    const key = routeKey(endpoint.method, endpoint.path);
    assert.equal(keys.has(key), false, 'duplicate machine API endpoint: ' + key);
    keys.add(key);
  }
});

test('every non-account admin route is represented in the machine API manifest', () => {
  const adminSource = readFileSync(new URL('./admin.ts', import.meta.url), 'utf8');
  const themeSource = readFileSync(new URL('./theme.ts', import.meta.url), 'utf8');
  const manifest = new Set(MACHINE_API_ENDPOINTS.map(item => routeKey(item.method, item.path)));

  const adminRoutes = routeDeclarations(adminSource, 'adminRoutes')
    .filter(item => !item.path.startsWith('/account'));
  const themeRoutes = routeDeclarations(themeSource, 'adminThemeRoutes', '/themes');

  const missing = [...adminRoutes, ...themeRoutes]
    .filter(item => !manifest.has(routeKey(item.method, item.path)))
    .map(item => routeKey(item.method, item.path));

  assert.deepEqual(missing, [], 'routes missing from machine API manifest: ' + missing.join(', '));
});

test('human account and MFA endpoints are intentionally absent from machine API manifest', () => {
  for (const endpoint of MACHINE_API_ENDPOINTS) {
    assert.equal(endpoint.path === '/account' || endpoint.path.startsWith('/account/'), false);
  }
});

test('canonical CRUD routes exist for nodes, ping tasks and website monitors', () => {
  const canonical = new Set(
    MACHINE_API_ENDPOINTS
      .filter(item => item.canonical)
      .map(item => routeKey(item.method, item.path)),
  );

  for (const required of [
    'GET /clients',
    'POST /clients',
    'PATCH /clients/:uuid',
    'DELETE /clients/:uuid',
    'GET /pings',
    'POST /pings',
    'PATCH /pings/:id',
    'DELETE /pings/:id',
    'GET /websites',
    'POST /websites',
    'PATCH /websites/:id',
    'DELETE /websites/:id',
    'DELETE /themes/:short',
  ]) {
    assert.ok(canonical.has(required), 'missing canonical route ' + required);
  }
});

test('OpenAPI output mirrors the manifest and advertises bearer auth + scopes', () => {
  const doc = buildMachineOpenApiDocument();
  assert.equal(doc.openapi, '3.1.0');
  assert.equal(doc.components.securitySchemes.bearerAuth.scheme, 'bearer');

  for (const endpoint of MACHINE_API_ENDPOINTS) {
    const path = '/api/v1' + endpoint.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
    const operation = doc.paths[path]?.[endpoint.method.toLowerCase()];
    assert.ok(operation, 'OpenAPI missing ' + endpoint.method + ' ' + endpoint.path);
    assert.equal(operation['x-cfvm-scope'], endpoint.scope);
  }
});
