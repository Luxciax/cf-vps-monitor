import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('./cfvm.mjs', import.meta.url));

function run(args, env = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    env: { ...process.env, CFVM_URL: '', CFVM_TOKEN: '', ...env },
  });
}

test('cfvm help does not require credentials', () => {
  const result = run(['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /CF VPS Monitor CLI/);
  assert.match(result.stdout, /discover/);
  assert.match(result.stdout, /clients remove/);
  assert.match(result.stdout, /backup restore/);
});

test('cfvm token generate emits a 32-byte hex token without credentials', () => {
  const result = run(['token', 'generate']);
  assert.equal(result.status, 0);
  assert.match(result.stdout.trim(), /^[a-f0-9]{64}$/);
});

test('cfvm generic request requires a relative API path', () => {
  const result = run(
    ['request', 'GET', 'https://evil.example/steal'],
    { CFVM_URL: 'https://monitor.example.com', CFVM_TOKEN: 'a'.repeat(64) },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /relative/);
});

test('cfvm destructive convenience commands validate identifiers before network I/O', () => {
  for (const args of [
    ['pings', 'remove', '0'],
    ['websites', 'remove', '-2'],
  ]) {
    const result = run(args, { CFVM_URL: 'https://monitor.example.com', CFVM_TOKEN: 'a'.repeat(64) });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /positive integer/);
  }
});
