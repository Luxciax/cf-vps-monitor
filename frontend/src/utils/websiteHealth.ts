export type WebsiteHealthStatus = 'pending' | 'up' | 'down' | 'paused';

export type WebsiteHealthCheckLike = {
  checked_at?: unknown;
  ok?: unknown;
  effective_status?: unknown;
};

export function latestWebsiteHealthCheck<T extends WebsiteHealthCheckLike>(checks: T[]): T | null {
  let latest: T | null = null;
  let latestTime = Number.NEGATIVE_INFINITY;

  for (const check of checks) {
    if (!check || typeof check !== 'object') continue;
    const time = typeof check.checked_at === 'string' ? Date.parse(check.checked_at) : Number.NaN;
    if (!Number.isFinite(time)) continue;
    if (time > latestTime) {
      latest = check;
      latestTime = time;
    }
  }

  return latest;
}

export function deriveWebsiteHealthStatus(
  rawStatus: unknown,
  checks: WebsiteHealthCheckLike[],
): WebsiteHealthStatus {
  if (rawStatus === 'paused') return 'paused';
  if (rawStatus === 'up' || rawStatus === 'down') return rawStatus;

  const latest = latestWebsiteHealthCheck(checks);
  if (!latest) return 'pending';
  if (latest.effective_status === 'up') return 'up';
  if (latest.effective_status === 'down') return 'down';
  if (latest.ok === true) return 'up';
  if (latest.ok === false) return 'down';
  return 'pending';
}
