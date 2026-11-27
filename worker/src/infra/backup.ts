import {
  assetInput,
  baselineInput,
  documentInput,
  object,
  safeData,
  string,
  uuid,
  InfraError,
  boundedNumber,
} from "./validation.ts";
import type { JsonObject } from "./types.ts";
export const INVENTORY_BACKUP_TABLES = [
  "assets",
  "relationships",
  "monitor_links",
  "documents",
  "document_versions",
  "baselines",
  "baseline_versions",
] as const;
export type InventoryBackup = Record<
  (typeof INVENTORY_BACKUP_TABLES)[number],
  JsonObject[]
>;
function revision(value: unknown): number {
  const version = boundedNumber(value, "version", 1, 1e9);
  if (!Number.isSafeInteger(version))
    throw new InfraError("VALIDATION_ERROR", "Backup revisions must be integers");
  return version;
}
export function validateInventoryBackup(input: unknown): InventoryBackup {
  const data = object(input, "infrastructure"),
    output = {} as InventoryBackup;
  if (
    Object.keys(data).some(
      (k) => !(INVENTORY_BACKUP_TABLES as readonly string[]).includes(k),
    )
  )
    throw new InfraError(
      "VALIDATION_ERROR",
      "Unknown infrastructure backup table",
    );
  for (const key of INVENTORY_BACKUP_TABLES) {
    const rows = data[key];
    if (!Array.isArray(rows) || rows.length > 5000)
      throw new InfraError(
        "VALIDATION_ERROR",
        `infrastructure.${key} must contain at most 5000 rows`,
      );
    const identities = new Set<string>();
    output[key] = rows.map((value) => {
      const row = { ...object(value) };
      switch (key) {
        case "assets":
          uuid(row.id);
          assetInput(row);
          safeData(row.metadata);
          safeData(row.observed);
          break;
        case "relationships":
          uuid(row.id);
          uuid(row.source_id);
          uuid(row.target_id);
          string(row.kind, "kind", 40, true);
          break;
        case "monitor_links":
          uuid(row.asset_id);
          string(row.monitor_id, "monitor_id", 100, true);
          if (!["website", "client", "ping"].includes(String(row.monitor_type)))
            throw new InfraError("VALIDATION_ERROR", "Invalid monitor link");
          break;
        case "documents":
          if (!("asset_kinds" in row)) row.asset_kinds = [];
          uuid(row.id);
          documentInput(row);
          revision(row.version);
          break;
        case "baselines":
          uuid(row.id);
          baselineInput(row);
          revision(row.version);
          break;
        case "document_versions":
        case "baseline_versions": {
          const type = key === "document_versions" ? "document" : "baseline";
          const parentId = uuid(row[`${type}_id`]);
          const data = { ...object(row[type]) };
          if (type === "document") {
            if (!("asset_kinds" in data)) data.asset_kinds = [];
            documentInput(data);
          } else baselineInput(data);
          if (
            uuid(data.id).toLowerCase() !== parentId.toLowerCase() ||
            revision(data.version) !== revision(row.version)
          )
            throw new InfraError(
              "VALIDATION_ERROR",
              "Backup revision identity does not match its contents",
            );
          row[type] = data;
          break;
        }
      }
      const identity =
        key === "monitor_links"
          ? `${row.monitor_type}:${row.monitor_id}`
          : key.endsWith("_versions")
            ? `${String(row[key === "document_versions" ? "document_id" : "baseline_id"]).toLowerCase()}:${row.version}`
            : String(row.id).toLowerCase();
      if (identities.has(identity))
        throw new InfraError(
          "VALIDATION_ERROR",
          `Duplicate infrastructure.${key} identity`,
        );
      identities.add(identity);
      return row;
    });
  }
  if (new TextEncoder().encode(JSON.stringify(output)).length > 3 * 1024 * 1024)
    throw new InfraError(
      "PAYLOAD_TOO_LARGE",
      "Inventory configuration backup exceeds 3 MiB; use a database backup",
      413,
    );
  return output;
}
