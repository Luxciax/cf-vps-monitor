# Read-only discovery and enhanced probes

Discovery is off by default. It uses the existing Agent Token to POST a bounded,
projected snapshot to `/api/clients/discovery` every 30 minutes. The server binds
that token to its node. The endpoint cannot ask the probe to execute a command,
read a file, or call a Docker API operation.

## Local enablement

Use the current fork's probe binary or build `./agent` from the matching commit.
Until a corresponding Release exists, use the installer's `--build-from-source`
option or a locally built binary; the upstream project's binary does not include
these additions. A source build requires the Go version declared in `go.mod`.

The current minimum is Go 1.26.11; the Go 1.27 branch requires 1.27.4 or newer.
The WebSocket module is pinned to the upstream fix commit for
[GO-2026-6278](https://pkg.go.dev/vuln/GO-2026-6278), and the toolchain gate covers
[GO-2026-6859](https://pkg.go.dev/vuln/GO-2026-6859). Existing CI reads the version
directly from `agent/go.mod`. These source changes do not update already installed
probe binaries until a corresponding tested binary is built and installed.

For an existing installation, set these variables in its existing service
configuration or an administrator-managed service drop-in:

```ini
CF_MONITOR_DISCOVERY=true
CF_MONITOR_DISCOVERY_INTERVAL=1800
CF_MONITOR_DISCOVERY_DOCKER=false
CF_MONITOR_DISCOVERY_SMART=false
```

A minimum interval of 300 seconds is enforced locally. Equivalent local flags
are `--discovery`, `--discovery-interval`, `--discovery-docker`, and
`--discovery-smart`. A locally launched `--discovery-once` prints one sanitized
snapshot and exits without contacting CVM; review that output privately before
enabling uploads. It does not require a server URL or Agent Token.

These settings are controlled on the server itself, outside CVM. The dashboard
has no remote enablement, command execution, package installation, or privilege
escalation facility. Preserve administrator-managed drop-ins when upgrading.

## Collected data and limits

Linux collectors expose:

- OS, kernel, architecture, virtualization, timezone, BBR and swap.
- A whitelist of effective default SSH settings from `sshd -T`; SSH `Match`
  contexts can differ and are explicitly identified as a limitation.
- nftables chain policies and rule counts, not raw rule bodies; Fail2ban jail
  names; systemd service states and timer names.
- The apt security-update timer state. Package policy remains unknown unless
  an external harness supplies it. Other distributions are not assumed secure.
- Cron file names, recognized schedule expressions and counts. Commands,
  arguments, environment variables and user crontabs are not uploaded.
- Network interfaces, IP addresses, listening ports, mounts and filesystem types.
- Host disk counters and measured average IOPS/throughput between consecutive
  snapshots. The first sample or a counter reset yields unknown rates. Host disk
  counters are not attributed to an unverified container.
- Docker, Compose, Caddy and Nginx versions when readable. Literal domains from
  standard Nginx/Caddy configuration paths are projected into relationships; custom
  includes, dynamic configuration and activation remain explicitly unverified.

Collectors have timeouts and output limits; one upload is capped at 512 KiB and
200 assets. Inventories that exceed limits are marked partial. Permission denied,
not installed, unsupported platform, unavailable, and collection failure do not
mean an asset was deleted. CVM never deletes an accepted asset merely because a
probe stopped reporting it.

Missing backup strategy and backup-success evidence remain unknown. An external
harness can supplement them through the same discovery API schema; a statement
by a harness is not converted to probe-observed evidence.

## Optional Docker collection

`CF_MONITOR_DISCOVERY_DOCKER=true` enables a fixed set of local Unix socket GETs
against `/var/run/docker.sock`: API-version negotiation, container list, inspect and one-shot resource
statistics. It discovers stable Compose/project/service identities, image IDs,
health vocabulary, ports, network names, restart count, deployment/configuration
paths and mounted data directories. Only selected Compose/Traefik labels are
projected. Environment values, command arguments, raw labels, health-command
output, credentials and complete configuration files are not uploaded.

A read-only filesystem bind of the Docker socket does **not** restrict Docker
API permissions. Access to that socket is a high-privilege local capability.
The installer does not grant that capability, change socket permissions, add the
probe user to the Docker group, or expose the socket to CVM. Prefer an external
harness submitting sanitized inventory if the existing service cannot safely
read the socket.

At most 50 containers are inspected and at most 10 running containers receive
resource samples per collection, rotating through that bounded inventory instead
of repeatedly sampling only the first ten. Missing memory/network/disk/CPU
counters remain null. CPU percentage requires two real CPU samples, uses the
same runtime container identity, and includes its actual averaging interval.
These are discovery-interval observations, not a real-time container dashboard.
The probe never sends Docker control, exec, logs,
image pull, filesystem archive, or mutation requests.

## Optional SMART

`CF_MONITOR_DISCOVERY_SMART=true` runs only `smartctl --json=c --health` for up to
eight locally enumerated physical disks. It runs no self-tests and changes no
settings. Virtual disks, containers, missing tooling and inadequate privileges
are marked unknown/unavailable instead of healthy.

## Website checks

`check_config` extends the existing website monitor, not a second monitor model:

```json
{
  "kind": "http",
  "keyword": "ready",
  "json_path": "data.status",
  "json_equals": "ready",
  "tls_warning_days": 14,
  "maintenance": [{"start":"2026-12-01T01:00:00Z","end":"2026-12-01T02:00:00Z"}]
}
```

HTTP content checks use GET and read at most 256 KiB. JSON paths are bounded
property/index paths, never executable expressions. `kind: "dns"` supports A,
AAAA, CNAME, MX, NS and TXT with optional expected answers; Worker probes use a
fixed Cloudflare DoH resolver and node probes use the operating system resolver.
`kind: "websocket"` performs a handshake and closes without sending application
messages. All network probes retain public-target restrictions.

A node HTTPS probe records the actual verified peer certificate expiry. Worker
Fetch does not expose certificate expiry, so it reports unknown. Notifications
require recent measured certificate evidence, honor maintenance/silence, reuse
the existing delivery ledger, retry failures, and deduplicate by certificate and
monitor configuration.

Maintenance skips checks; it does not manufacture an "up" result. Statistics use
one selected probe source, omit maintenance, show observation coverage and unknown
gaps, and calculate P50/P95/P99 from successful real samples. Short retained
history cannot establish an entire month's SLA.
