import type {
  Asset,
  Baseline,
  BaselineEvaluation,
  ConfigurationSnapshot,
} from "./types";

const unavailableStatuses = new Set(["unknown", "unavailable", "permission_denied", "unsupported", "error", "disabled", "partial"]);

function equalValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right))
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => equalValue(value, right[index]));
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equalValue(a[key], b[key]));
}

function atPath(data: unknown, path: string): unknown {
  let value = data;
  for (const part of path.split(".")) {
    if (
      value &&
      typeof value === "object" &&
      unavailableStatuses.has(String((value as Record<string, unknown>).status))
    )
      return value;
    if (!value || typeof value !== "object" || !Object.hasOwn(value, part))
      return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}
export function evaluateBaseline(
  baseline: Baseline,
  asset: Asset,
  snapshot: ConfigurationSnapshot | null,
  now = new Date(),
): BaselineEvaluation {
  const applicable =
    (!baseline.asset_kinds.length ||
      baseline.asset_kinds.includes(asset.kind)) &&
    (!baseline.environments.length ||
      Boolean(
        snapshot &&
        baseline.environments.some((e) =>
          snapshot.environment.toLowerCase().includes(e.toLowerCase()),
        ),
      ));
  const stale = Boolean(
    snapshot &&
    now.getTime() - Date.parse(snapshot.collected_at) >
      baseline.max_age_hours * 3600000,
  );
  const invalidTime = Boolean(snapshot && (!Number.isFinite(Date.parse(snapshot.collected_at)) || Date.parse(snapshot.collected_at) > now.getTime() + 300000));
  const results: BaselineEvaluation["results"] = baseline.rules.map((rule) => {
    const base = {
      rule_id: rule.id,
      expected: rule.expected,
      description: rule.description,
      severity: rule.severity,
      ...(rule.sop_id ? { sop_id: rule.sop_id } : {}),
      evidence: snapshot ? { source: snapshot.source, confidence: snapshot.confidence, collected_at: snapshot.collected_at } : null,
    };
    const exception = baseline.exceptions.find(
      (e) =>
        e.rule_id === rule.id &&
        e.asset_id === asset.id &&
        Date.parse(e.expires_at) > now.getTime(),
    );
    if (exception)
      return {
        ...base,
        status: "exception",
        exception_reason: exception.reason,
      };
    if (!snapshot || !applicable || snapshot.confidence === "unknown" || invalidTime)
      return { ...base, status: "unknown" };
    if (stale) return { ...base, status: "stale" };
    const actual = atPath(snapshot.data, rule.path);
    if (actual === undefined || actual === null)
      return { ...base, status: "missing" };
    if (
      typeof actual === "object" &&
      unavailableStatuses.has(String((actual as Record<string, unknown>).status))
    )
      return { ...base, actual, status: "unknown" };
    let passed = false;
    switch (rule.operator) {
      case "exists":
        passed = true;
        break;
      case "eq":
        passed = equalValue(actual, rule.expected);
        break;
      case "neq":
        passed = !equalValue(actual, rule.expected);
        break;
      case "in":
        passed =
          Array.isArray(rule.expected) &&
          rule.expected.some(
            (x) => equalValue(x, actual),
          );
        break;
      case "gte":
        passed =
          typeof actual === "number" &&
          typeof rule.expected === "number" &&
          actual >= rule.expected;
        break;
      case "lte":
        passed =
          typeof actual === "number" &&
          typeof rule.expected === "number" &&
          actual <= rule.expected;
        break;
      case "contains":
        passed =
          (typeof actual === "string" &&
            typeof rule.expected === "string" &&
            actual.includes(rule.expected)) ||
          (Array.isArray(actual) &&
            actual.some(
              (x) => equalValue(x, rule.expected),
            ));
        break;
    }
    return { ...base, actual, status: passed ? "compliant" : "deviation" };
  });
  const status: BaselineEvaluation["status"] = results.some(
    (r) => r.status === "deviation",
  )
    ? "deviation"
    : results.some((r) => r.status === "stale")
      ? "stale"
      : results.some((r) => r.status === "unknown")
        ? "unknown"
        : results.some((r) => r.status === "missing")
          ? "missing"
          : "compliant";
  return {
    baseline_id: baseline.id,
    baseline_version: baseline.version,
    asset_id: asset.id,
    snapshot_id: snapshot?.id ?? null,
    evaluated_at: now.toISOString(),
    status,
    results,
  };
}
