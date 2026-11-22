// CF VPS Monitor Supabase Data API proxy.
//
// The Worker stores only SUPABASE_PROXY_TOKEN. This function keeps Supabase's
// server-side secret inside Supabase and forwards only the app's approved REST/RPC
// surface. EXPECTED_TOKEN_SHA256 is a verifier for a 256-bit random token, not the
// token itself. Rotate both the Worker secret and this verifier together.
const EXPECTED_TOKEN_SHA256 = "b598eff980d5ad4f0409a9b01e9bf27c922d01dd55140ca0997896c21e6fdff2";

const ALLOWED_TABLES = new Set(["settings", "website_monitors", "website_checks"]);
const ALLOWED_METHODS = new Set(["GET", "POST", "PATCH", "DELETE"]);
const ALLOWED_PREFER = new Set(["", "return=minimal", "resolution=merge-duplicates,return=minimal"]);

function constantTimeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}

function serverKey(): string {
  const modern = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (modern) {
    try {
      const parsed = JSON.parse(modern);
      const key = String(parsed?.default || "").trim();
      if (key) return key;
    } catch {
      // Fall through to the legacy service-role key.
    }
  }
  return (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
}

function dataApiHeaders(key: string, prefer = ""): Headers {
  const headers = new Headers({
    apikey: key,
    "Content-Type": "application/json",
    Accept: "application/json",
  });
  if (!key.startsWith("sb_secret_")) headers.set("Authorization", `Bearer ${key}`);
  if (prefer) headers.set("Prefer", prefer);
  return headers;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const providedToken = req.headers.get("x-cfvm-proxy-token") || "";
  if (!providedToken || providedToken.length > 256) return new Response("forbidden", { status: 403 });
  const tokenDigest = await sha256Hex(providedToken);
  if (!constantTimeEqual(tokenDigest, EXPECTED_TOKEN_SHA256)) {
    return new Response("forbidden", { status: 403 });
  }

  const raw = await req.text();
  if (raw.length > 1_500_000) return new Response("payload too large", { status: 413 });

  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  const key = serverKey();
  const base = (Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, "");
  if (!key || !base) return new Response("supabase runtime credentials unavailable", { status: 500 });

  let target: string;
  let method = "POST";
  let body: string | undefined;
  let prefer = "";

  if (payload?.kind === "rpc") {
    const functionName = String(payload.functionName || "");
    if (!/^cfm_[a-z0-9_]+$/.test(functionName)) return new Response("rpc forbidden", { status: 403 });
    target = `${base}/rest/v1/rpc/${encodeURIComponent(functionName)}`;
    body = JSON.stringify(payload.body && typeof payload.body === "object" ? payload.body : {});
  } else if (payload?.kind === "table") {
    const path = String(payload.path || "");
    if (!path || path.includes("#") || path.includes("\\") || path.includes("..")) {
      return new Response("table path forbidden", { status: 403 });
    }

    const queryIndex = path.indexOf("?");
    const table = queryIndex >= 0 ? path.slice(0, queryIndex) : path;
    const query = queryIndex >= 0 ? path.slice(queryIndex + 1) : "";
    if (!ALLOWED_TABLES.has(table) || table.includes("/")) return new Response("table forbidden", { status: 403 });

    method = String(payload.method || "GET").toUpperCase();
    if (!ALLOWED_METHODS.has(method)) return new Response("method forbidden", { status: 405 });

    const incomingHeaders = payload.headers && typeof payload.headers === "object" ? payload.headers : {};
    prefer = String(incomingHeaders.prefer || incomingHeaders.Prefer || "");
    if (!ALLOWED_PREFER.has(prefer)) return new Response("prefer forbidden", { status: 403 });

    const url = new URL(`${base}/rest/v1/${table}`);
    if (query) url.search = query;
    target = url.toString();
    if (typeof payload.body === "string") body = payload.body;
  } else {
    return new Response("operation forbidden", { status: 403 });
  }

  const upstream = await fetch(target, {
    method,
    headers: dataApiHeaders(key, prefer),
    ...(body === undefined || method === "GET" || method === "DELETE" ? {} : { body }),
  });

  const responseHeaders = new Headers({
    "Cache-Control": "no-store, max-age=0",
    "Content-Type": upstream.headers.get("content-type") || "application/json",
  });
  const contentRange = upstream.headers.get("content-range");
  if (contentRange) responseHeaders.set("Content-Range", contentRange);

  if (upstream.status === 204) return new Response(null, { status: 204, headers: responseHeaders });
  return new Response(await upstream.arrayBuffer(), { status: upstream.status, headers: responseHeaders });
});
