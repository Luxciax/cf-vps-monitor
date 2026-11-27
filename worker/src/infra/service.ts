import {
  callSupabaseRpc,
  type SupabaseApiEnv,
} from "../db/supabase-api/client";
import { hasMachineScope, type AdminApiScope } from "../auth/admin-api-token";
import type {
  Asset,
  AssetContext,
  BaselineEvaluation,
  Change,
  ConfigurationSnapshot,
  JsonObject,
  KnowledgeDocument,
  Page,
  Relationship,
} from "./types";
import { InfraError } from "./validation";

export async function infra<T>(
  env: SupabaseApiEnv,
  operation: string,
  payload: JsonObject = {},
  actor = "system",
): Promise<T> {
  try {
    return await callSupabaseRpc<T>(env, "cfm_infra", {
      p_operation: operation,
      p_payload: payload,
      p_actor: actor,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("CVM_NOT_FOUND"))
      throw new InfraError(
        "RESOURCE_NOT_FOUND",
        "Requested infrastructure resource does not exist",
        404,
      );
    if (message.includes("CVM_CONFLICT") || message.includes("23505"))
      throw new InfraError(
        "RESOURCE_CONFLICT",
        "Resource identity or version conflicts with existing data; refresh before retrying",
        409,
      );
    if (message.includes("CVM_INVALID") || /23514|23503|22P02/.test(message))
      throw new InfraError(
        "VALIDATION_ERROR",
        "Invalid value or linked resource",
      );
    if (message.includes("PGRST202") || message.includes("42P01"))
      throw new InfraError(
        "INFRASTRUCTURE_MIGRATION_REQUIRED",
        "Apply the bundled infrastructure migrations before using this feature",
        503,
      );
    throw error;
  }
}
const sectionScopes: Record<string, AdminApiScope> = {
  asset: "assets:read",
  relationships: "assets:read",
  monitors: "monitors:read",
  configuration: "config:read",
  changes: "changes:read",
  documents: "knowledge:read",
  baselines: "baselines:read",
};
export function permittedSections(
  fields: string | undefined,
  scopes?: AdminApiScope[],
): string[] {
  const requested = fields
    ? fields.split(",").map((v) => v.trim())
    : Object.keys(sectionScopes);
  if (requested.some((s) => !sectionScopes[s]))
    throw new InfraError("VALIDATION_ERROR", "Unknown context section");
  return [...new Set(["asset", ...requested])].filter(
    (s) => !scopes || hasMachineScope(scopes, sectionScopes[s]),
  );
}
export async function assetContext(
  env: SupabaseApiEnv,
  id: string,
  options: JsonObject,
  scopes?: AdminApiScope[],
): Promise<AssetContext> {
  const limit = Number(options.limit ?? 20),
    maxBytes = Math.min(Number(options.max_bytes ?? 131072), 262144);
  const sections = permittedSections(
    options.fields as string | undefined,
    scopes,
  );
  const asset = await infra<Asset>(env, "assets.get", { id });
  const context: AssetContext = {
    schema_version: "1",
    trust: { content: "untrusted", execution_authority: "none" },
    asset,
    limits: { per_section: limit, max_bytes: maxBytes, truncated_sections: [] },
  };
  const operations: Record<string, string> = {
    monitors: "monitors.list",
    configuration: "snapshots.list",
    relationships: "relationships.list",
    changes: "changes.list",
    documents: "documents.applicable",
    baselines: "evaluations.list",
  };
  const results = await Promise.all(
    sections
      .filter((s) => s !== "asset")
      .map(async (section) => {
        const data = await infra<Page<unknown> | unknown[]>(
          env,
          operations[section],
          {
            asset_id: id,
            limit: limit + 1,
            ...(options.since ? { since: options.since } : {}),
            ...(options.until ? { until: options.until } : {}),
          },
        );
        if (Array.isArray(data) ? data.length > limit : data.total > limit)
          context.limits.truncated_sections.push(section);
        return {
          section,
          rows: (Array.isArray(data) ? data : data.data).slice(0, limit),
        };
      }),
  );
  for (const { section, rows } of results) {
    switch (section) {
      case "monitors":
        context.monitors = rows;
        break;
      case "configuration":
        context.configuration = rows as ConfigurationSnapshot[];
        break;
      case "relationships":
        context.relationships = rows as Relationship[];
        break;
      case "changes":
        context.changes = rows as Change[];
        break;
      case "documents":
        context.documents = rows as KnowledgeDocument[];
        break;
      case "baselines":
        context.baselines = rows as BaselineEvaluation[];
        break;
    }
  }
  const encoder = new TextEncoder();
  const shell: JsonObject = { ...context };
  const budgets = results.map(result => {
    shell[result.section] = [];
    const rowBytes = result.rows.map(row => encoder.encode(JSON.stringify(row)).length);
    return { ...result, rowBytes, bytes: rowBytes.reduce((sum,size) => sum+size,0) + Math.max(0,rowBytes.length-1) };
  });
  let rowsBytes = budgets.reduce((sum,section) => sum+section.bytes,0);
  // Serialize each row once. Re-serializing all remaining history on every pop
  // made large contexts quadratic in Worker CPU and temporary string allocations.
  while (encoder.encode(JSON.stringify(shell)).length + rowsBytes > maxBytes) {
    const largest = budgets
      .filter((r) => r.rows.length)
      .sort((a,b) => b.bytes-a.bytes)[0];
    if (!largest)
      throw new InfraError(
        "CONTEXT_TOO_LARGE",
        "The asset alone exceeds max_bytes; increase the limit",
        413,
      );
    largest.rows.pop();
    const removedBytes = largest.rowBytes.pop()! + (largest.rows.length ? 1 : 0);
    largest.bytes -= removedBytes;
    rowsBytes -= removedBytes;
    if (!context.limits.truncated_sections.includes(largest.section))
      context.limits.truncated_sections.push(largest.section);
  }
  return context;
}
