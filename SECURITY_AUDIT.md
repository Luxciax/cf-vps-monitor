# Security audit — 2026-11-08

Scope: Worker authentication and management routes, Agent transport, Supabase RPC
authorization, backup/restore, setup/recovery, website/webhook egress, installer
delivery, and dependency/toolchain gates.

This is a source-level review, not a substitute for an external penetration test.

## Executive assessment

The project has a smaller high-impact attack surface than a general remote-management
panel: there is no remote shell, file manager, arbitrary command task, or member
tenant boundary. The Agent is primarily telemetry and bounded network probing.

Existing controls include:

- Minimum 32-byte JWT secret and session-version revocation.
- HttpOnly admin session cookie, CSRF checks, and MFA step-up on high-risk browser operations.
- Random per-node Agent tokens, token hashing/rotation, auth rate limits, and disabled automatic registration.
- Public/private data projection and hidden-node checks.
- Private/loopback/link-local/reserved target filtering for monitoring; Agent probes also resolve DNS and reject private resolved IPs before dialing.
- Supabase RPC permission revocation from public/anon/authenticated roles with privileged functions restricted to service_role.
- Request/body limits on high-volume paths and a 512 KiB server-side Agent WebSocket message cap.
- Theme package size/path checks and restrictive asset CSP.
- Fail-closed npm audit and govulncheck in CI, plus Go race testing.

## Findings fixed in this change

### Agent WebSocket credential in URL query

The Agent WebSocket route accepted either an Authorization Bearer token or
`?token=...`. Query credentials can leak through logs, copied URLs, histories, and
diagnostics.

Fix: query-string Agent authentication is removed. Agents must use the Authorization
header. Token shape is validated before database lookup and WebSocket authentication
attempts/failures are rate-limited.

### Agent WebSocket client had no frame read ceiling

The Worker already rejected oversized Agent-to-panel messages, but the Go Agent had no
Gorilla WebSocket read limit for panel-to-Agent frames.

Fix: Agent WebSocket reads are capped at 512 KiB, with a regression test for oversized
frames.

### Automation reused browser-grade privilege state

Automation previously had to emulate the browser session, mixing Cookie, CSRF, and
interactive MFA state into machine workflows.

Fix: `/api/v1/*` uses a separate high-entropy Bearer secret with explicit `read`,
`write`, `backup`, and `restore` scopes. Machine credentials cannot access
account/password/MFA endpoints. The default scope is read-only.

### Fork install provenance pointed back to upstream

The fork's frontend install-command generator, bundled installer scripts, and Worker
installer redirects still named `kadidalax/cf-vps-monitor`. That meant new nodes could
bypass this fork's reviewed Agent code and trust a different repository/release path.

Fix: all default Agent installer provenance in this fork now points to
`Luxciax/cf-vps-monitor`. Existing branch-consistency tests verify the frontend and
installer scripts use the same repository.

## Residual risks / recommendations

### Medium: installer supply-chain trust is GitHub-centric

SHA256SUMS protects against corruption, but a compromised repository/release account
can replace both the binary and checksum because they share the same trust root.

Recommendation: publish Agent artifacts from the fork actually deployed, protect the
release workflow, pin installer sources to a release/commit where practical, and
consider signing release manifests with an independently protected signing key.

### Medium: hostname SSRF is harder to fully constrain in Worker fetch

Literal private/loopback/link-local/metadata/ambiguous numeric targets are blocked.
Agent-side probes additionally resolve DNS and reject private addresses before dialing.
Cloudflare Worker fetch does not expose the same low-level DNS/dial hook, leaving a
residual DNS-rebinding/private-resolution concern for hostname-based Worker egress.

Recommendation: keep secrets off internal HTTP endpoints reachable through public DNS,
prefer Agent-side probes for sensitive networks, and consider an explicit hostname
allowlist mode for webhook destinations.

### Medium: one static machine token per deployment

The first machine API intentionally uses one Worker Secret. Rotation replaces that
secret; there is no per-token expiry, independent revocation, or last-used record.

Recommendation: if multiple services/users need API access, move to hashed per-token
records with token IDs, expiry, last-used metadata, scopes and revocation.

### Low/operational: fallback limits are per-isolate

If the RATE_LIMIT Durable Object binding is absent, some paths fall back to in-memory
per-isolate limits. That is weaker under distributed abuse.

Recommendation: treat the missing RATE_LIMIT setup warning as a deployment failure for
Internet-facing instances.

### Low/operational: administrator recovery is intentionally root-equivalent

Recovery requires possession of the deployed Supabase Secret key and is rate-limited,
but that key is effectively a root recovery credential.

Recommendation: protect Cloudflare/Supabase accounts with MFA, never expose the secret
in logs, and rotate it after suspected disclosure.

## High-impact vulnerability classes checked

- Pre-auth static-file traversal/config-secret disclosure.
- Authentication/authorization bypass at admin and Agent boundaries.
- Arbitrary command execution/task escalation.
- WebSocket memory exhaustion and credential leakage.
- SSRF into metadata/private services.
- Backup/restore input boundaries and privileged operations.
- Theme upload/path/content handling.
- Supply-chain integrity of Agent installers.
- Dependency/toolchain vulnerabilities and CI fail-open behavior.

## Suggested next phase

1. Add hashed multi-token API credentials with expiry and last-used IP/time.
2. Sign Agent release manifests independently from the release account.
3. Add fuzz/property tests for URL normalization, restore payloads, theme ZIP parsing, and WebSocket envelopes.
4. Run a black-box test against a staging deployment with real Cloudflare/Supabase bindings, especially auth bypass, cache confusion, SSRF, and rate-limit behavior.
