# Machine API / CLI

CF VPS Monitor exposes a machine-oriented API at `/api/v1/*`. It reuses the same
privileged route handlers as the web admin UI, but authenticates with a dedicated
Bearer token instead of browser cookies, CSRF tokens, or an interactive MFA session.

## Configure

Create a strong token locally:

```bash
npm run cfvm -- token generate
```

Store it as a Cloudflare Worker Secret:

```bash
npx wrangler secret put ADMIN_API_TOKEN
```

For Cloudflare Workers Builds, you can instead add `ADMIN_API_TOKEN` as a Build
Secret and `ADMIN_API_TOKEN_SCOPES` as a Build Variable. The repository deploy
wrapper forwards the optional token into the Worker secret set and validates the
scope string before publishing.

Configure `ADMIN_API_TOKEN_SCOPES` with a comma-separated list:

- `read`: GET/HEAD/OPTIONS management endpoints.
- `write`: ordinary management writes.
- `backup`: download/export backup.
- `restore`: restore/upload backup.
- `*`: all four scopes.

If scopes are omitted, the token is read-only. Human account and MFA endpoints under
`/account/*` are never available to machine tokens, even with `*`.

Recommended for routine Codex automation:

```text
ADMIN_API_TOKEN_SCOPES=read,write
```

Keep `backup` and especially `restore` off routine automation credentials unless
they are actually required.

## HTTP

```bash
curl https://monitor.example.com/api/v1/clients \
  -H "Authorization: Bearer $CFVM_TOKEN"
```

The machine API mounts the same handlers used by `/api/admin/*`.

| Operation | Endpoint | Scope |
| --- | --- | --- |
| List nodes | `GET /api/v1/clients` | read |
| Add node | `POST /api/v1/clients/add` | write |
| Edit node | `POST /api/v1/clients/:uuid/edit` | write |
| Remove node | `POST /api/v1/clients/:uuid/remove` | write |
| Rotate Agent token | `POST /api/v1/clients/:uuid/token/rotate` | write |
| Ping tasks | `GET /api/v1/ping` | read |
| Website monitors | `GET /api/v1/websites` | read |
| Trigger website check | `POST /api/v1/websites/:id/check` | write |
| Settings | `GET /api/v1/settings` | read |
| Health | `GET /api/v1/health` | read |
| Capacity | `GET /api/v1/capacity` | read |
| Backup | `POST /api/v1/download/backup` | backup |
| Restore | `POST /api/v1/upload/backup` | restore |

For write endpoints, use the same JSON body accepted by the corresponding web admin
endpoint. CSRF is not used for this API because the credential is supplied explicitly
in the Authorization header rather than ambient browser cookies.

## CLI

```bash
export CFVM_URL=https://monitor.example.com
export CFVM_TOKEN=your-secret-token

npm run cfvm -- health
npm run cfvm -- clients list
npm run cfvm -- clients add "Tokyo VPS"
npm run cfvm -- websites list
npm run cfvm -- ping list
```

Generic access:

```bash
npm run cfvm -- get /logs
npm run cfvm -- post /clients/batch-hide '{"uuids":["node-a"],"hidden":true}'
```

The CLI refuses plaintext HTTP except for localhost.
