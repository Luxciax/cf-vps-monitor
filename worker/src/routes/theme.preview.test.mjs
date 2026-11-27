import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkerLoader } from '../../test-support/worker-module.mjs';

function fixture({ missingAsset = false } = {}) {
  const reads = [];
  const mutations = [];
  const stored = {
    short: 'uploaded',
    name: 'Uploaded fixture',
    style_path: 'theme.css',
    manifest_json: JSON.stringify({
      name: 'Uploaded fixture', short: 'uploaded', style: 'theme.css',
      configuration: { data: [{ key: 'accent', name: 'Accent', type: 'color', default: '#000000' }] },
    }),
    config_json: JSON.stringify({ accent: '#000000' }),
    custom_css: '.saved-only { opacity: .5; }',
  };
  const rejectMutation = (name) => async () => {
    mutations.push(name);
    throw new Error(`Preview attempted mutation: ${name}`);
  };
  const db = {
    getTheme: async (_database, short) => {
      reads.push(['theme', short]);
      return short === stored.short ? stored : null;
    },
    getThemeAsset: async (_database, short, path) => {
      reads.push(['asset', short, path]);
      return missingAsset ? null : { content_base64: btoa('.node-card { color: var(--cf-theme-accent); }') };
    },
    getSetting: async () => { throw new Error('Preview must not depend on the currently active theme'); },
    ...Object.fromEntries(['setSetting', 'updateThemeSettings', 'upsertTheme', 'deleteTheme', 'insertAuditLog'].map(name => [name, rejectMutation(name)])),
  };
  const { adminThemeRoutes } = createWorkerLoader({ db }).load('worker/src/routes/theme.ts');
  return {
    reads, mutations,
    request: (body, raw = false) => adminThemeRoutes.fetch(new Request('https://fixture.invalid/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: raw ? body : JSON.stringify(body),
    }), {}, { waitUntil() {}, passThroughOnException() {} }),
  };
}

test('theme preview compiles the selected uploaded theme and unsaved settings without a database write', async () => {
  const f = fixture();
  const response = await f.request({
    short: 'uploaded',
    config: { accent: '#12ab34', dashboardBackgroundEnabled: false },
    custom_css: '.node-card { border-radius: 27px; }',
  });
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  const result = await response.json();
  assert.equal(result.short, 'uploaded');
  assert.equal(result.config.dashboardBackgroundEnabled, false);
  assert.match(result.css, /--cf-theme-accent: #12ab34;/);
  assert.match(result.css, /--cf-theme-dashboardBackgroundEnabled: 0;/);
  assert.match(result.css, /color: var\(--cf-theme-accent\)/);
  assert.match(result.css, /border-radius: 27px/);
  assert.doesNotMatch(result.css, /saved-only/);
  assert.deepEqual(f.reads, [['theme', 'uploaded'], ['asset', 'uploaded', 'theme.css']]);
  assert.deepEqual(f.mutations, []);
});

test('theme preview renders built-in defaults without persisting a first-use theme record', async () => {
  const f = fixture();
  const response = await f.request({ short: 'aurora', config: { dashboardBackgroundBlur: 4 }, custom_css: '' });
  assert.equal(response.status, 200, await response.clone().text());
  const result = await response.json();
  assert.equal(result.short, 'aurora');
  assert.equal(result.config.dashboardBackgroundBlur, 4);
  assert.equal(result.config.dashboardBackgroundEnabled, true);
  assert.match(result.css, /--cf-theme-dashboardBackgroundBlur: 4;/);
  assert.deepEqual(f.reads, [['theme', 'aurora']]);
  assert.deepEqual(f.mutations, []);
});

test('theme preview rejects malformed or oversized inputs and unavailable theme resources', async () => {
  const f = fixture();
  for (const [body, status] of [
    [{ short: 'monitor', custom_css: {} }, 400],
    [{ short: 'monitor', config: { dashboardBackgroundBlur: 21 } }, 400],
    [{ short: 'monitor', config: { dashboardBackgroundImage: 'javascript:alert(1)' } }, 400],
    [{ short: 'monitor', config: { nonexistent: true } }, 400],
    [{ short: '../uploaded', config: {} }, 400],
    [{ short: 'missing', config: {} }, 404],
    [{ short: 'monitor', config: {}, custom_css: 'x'.repeat(65537) }, 413],
  ]) {
    const response = await f.request(body);
    assert.equal(response.status, status, await response.clone().text());
    assert.equal(typeof (await response.json()).error, 'string');
  }
  assert.equal((await f.request('{', true)).status, 400);
  assert.equal((await f.request(`{"padding":"${'x'.repeat(256 * 1024)}"}`, true)).status, 413);
  assert.equal((await fixture({ missingAsset: true }).request({ short: 'uploaded', config: {} })).status, 404);
  assert.deepEqual(f.mutations, []);
});
