import type { WebsiteMonitorSummary } from '../WebsiteMonitorList';

export type WebsiteAssetCategory = 'AI' | '工具' | '存储' | '博客' | 'API' | '管理' | '媒体' | '其他';

export const WEBSITE_ASSET_CATEGORIES: WebsiteAssetCategory[] = [
  'AI',
  '工具',
  '存储',
  '博客',
  'API',
  '管理',
  '媒体',
  '其他',
];

export interface WebsiteAssetMetadata {
  description: string;
  category: WebsiteAssetCategory;
  tags: string[];
  server: string;
  server_uuid?: string;
  deployment: string;
  domain: string;
  icon?: string;
  repository_url?: string;
  note?: string;
}

function safeHostname(value: string) {
  if (value.startsWith('tcp:')) return value.replace(/^tcp:\/\//, '').split('/')[0];
  try {
    return new URL(value).hostname;
  } catch {
    return value;
  }
}

export function metadataForMonitor(
  monitor: WebsiteMonitorSummary,
  serverNames: ReadonlyMap<string, string>,
): WebsiteAssetMetadata {
  const category = WEBSITE_ASSET_CATEGORIES.includes(monitor.category as WebsiteAssetCategory)
    ? monitor.category as WebsiteAssetCategory
    : '其他';
  return {
    description: monitor.description,
    category,
    tags: monitor.tags,
    server: monitor.server_uuid
      ? serverNames.get(monitor.server_uuid) || monitor.server_uuid
      : '未关联',
    server_uuid: monitor.server_uuid || undefined,
    deployment: monitor.deployment || '未填写',
    domain: monitor.domain || safeHostname(monitor.url),
    icon: monitor.icon || undefined,
    repository_url: monitor.repository_url || undefined,
  };
}
