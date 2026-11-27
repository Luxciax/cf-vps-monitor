# Security, credentials and disaster recovery

CVM observes, records and explains infrastructure. Server changes belong to an
external operator or harness. The Worker, API and MCP server do not expose Shell,
SSH, Docker Exec, script execution or remote file management. A Docker socket mount
marked read-only is **not** a Docker API permission boundary; the central Worker
must never receive a socket URL or access to a host Docker daemon.

## Credential inventory

| Credential | Location and purpose | Rotation / recovery |
| --- | --- | --- |
| `JWT_SECRET` | Worker Secret; signs human sessions and protects MFA-related cryptographic material | Rotating invalidates signed sessions. Preserve it for disaster recovery; review MFA consequences before changing it |
| `SUPABASE_SECRET_KEY` | Worker Secret in direct mode only; server database authority | Rotate through Supabase and update the direct-mode Worker. Do not add it to a proxy-only Worker |
| `SUPABASE_PROXY_TOKEN` | Worker Secret; authenticates to the dedicated Edge proxy | Rotate independently of the database key with the bounded overlap below |
| `CFVM_PROXY_TOKEN_SHA256` | Supabase Edge Function secret; verifier for the current proxy token | Must be configured before deploying the new proxy implementation |
| `CFVM_PROXY_PREVIOUS_TOKEN_SHA256`, `CFVM_PROXY_PREVIOUS_TOKEN_EXPIRES_AT` | Optional Edge Function overlap verifier and ISO expiry | Accepted only while expiry is in the future and at most seven days away; remove after Worker rotation |
| Supabase runtime server key | Supabase's `SUPABASE_SECRET_KEYS.default` or `SUPABASE_SERVICE_ROLE_KEY`; used only inside the Edge Function in proxy mode | Manage in Supabase, not the CVM settings/database |
| Independent `cvm_…` Machine Tokens | Secret held by each CLI/MCP/harness; database retains SHA-256 digest, prefix, scopes and lifecycle metadata | Create, rotate or revoke in the human-only AI/API page. Rotate preserves ID and discovery source |
| `ADMIN_API_TOKEN`, `ADMIN_API_TOKEN_SCOPES` | Optional legacy Worker machine token and scopes | Rotate the secret; independent tokens are preferable for separate callers |
| `ADMIN_RECOVERY_TOKEN` | Optional Worker Secret, independent of every database/proxy/machine credential | Default disabled; replace after use or suspected exposure, then disable recovery |
| Agent token / discovery enrollment key | Probe service environment and authorized CVM enrollment flow | Use existing per-node rotation; update the particular probe, never expose values publicly |
| Notification credentials | Validated private settings; masked in normal API reads | Rotate at provider, update private settings, send a test, then retire the old credential |
| Backup password | Operator's password manager; never stored with the backup | Loss prevents encrypted backup recovery. Keep a separately protected recovery copy |
| Cloudflare/GitHub discovery tokens | Local harness environment only | Read permissions only, limited accounts/repos; never submit in a discovery report |
| Deployment credentials | CI or local deployment secret manager only | Separate from runtime credentials and inventory data |

Root passwords and SSH private keys do not belong in CVM. A secret typed into an
asset note, document, URL or discovery field can escape even a strong authentication
system. The validators reject known secret keys, credential prefixes and private
key blocks, but operators must still use a whitelist when producing reports.

The proxy is a trusted server component, not a replacement for database permissions.

VPS enrollment bindings are protected independently from ordinary inventory fields.
`client_id` is read-only for asset CRUD/import, and generic monitor-link operations
cannot unlink or move a registered client. Repeating its existing canonical link is
idempotent; an attempted reassignment returns 409. Use validated asset merge or the
original node lifecycle so Agent identity, host discovery and configuration evidence
stay attached to the correct VPS. Inventory/discovery external IDs support 240
characters, including in configuration backups.

Tables have RLS enabled, anonymous/authenticated roles have no access to the new
inventory/token tables or privileged RPCs, and only `service_role` can execute the
enumerated operations. The Worker authenticates the caller and checks scopes before
invoking these RPCs. The proxy rejects arbitrary function names and table paths;
never weaken it to an unrestricted PostgREST passthrough.

## Administrator recovery, including Proxy deployments

Recovery is off unless both `ADMIN_RECOVERY_ENABLED=true` and a valid independent
`ADMIN_RECOVERY_TOKEN` (32–1024 characters) are configured. A database Secret key,
proxy token or Machine Token is not accepted as a recovery credential. The enabled
status endpoint does not contact the database when recovery is disabled.

1. Confirm access to the correct Worker deployment and take a database backup if
   the incident permits. Establish whether this is a lost password/MFA problem or
   a compromised account. Preserve relevant audit records.
2. Generate a new random secret locally (`npm run cfvm -- token generate`) and
   keep it in a password manager. Set the Worker Secret `ADMIN_RECOVERY_TOKEN`
   through the Cloudflare dashboard or `wrangler secret put`; do not put it in
   source, a URL, a shell argument containing its literal value, or a support ticket.
3. Temporarily set `ADMIN_RECOVERY_ENABLED=true` on that Worker. Use the login
   page's recovery form over HTTPS, supplying this recovery credential and the new
   administrator credentials. Do not enter a Supabase database key.
4. Recovery supports an empty installation or a single existing administrator;
   ambiguous multiple-owner state is rejected. Existing-account recovery increments
   `session_version`, resets MFA and writes an audit event. Account creation is
   atomic and rejects a competing first-owner creation. Attempts are rate limited.
5. Log in, enroll MFA again, save new one-time recovery codes and review account,
   token, notification and deployment settings for unwanted changes. Review Agent
   and Machine Token activity; revoke compromised tokens separately.
6. Set `ADMIN_RECOVERY_ENABLED=false`, rotate/remove the incident recovery secret,
   and verify `/api/admin/recovery/status` reports recovery disabled. Keep the
   durable recovery instructions and credential inventory outside CVM as well.

After account recovery/change, privileged human writes validate session state
directly against the database and reject old sessions. Read-only browser requests
can retain a previously validated edge-cache entry for 30 seconds plus a possible
10-second local validation-cache age. Machine
Token authorization is checked against the database on every request, with no
revocation cache. Rotating `JWT_SECRET` is a stronger incident response option but
affects MFA cryptographic material; it is not a routine prerequisite for recovery.

## Rotating the proxy token without broadening access

1. Generate a new independent random token and compute its lowercase SHA-256 hex
   verifier locally. Do not log the token or paste it into committed configuration.
2. Set the Edge Function's `CFVM_PROXY_PREVIOUS_TOKEN_SHA256` to the **current**
   verifier and an explicit near-term `CFVM_PROXY_PREVIOUS_TOKEN_EXPIRES_AT`. Set
   `CFVM_PROXY_TOKEN_SHA256` to the new verifier. Both paths use the same strict
   allowlist; the overlap cannot enable anonymous access.
3. Update the Worker's `SUPABASE_PROXY_TOKEN` to the new token. Exercise a normal
   authenticated read and a scoped non-destructive write, checking audit and health.
4. Remove the previous verifier/expiry as soon as old Workers are drained. An
   expired or malformed overlap configuration is rejected automatically.

Do not rotate the Supabase server key just to rotate this Worker-to-proxy link.
Do not add that server key to a proxy-only Worker to repair login or recovery.
The proxy bounds request bodies to 6 MiB (including the existing 5 MiB backup
restore envelope), responses to 32 MiB and upstream time to
25 seconds, rejects redirects, and sends no credential-bearing error output to logs.

## Backups: two different recovery objectives

The encrypted **configuration backup** is for recreating monitored resources and
application configuration. It includes existing clients, Ping/website tasks,
notification settings and the infrastructure inventory, relationship/monitor links,
knowledge documents, baselines and document/baseline versions. Inventory restore
merges stable IDs and preserves document/baseline revision history. Existing
monitor-module restore semantics can remove items absent from the selected backup;
always review the backup modules and restore summary first.

Configuration backups can contain Agent token material, an enrollment key and
notification secrets. Encrypt them with a separate strong password, store outside
the panel/database failure domain, and never attach them to public issues. The
application enforces a 5 MiB backup limit; split/trim unnecessary configuration or
use a database backup when the instance outgrows that export envelope.

Configuration export excludes human administrator credentials/MFA material,
Machine Tokens, monitoring measurements, configuration snapshots, discovery runs
and candidate evidence, change history and baseline evaluation results. A **full
database backup** is required to preserve those histories and authentication state.
Its secret handling is therefore stricter. Worker/Edge deployment secrets, object
storage/theme artifacts and probe service configuration also need separate recovery
copies; a SQL dump is not a complete copy of those external systems.

### Recovery drill / disaster procedure

1. Record the repository commit, Agent build/version, applied migration list,
   Worker/Proxy configuration names, database version and backup creation times.
   Maintain a periodic restore drill in a separate database and Worker.
2. Restore a full database backup into an isolated project using the provider's
   supported restore flow, or initialize a fresh database with all bundled
   migrations before importing a configuration-only backup. Never import over the
   only surviving database without an independently recoverable copy.
3. Recreate Worker and Edge secrets in the appropriate locations. In proxy mode,
   configure the verifier before the function and Worker. Recreate the administrator
   through the normal first-owner flow, or temporarily use independent recovery if
   a configuration-only restore requires it. Machine Tokens must be recreated after
   configuration-only restore.
4. Restore the encrypted application backup only after validating its password,
   schema/version, modules and expected identifiers. Document/baseline restoration
   creates version history; audit the resulting counts and relationships. Check that
   monitor links point at real client/website/Ping identifiers.
5. Verify login, MFA, public hidden-node/hidden-URL behavior, API scopes, recent Agent
   reports, representative HTTP/TCP/DNS/WebSocket checks, notification delivery,
   discovery completeness and a bounded asset context request. Do not interpret a
   fresh monitor with no samples as available or a failed discovery as deletion.
6. If moving domains, update the external probes/harnesses deliberately and monitor
   their first reports. Roll back DNS/Worker routing if validation fails; retain both
   database copies until the migration is accepted. Restore cleanup schedules only
   after validating retention windows and backup availability.

Schema changes use forward migrations, not destructive rollback guesses. If a
migration fails, preserve its error and transaction state, test a corrective
migration against a restored copy, then apply the reviewed fix. Never delete the
migration ledger, reset production, or bypass the deployment verification gate.

## Capacity and evidence retention

Use the capacity page and actual query/storage growth to select retention windows.
Inventory operations page results and cap imports/discovery/context; provider
collectors cap request/page counts and mark partial runs. `POST
/api/v1/infrastructure/cleanup` performs bounded history cleanup rather than an
unbounded DELETE; keep a separate DB backup for histories you must retain. Existing
scheduled monitor/audit cleanup continues independently. Repeated collection
failures retain formal assets and show unknown/unavailable states.

Token last-use writes are coalesced to once per minute per token and read-use audit
events to once per 15 minutes; mutations retain their operation audit. Authentication
still checks revocation/expiry every request. The inventory is private; the public
homepage uses existing sanitized monitoring projections, not the private context,
configuration, document or candidate endpoints.

## Local validation versus deployment

The security regression covers independent-token scope/expiry/revoke/rotate,
RLS/RPC denial to public roles, proxy allowlist/fail-closed/body bounds, recovery
without a direct database secret, MFA/CSRF ownership paths, masked settings,
MCP handshake/tools and bounded provider discovery. These checks use local fixtures
and an embedded PostgreSQL-compatible engine. They do not prove credentials or
provider access in a live Cloudflare/Supabase/GitHub account. A build, local test,
Git commit, production migration, deployment and Release are separate states.

Runtime/source references: `worker/src/auth/`,
`supabase/functions/cfvm-db-proxy/`,
`supabase/migrations/20261127111515_machine_token_security.sql`,
`worker/src/infra/`, `worker/src/utils/backup.ts`, and [API.md](API.md).
