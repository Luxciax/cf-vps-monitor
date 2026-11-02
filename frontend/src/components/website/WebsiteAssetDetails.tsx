import { Badge, Button, Dialog, Flex, Text } from '@radix-ui/themes';
import {
  Clock3,
  ExternalLink,
  GitBranch,
  Globe2,
  Layers3,
  Server,
  Timer,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import type { WebsiteAssetViewModel } from './WebsiteAssetCard';

const statusLabels = {
  up: '在线',
  down: '离线',
  paused: '暂停',
  pending: '等待检测',
} as const;

export default function WebsiteAssetDetails({
  asset,
  open,
  onOpenChange,
}: {
  asset: WebsiteAssetViewModel | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!asset) return null;
  const { monitor, metadata } = asset;
  const statusCode = monitor.last_raw_status_code ?? monitor.last_status_code;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content className="website-asset-details" aria-describedby={undefined} style={{ maxWidth: 620 }}>
        <div className="website-asset-details-head">
          <div>
            <Dialog.Title>{monitor.name}</Dialog.Title>
            {monitor.url ? <a href={monitor.url} target="_blank" rel="noopener noreferrer">
              {metadata.domain}
              <ExternalLink size={13} aria-hidden="true" />
            </a> : <span>地址已隐藏</span>}
          </div>
          <Badge
            color={monitor.status === 'up' ? 'green' : monitor.status === 'down' ? 'red' : 'gray'}
            variant="soft"
          >
            {statusLabels[monitor.status]}
          </Badge>
        </div>

        <Text as="p" className="website-asset-details-description">{metadata.description}</Text>

        <div className="website-asset-details-grid">
          <DetailItem icon={<Globe2 size={16} />} label="主域名" value={metadata.domain} />
          <DetailItem icon={<Layers3 size={16} />} label="分类" value={metadata.category} />
          <DetailItem icon={<Server size={16} />} label="所属服务器" value={metadata.server} />
          <DetailItem icon={<Layers3 size={16} />} label="部署方式" value={metadata.deployment} />
          <DetailItem
            icon={<Timer size={16} />}
            label="当前检测"
            value={`${statusCode ? `HTTP ${statusCode} · ` : ''}${monitor.last_latency_ms ?? 0} ms`}
          />
          <DetailItem
            icon={<Clock3 size={16} />}
            label="最后检测"
            value={monitor.last_checked_at ? new Date(monitor.last_checked_at).toLocaleString() : '尚未检测'}
          />
        </div>

        <div className="website-asset-details-tags">
          {metadata.tags.map((tag) => <Badge key={tag} variant="soft" color="gray">{tag}</Badge>)}
        </div>

        {metadata.note && <Text as="p" color="gray">{metadata.note}</Text>}

        <Flex gap="3" justify="end" wrap="wrap" className="website-asset-details-actions">
          {metadata.repository_url && (
            <Button asChild variant="soft" color="gray">
              <a href={metadata.repository_url} target="_blank" rel="noopener noreferrer">
                <GitBranch size={15} />代码仓库
              </a>
            </Button>
          )}
          {metadata.server_uuid && (
            <Button asChild variant="soft">
              <Link to={`/instance/${metadata.server_uuid}`} onClick={() => onOpenChange(false)}>
                <Server size={15} />查看服务器
              </Link>
            </Button>
          )}
          {monitor.url && <Button asChild>
            <a href={monitor.url} target="_blank" rel="noopener noreferrer">
              打开网站<ExternalLink size={15} />
            </a>
          </Button>}
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}

function DetailItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="website-asset-detail-item">
      <span aria-hidden="true">{icon}</span>
      <div>
        <small>{label}</small>
        <strong title={value}>{value}</strong>
      </div>
    </div>
  );
}
