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
| `ADMIN_API_TOKEN` | Secret | Bearer token for Codex/CLI/API |
| `ADMIN_API_TOKEN_SCOPES` | Variable | `read` by default; usually `read,write` for Codex |

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

Proxy mode keeps the Supabase server key inside Supabase Edge Functions. Deploy
`supabase/functions/cfvm-db-proxy/index.ts`, generate a random proxy token, replace
`EXPECTED_TOKEN_SHA256` with its SHA-256 verifier, then configure:

```bash
export SUPABASE_URL=https://PROJECT_REF.supabase.co
export SUPABASE_PROXY_URL=https://PROJECT_REF.supabase.co/functions/v1/cfvm-db-proxy
npx wrangler secret put SUPABASE_PROXY_TOKEN
npx wrangler secret put JWT_SECRET
```

Do not configure `SUPABASE_SECRET_KEY` on the Worker in proxy-only mode.

Enable the machine API:

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

After schema-affecting updates, run `/db-init` again.

## Machine API smoke test

Configure the local/Codex client environment:

```bash
export CFVM_URL=https://YOUR-WORKER
export CFVM_TOKEN=<same value as ADMIN_API_TOKEN>
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

### Machine API returns `API_DISABLED`

`ADMIN_API_TOKEN` is not configured as a Worker Secret.

### Machine API returns `API_SCOPE_REQUIRED`

The token is valid but `ADMIN_API_TOKEN_SCOPES` does not include the required scope.
Routine management changes need `write`.

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
