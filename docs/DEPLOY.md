# Deployment

This document is the deployment entrypoint for humans and Codex. For machine API
operations after deployment, see [API.md](API.md).

## Requirements

- Node.js 24
- Go version compatible with `agent/go.mod`
- A Cloudflare account with Workers access
- A Supabase project
- Wrangler authentication or a Cloudflare API token suitable for deployment

Required runtime configuration:

| Name | Type | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | Variable | Supabase project URL |
| `SUPABASE_SECRET_KEY` | Secret | Direct mode: Supabase Secret key |
| `SUPABASE_PROXY_URL` | Variable | Proxy mode: Supabase Edge Function URL |
| `SUPABASE_PROXY_TOKEN` | Secret | Proxy mode: random Worker-to-Edge proxy token |
| `JWT_SECRET` | Secret | Browser admin session signing key, at least 32 bytes |

Optional machine API configuration:

| Name | Type | Purpose |
| --- | --- | --- |
| `ADMIN_API_TOKEN` | Secret | Optional legacy Bearer token; independent database tokens are managed in the authenticated UI |
| `ADMIN_API_TOKEN_SCOPES` | Variable | `read` by default; prefer the fine-grained scopes documented in API.md |
| `ADMIN_RECOVERY_ENABLED` | Variable | `false` by default; enable only for an intended administrator recovery |
| `ADMIN_RECOVERY_TOKEN` | Secret | Independent random recovery secret, at least 32 characters; never a Supabase key |

## Cloudflare Workers Builds

Configure these in **Workers & Pages -> your Worker -> Settings -> Build -> Variables
and Secrets**.

Recommended values:

```text
NODE_VERSION=24
SUPABASE_URL=https://PROJECT_REF.supabase.co
# Direct mode:
SUPABASE_SECRET_KEY=<secret>
# Or proxy mode:
# SUPABASE_PROXY_URL=https://PROJECT_REF.supabase.co/functions/v1/cfvm-db-proxy
# SUPABASE_PROXY_TOKEN=<random 32-byte-or-longer token>
JWT_SECRET=<random secret at least 32 bytes>
ADMIN_API_TOKEN=<64 hex characters recommended>
ADMIN_API_TOKEN_SCOPES=read,write
ADMIN_RECOVERY_ENABLED=false
```

`JWT_SECRET` and `ADMIN_API_TOKEN` should be Secrets. For database access, configure either direct mode (`SUPABASE_SECRET_KEY`) or proxy mode (`SUPABASE_PROXY_URL` + `SUPABASE_PROXY_TOKEN`). Proxy mode keeps the Supabase server key inside Supabase Edge Functions; the Worker prefers proxy mode when both are configured.

Build command:

```text
npm run build
```

Deploy command:

```text
npm run deploy
```

The deployment wrapper validates the repository, runs verification, constructs a
temporary Wrangler configuration, forwards configured secrets via a temporary
0600-permission secrets file, and removes that file after deployment.

For Workers Builds, this repository's deploy gate requires successful GitHub CI for
the exact commit being deployed. Do not bypass that gate to work around a failed or
missing CI run.

## Local / Codex deployment

Install dependencies:

```bash
npm ci
```

Authenticate Wrangler if needed:

```bash
npx wrangler login
```

Set the Supabase URL and Worker secrets. Direct mode:

```bash
export SUPABASE_URL=https://PROJECT_REF.supabase.co
npx wrangler secret put SUPABASE_SECRET_KEY
npx wrangler secret put JWT_SECRET
```

Proxy mode keeps the Supabase server key inside Supabase Edge Functions. Generate
a random token locally (`npm run cfvm -- token generate`) and place it in the
Worker's `SUPABASE_PROXY_TOKEN` secret. Calculate its SHA-256 hex verifier locally
without logging the token. Set that verifier as the **Supabase Edge Function
secret** `CFVM_PROXY_TOKEN_SHA256`, then deploy `cfvm-db-proxy`. The verifier is
runtime configuration: never edit or commit authentication values in source.
The function accepts only an explicit RPC/table allowlist and fails closed when its
verifier is absent. It reads the Supabase-provided `SUPABASE_SECRET_KEYS.default`
or legacy `SUPABASE_SERVICE_ROLE_KEY` inside Supabase.

The function verifies the dedicated proxy token itself. If Supabase's gateway JWT
verification is enabled for this function, deploy/configure this specific function
with `verify_jwt=false` (CLI: `supabase functions deploy cfvm-db-proxy --no-verify-jwt`).
This does not make the function anonymous: every request still requires the
independent high-entropy `x-cfvm-proxy-token` header before any database access.
Do not disable RLS, grant anonymous RPC permissions, or change unrelated functions.

Configure the Worker:

```bash
export SUPABASE_URL=https://PROJECT_REF.supabase.co
export SUPABASE_PROXY_URL=https://PROJECT_REF.supabase.co/functions/v1/cfvm-db-proxy
npx wrangler secret put SUPABASE_PROXY_TOKEN
npx wrangler secret put JWT_SECRET
```

Do not configure `SUPABASE_SECRET_KEY` on the Worker in proxy-only mode.

**Upgrade ordering:** deployments of the previous proxy used a verifier embedded in
source. Set `CFVM_PROXY_TOKEN_SHA256` to the verifier for the currently active Worker
token **before** deploying the new function. Otherwise it intentionally returns 503.
For rotation, see [SECURITY_AND_RECOVERY.md](SECURITY_AND_RECOVERY.md); a bounded
overlap using the previous verifier is supported.

After applying migrations, create independent Machine Tokens from the authenticated
AI/API administration page. They work without an `ADMIN_API_TOKEN` Worker secret.
To retain the optional legacy environment token:

```bash
npm run cfvm -- token generate
npx wrangler secret put ADMIN_API_TOKEN
```

For Codex write access, set the runtime variable in `wrangler.toml` or the deployment
environment:

```text
ADMIN_API_TOKEN_SCOPES=read,write
```

Then deploy:

```bash
npm run deploy
```

The deploy command runs the full repository verification before publishing. If
verification fails, deployment stops.

## Database initialization / upgrade

After the first deployment, open:

```text
https://YOUR-WORKER/db-init
```

Run the database initialization/migration flow. Existing supported migrations are
designed to preserve current account/node data.

After schema-affecting updates, run `/db-init` again. The timestamped migrations
must run after legacy numeric migrations `1`–`8`; the manifest generator uses numeric
ordering. The infrastructure schema migration adds/backfills inventory references
for existing clients/websites without replacing their original monitoring tables.
The additional migrations add inventory RPCs, token security, monitoring extensions,
seeded SOPs/baselines and infrastructure configuration backup. Test against a copy
of the database before updating a production instance; do not manually mark a failed
migration as applied.

## Machine API smoke test

Configure the local/Codex client environment:

```bash
export CFVM_URL=https://YOUR-WORKER
export CFVM_TOKEN=<independent-token-or-legacy-ADMIN_API_TOKEN>
```

Then:

```bash
npm run cfvm -- discover
npm run cfvm -- health
npm run cfvm -- clients list
```

For a write-capable token:

```bash
npm run cfvm -- websites list
npm run cfvm -- pings list
```

A token with only `read` must fail write requests with:

```text
API_SCOPE_REQUIRED
```

## Codex workflow

When Codex is operating an already deployed panel:

1. Read `AGENTS.md`.
2. Set `CFVM_URL` and `CFVM_TOKEN`.
3. Run `npm run cfvm -- discover`.
4. Prefer the bundled CLI.
5. If the CLI has no convenience command, use `npm run cfvm -- request ...`.
6. Do not use browser UI automation when the machine API can perform the operation.
7. For destructive changes, list/get the target first and use its exact UUID/ID.
8. Canonical DELETE routes are idempotent and are preferred over legacy POST delete paths.
9. Do not request `backup` or `restore` scope unless the task requires it.
10. Machine API credentials cannot change the human admin password, username, or MFA.

## Updating an existing deployment

Before deploying an update:

```bash
git status --short
git pull --ff-only
npm ci
npm run verify
npm run deploy
```

If deployment uses Cloudflare Workers Builds, update/push the repository and allow its
GitHub CI + Workers Build pipeline to deploy the exact tested commit.

## Agent release note

This fork controls the Agent installer scripts/source. If the fork does not yet have
its own Agent Release assets, the configured release repository may still point to
the upstream prebuilt binaries. Check `CF_MONITOR_AGENT_RELEASE_REPOSITORY` before
assuming a source fix is present in an already-installed Agent binary.

## Troubleshooting

### Machine API authentication fails

For independent `cvm_…` tokens, verify that the token migration was applied and the
token is active and unexpired. Rotation immediately invalidates the previous secret.
For the legacy token, verify the Worker secret and `ADMIN_API_TOKEN_SCOPES`.
`API_DISABLED` is retained for older deployments with no authentication backend;
current database-token deployments do not require the legacy environment secret.

### Machine API returns `API_SCOPE_REQUIRED`

The token is valid but its stored scopes (or legacy `ADMIN_API_TOKEN_SCOPES`) omit
the response's `required_scope`. Grant the specific resource scope when creating a
replacement token; do not fall back to a browser session to bypass a denied machine
operation. Some composed operations require more than one scope.

### Codex can read but cannot delete

Verify:

```bash
npm run cfvm -- discover
npm run cfvm -- clients list
```

Then use the canonical command:

```bash
npm run cfvm -- clients remove <uuid>
```

Do not guess legacy POST delete paths.

### `API_ROUTE_NOT_FOUND`

Read:

```bash
npm run cfvm -- discover
npm run cfvm -- openapi
```

The response also contains the discovery/OpenAPI paths.

### Workers Build refuses deployment

The exact commit may not have a successful GitHub CI run. The deploy gate is
fail-closed by design.

### Administrator recovery in Proxy mode

Recovery uses `ADMIN_RECOVERY_ENABLED=true` and an independent
`ADMIN_RECOVERY_TOKEN`; it does not need or accept the Supabase server key. The
normal setting is `false`. Recovery is rate limited and audited, resets MFA and
invalidates prior account sessions. Disable it after the incident and rotate the
recovery secret. Read the complete [recovery procedure and credential inventory](SECURITY_AND_RECOVERY.md)
before using it.

### Configuration backup versus full disaster recovery

The encrypted application backup includes monitor configuration, infrastructure
assets/relationships/links, current documents/baselines and their versions. It can
contain Agent credentials and notification secrets and must be protected accordingly.
Machine Tokens and administrator credentials are excluded. Configuration snapshots,
discovery evidence, historical changes/evaluations and monitoring measurements need a
separate database backup. Check [SECURITY_AND_RECOVERY.md](SECURITY_AND_RECOVERY.md)
for restore order, compatible migrations, retention and verification.

## Provenance

The repository remains a fork of `kadidalax/cf-vps-monitor`. Preserve the original
MIT copyright/license and Git history. Twemoji flags have a separate CC-BY 4.0
graphics license. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) before
redistributing source, builds or themes.
