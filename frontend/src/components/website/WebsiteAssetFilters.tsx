import { Search } from 'lucide-react';
import type { WebsiteAssetCategory } from './websiteAssetTypes';
import type { WebsiteMonitorStatus } from '../WebsiteMonitorList';

export const websiteCategories: Array<'全部' | WebsiteAssetCategory> = [
  '全部',
  'AI',
  '工具',
  '存储',
  '博客',
  'API',
  '管理',
  '媒体',
  '其他',
];

const websiteStatuses: Array<{ value: 'all' | WebsiteMonitorStatus; label: string }> = [
  { value: 'all', label: '全部状态' },
  { value: 'up', label: '在线' },
  { value: 'down', label: '离线' },
  { value: 'paused', label: '暂停' },
  { value: 'pending', label: '等待' },
];

export default function WebsiteAssetFilters({
  query,
  category,
  status,
  onQueryChange,
  onCategoryChange,
  onStatusChange,
}: {
  query: string;
  category: '全部' | WebsiteAssetCategory;
  status: 'all' | WebsiteMonitorStatus;
  onQueryChange: (value: string) => void;
  onCategoryChange: (value: '全部' | WebsiteAssetCategory) => void;
  onStatusChange: (value: 'all' | WebsiteMonitorStatus) => void;
}) {
  return (
    <div className="website-asset-filters">
      <label className="website-asset-search">
        <Search size={16} aria-hidden="true" />
        <span className="sr-only">搜索网站</span>
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="搜索网站..."
          type="search"
        />
      </label>
      <label className="website-asset-select">
        <span className="sr-only">分类筛选</span>
        <select
          value={category}
          onChange={(event) => onCategoryChange(event.target.value as '全部' | WebsiteAssetCategory)}
        >
          {websiteCategories.map((item) => (
            <option value={item} key={item}>{item === '全部' ? '全部分类' : item}</option>
          ))}
        </select>
      </label>
      <label className="website-asset-select">
        <span className="sr-only">状态筛选</span>
        <select
          value={status}
          onChange={(event) => onStatusChange(event.target.value as 'all' | WebsiteMonitorStatus)}
        >
          {websiteStatuses.map((item) => (
            <option value={item.value} key={item.value}>{item.label}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
