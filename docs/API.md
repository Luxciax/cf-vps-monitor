# Machine API / CLI

CF VPS Monitor exposes a first-class machine API at `/api/v1/*` for Codex, scripts,
CI, and the bundled `cfvm` CLI. The machine API uses a dedicated Bearer token and
never depends on the browser admin cookie, CSRF token, or interactive MFA session.

## Authentication

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
- `*` - all four scopes.

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
| `API_DISABLED` | `ADMIN_API_TOKEN` is not configured |
| `API_MISCONFIGURED` | Configured machine token is invalid |
| `API_ROUTE_NOT_FOUND` | Unknown `/api/v1/*` route |

Application-level validation errors keep the existing `error` and optional
`details` / `code` fields.

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
