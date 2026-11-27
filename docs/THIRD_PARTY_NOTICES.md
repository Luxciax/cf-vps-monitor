# Source provenance and third-party notices

## Project lineage

This repository is [Luxciax/cf-vps-monitor](https://github.com/Luxciax/cf-vps-monitor),
a fork of [kadidalax/cf-vps-monitor](https://github.com/kadidalax/cf-vps-monitor).
GitHub's repository metadata identifies the latter as both parent and source.
The existing root [LICENSE](../LICENSE) is MIT and retains:

> Copyright (c) 2026 CF VPS Monitor contributors

The license matches the upstream license. Its copyright and permission notice must
accompany substantial copies. Independent maintenance does not require rewriting Git
history, removing upstream attribution or leaving the fork network. Those operations
are not part of this change. Installer/release repository settings identify the
binary source independently from the source checkout; validate the actual release
asset and commit before claiming a source change is deployed on a probe.

## Twemoji flag graphics

`frontend/public/assets/flags/*.svg` contains the Twemoji-style national flag
graphics inherited from the existing repository. The CN and US SVG assets were
compared with their corresponding upstream Twemoji SVGs during the provenance
review. Their original paths are Unicode regional-indicator filenames; this project
stores ISO region filenames for lookup. No graphical edits are introduced here.

**Twemoji — Copyright 2019 Twitter, Inc and other contributors.**
Graphics are licensed under
[Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/),
independently of the MIT license on CVM's code. Attribution is to Twitter/Twemoji
and its contributors, with no endorsement implied.

- Source project and licensing: [twitter/twemoji README](https://github.com/twitter/twemoji#license).
- Original artwork: [Twemoji SVG assets](https://github.com/twitter/twemoji/tree/master/assets/svg).
- Verified reference assets: [CN](https://github.com/twitter/twemoji/blob/master/assets/svg/1f1e8-1f1f3.svg), [US](https://github.com/twitter/twemoji/blob/master/assets/svg/1f1fa-1f1f8.svg).
- Complete graphics license: [LICENSE-TWEMOJI-GRAPHICS](../LICENSE-TWEMOJI-GRAPHICS).

Preserve this notice and license when redistributing the bundled flags. Describe
any later artwork edits in the distribution's attribution. Other pre-existing logo
assets remain covered by their existing project provenance; no claim is made that
third-party trademarks are owned by the maintainer.

## Package dependencies

The exact JavaScript dependency graph, versions, resolved packages and integrity
hashes are in `package-lock.json`; runtime/development dependency declarations are
in the root, frontend and Worker `package.json` files. Their license metadata is
retained in the installed packages and lockfile. Do not remove dependency license
files from a redistributed source/vendor bundle.

| Module family | Direct dependencies / source |
| --- | --- |
| Frontend | React / React DOM, React Router, Radix UI, dnd-kit, Recharts, Sonner, qrcode |
| Icons | Lucide (`lucide-react`); retain its own icon/package license |
| Worker | Hono, jose, fflate |
| Build/test tooling | TypeScript, Vite, Tailwind/PostCSS, Wrangler/Miniflare, esbuild, PGlite |
| Go Agent | [gorilla/websocket](https://github.com/gorilla/websocket), [gopsutil](https://github.com/shirou/gopsutil), [golang.org/x/sys](https://pkg.go.dev/golang.org/x/sys), plus the indirect modules in `agent/go.mod` |

Go versions/checksums are recorded in `agent/go.mod` and `agent/go.sum`. Upstream
module license files remain authoritative; this project does not relicense those
dependencies. The MCP server and provider discovery adapters introduced here use
Node's standard library and the existing CVM API, adding no copied MCP SDK, remote
execution component or provider SDK source.

Komari, Uptime Kuma, Homeport/Homedex and 1Panel are product-design references in the
requirements. This change does not import their application source or assert that
their code is licensed under CVM's MIT license. If source/artwork is imported later,
record the exact origin, version and applicable license before redistribution.
