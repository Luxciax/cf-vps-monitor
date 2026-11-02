import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkerLoader } from '../../test-support/worker-module.mjs';

test('legacy Next background is inherited by Aurora and existing Aurora wins', async () => {
  const rows = new Map([['next', { short:'next', config_json: JSON.stringify({ dashboardBackgroundImage:'https://example.com/bg.png', dashboardBackgroundBlur:5, unrelated:'ignored' }) }]]);
  const loader = createWorkerLoader({ db: {
    getTheme: async (_db, short) => rows.get(short) || null,
    upsertTheme: async (_db, theme) => { rows.set(theme.short, theme); },
  }, expose: { 'worker/src/routes/theme.ts': ['ensureBuiltinTheme', 'builtinThemeSummary'] } });
  const { ensureBuiltinTheme, builtinThemeSummary } = loader.load('worker/src/routes/theme.ts');
  const summary = builtinThemeSummary('aurora', 'aurora', rows.get('next'));
  assert.equal(summary.config.dashboardBackgroundImage, 'https://example.com/bg.png');
  const created = await ensureBuiltinTheme(loader.database, 'aurora');
  assert.equal(JSON.parse(created.config_json).dashboardBackgroundBlur, 5);
  assert.equal(JSON.parse(created.config_json).unrelated, undefined);
  assert.ok(rows.has('next'));
  rows.set('aurora', { ...created, config_json: JSON.stringify({ dashboardBackgroundImage:'https://example.com/aurora.png' }) });
  assert.equal(JSON.parse((await ensureBuiltinTheme(loader.database, 'aurora')).config_json).dashboardBackgroundImage, 'https://example.com/aurora.png');
});
