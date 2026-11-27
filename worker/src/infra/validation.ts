import {
  ASSET_KINDS,
  type Baseline,
  type BaselineRule,
  type DiscoveryReport,
  type JsonObject,
} from "./types.ts";

export class InfraError extends Error {
  readonly code: string;
  readonly status: 400 | 404 | 409 | 413 | 422 | 503;
  constructor(
    code: string,
    message: string,
    status: 400 | 404 | 409 | 413 | 422 | 503 = 400,
  ) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
export function object(value: unknown, field = "body"): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new InfraError("VALIDATION_ERROR", `${field} must be an object`);
  return value as JsonObject;
}
export function string(
  value: unknown,
  field: string,
  max = 200,
  required = false,
): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  )
    throw new InfraError(
      "VALIDATION_ERROR",
      `${field} must be ${required ? "nonempty " : ""}text of at most ${max} characters`,
    );
  return value.trim();
}
export function uuid(value: unknown, field = "id"): string {
  const id = string(value, field, 36, true);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id,
    )
  )
    throw new InfraError("VALIDATION_ERROR", `${field} must be a UUID`);
  return id;
}
export function strings(
  value: unknown,
  field: string,
  maxItems = 40,
  maxLength = 100,
): string[] {
  if (!Array.isArray(value) || value.length > maxItems)
    throw new InfraError(
      "VALIDATION_ERROR",
      `${field} must be an array of at most ${maxItems} strings`,
    );
  return [...new Set(value.map((v) => string(v, field, maxLength, true)))];
}
export function timestamp(value: unknown, field: string): string {
  const text = string(value, field, 40, true);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(text) || !Number.isFinite(Date.parse(text)))
    throw new InfraError(
      "VALIDATION_ERROR",
      `${field} must be an ISO timestamp`,
    );
  return new Date(text).toISOString();
}
export function boundedNumber(
  value: unknown,
  field: string,
  min: number,
  max: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw new InfraError(
      "VALIDATION_ERROR",
      `${field} must be between ${min} and ${max}`,
    );
  return value;
}
const secretKey =
  /^(?:(?:[a-z0-9]+_)*(?:password|passwd|private_key|secret|secret_key|api_key|token|credentials|authorization|cookie)|env|env_vars|environment_variables|raw_config|config_content|database_url|connection_string)$/i;
const secretValue =
  /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|\b(?:sb_secret_|gh[pousr]_|github_pat_|sk-proj-)[A-Za-z0-9_-]{12,}|\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=-]{12,}/i;
function sensitiveKey(key: string): boolean {
  return secretKey.test(key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/-/g, "_"));
}
export function safeData(value: unknown, maxBytes = 32768): JsonObject {
  const data = object(value);
  const visit = (entry: unknown, depth: number): void => {
    if (depth > 8)
      throw new InfraError("VALIDATION_ERROR", "Nested data exceeds 8 levels");
    if (typeof entry === "string" && secretValue.test(entry))
      throw new InfraError(
        "SENSITIVE_DATA_REJECTED",
        "Credentials and private keys must not be uploaded",
      );
    if (Array.isArray(entry)) {
      if (entry.length > 1000)
        throw new InfraError("VALIDATION_ERROR", "Array is too large");
      entry.forEach((v) => visit(v, depth + 1));
    } else if (entry && typeof entry === "object")
      for (const [key, val] of Object.entries(entry)) {
        if (
          sensitiveKey(key) ||
          ["__proto__", "constructor", "prototype"].includes(key)
        )
          throw new InfraError(
            "SENSITIVE_DATA_REJECTED",
            `Field ${key} is not permitted`,
          );
        visit(val, depth + 1);
      }
  };
  visit(data, 0);
  if (new TextEncoder().encode(JSON.stringify(data)).length > maxBytes)
    throw new InfraError(
      "PAYLOAD_TOO_LARGE",
      "Structured data is too large",
      413,
    );
  return data;
}
export function assetInput(value: unknown, partial = false): JsonObject {
  const input = object(value),
    out: JsonObject = {};
  for (const key of ["kind", "name"])
    if (!partial || key in input)
      out[key] = string(input[key], key, key === "kind" ? 40 : 200, true);
  if (
    out.kind &&
    !ASSET_KINDS.includes(out.kind as (typeof ASSET_KINDS)[number])
  )
    throw new InfraError("VALIDATION_ERROR", "Unsupported asset kind");
  for (const key of [
    "category",
    "provider",
    "billing_cycle",
    "currency",
    "description",
    "external_id",
    "source",
    "url",
  ])
    if (key in input)
      out[key] = string(
        input[key],
        key,
        key === "description" ? 4000 : key === "url" ? 2000 : key === "external_id" ? 240 : 200,
      );
  if ("url" in out && out.url) {
    let url: URL;
    try {
      url = new URL(out.url as string);
    } catch {
      throw new InfraError("VALIDATION_ERROR", "Invalid asset URL");
    }
    if (
      !["https:", "http:", "tcp:", "dns:", "ws:", "wss:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new InfraError(
        "VALIDATION_ERROR",
        "Asset URLs must use HTTP(S), TCP, DNS or WS(S) without credentials",
      );
    if ([...url.searchParams.keys()].some(sensitiveKey))
      throw new InfraError("SENSITIVE_DATA_REJECTED", "Asset URLs must not contain authentication query parameters");
  }
  if ("status" in input) {
    if (!["active", "planned", "archived"].includes(String(input.status)))
      throw new InfraError("VALIDATION_ERROR", "Invalid asset status");
    out.status = input.status;
  }
  if ("tags" in input) out.tags = strings(input.tags, "tags");
  if ("metadata" in input) out.metadata = safeData(input.metadata);
  if ("client_id" in input)
    out.client_id =
      input.client_id === null
        ? null
        : string(input.client_id, "client_id", 100, true);
  if ("cost" in input)
    out.cost =
      input.cost === null ? null : boundedNumber(input.cost, "cost", 0, 1e12);
  if ("expires_at" in input)
    out.expires_at =
      input.expires_at === null || input.expires_at === ""
        ? null
        : timestamp(input.expires_at, "expires_at");
  safeData(out, 65536);
  return out;
}
export function documentInput(value: unknown, partial = false): JsonObject {
  const input = object(value),
    out: JsonObject = {};
  for (const key of ["title", "content"])
    if (!partial || key in input)
      out[key] = string(
        input[key],
        key,
        key === "content" ? 100000 : 200,
        true,
      );
  for (const key of ["slug", "category"])
    if (key in input) out[key] = string(input[key], key, 200);
  if (out.slug && !/^[a-z0-9][a-z0-9-]{0,199}$/.test(String(out.slug)))
    throw new InfraError(
      "VALIDATION_ERROR",
      "slug must use lowercase letters, digits and hyphens",
    );
  for (const key of ["tags", "environments", "asset_ids", "asset_kinds"])
    if (key in input) out[key] = strings(input[key], key, 50);
  if (
    out.asset_kinds &&
    (out.asset_kinds as string[]).some(
      (kind) => !ASSET_KINDS.includes(kind as (typeof ASSET_KINDS)[number]),
    )
  )
    throw new InfraError("VALIDATION_ERROR", "Invalid document asset kind");
  if (out.asset_ids)
    (out.asset_ids as string[]).forEach((v) => uuid(v, "asset_ids"));
  if ("risk" in input) {
    if (!["low", "medium", "high"].includes(String(input.risk)))
      throw new InfraError("VALIDATION_ERROR", "Invalid risk");
    out.risk = input.risk;
  }
  if ("version" in input)
    out.version = boundedNumber(input.version, "version", 1, 1e9);
  if (typeof out.content === "string" && secretValue.test(out.content))
    throw new InfraError(
      "SENSITIVE_DATA_REJECTED",
      "Remove credentials from the document",
    );
  return out;
}
export function baselineInput(value: unknown, partial = false): JsonObject {
  const input = object(value),
    out: JsonObject = {};
  if (!partial || "name" in input)
    out.name = string(input.name, "name", 200, true);
  if ("description" in input)
    out.description = string(input.description, "description", 4000);
  for (const key of ["environments", "asset_kinds"])
    if (key in input) out[key] = strings(input[key], key);
  if (
    out.asset_kinds &&
    (out.asset_kinds as string[]).some(
      (k) => !ASSET_KINDS.includes(k as (typeof ASSET_KINDS)[number]),
    )
  )
    throw new InfraError("VALIDATION_ERROR", "Invalid baseline asset kind");
  if (!partial || "rules" in input) {
    if (
      !Array.isArray(input.rules) ||
      input.rules.length > 100 ||
      !input.rules.length
    )
      throw new InfraError("VALIDATION_ERROR", "A baseline needs 1–100 rules");
    out.rules = input.rules.map((r): BaselineRule => {
      const rule = object(r),
        id = string(rule.id, "rule.id", 80, true),
        path = string(rule.path, "rule.path", 200, true);
      if (
        !/^[A-Za-z0-9_.-]+$/.test(path) ||
        path
          .split(".")
          .some((x) => ["__proto__", "prototype", "constructor"].includes(x))
      )
        throw new InfraError("VALIDATION_ERROR", "Invalid rule path");
      if (
        !["eq", "neq", "exists", "in", "gte", "lte", "contains"].includes(
          String(rule.operator),
        )
      )
        throw new InfraError("VALIDATION_ERROR", "Invalid rule operator");
      if (!["info", "warning", "critical"].includes(String(rule.severity)))
        throw new InfraError("VALIDATION_ERROR", "Invalid rule severity");
      return {
        id,
        path,
        operator: rule.operator as BaselineRule["operator"],
        expected: rule.expected,
        severity: rule.severity as BaselineRule["severity"],
        description: string(rule.description ?? "", "description", 1000),
        ...(rule.sop_id ? { sop_id: uuid(rule.sop_id, "sop_id") } : {}),
      };
    });
    if (
      new Set((out.rules as BaselineRule[]).map((r) => r.id)).size !==
      (out.rules as BaselineRule[]).length
    )
      throw new InfraError("VALIDATION_ERROR", "Rule IDs must be unique");
  }
  if ("exceptions" in input) {
    if (!Array.isArray(input.exceptions) || input.exceptions.length > 100)
      throw new InfraError("VALIDATION_ERROR", "Too many exceptions");
    out.exceptions = input.exceptions.map((v) => {
      const e = object(v);
      return {
        rule_id: string(e.rule_id, "rule_id", 80, true),
        asset_id: uuid(e.asset_id),
        reason: string(e.reason, "reason", 1000, true),
        expires_at: timestamp(e.expires_at, "expires_at"),
      };
    });
  }
  if ("max_age_hours" in input)
    out.max_age_hours = boundedNumber(
      input.max_age_hours,
      "max_age_hours",
      1,
      8760,
    );
  if ("version" in input)
    out.version = boundedNumber(input.version, "version", 1, 1e9);
  safeData(out, 100000);
  return out as Partial<Baseline> as JsonObject;
}
export function discoveryInput(
  value: unknown,
  source: string,
  clientId?: string,
): DiscoveryReport {
  const input = object(value);
  if (input.schema_version !== 1 || typeof input.complete !== "boolean")
    throw new InfraError(
      "VALIDATION_ERROR",
      "schema_version=1 and complete are required",
    );
  const collected_at = timestamp(input.collected_at, "collected_at");
  if (
    Date.parse(collected_at) > Date.now() + 300000 ||
    Date.parse(collected_at) < Date.now() - 7 * 86400000
  )
    throw new InfraError(
      "VALIDATION_ERROR",
      "Discovery collection time must be within the last 7 days",
    );
  if (!Array.isArray(input.assets) || input.assets.length > 500)
    throw new InfraError(
      "VALIDATION_ERROR",
      "Discovery allows at most 500 assets",
    );
  if (!Array.isArray(input.collectors) || input.collectors.length > 40)
    throw new InfraError("VALIDATION_ERROR", "collectors must be an array");
  const collectors = input.collectors.map((v) => {
    const x = object(v);
    const status = string(x.status, "status", 40, true);
    if (
      ![
        "ok",
        "success",
        "available",
        "unknown",
        "unsupported",
        "unavailable",
        "permission_denied",
        "error",
        "disabled",
        "partial",
      ].includes(status)
    )
      throw new InfraError("VALIDATION_ERROR", "Invalid collector status");
    return {
      name: string(x.name, "collector.name", 80, true),
      status,
      ...(x.reason ? { reason: string(x.reason, "reason", 500) } : {}),
    };
  });
  const assets = input.assets.map((v) => {
    const a = object(v),
      kind = string(
        a.kind,
        "kind",
        40,
        true,
      ) as DiscoveryReport["assets"][number]["kind"];
    if (!ASSET_KINDS.includes(kind))
      throw new InfraError("VALIDATION_ERROR", "Invalid discovered asset kind");
    const relations = a.relations === undefined ? [] : a.relations;
    if (!Array.isArray(relations) || relations.length > 30)
      throw new InfraError("VALIDATION_ERROR", "Too many relations");
    return {
      external_id: string(a.external_id, "external_id", 240, true),
      kind,
      name: string(a.name, "name", 200, true),
      metadata: safeData(a.metadata ?? {}),
      evidence: safeData(a.evidence ?? {}),
      relations: relations.map((v) => {
        const r = object(v);
        return {
          target_external_id: string(
            r.target_external_id,
            "target_external_id",
            240,
            true,
          ),
          kind: string(r.kind, "relationship.kind", 40, true),
        };
      }),
    };
  });
  if (new Set(assets.map((a) => a.external_id)).size !== assets.length)
    throw new InfraError("VALIDATION_ERROR", "Duplicate discovery external_id");
  return {
    schema_version: 1,
    source,
    collected_at,
    complete: input.complete,
    collectors,
    assets,
    ...(clientId ? { client_id: clientId } : {}),
    ...(input.configuration
      ? { configuration: safeData(input.configuration, 131072) }
      : {}),
  };
}
