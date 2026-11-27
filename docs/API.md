# Machine API / CLI

CF VPS Monitor exposes a first-class machine API at `/api/v1/*` for Codex, scripts,
CI, and the bundled `cfvm` CLI. The machine API uses a dedicated Bearer token and
never depends on the browser admin cookie, CSRF token, or interactive MFA session.

## Authentication and independent tokens

Create a named Machine Token in **AI Context / API → Machine Tokens** while signed
in as a human administrator. Choose only the required scopes and an expiry. The
default expiry is 90 days. The full `cvm_…` secret appears only on creation or
rotation; the database stores its SHA-256 digest. Tokens have independent identities,
expiry, revocation, last-use timestamps and audit events. Rotation preserves the token
ID and discovery namespace while immediately invalidating the old secret. Revoking a
token takes effect on its next request, without an authorization cache.

The human-only routes are `GET/POST /api/admin/account/machine-tokens` and
`POST /api/admin/account/machine-tokens/:id/rotate|revoke`. Writes require the normal
browser CSRF protection and MFA step-up when MFA is enrolled. Machine tokens cannot
create, rotate or revoke other tokens. A deployment supports at most 64 active tokens;
expired/revoked metadata is retained for audit and bounded to 500 records.

The existing environment token remains supported for compatibility:

Keep its secret distinct from issued `cvm_…` tokens. An exact match to the explicitly
configured legacy environment secret uses that environment's scopes and lifecycle;
revoking a database token cannot revoke a separately configured Worker secret.

Create a high-entropy token:

```bash
npm run cfvm -- token generate
```

Store it as a Cloudflare Worker Secret:

```bash
npx wrangler secret put ADMIN_API_TOKEN
```

Configure scopes with `ADMIN_API_TOKEN_SCOPES`:

- `read` - read/list/health/log operations.
- `write` - create/update/delete/maintenance/notification operations.
- `backup` - encrypted backup export.
- `restore` - encrypted backup restore.
- `*` - all supported scopes for the legacy environment token.

New tokens also support these narrower scope families. `read` includes every
`*:read` scope and `write` includes every `*:write` scope; neither grants `backup`
or `restore`. A write scope does not implicitly grant read access.

| Scopes | Resources |
| --- | --- |
| `assets:read`, `assets:write` | Inventory, relationships, topology, inventory summary |
| `discovery:read`, `discovery:write` | Discovery candidates, runs and structured reports |
| `config:read`, `config:write` | Configuration snapshots |
| `knowledge:read`, `knowledge:write` | Documents, versions and Markdown export |
| `changes:read`, `changes:write` | Change history and externally reported operations |
| `baselines:read`, `baselines:write` | Baselines, versions and evaluation |
| `monitors:read`, `monitors:write` | Nodes, websites, Ping, notifications and monitor links |
| `settings:read`, `settings:write` | Site settings, themes and logos |
| `audit:read` | Administrator audit logs |

Discovery import/merge additionally needs `assets:write`; linking a monitor needs
both `assets:write` and `monitors:write`; baseline evaluation needs
`baselines:write`, `config:read` and `assets:read`. Asset context and global search
filter their sections according to the token's read scopes. A token restricted to
`assets:read` cannot obtain documents, configuration or change history through an
aggregate endpoint. GET settings responses expose only masked credential previews.

A discovery report that includes `configuration` additionally needs `config:write`.
Inventory history cleanup also requires `config:write`, `changes:write`,
`discovery:write` and `baselines:write`, because it removes retained history in those
families. Baseline result rows include their evidence source, collection time and
`reported`/`observed` confidence; a compliant reported value is still a claim.

The default is `read`. Routine Codex automation should normally use:

```text
ADMIN_API_TOKEN_SCOPES=read,write
```

Human account, password, and MFA endpoints under `/account/*` are intentionally
unavailable to machine tokens even when `*` is configured.

## Discovery

Do not guess endpoint shapes. Start with:

```bash
npm run cfvm -- discover
npm run cfvm -- openapi
```

Equivalent HTTP endpoints:

- `GET /api/v1/capabilities`
- `GET /api/v1/openapi.json`

Every authenticated response also advertises:

```text
X-CF-VPS-Monitor-API-Version: v1
X-CF-VPS-Monitor-API-Scopes: ...
Link: </api/v1/openapi.json>; rel="service-desc"
```

Unknown machine API paths return a JSON error with `API_ROUTE_NOT_FOUND` plus the
discovery and OpenAPI paths.

## Stable error codes

Authentication-level failures use stable machine-readable codes:

| Code | Meaning |
| --- | --- |
| `API_UNAUTHORIZED` | Missing or invalid Bearer token |
| `API_SCOPE_REQUIRED` | Token is valid but lacks the required scope |
| `API_OPERATION_FORBIDDEN` | Operation is intentionally unavailable to machine tokens |
| `API_DISABLED` | No configured authentication backend is available (legacy deployments) |
| `API_MISCONFIGURED` | Configured machine token is invalid |
| `API_TOKEN_STORE_UNAVAILABLE` | Independent-token storage cannot be queried; inspect connectivity and migrations, do not assume authorization |
| `API_ROUTE_NOT_FOUND` | Unknown `/api/v1/*` route |

Infrastructure responses additionally use `VALIDATION_ERROR` (400),
`SENSITIVE_DATA_REJECTED` (400), `RESOURCE_NOT_FOUND` (404), `RESOURCE_CONFLICT`
(409), `PAYLOAD_TOO_LARGE` / `CONTEXT_TOO_LARGE` (413), and
`INFRASTRUCTURE_MIGRATION_REQUIRED` (503). A conflict requires refreshing the
resource/version before retrying. Legacy monitoring validation keeps its existing
`error` and optional `details` / `code` fields. Clients should inspect both HTTP
status and the stable `code`, without matching translated error text.

Example:

```json
{"code":"API_SCOPE_REQUIRED","error":"Insufficient machine API scope","required_scope":"knowledge:read"}
```

## Canonical CRUD

The following REST-style routes are preferred for new automation. Legacy web-admin
compatible POST paths remain supported.

| Resource | List/Get | Create | Update | Delete |
| --- | --- | --- | --- | --- |
| Nodes | `GET /clients`, `GET /clients/:uuid` | `POST /clients` | `PATCH /clients/:uuid` | `DELETE /clients/:uuid` |
| Ping tasks | `GET /pings` | `POST /pings` | `PATCH /pings/:id` | `DELETE /pings/:id` |
| Websites | `GET /websites`, `GET /websites/:id/checks` | `POST /websites` | `PATCH /websites/:id` | `DELETE /websites/:id` |
| Themes | `GET /themes` | `POST /themes/upload` | settings/activate endpoints | `DELETE /themes/:short` |

Canonical DELETE operations for nodes, Ping tasks, websites, and uploaded themes are
idempotent. If the target is already absent, the API returns success with
`already_absent: true` instead of a retry-inducing 404.

## Complete endpoint groups

The authoritative list is always `/api/v1/capabilities` and OpenAPI. Current groups:

### Nodes

- `GET /clients`
- `GET /clients/:uuid`
- `POST /clients`
- `PATCH /clients/:uuid`
- `DELETE /clients/:uuid`
- `POST /clients/:uuid/token`
- `POST /clients/:uuid/token/install`
- `POST /clients/:uuid/token/rotate`
- `POST /clients/reorder`
- `POST /clients/batch-hide`
- `POST /clients/batch-remove`
- Legacy: `POST /clients/add`, `POST /clients/:uuid/edit`, `POST /clients/:uuid/remove`

### Ping

- `GET /pings`
- `POST /pings`
- `PATCH /pings/:id`
- `DELETE /pings/:id`
- `POST /ping/reorder`
- Legacy: `GET /ping`, `POST /ping/add`, `POST /ping/edit`, `POST /ping/delete`

### Website monitoring

- `GET /websites`
- `GET /websites/:id/checks`
- `POST /websites`
- `PATCH /websites/:id`
- `DELETE /websites/:id`
- `POST /websites/:id/check`
- `POST /websites/visibility`
- `POST /websites/enabled`
- `POST /websites/reorder`
- Legacy: `POST /websites/add`, `POST /websites/edit`, `POST /websites/delete`

### Settings and assets

- `GET /settings` (optional `?scope=site|general|notification`)
- `POST /settings`
- `POST /site-logo` multipart file upload
- `POST /site-logo/reset`
- `GET /themes`
- `POST /themes/upload` multipart ZIP upload
- `POST /themes/set`
- `POST /themes/settings`
- `DELETE /themes/:short`
- Legacy: `POST /themes/delete`

### Notifications

- `GET /notification/offline`
- `POST /notification/offline/edit`
- `GET /notification/expiry`
- `POST /notification/expiry/edit`
- `GET /notification/load`
- `POST /notification/load/add`
- `POST /notification/load/:id`
- `DELETE /notification/load/:id`
- Legacy: `POST /notification/load/edit`, `POST /notification/load/delete`
- `POST /test/sendMessage`

### Records, maintenance and system

- `POST /record/clear`
- `POST /record/clear/all`
- `GET /logs`
- `GET /health`
- `GET /capacity`
- `GET /update-check`
- `POST /maintenance/cleanup`
- `POST /cron/run`

### Backup

- `POST /download/backup` - requires `backup`
- `POST /upload/backup` - requires `restore`

Keep `backup` and especially `restore` off routine automation tokens unless needed.

## Infrastructure API v1

All paths below are relative to `/api/v1`; the same handlers power the administrator
UI. `GET /openapi.json` describes request/response schemas, UUID identifiers,
filters, paging and required scopes. Additive changes remain in v1; clients should
tolerate new response fields. Inventory is separate from monitoring: an internal
website can exist without a public monitor, and an asset can have multiple monitors.

| Capability | Endpoints |
| --- | --- |
| Inventory | `GET/POST /assets`, `GET/PATCH /assets/:id` |
| Import / batch / deduplication | `POST /assets/import`, `POST /assets/batch`, `POST /assets/:id/merge` |
| Context / topology | `GET /assets/:id/context`, `GET /assets/:id/topology` |
| Monitor association | `GET/POST /assets/:id/monitors` |
| Relationships | `GET/POST /relationships`, `DELETE /relationships/:id` |
| Discovery | `GET /discovery/candidates`, `GET /discovery/runs`, `POST /discovery/reports`, `POST /discovery/candidates/:id/resolve` |
| Configuration | `GET/POST /configuration/snapshots` |
| Changes / external reports | `GET /changes`, `POST /operations` |
| Documents | `GET/POST /documents`, `GET/PATCH /documents/:id`, `GET /documents/:id/versions`, `POST /documents/:id/restore`, `GET /documents/:id/export` |
| Baselines | `GET/POST /baselines`, `GET/PATCH /baselines/:id`, `GET /baselines/:id/versions`, `POST /baselines/:id/evaluate` |
| Search / summary / retention | `GET /search`, `GET /infrastructure/summary`, `POST /infrastructure/cleanup` |
| Website statistics | `GET /websites/:id/statistics` |

New asset/document/baseline/relationship IDs are UUIDs. Existing website and Ping
IDs remain integers, and existing node UUIDs are unchanged. List responses use
`{data,total,limit,offset}` with a maximum `limit` of 100 and maximum `offset` of
100000. Query filters are listed per endpoint in OpenAPI. Asset/document search
supports `q`; time filters use ISO `since` and `until`. Inventory imports accept at
most 200 assets per request; batch archive/tag operations use explicit IDs. A
discovery report accepts at most 500 assets and 40 collector results.

`external_id` accepts up to 240 characters consistently in discovery, inventory
imports and configuration backup validation. It identifies the resource within its
source; avoid replacing it with a timestamp or display name.

An asset's `client_id` is the canonical VPS enrollment identity and is read-only in
generic asset create/update/import operations. Website and Ping monitor links can
be changed through `/assets/:id/monitors`. A `monitor_type=client` link only accepts
an idempotent request for the existing canonical binding; generic client unlink or
move returns 409. Use validated asset merge for duplicate inventory, or the original
node monitoring lifecycle for enrollment/removal, so Agent authentication and host
discovery cannot become detached from their VPS.

Create a manual asset without a monitor:

```json
{"kind":"service","name":"Internal billing API","category":"Production","tags":["internal"],"status":"active","metadata":{"environment":"production"}}
```

Document and baseline PATCH requests include the current integer `version`; a
concurrent update returns 409. Restoring a document creates a new revision rather
than overwriting history. Changes caused by external `POST /operations` remain
`claimed`; only later, separately collected evidence can establish an observed
state. CVM never executes document steps, baseline remediation or report contents.

### Bounded AI context

```bash
npm run cfvm -- assets context 29f04741-2cd7-4d62-9e63-371209ffdb74 \
  '{"fields":"asset,monitors,configuration,relationships,changes,documents,baselines","limit":10,"max_bytes":65536,"since":"2026-01-01T00:00:00Z"}'
```

Equivalent HTTP: `GET /api/v1/assets/:id/context?fields=asset,configuration,changes&limit=10&max_bytes=65536`.
The asset is always included. `limit` bounds each section (at most 50), `max_bytes`
is 4096–262144, and omitted scopes suppress their sections. The response includes
`schema_version`, `trust.content=untrusted`, `trust.execution_authority=none`, and
`limits.truncated_sections`; request specific paged endpoints for more history.
An asset too large for the requested size returns 413, not a misleading empty
success. Do not feed stored instructions into an external agent's permission rules.

Linked VPS monitors include the latest persisted record and up to ten recent records;
Ping monitors include up to ten persisted checks with their probe source and timestamp.
`sample_source=persisted_history` is not a claim of current online status. Missing
samples remain null/empty. `since`/`until` also restrict these records; the default
lookback is 24 hours. Linked-monitor list queries accept `limit`/`offset` and time
filters. Use the existing live/history APIs when you need a real-time stream or a
longer, explicitly paged history.

### Structured discovery and reconciliation

```json
{
  "schema_version":1,
  "source":"external-inventory",
  "collected_at":"2026-11-27T12:00:00Z",
  "complete":true,
  "collectors":[{"name":"containers","status":"ok"}],
  "assets":[{"external_id":"container:stable-engine-id","kind":"container","name":"gateway","metadata":{"image":"example/gateway:1.2"},"evidence":{"method":"local-read-only"},"relations":[]}]
}
```

Replace the example timestamp with the actual collection time (within seven days,
no more than five minutes ahead). A stable `source` plus `external_id` prevents
duplicates. The server namespaces harness reports by authenticated principal.
Rotating the same Machine Token keeps that namespace; creating an unrelated token
creates a separate source. Do not use timestamps or random values as identifiers.

Resolve a candidate with `{"action":"import"}`, `{"action":"ignore"}`, or
`{"action":"merge","asset_id":"…"}`. Imported discovery data lives in observed
metadata, preserving manually maintained fields. Collection failures and permission
errors must use their actual collector status and `complete:false`. Only a complete
run with successful collectors can mark an older candidate's `missing_since`; that
means an observation is missing, not that the resource is confirmed deleted. Review
subsequent evidence before archiving anything. Formal assets are never automatically
deleted. Never include environment variables, raw configuration files, private
keys, passwords or access tokens in metadata, evidence, snapshots or Markdown.

## Read-only provider discovery from a local harness

The CLI contains real Cloudflare and GitHub API collectors. Provider credentials
stay in the local CLI process; they are neither uploaded to CVM nor stored in its
database. Only explicit safe fields are reported. Default output is a reviewable JSON
report; add `--submit` to send it to `/discovery/reports` using `CFVM_TOKEN` with
`discovery:write`.

```bash
# Set provider secrets through your local secret manager, without putting them in git.
# Cloudflare: CF_API_TOKEN, CF_ACCOUNT_ID; optional comma-separated CF_ZONE_IDS.
npm run cfvm -- discovery cloudflare > cloudflare-report.json
npm run cfvm -- discovery cloudflare --submit

# GitHub: GH_TOKEN or GITHUB_TOKEN; optional GITHUB_REPOSITORIES=owner/repo,owner/other.
npm run cfvm -- discovery github > github-report.json
npm run cfvm -- discovery github --submit
```

Use Cloudflare Zone/DNS Read, Workers Scripts Read and Pages Read only for the
resources you want discovered. GitHub needs repository metadata and deployment
read access to selected repositories. Permission-denied collectors retain accessible
results and report their error status. Cloudflare collection covers zones, DNS,
Workers, Worker custom domains, Pages projects/domains and the production deployment.
DNS TXT/other opaque content and Worker bindings are omitted to avoid secrets.
GitHub collection covers repository metadata and up to ten recent deployments per
repository, including latest deployment status; deployment payloads and log URLs
are omitted.

When using an installation or GitHub Actions token, set `GITHUB_REPOSITORIES`
explicitly; that mode does not call the user-identity API. Automatic repository
listing requires a user token. Stable source IDs incorporate the explicit resource
set, so keep the same partition when repeating a scheduled collection.

Each run is bounded to 80 provider requests, five pages per list and 500 assets.
Use up to 20 explicit zone IDs or repository names to partition a large account.
A bounded/truncated run reports `complete:false`; it cannot imply resource deletion.
These are inventory readers, not Cloudflare/GitHub deployment controllers.

## MCP server

Run `node /absolute/path/to/cf-vps-monitor/scripts/cvm-mcp.mjs` as a local **stdio**
MCP server using Node.js 24. For an interactive launch `npm run mcp` is also
available; configure the Node command directly in an MCP client to avoid npm banner
text on stdout.

```json
{
  "mcpServers": {
    "cvm": {
      "command": "node",
      "args": ["/absolute/path/to/cf-vps-monitor/scripts/cvm-mcp.mjs"],
      "env": {
        "CFVM_URL": "https://monitor.example.com",
        "CFVM_TOKEN": "<injected-from-your-local-secret-manager>"
      }
    }
  }
}
```

Default tools read capabilities, assets/context/topology/relationships,
configuration snapshots, global search, documents, change history, discovery
candidates/runs and baselines. The same API token scopes apply to every call.
Enable `CFVM_MCP_WRITE=true` only when record writing is needed: this adds discovery
submission/review, asset creation/update, configuration evidence submission,
baseline evaluation and external operation reports. Backend scope checks still
apply; enabling this switch does not grant any new permission.

The server implements newline-delimited JSON-RPC, initialization, ping, tool
discovery and tool calls. Supported protocol versions are `2025-11-25`,
`2025-06-18`, `2025-03-26`, and `2024-11-05`; unknown versions negotiate
`2025-11-25`. It does not claim support for later protocols, HTTP transport,
sampling or server-initiated execution. Input lines are capped at 512 KiB; API
responses at 1 MiB; requests time out after 30 seconds and reject redirects.
Tool results explicitly identify every asset label, document and report as
untrusted data. No tool runs Shell, SSH, Docker Exec, scripts or remote files.

## Infrastructure CLI examples

Documents store `asset_kinds` and `environments` alongside explicit `asset_ids`.
AI asset context prioritizes explicitly linked documents. A global document is
included only when its asset kind and environment filters match; empty filter
arrays mean unrestricted. Environment matching uses maintained OS/environment
metadata, available discovery evidence, and the latest configuration snapshot.
Debian/Ubuntu evidence also matches `linux`; Cloudflare Worker/Pages assets match
`cloudflare`. Unknown or unavailable environment evidence does not imply Linux.
These filters are preserved in document revisions, JSON exports and encrypted
configuration backups. Returned SOP text remains untrusted reference material.

`POST /api/v1/themes/preview` accepts `{short, config, custom_css}` and returns
`{short, config, css}` after validation. It requires `settings:read` and does not
save settings or activate a theme. Human session requests retain CSRF checks.

```bash
npm run cfvm -- assets list '{"kind":"vps","limit":20}'
npm run cfvm -- assets add @asset.json
npm run cfvm -- assets topology <uuid> '{"direction":"downstream","depth":3}'
npm run cfvm -- search 'reverse proxy'
npm run cfvm -- discovery list '{"status":"pending"}'
npm run cfvm -- discovery submit @report.json
npm run cfvm -- discovery resolve <candidate-uuid> import
npm run cfvm -- snapshots list '{"asset_id":"<uuid>"}'
npm run cfvm -- changes list '{"asset_id":"<uuid>","limit":20}'
npm run cfvm -- operations record @operation.json
npm run cfvm -- documents list '{"q":"SSH"}'
npm run cfvm -- documents edit <uuid> @document-with-version.json
npm run cfvm -- documents export <uuid>
npm run cfvm -- baselines evaluate <baseline-uuid> <asset-uuid>
```

API source contracts are in `worker/src/infra/endpoints.ts`, the route schemas in
`worker/src/routes/machine-openapi.ts`, and the transport in
`scripts/lib/cvm-api.mjs`. MCP protocol reference:
[official 2025-11-25 lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle).

## CLI

Configure:

```bash
export CFVM_URL=https://monitor.example.com
export CFVM_TOKEN=your-admin-api-token
```

Examples:

```bash
npm run cfvm -- discover
npm run cfvm -- health

npm run cfvm -- clients list
npm run cfvm -- clients add "Tokyo VPS"
npm run cfvm -- clients edit <uuid> '{"name":"Tokyo-2"}'
npm run cfvm -- clients remove <uuid>

npm run cfvm -- pings list
npm run cfvm -- pings add @ping.json
npm run cfvm -- pings remove 12

npm run cfvm -- websites add @website.json
npm run cfvm -- websites edit 7 @website-update.json
npm run cfvm -- websites remove 7

npm run cfvm -- settings get notification
npm run cfvm -- settings set @settings.json

npm run cfvm -- themes upload ./theme.zip
npm run cfvm -- site-logo upload ./logo.png

npm run cfvm -- backup export ./backup.json
npm run cfvm -- backup restore @backup.json
```

Generic access is also available:

```bash
npm run cfvm -- request POST /clients/batch-hide '{"uuids":["node-a"],"hidden":true}'
npm run cfvm -- patch /clients/node-a '{"name":"renamed"}'
npm run cfvm -- delete /websites/7
```

The CLI only accepts relative API paths for generic requests, so the Bearer token
cannot be redirected to an arbitrary external URL. Public plaintext HTTP is rejected;
HTTP is accepted only for localhost.

## Direct HTTP example

```bash
curl https://monitor.example.com/api/v1/clients \
  -H "Authorization: Bearer $CFVM_TOKEN"

curl -X DELETE https://monitor.example.com/api/v1/clients/node-uuid \
  -H "Authorization: Bearer $CFVM_TOKEN"
```

Because machine credentials are explicit Authorization headers rather than ambient
browser cookies, browser CSRF tokens are not part of this API.
