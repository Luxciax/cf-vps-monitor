import type { MaintenanceWindow } from './website-check-config.ts';

export interface StatisticsCheck {
  checked_at: string;
  ok: boolean;
  latency_ms?: number | null;
  source_type?: string;
  source_client?: string | null;
}

export interface StatisticsOptions {
  since: string;
  until: string;
  intervalSec: number;
  maintenance?: MaintenanceWindow[];
  source?: 'worker' | string;
}

interface ObservedIncident {
  started_at: string;
  recovered_at: string | null;
  observed_duration_ms: number;
  observation_gap: boolean;
}

function uncoveredDuration(start: number, end: number, windows: Array<[number, number]>): number {
  let duration = Math.max(0, end - start);
  for (const [windowStart, windowEnd] of windows) {
    duration -= Math.max(0, Math.min(end, windowEnd) - Math.max(start, windowStart));
  }
  return Math.max(0, duration);
}

function mergedMaintenance(windows: MaintenanceWindow[]): Array<[number, number]> {
  const sorted = windows
    .map(window => [Date.parse(window.start), Date.parse(window.end)] as [number, number])
    .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start)
    .sort((a, b) => a[0] - b[0]);
  const result: Array<[number, number]> = [];
  for (const item of sorted) {
    const last = result[result.length - 1];
    if (last && item[0] <= last[1]) last[1] = Math.max(last[1], item[1]);
    else result.push([...item]);
  }
  return result;
}

/** Sparse samples are evidence for at most two intervals, never for an entire gap. */
export function analyzeWebsiteChecks(checks: StatisticsCheck[], options: StatisticsOptions) {
  const since = Date.parse(options.since);
  const until = Date.parse(options.until);
  if (!Number.isFinite(since) || !Number.isFinite(until) || until <= since || until - since > 366 * 86400000) {
    throw new Error('invalid_statistics_range');
  }
  if (!Number.isFinite(options.intervalSec) || options.intervalSec < 1 || options.intervalSec > 86400) {
    throw new Error('invalid_statistics_interval');
  }

  const sampleLifetime = options.intervalSec * 2000;
  const windows = mergedMaintenance(options.maintenance || []);
  const eligibleMs = uncoveredDuration(since, until, windows);
  const source = options.source || 'worker';
  const byTime = new Map<number, StatisticsCheck>();
  for (const check of checks) {
    const wrongSource = source === 'worker'
      ? check.source_type && check.source_type !== 'worker'
      : check.source_type !== 'agent' || check.source_client !== source;
    if (wrongSource) continue;
    const at = Date.parse(check.checked_at);
    if (Number.isFinite(at) && at < until && at >= since - sampleLifetime) byTime.set(at, check);
  }

  const rows = [...byTime.entries()].sort((a, b) => a[0] - b[0]);
  const latencies: number[] = [];
  const incidents: ObservedIncident[] = [];
  let upMs = 0;
  let downMs = 0;
  let samples = 0;
  let incident: ObservedIncident | null = null;
  let previousAt: number | undefined;

  for (let i = 0; i < rows.length; i++) {
    const [at, check] = rows[i];
    if (windows.some(([start, end]) => start <= at && at < end)) continue;

    const start = Math.max(since, at);
    const end = Math.min(until, rows[i + 1]?.[0] ?? until, at + sampleLifetime);
    const covered = uncoveredDuration(start, end, windows);
    // A failure that already recovered before this range cannot create an incident.
    if (covered === 0 && at < since) continue;

    if (at >= since) {
      samples++;
      if (check.ok && typeof check.latency_ms === 'number' && Number.isFinite(check.latency_ms) && check.latency_ms >= 0) {
        latencies.push(check.latency_ms);
      }
    }
    if (check.ok) upMs += covered;
    else downMs += covered;

    if (incident && previousAt !== undefined && at - previousAt > sampleLifetime) incident.observation_gap = true;
    if (!check.ok) {
      if (!incident) {
        incident = {
          started_at: new Date(Math.max(at, since)).toISOString(),
          recovered_at: null,
          observed_duration_ms: 0,
          observation_gap: at < since,
        };
        incidents.push(incident);
      }
      incident.observed_duration_ms += covered;
    } else if (incident) {
      incident.recovered_at = new Date(at).toISOString();
      incident = null;
    }
    previousAt = at;
  }

  if (incident && previousAt !== undefined && until - previousAt > sampleLifetime) incident.observation_gap = true;
  latencies.sort((a, b) => a - b);
  const percentile = (p: number) => latencies.length ? latencies[Math.max(0, Math.ceil(latencies.length * p) - 1)] : null;
  const observedMs = upMs + downMs;
  return {
    since: options.since,
    until: options.until,
    source,
    samples,
    availability_percent: observedMs ? 100 * upMs / observedMs : null,
    coverage_percent: eligibleMs ? 100 * observedMs / eligibleMs : null,
    up_ms: upMs,
    down_ms: downMs,
    unknown_ms: Math.max(0, eligibleMs - observedMs),
    maintenance_ms: until - since - eligibleMs,
    p50_ms: percentile(0.5),
    p95_ms: percentile(0.95),
    p99_ms: percentile(0.99),
    incidents,
    semantics: 'time-weighted within two probe intervals; gaps unknown; maintenance excluded; a single source is used',
  };
}
