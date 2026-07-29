import { useMemo, useState } from 'react';
import {
  Cloud,
  Container,
  ExternalLink,
  Globe2,
  Server,
  Timer,
} from 'lucide-react';
import WebsiteHeartbeatBar, { type WebsiteHeartbeatPoint } from '../WebsiteHeartbeatBar';
import type { WebsiteMonitorSummary } from '../WebsiteMonitorList';
import type { WebsiteAssetMetadata } from './websiteAssetTypes';

export interface WebsiteAssetViewModel {
  monitor: WebsiteMonitorSummary;
  metadata: WebsiteAssetMetadata;
  uptime: string;
  heartbeat: Array<WebsiteHeartbeatPoint | null>;
  heartbeatSegments: number;
}

const statusLabels = {
  up: '在线',
  down: '离线',
  paused: '暂停',
  pending: '等待',
} as const;

function faviconUrl(url: string, customIcon?: string) {
  if (customIcon) return customIcon;
  try {
    return `${new URL(url).origin}/favicon.ico`;
  } catch {
    return '';
  }
}

function protocolLabel(monitor: WebsiteMonitorSummary) {
  if (monitor.url.startsWith('tcp:')) return 'TCP';
  const code = monitor.last_raw_status_code ?? monitor.last_status_code;
  return code ? `HTTP ${code}` : 'HTTP';
}

function WebsiteAssetIcon({ monitor, icon }: { monitor: WebsiteMonitorSummary; icon?: string }) {
  const src = useMemo(() => faviconUrl(monitor.url, icon), [icon, monitor.url]);
  const [failed, setFailed] = useState(false);

  return (
    <span className="website-asset-icon" aria-hidden="true">
      {src && !failed ? (
        <img src={src} alt="" onError={() => setFailed(true)} />
      ) : (
        <Globe2 size={20} />
      )}
    </span>
  );
}

export default function WebsiteAssetCard({
  asset,
  periodHours,
  onOpenDetails,
}: {
  asset: WebsiteAssetViewModel;
  periodHours: number;
  onOpenDetails: (asset: WebsiteAssetViewModel) => void;
}) {
  const { monitor, metadata } = asset;
  const visibleTags = metadata.tags.slice(0, 2);
  const extraTags = Math.max(0, metadata.tags.length - visibleTags.length);
  const latency = monitor.last_latency_ms == null || monitor.status === 'paused'
    ? '—'
    : `${monitor.last_latency_ms} ms`;

  return (
    <article
      className={`website-asset-card is-${monitor.status}`}
      role="button"
      tabIndex={0}
      onClick={() => onOpenDetails(asset)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpenDetails(asset);
        }
      }}
      aria-label={`查看 ${monitor.name} 详情`}
    >
      <header className="website-asset-card-header">
        <WebsiteAssetIcon monitor={monitor} icon={metadata.icon} />
        <div className="website-asset-heading">
          <div className="website-asset-title-row">
            <a
              href={monitor.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => event.stopPropagation()}
              title={monitor.name}
            >
              {monitor.name}
            </a>
            <ExternalLink size={14} aria-hidden="true" />
          </div>
          <div className="website-asset-classification">
            <span>{metadata.category}</span>
            {visibleTags[0] && <span>{visibleTags[0]}</span>}
          </div>
        </div>
        <div className="website-asset-health">
          <span className={`website-asset-status is-${monitor.status}`}>
            <span className="website-asset-status-dot" aria-hidden="true" />
            {statusLabels[monitor.status]}
          </span>
          <strong>{asset.uptime}</strong>
        </div>
      </header>

      <div className="website-asset-copy">
        <p>{metadata.description}</p>
        <a
          className="website-asset-domain"
          href={monitor.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => event.stopPropagation()}
          title={metadata.domain}
        >
          {metadata.domain}
        </a>
      </div>

      <div className="website-asset-meta">
        <span title={`服务器：${metadata.server}`}><Server size={14} />{metadata.server}</span>
        <span title={`部署方式：${metadata.deployment}`}><Container size={14} />{metadata.deployment}</span>
        <span title="接入层"><Cloud size={14} />{visibleTags[1] || '直连'}</span>
        <span title={`${protocolLabel(monitor)} · ${latency}`}><Timer size={14} />{latency}</span>
      </div>

      {extraTags > 0 && (
        <div className="website-asset-tags" aria-label="更多标签">
          {metadata.tags.slice(2, 3).map((tag) => <span key={tag}>{tag}</span>)}
          {metadata.tags.length > 3 && <span>+{metadata.tags.length - 3}</span>}
        </div>
      )}

      <div className="website-asset-heartbeat">
        <WebsiteHeartbeatBar checks={asset.heartbeat} max={asset.heartbeatSegments} />
        <div className="website-asset-heartbeat-caption">
          <span>{periodHours}h</span>
          <span>{protocolLabel(monitor)} · {lastCheckedText(monitor.last_checked_at)}</span>
        </div>
      </div>
    </article>
  );
}

function lastCheckedText(value: string | null) {
  if (!value) return '尚未检测';
  const diff = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return '刚刚检查';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} 小时前`;
  return `${Math.floor(minutes / 1440)} 天前`;
}
