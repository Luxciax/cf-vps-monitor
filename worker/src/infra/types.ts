export const ASSET_KINDS = [
  "vps",
  "website",
  "api",
  "domain",
  "container",
  "compose",
  "reverse_proxy",
  "service",
  "repository",
  "deployment",
  "cloudflare_worker",
  "cloudflare_pages",
  "database",
  "storage",
  "certificate",
  "provider",
  "other",
] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];
export type JsonObject = Record<string, unknown>;
export interface Asset {
  id: string;
  kind: AssetKind;
  name: string;
  status: "active" | "planned" | "archived";
  category: string;
  tags: string[];
  description: string;
  source: string;
  external_id: string;
  metadata: JsonObject;
  observed: JsonObject;
  observed_source: string;
  observed_at: string | null;
  observed_confidence: "observed" | "reported" | "unknown";
  url: string;
  provider: string;
  client_id: string | null;
  cost: number | null;
  currency: string;
  billing_cycle: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}
export interface Relationship {
  id: string;
  source_id: string;
  target_id: string;
  kind: string;
  description: string;
  source: string;
  created_at: string;
}
export interface ConfigurationSnapshot {
  id: string;
  asset_id: string;
  source: string;
  collected_at: string;
  created_at: string;
  confidence: "observed" | "reported" | "unknown";
  environment: string;
  data: JsonObject;
  collectors: Array<{ name: string; status: string; reason?: string }>;
}
export interface Change {
  id: string;
  asset_id: string | null;
  kind: string;
  summary: string;
  source: string;
  verification: "observed" | "claimed" | "manual";
  before: unknown;
  after: unknown;
  document_ids: string[];
  created_at: string;
}
export interface KnowledgeDocument {
  id: string;
  slug: string;
  title: string;
  category: string;
  tags: string[];
  content: string;
  environments: string[];
  asset_kinds: AssetKind[];
  risk: "low" | "medium" | "high";
  asset_ids: string[];
  version: number;
  created_at: string;
  updated_at: string;
}
export type BaselineOperator =
  "eq" | "neq" | "exists" | "in" | "gte" | "lte" | "contains";
export interface BaselineRule {
  id: string;
  path: string;
  operator: BaselineOperator;
  expected?: unknown;
  severity: "info" | "warning" | "critical";
  sop_id?: string;
  description: string;
}
export interface Baseline {
  id: string;
  name: string;
  description: string;
  environments: string[];
  asset_kinds: AssetKind[];
  rules: BaselineRule[];
  exceptions: Array<{
    rule_id: string;
    asset_id: string;
    reason: string;
    expires_at: string;
  }>;
  max_age_hours: number;
  version: number;
  created_at: string;
  updated_at: string;
}
export interface BaselineEvaluation {
  baseline_id: string;
  baseline_version: number;
  asset_id: string;
  snapshot_id: string | null;
  evaluated_at: string;
  status: "compliant" | "deviation" | "missing" | "unknown" | "stale";
  results: Array<{
    rule_id: string;
    status:
      "compliant" | "deviation" | "missing" | "unknown" | "stale" | "exception";
    actual?: unknown;
    expected?: unknown;
    description: string;
    severity: string;
    sop_id?: string;
    exception_reason?: string;
  }>;
}
export interface DiscoveryReport {
  schema_version: 1;
  source: string;
  client_id?: string;
  collected_at: string;
  complete: boolean;
  collectors: Array<{ name: string; status: string; reason?: string }>;
  assets: Array<{
    external_id: string;
    kind: AssetKind;
    name: string;
    metadata: JsonObject;
    evidence: JsonObject;
    relations?: Array<{ target_external_id: string; kind: string }>;
  }>;
  configuration?: JsonObject;
}
export interface Page<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}
export interface AssetContext {
  schema_version: "1";
  trust: { content: "untrusted"; execution_authority: "none" };
  asset: Asset;
  monitors?: unknown[];
  configuration?: ConfigurationSnapshot[];
  relationships?: Relationship[];
  changes?: Change[];
  documents?: KnowledgeDocument[];
  baselines?: BaselineEvaluation[];
  limits: {
    per_section: number;
    max_bytes: number;
    truncated_sections: string[];
  };
}
