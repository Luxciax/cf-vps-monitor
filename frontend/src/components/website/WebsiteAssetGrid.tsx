import type { WebsiteAssetViewModel } from './WebsiteAssetCard';
import WebsiteAssetCard from './WebsiteAssetCard';

export default function WebsiteAssetGrid({
  assets,
  periodHours,
  onOpenDetails,
}: {
  assets: WebsiteAssetViewModel[];
  periodHours: number;
  onOpenDetails: (asset: WebsiteAssetViewModel) => void;
}) {
  if (assets.length === 0) {
    return (
      <div className="website-asset-empty">
        <strong>没有匹配的网站</strong>
        <span>试试调整搜索词或筛选条件。</span>
      </div>
    );
  }

  return (
    <div className="website-asset-grid">
      {assets.map((asset) => (
        <WebsiteAssetCard
          key={asset.monitor.id}
          asset={asset}
          periodHours={periodHours}
          onOpenDetails={onOpenDetails}
        />
      ))}
    </div>
  );
}
