import { Hono, type Context } from "hono";
import type { Bindings, Variables } from "../index";
import { hasMachineScope, type AdminApiScope } from "../auth/admin-api-token";
import { getDatabase } from "../db/provider";
import * as db from "../db/queries";
import { readJsonWithLimit } from "../utils/request-body";
import { websiteStatistics } from "../utils/website-statistics-service";
import { infra, assetContext } from "../infra/service";
import { evaluateBaseline } from "../infra/baselines";
import {
  InfraError,
  assetInput,
  baselineInput,
  boundedNumber,
  discoveryInput,
  documentInput,
  object,
  safeData,
  string,
  strings,
  timestamp,
  uuid,
} from "../infra/validation";
import type {
  Asset,
  Baseline,
  ConfigurationSnapshot,
  JsonObject,
  KnowledgeDocument,
  Page,
} from "../infra/types";

type Ctx = Context<{ Bindings: Bindings; Variables: Variables }>;
export const infrastructureRoutes = new Hono<{
  Bindings: Bindings;
  Variables: Variables;
}>();
const actor = (c: Ctx) =>
  c.get("username") || c.get("userId") || "administrator";
function requireScopes(c: Ctx, ...required: AdminApiScope[]) {
  const scopes = c.get("machineScopes");
  if (scopes && required.some((s) => !hasMachineScope(scopes, s)))
    throw new InfraError(
      "API_SCOPE_REQUIRED",
      `Additional scopes required: ${required.join(", ")}`,
      422,
    );
}
async function body(c: Ctx): Promise<JsonObject> {
  const result = await readJsonWithLimit(c.req.raw, 524288);
  if (!result.ok)
    throw new InfraError(
      result.reason === "too_large" ? "PAYLOAD_TOO_LARGE" : "VALIDATION_ERROR",
      result.reason,
      result.reason === "too_large" ? 413 : 400,
    );
  return object(result.body);
}
function query(c: Ctx, defaultLimit = 50): JsonObject {
  const q: JsonObject = { limit: defaultLimit, offset: 0 };
  for (const key of [
    "q",
    "kind",
    "status",
    "source",
    "category",
    "tag",
    "verification",
    "client_id",
    "monitor_type",
    "monitor_id",
    "sort",
  ]) {
    const val = c.req.query(key);
    if (val) q[key] = string(val, key, 200);
  }
  for (const key of ["asset_id", "baseline_id"]) {
    const val = c.req.query(key);
    if (val) q[key] = uuid(val, key);
  }
  for (const key of ["since", "until"]) {
    const val = c.req.query(key);
    if (val) q[key] = timestamp(val, key);
  }
  for (const [key, max] of [
    ["limit", 100],
    ["offset", 100000],
  ] as const) {
    const val = c.req.query(key);
    if (val !== undefined) {
      const num = Number(val);
      if (!Number.isInteger(num))
        throw new InfraError("VALIDATION_ERROR", `${key} must be an integer`);
      q[key] = boundedNumber(num, key, key === "limit" ? 1 : 0, max);
    }
  }
  if (
    q.since &&
    q.until &&
    Date.parse(q.since as string) > Date.parse(q.until as string)
  )
    throw new InfraError("VALIDATION_ERROR", "since must precede until");
  return q;
}
function run<T = unknown>(c: Ctx, op: string, p: JsonObject = {}) {
  return infra<T>(c.env, op, p, actor(c));
}
infrastructureRoutes.onError((error, c) => {
  if (error instanceof InfraError)
    return c.json(
      { code: error.code, error: error.message },
      error.code === "API_SCOPE_REQUIRED" ? 403 : error.status,
    );
  console.error(
    "[infrastructure] request failed",
    error instanceof Error ? error.name : "unknown",
  );
  return c.json(
    {
      code: "INFRASTRUCTURE_UNAVAILABLE",
      error: "Infrastructure storage is unavailable; no success is assumed",
    },
    503,
  );
});
infrastructureRoutes.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  await next();
});
infrastructureRoutes.get("/infrastructure/summary", async (c) => {
  const data = await run<JsonObject>(c, "summary"),
    scopes = c.get("machineScopes");
  if (scopes) {
    if (!hasMachineScope(scopes, "knowledge:read")) delete data.documents_total;
    if (!hasMachineScope(scopes, "discovery:read"))
      delete data.discovery_pending;
    if (!hasMachineScope(scopes, "changes:read")) delete data.changes_24h;
    if (!hasMachineScope(scopes, "baselines:read")) delete data.baselines_total;
    if (!hasMachineScope(scopes, "config:read"))
      delete data.configuration_total;
  }
  return c.json(data);
});
infrastructureRoutes.post("/infrastructure/cleanup", async (c) => {
  requireScopes(c, "config:write", "changes:write", "discovery:write", "baselines:write");
  return c.json(await run(c, "cleanup"));
});
infrastructureRoutes.get("/assets", async (c) =>
  c.json(await run(c, "assets.list", query(c))),
);
infrastructureRoutes.post("/assets", async (c) =>
  c.json(await run(c, "assets.save", assetInput(await body(c))), 201),
);
infrastructureRoutes.post("/assets/import", async (c) => {
  const b = await body(c);
  if (!Array.isArray(b.assets) || b.assets.length > 200)
    throw new InfraError(
      "VALIDATION_ERROR",
      "assets must contain at most 200 entries",
    );
  return c.json(
    await run(c, "assets.import", {
      assets: b.assets.map((a) => {
        const item = assetInput(a);
        // An inventory import cannot claim a live Agent identity from another instance.
        delete item.client_id;
        return { ...item, ...(object(a).id ? { import_id: uuid(object(a).id) } : {}) };
      }),
    }),
  );
});
infrastructureRoutes.post("/assets/batch", async (c) => {
  const b = await body(c);
  const ids = strings(b.ids, "ids", 100, 36).map((v) => uuid(v));
  if (!ids.length)
    throw new InfraError("VALIDATION_ERROR", "Select at least one asset");
  if (!["archive", "tag"].includes(String(b.action)))
    throw new InfraError("VALIDATION_ERROR", "Invalid batch action");
  return c.json(
    await run(c, "assets.batch", {
      ids,
      action: b.action,
      ...(b.action === "tag" ? { tags: strings(b.tags, "tags") } : {}),
    }),
  );
});
infrastructureRoutes.get("/assets/:id", async (c) =>
  c.json(await run(c, "assets.get", { id: uuid(c.req.param("id")) })),
);
infrastructureRoutes.patch("/assets/:id", async (c) =>
  c.json(
    await run(c, "assets.save", {
      ...assetInput(await body(c), true),
      id: uuid(c.req.param("id")),
    }),
  ),
);
infrastructureRoutes.post("/assets/:id/merge", async (c) => {
  const b = await body(c);
  return c.json(
    await run(c, "assets.merge", {
      id: uuid(c.req.param("id")),
      target_id: uuid(b.target_id, "target_id"),
    }),
  );
});
infrastructureRoutes.get("/assets/:id/context", async (c) => {
  const q = query(c, 20);
  if (Number(q.limit) > 50)
    throw new InfraError("VALIDATION_ERROR", "Context limit cannot exceed 50");
  if (c.req.query("fields") !== undefined)
    q.fields = string(c.req.query("fields"), "fields", 200);
  if (c.req.query("max_bytes"))
    q.max_bytes = boundedNumber(
      Number(c.req.query("max_bytes")),
      "max_bytes",
      4096,
      262144,
    );
  return c.json(
    await assetContext(
      c.env,
      uuid(c.req.param("id")),
      q,
      c.get("machineScopes"),
    ),
  );
});
infrastructureRoutes.get("/assets/:id/topology", async (c) => {
  const direction = c.req.query("direction") || "both";
  if (!["both", "upstream", "downstream"].includes(direction))
    throw new InfraError("VALIDATION_ERROR", "Invalid topology direction");
  const depth = boundedNumber(Number(c.req.query("depth") || 3), "depth", 1, 5);
  if (!Number.isInteger(depth))
    throw new InfraError("VALIDATION_ERROR", "depth must be an integer");
  return c.json(
    await run(c, "topology", { id: uuid(c.req.param("id")), direction, depth }),
  );
});
infrastructureRoutes.get("/assets/:id/monitors", async (c) => {
  requireScopes(c, "monitors:read");
  return c.json(
    await run(c, "monitors.list", { ...query(c), asset_id: uuid(c.req.param("id")) }),
  );
});
infrastructureRoutes.post("/assets/:id/monitors", async (c) => {
  requireScopes(c, "monitors:write");
  const b = await body(c);
  if (!["website", "ping", "client"].includes(String(b.monitor_type)))
    throw new InfraError("VALIDATION_ERROR", "Invalid monitor type");
  return c.json(
    await run(c, b.action === "unlink" ? "monitors.unlink" : "monitors.link", {
      asset_id: uuid(c.req.param("id")),
      monitor_type: b.monitor_type,
      monitor_id: string(String(b.monitor_id), "monitor_id", 100, true),
    }),
  );
});
infrastructureRoutes.get("/relationships", async (c) =>
  c.json(await run(c, "relationships.list", query(c))),
);
infrastructureRoutes.post("/relationships", async (c) => {
  const b = await body(c);
  if (
    ![
      "runs_on",
      "depends_on",
      "routes_to",
      "part_of",
      "deploys",
      "resolves_to",
      "uses",
      "exposes",
      "backs_up",
      "secured_by",
    ].includes(String(b.kind))
  )
    throw new InfraError("VALIDATION_ERROR", "Invalid relationship kind");
  return c.json(
    await run(c, "relationships.save", {
      source_id: uuid(b.source_id, "source_id"),
      target_id: uuid(b.target_id, "target_id"),
      kind: b.kind,
      description: string(b.description ?? "", "description", 1000),
    }),
  );
});
infrastructureRoutes.delete("/relationships/:id", async (c) =>
  c.json(await run(c, "relationships.delete", { id: uuid(c.req.param("id")) })),
);
infrastructureRoutes.get("/discovery/candidates", async (c) =>
  c.json(await run(c, "discovery.list", query(c))),
);
infrastructureRoutes.get("/discovery/runs", async (c) =>
  c.json(await run(c, "discovery.runs", query(c))),
);
infrastructureRoutes.post("/discovery/reports", async (c) => {
  const b = await body(c);
  if (b.configuration !== undefined) requireScopes(c, "config:write");
  const source = string(b.source ?? "external", "source", 80, true);
  const clientId = b.client_id
    ? string(b.client_id, "client_id", 100, true)
    : undefined;
  const report = discoveryInput(b, `harness:${actor(c)}:${source}`, clientId);
  return c.json(
    await run(c, "discovery.submit", report as unknown as JsonObject),
  );
});
infrastructureRoutes.post("/discovery/candidates/:id/resolve", async (c) => {
  const b = await body(c);
  if (!["import", "merge", "ignore"].includes(String(b.action)))
    throw new InfraError("VALIDATION_ERROR", "Invalid resolution");
  if (b.action !== "ignore") requireScopes(c, "assets:write");
  return c.json(
    await run(c, "discovery.resolve", {
      id: uuid(c.req.param("id")),
      action: b.action,
      ...(b.action === "merge"
        ? { asset_id: uuid(b.asset_id, "asset_id") }
        : {}),
    }),
  );
});
infrastructureRoutes.get("/configuration/snapshots", async (c) =>
  c.json(await run(c, "snapshots.list", query(c))),
);
infrastructureRoutes.post("/configuration/snapshots", async (c) => {
  const b = await body(c);
  const collectedAt = timestamp(b.collected_at, "collected_at");
  if (Date.parse(collectedAt) > Date.now() + 300000)
    throw new InfraError("VALIDATION_ERROR", "Configuration collection time cannot be in the future");
  return c.json(
    await run(c, "snapshots.save", {
      asset_id: uuid(b.asset_id, "asset_id"),
      collected_at: collectedAt,
      confidence: "reported",
      environment: string(b.environment ?? "", "environment", 200),
      data: safeData(b.data, 131072),
      collectors: [],
    }),
  );
});
infrastructureRoutes.get("/changes", async (c) =>
  c.json(await run(c, "changes.list", query(c))),
);
infrastructureRoutes.post("/operations", async (c) => {
  const b = await body(c);
  return c.json(
    await run(c, "operations.save", {
      asset_id: b.asset_id ? uuid(b.asset_id, "asset_id") : null,
      summary: string(b.summary, "summary", 1000, true),
      before: b.before ? safeData(b.before) : null,
      after: b.after ? safeData(b.after) : null,
      document_ids: b.document_ids
        ? strings(b.document_ids, "document_ids", 20, 36).map((v) => uuid(v))
        : [],
    }),
  );
});
infrastructureRoutes.get("/documents", async (c) =>
  c.json(await run(c, "documents.list", query(c))),
);
infrastructureRoutes.post("/documents", async (c) =>
  c.json(await run(c, "documents.save", documentInput(await body(c))), 201),
);
infrastructureRoutes.get("/documents/:id", async (c) =>
  c.json(await run(c, "documents.get", { id: uuid(c.req.param("id")) })),
);
infrastructureRoutes.patch("/documents/:id", async (c) =>
  c.json(
    await run(c, "documents.save", {
      ...documentInput(await body(c), true),
      id: uuid(c.req.param("id")),
    }),
  ),
);
infrastructureRoutes.get("/documents/:id/versions", async (c) => {
  const r = await run<
    Page<{ document: KnowledgeDocument; actor: string; created_at: string }>
  >(c, "documents.versions", { ...query(c), id: uuid(c.req.param("id")) });
  return c.json({
    ...r,
    data: r.data.map((v) => ({
      ...v.document,
      actor: v.actor,
      recorded_at: v.created_at,
    })),
  });
});
infrastructureRoutes.post("/documents/:id/restore", async (c) => {
  const b = await body(c);
  return c.json(
    await run(c, "documents.restore", {
      id: uuid(c.req.param("id")),
      version: boundedNumber(b.version, "version", 1, 1e9),
    }),
  );
});
infrastructureRoutes.get("/documents/:id/export", async (c) => {
  const doc = await run<KnowledgeDocument>(c, "documents.get", {
    id: uuid(c.req.param("id")),
  });
  c.header("Content-Type", "text/markdown; charset=utf-8");
  c.header("Content-Disposition", `attachment; filename="${doc.id}.md"`);
  return c.body(doc.content);
});
infrastructureRoutes.get("/baselines", async (c) =>
  c.json(await run(c, "baselines.list", query(c))),
);
infrastructureRoutes.post("/baselines", async (c) =>
  c.json(await run(c, "baselines.save", baselineInput(await body(c))), 201),
);
infrastructureRoutes.get("/baselines/:id", async (c) =>
  c.json(await run(c, "baselines.get", { id: uuid(c.req.param("id")) })),
);
infrastructureRoutes.patch("/baselines/:id", async (c) =>
  c.json(
    await run(c, "baselines.save", {
      ...baselineInput(await body(c), true),
      id: uuid(c.req.param("id")),
    }),
  ),
);
infrastructureRoutes.get("/baselines/:id/versions", async (c) => {
  const r = await run<
    Page<{ baseline: Baseline; actor: string; created_at: string }>
  >(c, "baselines.versions", { ...query(c), id: uuid(c.req.param("id")) });
  return c.json({
    ...r,
    data: r.data.map((v) => ({
      ...v.baseline,
      actor: v.actor,
      recorded_at: v.created_at,
    })),
  });
});
infrastructureRoutes.post("/baselines/:id/evaluate", async (c) => {
  requireScopes(c, "config:read", "assets:read");
  const b = await body(c),
    asset_id = uuid(b.asset_id, "asset_id");
  const [baseline, asset, snapshots] = await Promise.all([
    run<Baseline>(c, "baselines.get", { id: uuid(c.req.param("id")) }),
    run<Asset>(c, "assets.get", { id: asset_id }),
    run<Page<ConfigurationSnapshot>>(c, "snapshots.list", {
      asset_id,
      limit: 1,
    }),
  ]);
  return c.json(
    await run(
      c,
      "evaluations.save",
      evaluateBaseline(
        baseline,
        asset,
        snapshots.data[0] ?? null,
      ) as unknown as JsonObject,
    ),
  );
});
infrastructureRoutes.get("/search", async (c) => {
  const q = query(c, 10),
    scopes = c.get("machineScopes");
  if (!q.q)
    return c.json({
      assets: [],
      documents: [],
      changes: [],
      limit: q.limit,
      truncated: false,
    });
  const [assets, documents, changes] = await Promise.all([
    run<Page<Asset>>(c, "assets.list", q),
    !scopes || hasMachineScope(scopes, "knowledge:read")
      ? run<Page<KnowledgeDocument>>(c, "documents.list", q)
      : null,
    !scopes || hasMachineScope(scopes, "changes:read")
      ? run<Page<unknown>>(c, "changes.list", q)
      : null,
  ]);
  return c.json({
    assets: assets.data,
    documents:
      documents?.data.map((d) => ({
        ...d,
        content: d.content.slice(0, 400),
      })) ?? [],
    changes: changes?.data ?? [],
    limit: q.limit,
    truncated:
      assets.total > assets.data.length ||
      Boolean(documents && documents.total > documents.data.length) ||
      Boolean(changes && changes.total > changes.data.length),
  });
});
infrastructureRoutes.get("/websites/:id/statistics", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isSafeInteger(id) || id < 1)
    throw new InfraError("VALIDATION_ERROR", "Invalid website ID");
  const database = getDatabase(c.env),
    monitor = await db.getWebsiteMonitor(database, id);
  if (!monitor)
    throw new InfraError(
      "RESOURCE_NOT_FOUND",
      "Website monitor does not exist",
      404,
    );
  const until = c.req.query("until")
    ? timestamp(c.req.query("until"), "until")
    : new Date().toISOString();
  const since = c.req.query("since")
    ? timestamp(c.req.query("since"), "since")
    : new Date(Date.parse(until) - 86400000).toISOString();
  if (
    Date.parse(until) <= Date.parse(since) ||
    Date.parse(until) - Date.parse(since) > 30 * 86400000
  )
    throw new InfraError(
      "VALIDATION_ERROR",
      "Statistics window must be positive and at most 30 days",
    );
  return c.json(
    await websiteStatistics(
      database,
      monitor,
      since,
      until,
      c.req.query("source") || "worker",
    ),
  );
});
