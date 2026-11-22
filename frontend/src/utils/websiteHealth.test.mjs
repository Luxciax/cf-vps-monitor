import assert from 'node:assert/strict';

const { deriveWebsiteHealthStatus, latestWebsiteHealthCheck } = await import('./websiteHealth.ts');

const checks = [
  { checked_at: '2026-11-22T00:00:00Z', ok: false, effective_status: 'down' },
  { checked_at: '2026-11-22T00:01:00Z', ok: true, effective_status: 'up' },
];

assert.equal(latestWebsiteHealthCheck(checks)?.checked_at, '2026-11-22T00:01:00Z');
assert.equal(deriveWebsiteHealthStatus('up', checks), 'up');
assert.equal(deriveWebsiteHealthStatus('down', checks), 'down');
assert.equal(deriveWebsiteHealthStatus('paused', checks), 'paused');
assert.equal(deriveWebsiteHealthStatus('pending', checks), 'up');
assert.equal(deriveWebsiteHealthStatus(undefined, [{ checked_at: '2026-11-22T00:00:00Z', ok: false }]), 'down');
assert.equal(deriveWebsiteHealthStatus('pending', []), 'pending');
assert.equal(deriveWebsiteHealthStatus('pending', [{ checked_at: 'invalid', ok: true }]), 'pending');

console.log('websiteHealth tests passed');
