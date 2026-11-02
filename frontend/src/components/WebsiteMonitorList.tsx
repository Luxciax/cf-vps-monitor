import { useEffect, useMemo, useRef, useState } from 'react';
import { SegmentedControl } from '@radix-ui/themes';
import type { WebsiteHeartbeatPoint } from './WebsiteHeartbeatBar';
import WebsiteAssetDetails from './website/WebsiteAssetDetails';
import WebsiteAssetFilters from './website/WebsiteAssetFilters';
import WebsiteAssetGrid from './website/WebsiteAssetGrid';
import type { WebsiteAssetViewModel } from './website/WebsiteAssetCard';
import WebsiteBackgroundPreviewControl from './website/WebsiteBackgroundPreviewControl';
import { fetchPublicSettings } from '../utils/publicSettings';
import {
  metadataForMonitor,
  type WebsiteAssetCategory,
} from './website/websiteAssetTypes';
import './website/website-assets.css';

export type WebsiteMonitorStatus = 'pending' | 'up' | 'down' | 'paused';
const DEFAULT_WEBSITE_INTERVAL_SEC = 120;

export interface WebsiteMonitorSummary {
  id: number;
  name: string;
  /** 勾选「对游客隐藏地址」时服务端返回 null——此时不得渲染任何链接。 */
  url: string | null;
  /** 服务端下发的监控类型，用于区分 TCP 与 HTTP，不依赖 url 字符串。 */
  method?: 'GET' | 'HEAD' | 'TCP';
  interval_sec: number;
  status: WebsiteMonitorStatus;
  last_checked_at: string | null;
  last_status_code: number | null;
  last_raw_status_code?: number | null;
  last_latency_ms: number | null;
  last_effective_reason?: string | null;
  hidden?: boolean;
  hide_url?: boolean;
  description: string;
  category: string;
  tags: string[];
  icon: string;
  server_uuid: string | null;
  domain: string;
  deployment: string;
  repository_url: string;
  checks: WebsiteHeartbeatPoint[];
}

type DashboardBackgroundSettings = {
  enabled: boolean;
  image: string;
  overlay: number;
  blur: number;
  position: 'center' | 'top' | 'bottom';
  size: 'cover' | 'contain' | 'auto';
};

const DEFAULT_DASHBOARD_BACKGROUND: DashboardBackgroundSettings = {
  enabled: true,
  image: '/dashboard-background.jpg',
  overlay: 0.3,
  blur: 0,
  position: 'center',
  size: 'cover',
};

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function safeBackgroundImage(value: unknown) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
  try {
    const url = new URL(raw, window.location.origin);
    if (url.protocol === 'https:' || (url.protocol === 'http:' && window.location.protocol === 'http:')) {
      return url.toString();
    }
  } catch {
    return '';
  }
  return '';
}

function normalizeDashboardBackground(config: Record<string, unknown>): DashboardBackgroundSettings {
  const position = config.dashboardBackgroundPosition;
  const size = config.dashboardBackgroundSize;
  return {
    enabled: typeof config.dashboardBackgroundEnabled === 'boolean'
      ? config.dashboardBackgroundEnabled
      : DEFAULT_DASHBOARD_BACKGROUND.enabled,
    image: safeBackgroundImage(config.dashboardBackgroundImage) || DEFAULT_DASHBOARD_BACKGROUND.image,
    overlay: clampNumber(config.dashboardBackgroundOverlay, 0, 0.8, DEFAULT_DASHBOARD_BACKGROUND.overlay),
    blur: clampNumber(config.dashboardBackgroundBlur, 0, 20, DEFAULT_DASHBOARD_BACKGROUND.blur),
    position: position === 'top' || position === 'bottom' ? position : 'center',
    size: size === 'contain' || size === 'auto' ? size : 'cover',
  };
}

function uptimePercent(checks: WebsiteHeartbeatPoint[]) {
  if (checks.length === 0) return '0%';
  const ok = checks.filter((check) => check.ok).length;
  const percent = (ok / checks.length) * 100;
  return `${percent >= 99.995 ? '100' : percent.toFixed(2)}%`;
}

function checksInPeriod(checks: WebsiteHeartbeatPoint[], hours: number) {
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  return checks.filter((check) => new Date(check.checked_at).getTime() >= cutoff);
}

function heartbeatSegmentCount(periodHours: number, intervalSec = DEFAULT_WEBSITE_INTERVAL_SEC) {
  const interval = Math.max(1, Number(intervalSec) || DEFAULT_WEBSITE_INTERVAL_SEC);
  if (periodHours === 1) return Math.max(1, Math.ceil(periodHours * 60 * 60 / interval));
  return 72;
}

function bucketChecksByPeriod(checks: WebsiteHeartbeatPoint[], periodHours: number, segmentCount: number) {
  const end = Date.now();
  const periodMs = periodHours * 60 * 60 * 1000;
  const start = end - periodMs;
  const bucketMs = periodHours * 60 * 60 * 1000 / segmentCount;
  const buckets: Array<WebsiteHeartbeatPoint | null> = Array.from({ length: segmentCount }, () => null);

  for (const check of checks) {
    const time = new Date(check.checked_at).getTime();
    if (time < start || time > end) continue;
    const index = Math.min(segmentCount - 1, Math.floor((time - start) / bucketMs));
    const current = buckets[index];
    if (!current || time > new Date(current.checked_at).getTime()) buckets[index] = check;
  }

  return buckets.reverse();
}

export default function WebsiteMonitorList({
  monitors,
  loading,
  periodHours,
  onPeriodChange,
  periods = [1, 24, 72],
  servers = [],
}: {
  monitors: WebsiteMonitorSummary[];
  loading?: boolean;
  periodHours: number;
  onPeriodChange: (hours: number) => void;
  periods?: readonly number[];
  servers?: Array<{ uuid: string; name: string }>;
}) {
  // 切换周期时 checks 数据异步到达，用新周期对旧数据分桶会产生大量空桶闪灰。
  // loading 期间保持上一个已渲染周期，数据就绪后一并切换。
  const lastPeriodRef = useRef(periodHours);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<'全部' | WebsiteAssetCategory>('全部');
  const [status, setStatus] = useState<'all' | WebsiteMonitorStatus>('all');
  const [selected, setSelected] = useState<WebsiteAssetViewModel | null>(null);
  const [backgroundSettings, setBackgroundSettings] = useState(DEFAULT_DASHBOARD_BACKGROUND);
  const [backgroundPreview, setBackgroundPreview] = useState('');
  if (!loading) {
    lastPeriodRef.current = periodHours;
  }
  const renderPeriodHours = loading ? lastPeriodRef.current : periodHours;
  const customizedBackground = Boolean(backgroundPreview);
  const activeBackground = backgroundPreview || backgroundSettings.image;
  const hasBackground = Boolean(activeBackground) && (backgroundSettings.enabled || customizedBackground);
  const serverNames = useMemo(
    () => new Map(servers.map((server) => [server.uuid, server.name || server.uuid])),
    [servers],
  );

  useEffect(() => {
    let cancelled = false;
    fetchPublicSettings()
      .then(async (settings) => {
        const activeTheme = encodeURIComponent(settings.active_theme || 'monitor');
        const response = await fetch(`/api/theme/manifest/${activeTheme}`);
        if (!response.ok) return;
        const payload = await response.json() as { config?: Record<string, unknown> };
        if (!cancelled) setBackgroundSettings(normalizeDashboardBackground(payload.config || {}));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (backgroundPreview.startsWith('blob:')) URL.revokeObjectURL(backgroundPreview);
    };
  }, [backgroundPreview]);

  const assets = useMemo<WebsiteAssetViewModel[]>(() => monitors.map((monitor) => {
    const periodChecks = checksInPeriod(monitor.checks || [], renderPeriodHours);
    const heartbeatSegments = heartbeatSegmentCount(renderPeriodHours, monitor.interval_sec);
    return {
      monitor,
      metadata: metadataForMonitor(monitor, serverNames),
      uptime: uptimePercent(periodChecks),
      heartbeat: bucketChecksByPeriod(monitor.checks || [], renderPeriodHours, heartbeatSegments),
      heartbeatSegments,
    };
  }), [monitors, renderPeriodHours, serverNames]);

  const filteredAssets = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return assets.filter(({ monitor, metadata }) => {
      if (category !== '全部' && metadata.category !== category) return false;
      if (status !== 'all' && monitor.status !== status) return false;
      if (!normalizedQuery) return true;
      return [
        monitor.name,
        metadata.description,
        metadata.domain,
        metadata.category,
        ...metadata.tags,
      ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
    });
  }, [assets, category, query, status]);

  const summary = useMemo(() => ({
    total: assets.length,
    up: assets.filter(({ monitor }) => monitor.status === 'up').length,
    down: assets.filter(({ monitor }) => monitor.status === 'down').length,
    paused: assets.filter(({ monitor }) => monitor.status === 'paused').length,
  }), [assets]);

  return (
    <section className={`website-asset-dashboard${hasBackground ? ' has-dashboard-background' : ' has-no-dashboard-background'}`}>
      {hasBackground && (
        <>
          <div
            className="website-dashboard-background"
            style={{
              backgroundImage: `url(${JSON.stringify(activeBackground)})`,
              backgroundPosition: backgroundSettings.position,
              backgroundSize: backgroundSettings.size,
              filter: backgroundSettings.blur > 0 ? `blur(${backgroundSettings.blur}px) scale(1.03)` : undefined,
            }}
            aria-hidden="true"
          />
          <div
            className="website-dashboard-background-overlay"
            style={{ background: `rgba(5, 9, 17, ${backgroundSettings.overlay})` }}
            aria-hidden="true"
          />
        </>
      )}

      <div className="website-asset-dashboard-content">
        <header className="website-asset-toolbar">
          <div className="website-asset-toolbar-title">
            <div className="website-asset-heading-line">
              <h1>我的网站</h1>
            </div>
            <div className="website-asset-summary" aria-label="网站状态摘要">
              <span><strong>{summary.total}</strong> Sites</span>
              <span className="is-up"><strong>{summary.up}</strong> Online</span>
              <span className="is-down"><strong>{summary.down}</strong> Offline</span>
              <span className="is-paused"><strong>{summary.paused}</strong> Paused</span>
            </div>
          </div>

          <div className="website-asset-toolbar-actions">
            <WebsiteBackgroundPreviewControl
              customized={customizedBackground}
              onSelect={(file) => setBackgroundPreview(URL.createObjectURL(file))}
              onReset={() => setBackgroundPreview('')}
            />
            <SegmentedControl.Root
              className="website-asset-period"
              size="1"
              value={String(periodHours)}
              onValueChange={(value) => onPeriodChange(Number(value))}
            >
              {periods.map((hours) => (
                <SegmentedControl.Item key={hours} value={String(hours)}>
                  {hours}h
                </SegmentedControl.Item>
              ))}
            </SegmentedControl.Root>
          </div>
        </header>

        <WebsiteAssetFilters
          query={query}
          category={category}
          status={status}
          onQueryChange={setQuery}
          onCategoryChange={setCategory}
          onStatusChange={setStatus}
        />

        {loading && <div className="website-asset-loading">正在刷新监控状态…</div>}

        <WebsiteAssetGrid
          assets={filteredAssets}
          periodHours={renderPeriodHours}
          onOpenDetails={setSelected}
        />
      </div>

      <WebsiteAssetDetails
        asset={selected}
        open={Boolean(selected)}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </section>
  );
}
