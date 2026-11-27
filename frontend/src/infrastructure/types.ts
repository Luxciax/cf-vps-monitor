export const assetKinds = [
  "vps",
  "website",
  "api",
  "domain",
  "container",
  "compose",
  "reverse_proxy",
  "repository",
  "deployment",
  "cloudflare_worker",
  "cloudflare_pages",
  "database",
  "storage",
  "certificate",
  "provider",
  "service",
  "other",
] as const;
export const assetKindLabels: Record<string, string> = {
  vps: "VPS",
  website: "网站",
  api: "API",
  domain: "域名",
  container: "容器",
  compose: "Compose",
  reverse_proxy: "反向代理",
  repository: "GitHub 仓库",
  deployment: "部署实例",
  cloudflare_worker: "Cloudflare Worker",
  cloudflare_pages: "Cloudflare Pages",
  database: "数据库",
  storage: "存储",
  certificate: "证书",
  provider: "服务商",
  service: "系统 / 内部服务",
  other: "其他",
};
export type Asset = {
  id: string;
  kind: string;
  name: string;
  status: string;
  category: string;
  tags: string[];
  description: string;
  source: string;
  external_id?: string;
  metadata: Record<string, unknown>;
  observed?: Record<string, unknown>;
  observed_source?: string;
  observed_at?: string | null;
  observed_confidence?: string;
  created_at: string;
  updated_at: string;
  expires_at?: string | null;
  cost?: number | null;
  currency?: string;
  billing_cycle?: string | number;
  provider?: string;
  url?: string;
  client_id?: string | null;
};
export type Relationship = {
  id: string;
  source_id: string;
  target_id: string;
  kind: string;
  description?: string;
  source?: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
};
export type Change = {
  id: string;
  asset_id?: string | null;
  kind?: string;
  action?: string;
  summary?: string;
  source: string;
  verification?: string;
  before?: unknown;
  after?: unknown;
  diff?: unknown;
  created_at: string;
  observed_at?: string;
  metadata?: Record<string, unknown>;
};
export type Snapshot = {
  id: string;
  asset_id: string;
  source: string;
  collected_at: string;
  created_at: string;
  status?: string;
  confidence?: string;
  environment?: string;
  collectors?: Array<{ name: string; status: string; reason?: string }>;
  data: Record<string, unknown>;
};
export type DocumentRecord = {
  id: string;
  title: string;
  content: string;
  category: string;
  tags: string[];
  version: number;
  asset_ids: string[];
  asset_kinds?: string[];
  environments: string[];
  risk: string;
  slug?: string;
  created_at: string;
  updated_at: string;
};
export type Baseline = {
  id: string;
  name: string;
  description: string;
  version: number;
  environments: string[];
  asset_kinds?: string[];
  max_age_hours?: number;
  rules: BaselineRule[];
  exceptions?: Array<{
    rule_id: string;
    asset_id: string;
    reason: string;
    expires_at: string;
  }>;
  created_at: string;
  updated_at: string;
};
export type BaselineRule = {
  id?: string;
  path: string;
  operator: string;
  expected?: unknown;
  severity?: string;
  sop_id?: string;
  description?: string;
};
