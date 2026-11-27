# CVM 基础设施中心：实现与审查记录

本次工作基于 `main` 的 `32e1f90712f2274ba63dbbfc296ec24197646578`
（`feat:complete-supabase-proxy-migration-cutover`），在独立开发分支
`feat/cvm-infrastructure-center` 完成。原始工作区为干净克隆，没有覆盖用户本地修改。

本文件记录源码交付的范围、模型和验证边界。**源码实现、测试、构建、提交、线上迁移、
部署与 Release 是不同状态。** 本次没有更改生产数据库、线上凭据或已安装探针，
没有部署 Worker/Proxy，也没有发布 Release。

## 1. 事实核查与功能矩阵

先检查实际 GitHub 分支/提交、工作区、React 前端、Worker/Hono、Go 探针、
Supabase 迁移及 Proxy、CLI、部署门槛和原有文档，再按依赖分工实现。
下面的“保留”表示继续使用原有模块；并不意味着每一种硬件和每一个线上提供商都已实测。

| 需求 | 基线状态 | 本次源码结果 | 主要实现 / 证据 |
| --- | --- | --- | --- |
| VPS 实时与历史资源、GPU、温度、流量、费用/到期 | 已有 | 保留原采集、实时通道、历史与通知；增加统一库存入口和配置证据 | `agent/main.go`、`worker/src/do/live-data.ts`、原服务器页面；Go 回归与前端原页面回归 |
| HTTP/TCP、多地区 Worker/Agent 探测、Heartbeat | 已有 | 保留现有监控表和调度；缺失采样不再补成成功，空延迟不再显示零 | `website-monitor.ts`、`probe_scheduler.go`、`WebsiteHeartbeatBar.tsx` |
| 网站分类、标签、图标、备注、部署关联、隐藏与隐藏 URL | 已有 | 保留并迁移；库存和监控解耦，双向入口及多监控绑定 | 旧库升级、隐藏 URL、关联迁移回归 |
| Ping、通知、Webhook、账户/MFA、审计、Agent Token | 已有 | 复用原系统；补权限、恢复与会话失效缺陷；不建立第二套认证 | `auth/`、`routes/client.ts`、原管理页面 |
| 统一资产台账 | 原网站属性与节点记录分散 | 17 种资产类型、稳定 UUID、分类/标签、生命周期、费用/到期、来源、手动字段与采集字段分离 | `infra_assets`、`infra_monitor_links`、`infra/types.ts`、基础设施页面 |
| 导入、合并、去重、归档、搜索、批量管理 | 无统一闭环 | ID 和 source/external_id 去重；事务批量操作；合并重挂监控、关系、文档、快照、例外与历史 | `infra_dispatch`、实际 PGlite 回归 |
| 资产关系与影响查询 | 缺少统一关系模型 | 有类型、有来源的关系；上下游、深度/数量上限；潜在影响与已观测故障分开表达 | `infra_relationships`、拓扑 API、资产详情拓扑 |
| 本地只读发现 | 无统一发现收件箱 | 默认关闭的固定采集器；候选 → 导入/合并/忽略 → 持续同步 → 变化记录 | `agent/discovery*.go`、Discovery Inbox、真实本机报告契约验证 |
| Cloudflare / GitHub 发现 | 无统一外部发现接入 | 本地 CLI 提供商采集器，同一报告/确认流程；凭据留在本地，分页/权限错误如实标记 | `scripts/lib/provider-discovery.mjs`、提供商合约测试 |
| VPS 配置可视化 | 基础系统信息为主 | 只读配置快照、来源/时间/环境/可信度、能力状态、结构化展示、前后差异 | `infra_configuration_snapshots`、`Configuration.tsx` |
| 配置基线 | 无 | 可版本化规则、环境/资产适用性、例外期限、SOP 关联、真实评估结果 | `infra_baselines`、`baselines.ts`、基线页面 |
| 资产与外部操作变化 | 审计日志为主 | 资产、发现、配置、关系、基线时间线；before/after；外部结果固定为 claimed | `infra_changes`、`POST /operations`、变更页面 |
| 运维知识库 | 无完整管理系统 | Markdown 编辑/安全预览、分类/标签/全文查询、版本与冲突、关联/适用范围、导入导出、15 篇 SOP | `infra_documents`、Knowledge 页面、`sop-library.json` |
| AI 上下文与全局搜索 | 旧 Machine API / CLI | 在原 API 中扩展上下文、查询、写回；字段/权限/时间/数量/UTF-8 大小约束 | `infra/service.ts`、`routes/infrastructure.ts` |
| 多 Machine Token 与 MCP | 单一环境 Token；无完整 MCP | 独立 token、细粒度 scope、到期/撤销/轮换、审计；实际 stdio MCP | `machine-tokens.ts`、`machine-openapi.ts`、`cvm-mcp.mjs` |
| 公开首页与后台体验 | 既有主题/页面 | 保留旧主题、CSS、背景；新统一后台与清爽 Monitor 主题、移动端、快捷搜索、密度与布局 | `frontend/src/infrastructure/`、浏览器渲染证据 |
| TLS / 内容 / DNS / WebSocket | 原 HTTP/TCP | 真实 TLS 证据及提醒、关键词/JSON 检查、DNS、WebSocket 握手 | Go 与 Worker 检查器、监控核心测试 |
| 维护 / 静默 / SLA / 分位数 / 故障恢复 | 原状态与部分历史统计 | 网站维护窗口、静默、去重/恢复；单源可用率、覆盖率、未知时段、P50/P95/P99、故障区间 | 既有通知账本、`website-statistics.ts`、数据库维护守卫 |
| SMART / I/O / IOPS / 单容器指标 | 部分主机指标 | 可选 SMART、真实差值 I/O、限量轮转容器采样；无数据明确 unknown | 只读 Go 采集器与采样测试 |
| 备份、恢复、迁移、容量 | 已有加密配置备份与迁移 | 新模块纳入同一配置快照；版本与身份校验；有界历史清理；保留原发布门槛 | `infra/backup.ts`、备份迁移、清理与恢复回归 |
| Proxy 管理员恢复 | 依赖不应存在于 Proxy Worker 的直连凭据 | 独立、默认关闭、可轮换恢复凭据；限流、审计、MFA 重置及旧会话失效 | `admin-recovery.ts`、实际认证回归 |
| 许可与独立维护 | MIT / 上游 fork；部分图形署名不足 | 保留 Git 历史与 MIT；核对上游，补 Twemoji CC-BY 4.0 署名/许可 | `THIRD_PARTY_NOTICES.md`、公开开源声明 |

## 2. 产品边界与统一数据流

CVM 只负责监控、发现、记录、查询、展示和向外部 AI 提供上下文。
没有新增 WebShell、SSH 执行器、远程文件管理、Docker 控制/Exec、脚本任务队列或内置 Agent。
文档和操作回写不会触发服务器操作。生产变更由用户授权的外部操作者执行。

浏览器后台与 Machine API 共用 Hono 路由和同一 `cfm_infra` 事务 RPC；后者继续走原
Supabase Data API / Proxy 连接，不新增第二套数据库服务或认证系统。
原 `clients`、`website_monitors`、`ping_tasks` 保持监控职责；`infra_assets` 保存库存，
通过 `infra_monitor_links` 引用原 ID。没有复制一套采样表。

资产种类为 `vps`、`website`、`api`、`domain`、`container`、`compose`、
`reverse_proxy`、`service`、`repository`、`deployment`、`cloudflare_worker`、
`cloudflare_pages`、`database`、`storage`、`certificate`、`provider`、`other`。
内部服务使用 `service`，不需要先公开或先创建监控。一个服务可关联多个监控；
同一仓库可关联不同 Deployment 实例。

网站与 Ping 的监控关联可移动/解绑。VPS 的 Agent 身份是规范绑定：
不能用普通资产编辑修改 `client_id`、把已绑定 VPS 改成其他类型或任意搬动 client 监控。
合并重复库存时使用事务化的资产合并；两个不同的已注册节点不能被合并成一个身份。
删除旧监控只移除关联，保留正式资产，避免删除监控意外等于删除基础设施记录。

## 3. 发现、来源与变化的可信边界

- `metadata`、名称、标签、说明等为手动维护字段。采集进入独立的 `observed` 投影；
  配套记录 `observed_source`、`observed_at`、`observed_confidence`。
- Agent 来源由既有 Agent Token 绑定为 `agent:<client>`，客户端不能冒用其他节点。
  外部报告使用调用者身份隔离的 Harness 来源；token 轮换保留其稳定 ID。
- Agent 事实标记 observed；外部快照标记 reported；外部操作和相应变化标记 claimed。
  后来的较旧来源不能覆盖更新投影；历史证据仍各自保留。
- 稳定 external_id 最长 240 字符。长提供商标识使用确定性缩短方式，完整非敏感名称
  保留在 metadata。重复同一报告不重复创建资产或配置快照。
- 完整成功报告中缺失的候选记录 `missing_since`；这只是缺失证据，
  **不会自动删除或归档正式资产**。暂时离线、权限不足、工具缺失、采集失败与
  确认的人工归档不是同一状态。
- 只对当前来源拥有的关系做持续同步；手工关系不会被自动发现覆盖或删除。
  关系实际增删留下时间线，不用“发现成功”掩盖拓扑漂移。
- 本地探针的 Docker/SMART 能力另行 opt-in。只读挂载 Docker Socket 仍是高权限
  本地能力，安装器不提升权限、不修改 Socket 权限、不把它暴露给中心。

具体安全采集范围与环境限制见 [agent/DISCOVERY.md](../agent/DISCOVERY.md)。

## 4. 配置、基线与知识库

配置页展示操作系统/内核/架构、SSH 默认有效配置、nftables 摘要、Fail2ban、
自动更新定时器、BBR、Swap、时区、网卡/IP/监听、Docker/Compose/反代运行环境、
systemd 服务/定时器、Cron 摘要、挂载与数据/部署目录及关联资产。
没有安全数据来源的备份策略、备份成功证据和受限配置继续显示未知，可由外部 Harness 补充。

基线规则是受限属性路径和比较操作，不是可执行表达式。评估区分 compliant、deviation、
missing、unknown、stale；规则结果显示原始证据可信度。disabled、partial、
无效/未来时间、无权限采集不能变成“合规”。例外需关联实际规则/资产并有到期时间。
基线只检测；SOP 链接也不授权自动修复。

知识库内置 15 篇可编辑、可版本管理的 SOP：

1. 新 VPS 初始化。
2. Debian / Ubuntu 安全加固。
3. SSH 安全配置。
4. 防火墙与 Fail2ban。
5. Docker 安装与部署。
6. Compose 服务维护。
7. Caddy / Nginx 反向代理。
8. Cloudflare DNS、Worker、Pages、Tunnel。
9. 数据库备份与恢复。
10. 服务迁移。
11. TLS 证书故障。
12. 网站 502。
13. 磁盘爆满。
14. 高负载。
15. VPS 离线。

每篇都包含目标、适用环境、前置条件、环境检测、步骤、风险、禁止事项、验证、回滚、
常见故障与官方参考。SSH/防火墙要求先验证备用入口和新会话；数据库恢复要求隔离验证；
迁移考虑双写/回切；禁止无条件清空磁盘、删除卷或重启整机。
自动上下文按资产种类/已知环境匹配 SOP，明确关联的文档保持可读，未知环境不被推断为 Linux。

## 5. API 与管理页面

新 API 在 `/api/admin` 和 `/api/v1` 共用实现，主要路径：

| 路径 | 作用 |
| --- | --- |
| `/assets`、`/assets/import`、`/assets/batch` | 查询、创建、导入、批量标签/归档 |
| `/assets/:id`、`/assets/:id/merge` | 稳定身份编辑与事务合并 |
| `/assets/:id/context` | 有界 AI 上下文与可信边界 |
| `/assets/:id/topology`、`/relationships` | 上下游、潜在影响与关系管理 |
| `/assets/:id/monitors` | 原监控的关联与安全投影 |
| `/discovery/reports`、`/discovery/candidates`、`/discovery/runs` | 外部发现、候选与采集证据 |
| `/discovery/candidates/:id/resolve` | 导入、合并、忽略 |
| `/configuration/snapshots`、`/changes`、`/operations` | 配置证据、变化及外部声明回写 |
| `/documents`、版本/恢复/导出子路径 | 知识库、并发版本保护与 Markdown 导出 |
| `/baselines`、版本/评估子路径 | 规则、例外和检测 |
| `/search`、`/infrastructure/summary` | 按 scope 的全局检索与概览 |
| `/websites/:id/statistics` | 单源、有限时间窗的实际可用率/延迟/故障 |
| `/themes/preview` | 校验并生成主题预览 CSS，不保存或激活 |

人类管理员的 Machine Token 管理位于 `/api/admin/account/machine-tokens` 及其生命周期
子路径，机器 token 不可访问。Agent 发现仍走 `/api/clients/discovery`，不是机器 API 的免鉴权旁路。
游客统计走原 `/api/public` 路由；先验证监控公开性，且不返回 URL、私密配置或错误详情。

新增管理路由为 `/admin/infrastructure`、`/admin/assets/:id`、`/admin/discovery`、
`/admin/changes`、`/admin/baselines`、`/admin/knowledge`、`/admin/api`。
原服务器、网站、通知、主题、账户和设置页面保留并增加关联入口。
Ctrl/⌘+K、URL 筛选、排序/分组、批量操作、卡片/表格、信息密度与摘要布局均使用真实 API。

完整请求、权限、CLI/MCP 配置见 [API.md](API.md)。

## 6. 新迁移与升级策略

| 迁移 | 内容 |
| --- | --- |
| `20261127111500_infrastructure_schema.sql` | 库存/关系/监控链接、发现、快照、变化、文档/基线及版本表，旧数据回填、同步、RLS/索引 |
| `20261127111509_infrastructure_rpc.sql` | 事务 CRUD、合并、发现协调、上下文所需查询、关系/引用一致性、保留清理与审计 |
| `20261127111515_machine_token_security.sql` | 独立 Machine Token 与安全生命周期 RPC |
| `20261127111522_monitor_extensions.sql` | 检查策略、TLS 真实证据/通知、维护保护、分位数统计所需采样 RPC、公开安全投影 |
| `20261127111529_operations_knowledge.sql` | 15 篇 SOP 与 Debian/Ubuntu 示例基线，不覆盖既有同名用户内容 |
| `20261127112419_infrastructure_backup.sql` | 原原子配置备份/恢复接入库存、文档、基线与版本；严格引用/身份校验 |

原 `1` 至 `8` 迁移不被重写。迁移生成器按数字顺序排列旧版本与时间戳版本，生成同一
Worker 迁移包。增量升级和新库安装都用实际 PostgreSQL 语义回归；这不等于已在生产执行。

配置备份仍是加密的 5 MiB 配置备份，库存部分额外限制 3 MiB。它包含必要配置及文档/基线版本，
不代替全数据库备份：运行采样、配置快照、发现证据、变化历史、基线评估和认证状态需完整 DB 备份。
恢复校验真实目标引用；错误时整笔事务回滚，不能返回成功却留下 `monitor:null`。
监控模块保留原“所选模块替换”语义，库存按稳定 ID 合并并保留版本记录。

## 7. 容量与安全审查要点

- 新表启用并强制 RLS；撤销 PUBLIC/anon/authenticated 访问；特权 RPC 只向服务器角色开放。
- Proxy 使用运行时 SHA-256 verifier 和显式 RPC allowlist，6 MiB 请求、32 MiB 响应、25 秒上游超时，禁止任意路径和重定向。
- 管理员恢复默认关闭；只接受独立恢复凭据。Proxy 模式不向 Worker 塞入数据库直连 Secret。
- Machine Token 只存哈希；每请求验证，立即撤销；组合操作检查对应模块权限。
- 库存不会复制监控 URL 的 userinfo/query/fragment；原检测地址仍保留在监控权限内。
- 文档预览不执行原始 HTML；JSON 属性路径不执行代码；输入拒绝已知秘密字段/凭据格式。
- 上下文内容永远是不可信数据，返回 `execution_authority: none`；每节最多 50 条，UTF-8 总预算最大 256 KiB。
- 拓扑最多 5 层、200 节点、1000 边；明确报告截断。统计最多 30 天窗口、10,000 个实际样本，采样不足不冒充全时段 SLA。
- 探针发现默认 30 分钟、至少 5 分钟；API 体积 512 KiB，Agent 路由另有每分钟限流；本地最多 200 个资产。
- 提供商发现最多 80 请求、每列表 5 页、500 资产；截断标记 partial。
- 变化保留 180 天，配置/评估 90 天，发现运行 30 天；按批清理并保留每资产/来源最新配置及候选需要的运行证据。
- 补齐真实安全扫描发现的 Go 与 Gorilla WebSocket 漏洞；没有删除检查或放松发布门槛。

更完整的凭据清单、Proxy 升级顺序、恢复操作及不可省略的验证见
[SECURITY_AND_RECOVERY.md](SECURITY_AND_RECOVERY.md) 和 [DEPLOY.md](DEPLOY.md)。

## 8. 验证与实际运行边界

核心回归覆盖旧库升级、重复/失败/迟到发现、跨来源证据、手工字段保护、合并与身份、
多态监控引用、关系协调、文档/基线并发版本、备份加密/恢复、权限组合、恢复与 token、
SSRF/内容检查、维护、统计和通知去重。PGlite 执行真实迁移与 RPC；Hono 测试执行实际路由，
仅替换外部平台/数据库传输。浏览器用当前源码和明确标注的合成 API 数据测试，不接触生产。

本地 workerd 已成功启动，实测 `/ping` 为 200、`/api/version` 为 200、独立恢复默认关闭，
未认证 `/api/v1/assets` 为 401。这个运行验证没有伪称完成线上 Supabase/Cloudflare 集成验收。

以下限制保留为明确状态：

- 当前环境禁止创建 AF_UNIX Socket，原生 guest 磁盘 Socket 测试因此无法通过；测试本身与发布门槛不被跳过。
- 本机没有真实 Docker Socket、SMART 物理设备；相关接口投影与失败路径已测试，真实宿主能力需在对应环境验收。
- 已补齐 Linux 上的官方便携版 PowerShell 7.7.0，原安装器/Release 版本解析 29 项与完整核心集合已通过；这不等同于真实 Windows 服务安装、升级和卸载验收。
- Docker 资源是有界发现周期快照/平均值，**不是实时容器控制台**。
- 动态 Nginx/Caddy includes、非标准配置、NPM 内部配置数据库及未知部署路径不能凭推测补全，由能力状态和外部报告表达。
- Worker Fetch 无法提供证书到期日期；需实际 HTTPS/WSS Agent 证据，否则保持未知。
- Cloudflare/GitHub 采集器完成合约测试，未使用用户生产提供商凭据执行在线采集。
- 本次未执行生产迁移、部署、密钥轮换或 Release；已有线上 Agent 不会仅因源码提交就自动具备新功能。

## 9. 完整交付检查表

- [x] 最新仓库/分支/工作区核查与现有代码、数据流、部署架构审查。
- [x] 保留原监控、流量、账单、网络、通知、主题、账户/MFA、Agent Token、备份与 CLI。
- [x] 统一资产类型、唯一身份、分类/生命周期/费用、导入去重、合并与批量管理。
- [x] 资产/监控解耦、多监控链接、内部服务、多部署实例、拓扑与潜在影响。
- [x] 固定只读探针与外部发现、候选确认、持续同步、失败/离线/缺失状态和证据追踪。
- [x] VPS 配置可视化、采集环境/时间/可信度、未知能力与外部补充。
- [x] 可版本化基线、差异、例外、SOP 与 claimed/observed 变化时间线。
- [x] 实际知识库管理与 15 篇完整 SOP。
- [x] 扩展原 API、全局搜索、有界上下文、OpenAPI、CLI 与 stdio MCP。
- [x] 独立 Machine Token、细粒度权限、轮换/撤销/过期和审计。
- [x] 统一设计、公开 Monitor 主题、桌面/手机、浅/深色、加载/错误/空数据、快捷搜索与布局。
- [x] TLS/内容/DNS/WebSocket、维护静默、单源统计/事件、SMART/I/O/容器真实采样。
- [x] Proxy 默认关闭恢复、RLS/RPC、公开数据隔离、凭据处理、输入和渲染安全。
- [x] 迁移、备份恢复、保留策略、部署/灾难恢复/凭据文档、上游与许可审查。
- [x] 独立对抗审查发现的问题直接修复，并保留针对性回归。
- [ ] 在允许 AF_UNIX 的环境通过剩余 Go 全量门槛。
- [ ] 在真实 Docker/SMART/Windows 与用户提供商账户环境完成可选能力验收。
- [ ] 生产数据库迁移、Proxy/Worker 部署、线上 Agent 安装升级及 Release：按本次操作边界未执行。

最终提交状态和精确验证结果以提交对应的 [VERIFICATION.md](VERIFICATION.md) 为准。
