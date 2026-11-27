# CVM 验证记录

验证日期：**2026-11-27**。源码基于 `main` 的
`32e1f90712f2274ba63dbbfc296ec24197646578`，在
`feat/cvm-infrastructure-center` 工作分支验证。

**核心回归 156/156 通过；前端和 Worker 类型检查、构建检查通过；实际浏览器与认证运行时回归通过。
Go 全量测试仍有受当前环境 AF_UNIX 限制影响的失败，因此不能声明 `npm run verify`
整体通过，也不能把本次源码验证视为生产部署或 Release 验收。**

本文记录本地运行证据。提交、远端 CI、部署与发布须分别以对应 Git 提交、CI 运行和部署记录为准，
不从“构建通过”推导其他状态。功能范围与已知能力边界见
[实现与审查记录](CVM_IMPLEMENTATION_REVIEW.md)。

## 1. 环境与计数规则

| 项目 | 本次环境 |
| --- | --- |
| 操作系统 | Linux amd64；当前执行环境禁止创建 AF_UNIX Socket |
| Node / npm | Node `v24.22.3`；npm `11.19.1` |
| Worker | Wrangler `4.156.1`；本地 workerd / Miniflare |
| 数据库回归 | PGlite 执行实际 PostgreSQL 迁移、函数与事务；不连接生产数据库 |
| Go | 官方 Go `1.26.11` Linux amd64 工具链 |
| PowerShell | 官方便携版 PowerShell `7.7.0`，运行于 Linux；执行测试时将其目录加入 `PATH` |
| 浏览器 | Chromium `158.0.8127.0`；当前 Vite 源码、隔离上下文、受控 API 响应 |

Node 和 Go 的数字均保留各测试运行器的统计口径，可能同时包含父测试及子测试。
**不同运行的计数不相加**：核心 156 项中已包含安装器/版本 29 项、前端核心 4 项、
主题路由 3 项、身份与恢复完整性 8 项等专项验证。全量 JavaScript 运行也包含核心集合。
认证运行时的 75 个匿名请求属于 7 项认证测试的覆盖范围，不是额外 75 个独立测试。

## 2. 实际结果与证据

临时日志路径相对于仓库根目录；`../` 路径为本次同一工作区的外围验证产物。
这些日志属于本地执行证据，不保证包含于 Git 仓库。本文保留准确结果、测试入口与边界，
代表性浏览器截图另存于 [review/](review/README.md)。没有单独保存日志的项目明确标为工具执行记录。

| 验证项 | 实际结果 | 证据与边界 |
| --- | --- | --- |
| `npm run lint` | 通过 | `.tmp/cvm-verify-core.log`：前端 `tsc --noEmit`；Worker `wrangler types --check` 与 `tsc --noEmit` |
| `npm run build` | 通过 | 同上：前端生产构建；Worker 生成 14 个迁移并通过类型检查。这是当前脚本定义的构建检查，不表示已发布 Worker |
| 最终前端生产构建 | 通过，1.62 秒 | `.tmp-cvm-frontend-build-final.log`；入口 JS gzip 61.70 kB，不能将入口大小当成全部页面资源总量 |
| `npm run test:core` | **156 pass / 0 fail / 0 skip**，45.20 秒 | `.tmp/cvm-core-final.log`；实际执行 `package.json` 明列的 24 个核心测试文件 |
| 全量 `npm run test:js` | **1020 pass / 6 fail / 25 skip，共 1051 项**；退出码 1，144.29 秒 | `.tmp/cvm-js-final.log`；本次全量运行没有通过，失败集合及后续定向复验单独记录，不将定向结果改写为全量通过 |
| 全量失败后的后端定向复验 | **9 pass / 0 fail / 0 skip**；退出码 0，16.96 秒 | `.tmp/cvm-js-final-backend-fixes.log`；包含 4 个原失败及同文件既有回归；仅对齐测试的迁移数量/顺序与真实辅助依赖，保留预算、超时及安全断言 |
| 全量失败后的前端定向复验 | **76 pass / 0 fail / 0 skip**，6.99 秒 | `.tmp/cvm-frontend-final-fixes.log`；包含 2 个原失败及同文件既有回归；独立恢复凭据精确请求与公开网站真实 helper 契约修正 |
| 原安装器与 Release 版本解析 | **29 pass / 0 fail / 0 skip** | `.tmp/cvm-powershell-release.log`；已包含于最终核心 156 项，不另加；PowerShell 在 Linux 执行，不是 Windows 服务安装验收 |
| 实际认证运行时 | **7 pass / 0 fail / 0 skip** | `.tmp/cvm-auth-runtime-final.log`；真实 workerd、中间件、PostgreSQL；75 个受保护管理路由声明均拒绝匿名访问 |
| 新界面浏览器回归 | **14/14 通过，0 pageErrors** | `.tmp-cvm-ui-final-complete.log`；当前源码真实渲染及交互，API 为合成响应 |
| 原图表主题切换 | **1/1 通过，0 pageErrors** | `.tmp-cvm-chart-runtime.log`；`CHART-runtime`，旧图表在显示主题与外观切换后更新 |
| 原隐藏 URL 与跨标签页传播 | **2/2 通过，0 pageErrors** | `.tmp-cvm-hidden-url.log`；分别覆盖 BroadcastChannel 与 storage 通道 |
| `npm run security:check` | 通过，退出码 0 | 本轮工具执行记录，未另存扫描日志：`npm audit: no vulnerabilities found.` 与 `govulncheck: no vulnerabilities found.`；使用 Go 1.26.11，不以安全门槛的模拟测试代替真实扫描 |
| `go test -json ./...` | **455 pass / 13 skip / 6 fail，共 474 个测试/子测试事件**；包结果失败，18.359 秒 | `../cvm-go-patched-tests.jsonl`；6 个失败均来自同一 AF_UNIX 测试族，详见第 5 节 |
| Agent Linux amd64 / Windows amd64 构建 | 两个目标均构建成功 | 本轮工具执行记录，未另存完整构建日志；Windows 为交叉编译，不是原生 Windows 运行测试 |
| `go mod verify` | `all modules verified` | 本轮工具执行记录；当前 `go.mod` 固定 Go 1.26.11 与已修补的依赖版本 |
| 两个 Unix 安装器语法 | `bash -n` 通过 | 本轮工具执行记录；不执行安装、升级、卸载或系统服务变更 |
| 本机只读发现到 RPC | 真实发现报告通过正式验证器并进入实际数据库 RPC；重复提交判定为重复 | `../cvm-discovery-runtime.json` 与本轮工具执行记录；绑定现有 VPS、产生 1 个配置快照，未重复创建宿主资产 |
| 本地 Worker HTTP 冒烟 | `/ping` 200；`/api/version` 200；恢复状态接口 200 且默认关闭；未认证资产 API 401 | `.tmp/cvm-worker-runtime.log` 与本轮 HTTP 响应检查；没有连接用户生产 Supabase / Cloudflare 环境 |

首次 `npm run verify:core` 的完整日志仍保留于 `.tmp/cvm-verify-core.log`。
该次运行先完成 lint 与 build，随后因缺少 `pwsh`，核心测试得到 **127 pass / 29 fail**；
失败输出为 `spawnSync pwsh ENOENT`。随后安装官方 PowerShell 7.7.0，先验证原 29 项，
再重跑完整核心集合得到上述 **156/156**。没有删除、跳过这些测试，也不把首次失败记录改称成功。

## 3. 核心回归验证了什么

以下为已经运行的核心集合所覆盖的关键风险；完整测试入口见根目录 `package.json` 的
`test:core`。测试执行真实实现，外部网络与平台 I/O 在对应边界受控替换。

| 风险 | 验证方式与实际断言 |
| --- | --- |
| 旧数据升级、重复资产模型 | 在 PGlite 执行旧结构到新结构的迁移；原 VPS、网站监控、隐藏 URL 及关联进入统一台账；保留原监控 ID 与多监控关联 |
| 发现失败误删、重复创建与手工字段覆盖 | 重复/失败/不完整/迟到报告、忽略后再次发现均有回归；正式资产不因采集缺失被删除；手工字段保留 |
| 跨来源数据回退 | 新观测后提交另一个来源的旧报告，资产值及 `observed_source` / `observed_at` / `observed_confidence` 不回退 |
| 身份与拓扑一致性 | 已绑定 VPS 不能通过普通编辑更换 client 身份；不同已注册节点不能合并；网站监控移动/解绑立即协调来源所属关系；删除 Ping 保留资产并清除引用 |
| 备份恢复闭环 | 新库完整恢复成功；监控引用、文档资产、基线例外/SOP、版本父身份和重复 ID 非法时整笔事务拒绝；旧文档缺少 `asset_kinds` 时兼容为空数组，非法类型仍拒绝 |
| 文档与基线适用性 | Cloudflare 资产选择对应 SOP；缺少 OS 证据不默认 Linux；Linux 证据驱动筛选；版本保留适用范围；disabled、未来时间与未知采集不产生虚假合规 |
| API 与 AI 数据边界 | 执行实际 Hono 路由及 scope 检查；限制字段、时间、分页、UTF-8 响应字节；受限调用者不能读取超出权限的快照/文档；外部操作保持 claimed |
| 上下文当前状态 | 使用实际持久化 VPS/Ping 观测及时间过滤；缺测保留未知，不把历史快照冒充当前在线 |
| 凭据与恢复 | 独立恢复凭据、默认关闭、恢复后会话失效；Machine Token 到期、吊销、轮换与 scope；混合大小写敏感字段及带凭据 URL 拒绝 |
| 提供商发现 | Cloudflare/GitHub 稳定标识、来源、关系、权限失败与分页截断；长域名标识保持确定性和区分性，关系目标通过正式发现 Schema |
| 监控增强 | HTTP 内容、JSON、DNS、WebSocket、维护/静默、TLS 证据和提醒；可用率/覆盖率区分缺测，P50/P95/P99 与事件区间使用观测数据 |
| 通知与旧功能保留 | 现有加密备份往返、网站恢复/合并、清理续跑、通知生命周期与恢复状态、隐藏 URL、主题预览及原发布门槛 |
| MCP | 实际 JSON-RPC/stdio 处理器，通过内存输入/输出流和受控 API 验证会话及调用契约；工具沿用现有权限，没有 Shell、SSH 或 Docker Exec 工具 |

认证运行时另验证完整登录过程：MFA challenge 不能冒充管理会话；正确 OTP 完成后才取得会话；
CSRF 与敏感操作 step-up 独立有效；恢复码一次性使用并拒绝重放。
该运行的匿名路由覆盖为 **75 个声明**，以当前源码实际枚举为准。

## 4. 浏览器与真实采集证据

浏览器运行日期均为 2026-11-27，最终 14 项运行区间为新加坡时间（UTC+8）
`19:49:59` 至 `19:50:28`。Chromium 渲染当前 React 组件，验证资产创建/分组/批量修改、
Ctrl+K、发现确认、Markdown 注入与冲突草稿、基线与 Token 生命周期、手机导航、
未知指标、监控设置、主题预览隔离、恢复页面和请求失败状态。
公开 Monitor 主题同时检查 VPS 与网站网格、浅深色和横向溢出；原有图表及隐藏网址另做回归。

页面测试采用空环境、隔离浏览器上下文、受控 API interception，外部请求被阻断。
**截图中的资产、指标及配置均为合成测试数据**。这证明页面实际渲染与交互契约，
不代表生产数据库端到端测试。手机验证使用 390 px 视口，不等于实体手机验证。
截图、实际查看范围及复现入口见 [视觉验证记录](review/README.md) 和
[浏览器回归说明](../frontend/browser/README.md)。

本机 Agent 的 `--discovery-once` 则采集真实当前环境，报告为 **8486 字节、1 个宿主资产、
23 个采集器状态**：9 available、9 unavailable、3 error、1 permission_denied、1 disabled。
报告明确 `complete=false`，没有把环境不支持的能力补成成功。正式输入验证器接受该报告，
实际迁移/RPC 流程保存配置并绑定既有 VPS，重复同一报告返回重复状态。
该验证没有 Docker 控制操作，也没有上传完整配置、环境变量、密码或私钥。

## 5. 尚未通过的完整门槛与环境限制

### 全量 JavaScript 结果

本次唯一一次完整 `npm run test:js` 得到 1020 pass、6 fail、25 skip，退出码为 1。
6 个失败覆盖独立恢复凭据表单契约、公开网站旧事件的 helper 注入、迁移签名/排序、
setup 迁移计数，以及 2 个计划任务预算 fixture。核心集合与这些旧契约是不同的覆盖范围，
核心 156 项通过不能消除该次全量运行的失败记录。

后端已对实际失败文件做定向复验，9 项全部通过，覆盖其中 4 个原失败以及同文件相关回归。
更新的是旧测试所依赖的实际迁移清单、签名排序、数量和辅助函数注入；没有降低生产逻辑的
预算/超时要求，没有放松发布或认证门槛。

前端两个测试文件的定向复验为 76/76 通过，覆盖剩余 2 个原失败；恢复请求严格断言独立
`recovery_token` 并禁止 Supabase 凭据字段，公开网站测试注入真实的 `websiteHealth` helper。
仅修改旧测试契约，生产源没有因此改变。首次独立调用遗漏 PowerShell 的 `PATH`，
已有 `AUD-38` 因此得到 75/76；该记录保留于 `.tmp/cvm-frontend-final-fixes-initial.log`，
正确使用已安装 PowerShell 后得到最终 76/76。

**原全量的 6 个失败均已在上述定向复验中通过；没有再次运行全部 1051 项。**
后端 9 项与前端 76 项来自原全量集合，不能另加为新的独立测试总数。

25 项 skip 为既有的 6 项 Linux 原生权限/root 条件测试及 19 项 Windows 原生环境测试；
保持 skip 状态，不计入通过。后续修复只复验实际失败集合，另记结果，不声称已重新运行
并通过全部 1051 项。

### Go 全量结果

Go JSONL 的 6 个失败事件为：

```text
TestDirectoryDiskNativeGuestSocket/devices
TestDirectoryDiskNativeGuestSocket/root_listing
TestDirectoryDiskNativeGuestSocket/redirect
TestDirectoryDiskNativeGuestSocket/too_large
TestDirectoryDiskNativeGuestSocket/deadline
TestDirectoryDiskNativeGuestSocket
```

前 5 项是子测试，最后一项是父测试结果；不能表述为 6 个独立功能故障。
实际错误为 `listen unix /proc/self/fd/3/s: socket: operation not permitted`。
另一次 Python AF_UNIX 创建也得到同类权限错误，支持当前执行环境限制的判断。
没有为取得全绿结果修改测试以绕过该限制。

13 个 skip 来自当前环境下的目录权限/扫描锁/受保护缓存分支及
`TestReauditICMPPlatform`。它们保留为 skip，不计入通过。ICMP 平台命令另有受控命令
回归覆盖各平台参数和超时取消，但不能据此声称已在所有目标操作系统原生运行。

因此，本地完整 Go 门槛仍是**未通过**。需要在允许 AF_UNIX、具备对应权限和平台条件的
环境执行既有完整门槛。`npm run verify` 继续保留 lint、build、全量 JS、Go 与真实安全扫描，
没有改成仅跑核心集合。

### 其他尚无真实环境验收证据的项目

- Docker Socket、SMART 物理设备：已做安全投影、边界与失败状态测试，本机没有相应真实设备。
- Windows：Linux PowerShell 已运行安装器的版本解析及发布契约，Windows amd64 可交叉编译；
  没有真实 Windows 主机的服务安装、升级、卸载验收。
- Cloudflare/GitHub：提供商适配器已做合约、分页、权限与敏感字段测试，未使用用户生产账户凭据在线采集。
- Supabase/Proxy/Worker：本地迁移、RPC、代理权限及 HTTP 运行时已有证据；未迁移用户生产库，
  未进行真实 Cloudflare/生产 Supabase 联调或负载验收。
- TLS、SMART、容器资源等需要对应采集能力；源码和页面继续显示未知/不可用，不能用测试夹具当实际指标。

## 6. 复现与交付状态

在已安装项目依赖、Go 1.26.11、PowerShell 7.7.0 且相应二进制位于 `PATH` 的环境执行：

```sh
npm run lint
npm run build
npm run test:core
node --test worker/test/auth-runtime.test.mjs
npm run security:check
```

发布前完整门槛仍为：

```sh
npm run verify
```

该命令会运行全量 JavaScript 与 Go 测试；核心集合不替代它。浏览器需要 Playwright 与兼容
Chromium，按上文浏览器说明运行。所有上述本地检查均无需生产凭据；不要为了复现测试修改生产配置。

- [x] 读取实际测试输出，分别记录核心、认证、浏览器、Go 与安全扫描结果。
- [x] 前端和 Worker 类型检查、构建检查通过。
- [x] 核心 156 项通过，包含补齐 PowerShell 后的原安装器验证。
- [x] 全量 JavaScript 首轮 6 个失败已修正测试契约并完成后端 9/9、前端 76/76 定向复验；保留首轮完整运行结果。
- [x] 认证运行时、75 个匿名管理路由拒绝与浏览器渲染验证通过。
- [x] 真实 npm / Go 漏洞扫描通过；没有放松扫描或发布门槛。
- [x] 本机真实发现报告通过输入验证与实际数据库 RPC。
- [x] Go Linux/Windows 目标构建与模块校验通过。
- [ ] 完整 `npm run verify` 成功：本地仍无整体通过证据，Go 全量受上述环境限制。
- [ ] 真实 Docker/SMART、Windows 安装生命周期与用户提供商环境验收。
- [ ] 生产数据库迁移、Proxy/Worker 部署、线上探针安装升级、密钥轮换及 Release：本次未执行。

Git 提交与远端 CI 状态应由最终交付回复列出实际提交标识和运行结果；本文不将工作区修改或
本地成功构建标记为“已提交”“已部署”或“已发布”。
