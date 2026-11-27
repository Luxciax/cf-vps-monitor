set local search_path=public;

insert into infra_documents(id,slug,title,category,content,risk,tags,environments,asset_kinds,asset_ids) values('684349cb-e183-538f-bcaf-a38b80031527','vps-initialization','新 VPS 初始化','初始化','# 新 VPS 初始化

## 目标
建立可恢复、可追踪的首份资产记录。

## 适用环境
Debian / Ubuntu；其他发行版仅采用只读核查，包管理与服务名按实际调整

## 前置条件
确认服务商控制台或串口可用；保存现有访问方式；核对公网 IP 与资产 UUID；新机器也可能预装业务。

## 环境检测
只读执行 `cat /etc/os-release`、`uname -a`、`timedatectl`、`df -hT`、`free -h`、`ss -lntup`；识别 systemd/OpenRC、容器与虚拟化限制。仅回写脱敏摘要。

## 操作步骤
1. 在 CVM 登记供应商、地区、费用周期、到期与负责人。
2. 列出现有监听、挂载、服务和数据目录，确认不会覆盖已有业务。
3. 创建并验证日常管理账户及 sudo；从第二会话验证密钥登录，再做 SSH 加固。
4. 评估安全更新、时区、防火墙及监控网络出口；每项按对应 SOP 单独变更。
5. 部署只读探针，使用每节点独立 Token；核对架构、磁盘及负载是否实际可采集。
6. 建首份配置快照，关联初始化基线和备份策略。

## 风险
修改 SSH、路由或防火墙可能失联；安装自动重启组件可能中断业务。

## 禁止事项
禁止一次性复制网络初始化脚本、关闭全部会话或清空防火墙。

## 验证方法
从新会话重新登录；核对 CVM 最后采集时间、节点 UUID、公开隐藏策略；抽查一项真实指标。

## 回滚方法
保留原配置与控制台；每次只回退刚改的一项。无法新建连接时先用仍存活会话恢复访问。

## 常见故障
包管理锁需确认正在运行的更新任务；时钟异常先检查 NTP；指标未知保留 unknown，不写零。

## 参考
[官方文档](https://documentation.ubuntu.com/server/)

## 执行与证据
本文是待审阅的运维资料。CVM不执行其中命令；外部操作者确认目标与权限后执行。回写操作记录默认claimed，探针采集到的事实另标observed。','medium','["初始化", "SOP"]'::jsonb,'["linux"]'::jsonb,'["vps"]'::jsonb,'[]'::jsonb) on conflict(slug) do nothing;
insert into infra_documents(id,slug,title,category,content,risk,tags,environments,asset_kinds,asset_ids) values('ee95dfe0-b9c7-55dc-b7a9-7bf517449326','debian-ubuntu-hardening','Debian / Ubuntu 安全加固','安全','# Debian / Ubuntu 安全加固

## 目标
在不破坏远程访问和业务的前提下逐项减少暴露面。

## 适用环境
受支持的 Debian / Ubuntu；供应商内核和容器需独立评估

## 前置条件
已验证控制台、备用登录、备份和维护窗口；记录系统版本与业务依赖。

## 环境检测
检查发行版支持周期、`systemctl --failed`、`apt list --upgradable`、监听端口、AppArmor 状态及当前 SSH 生效配置；不要上传完整环境文件。

## 操作步骤
1. 分类已暴露服务，明确哪些只需内网。
2. 先修正不需要的监听地址，验证业务后再收窄防火墙。
3. 用发行版安全更新机制，并检查 Origins/自动重启策略；先做 dry-run 或模拟。
4. 分别执行 SSH、防火墙、Fail2ban SOP，不同时变更所有入口。
5. 设置日志保留与磁盘空间告警，确认备份能在隔离环境恢复。
6. 提交带原因、范围、到期时间的基线例外，不把不适用项目标记合规。

## 风险
自动重启、内核更新及权限收紧可能影响业务；升级主版本应另立迁移任务。

## 禁止事项
禁止全局禁用安全模块、直接替换所有 sysctl，或把 SSH 已连接当作新登录成功。

## 验证方法
核查新登录、服务健康、监听范围和安全更新日志；重新采集快照，比对前后差异。

## 回滚方法
恢复本次变更前的单项配置；软件升级按已测试的备份/快照恢复方案处理，不盲目降级数据库。

## 常见故障
容器没有 systemd 时记录不适用；软件源不匹配先确认发行版代号，不强行混用源。

## 参考
[官方文档](https://documentation.ubuntu.com/server/how-to/software/automatic-updates/)

## 执行与证据
本文是待审阅的运维资料。CVM不执行其中命令；外部操作者确认目标与权限后执行。回写操作记录默认claimed，探针采集到的事实另标observed。','high','["安全", "SOP"]'::jsonb,'["debian", "ubuntu"]'::jsonb,'["vps"]'::jsonb,'[]'::jsonb) on conflict(slug) do nothing;
insert into infra_documents(id,slug,title,category,content,risk,tags,environments,asset_kinds,asset_ids) values('cdc09d6a-149a-5b04-a74b-ce256dcba512','ssh-safety','SSH 安全配置','安全','# SSH 安全配置

## 目标
收紧 SSH 身份验证，保持可恢复的管理入口。

## 适用环境
OpenSSH；Debian 常用 ssh.service，其他发行版可能 sshd.service

## 前置条件
保持一个已连接会话；确认服务商控制台可用；必须已从另一会话验证目标非 root 用户密钥登录及 sudo。

## 环境检测
先 `ss -lntp` 核实实际端口；运行 `sshd -t`、`sshd -T`。存在 Match/Include 时使用实际连接条件进行 `sshd -T -C user=<用户>,host=<主机>,addr=<来源IP>`，仅记录必要摘要。

## 操作步骤
1. 备份实际生效的主文件与 Include 片段，在本机保护备份。
2. 根据发行版 Include 顺序创建独立配置片段，核实先匹配值的行为。
3. 在密钥验证后，按业务需要设置 PasswordAuthentication/PermitRootLogin；有跳板机或自动化账户时先核对依赖。
4. `sshd -t` 成功后，再确认真实服务名并 reload，避免无条件 restart。
5. 保留原会话，测试第二个全新连接、sudo 和自动化任务。
6. CVM 仅登记生效值、采集来源和验证结果。

## 风险
错误端口、Match 规则、Include 优先级或账户权限会造成失联。

## 禁止事项
禁止先关闭密码/root 登录再测试密钥；禁止随手改端口并同时关闭旧入口；禁止上传私钥。

## 验证方法
全新登录与sudo成功，`sshd -T` 符合预期；确认密钥路径与目录权限而非泄露文件内容。

## 回滚方法
用保留会话或控制台恢复备份，运行语法检查后 reload；重新建立连接再关闭救援通道。

## 常见故障
密钥失败检查账户/权限/认证日志；Include覆盖检查条件生效值；socket activation需核对监听单元。

## 参考
[官方文档](https://man.openbsd.org/sshd_config)

## 执行与证据
本文是待审阅的运维资料。CVM不执行其中命令；外部操作者确认目标与权限后执行。回写操作记录默认claimed，探针采集到的事实另标observed。','high','["安全", "SOP"]'::jsonb,'["linux"]'::jsonb,'["vps"]'::jsonb,'[]'::jsonb) on conflict(slug) do nothing;
insert into infra_documents(id,slug,title,category,content,risk,tags,environments,asset_kinds,asset_ids) values('bef50fbb-e7e9-5639-a1b3-7a48e3c876eb','firewall-fail2ban','防火墙与 Fail2ban','安全','# 防火墙与 Fail2ban

## 目标
限制服务暴露，阻挡重复认证攻击而不误封管理访问。

## 适用环境
nftables / UFW / firewalld 与 Fail2ban；只采用当前实际管理栈

## 前置条件
明确云安全组、主机规则和 Docker 发布端口三层关系；具备控制台；登记当前 SSH 端口和可信来源。

## 环境检测
只读检查 `nft list ruleset`、`ufw status verbose` 或 `firewall-cmd --list-all` 中实际存在的一种；检查 Fail2ban jails 和日志后端；摘要应脱敏。

## 操作步骤
1. 记录当前规则与顺序，确定哪个组件拥有规则。
2. 先允许实际 SSH 端口和必要业务，再考虑默认拒绝。
3. 对规则变更设置独立、已验证的回退办法；从第二来源测试新连接。
4. 为 Fail2ban 配置实际日志后端与 sshd 端口，避免复制不匹配的 jail。
5. 检查可信管理 IP 的误封处理，审阅 ban 时间和重试阈值。
6. 检查 Docker 发布端口是否绕过预期规则，使用其支持的链/网络控制。

## 风险
不同防火墙工具混用会覆盖规则；容器端口可能不受期望的 UFW 入站路径控制。

## 禁止事项
禁止 `iptables -F` / `nft flush ruleset`；禁止把所有来源作为永久白名单；不得让面板执行解封或改规则。

## 验证方法
允许服务可达，未授权端口从外部不可达；新SSH会话正常；Fail2ban状态与日志一致。

## 回滚方法
从控制台恢复原规则快照；仅回退本次jail变更，确认新登录后撤去临时允许。

## 常见故障
误封先定位 jail 和来源；无日志检查 journald/backend；Docker链变化按Docker网络文档处理。

## 参考
[官方文档](https://docs.docker.com/engine/network/packet-filtering-firewalls/)

## 执行与证据
本文是待审阅的运维资料。CVM不执行其中命令；外部操作者确认目标与权限后执行。回写操作记录默认claimed，探针采集到的事实另标observed。','high','["安全", "SOP"]'::jsonb,'["linux"]'::jsonb,'["vps"]'::jsonb,'[]'::jsonb) on conflict(slug) do nothing;
insert into infra_documents(id,slug,title,category,content,risk,tags,environments,asset_kinds,asset_ids) values('814fc546-5dfd-5aa9-a351-0d276990c6ed','docker-install','Docker 安装与部署','容器','# Docker 安装与部署

## 目标
以受支持的软件源部署 Docker，并限制管理权限。

## 适用环境
Docker Engine；Debian/Ubuntu；rootless 与 rootful 分别评估

## 前置条件
确认CPU架构、发行版代号、已安装容器运行时、数据目录与网络规则；有现有数据则先备份。

## 环境检测
执行 `docker version`、`docker info`（输出需脱敏）、`docker compose version`；无权限是权限未知，不能据此判断未安装。

## 操作步骤
1. 按对应发行版的官方安装文档核对受支持版本和软件源签名。
2. 已有 containerd/Docker 时评估兼容及依赖，不先卸载冲突包。
3. 记录计划安装版本，维护窗口内安装并验证daemon。
4. 业务使用明确镜像版本或digest，规划网络、日志轮转和卷。
5. Docker管理组/Socket权限按root级能力评估；监控collector必须本地显式启用。
6. CVM保存镜像、健康、端口、项目和资源摘要。

## 风险
安装会修改网络规则；docker组和socket控制能影响宿主机。

## 禁止事项
禁止将Docker Socket暴露到中心面板或公网；禁止将只读挂载误当成API权限隔离；禁止curl脚本无审查直执行。

## 验证方法
检查版本、容器健康、外部暴露、卷路径和重启策略；探针仅采集固定只读API且不上传Env。

## 回滚方法
保留旧版本软件包与数据目录；回退前确认存储格式兼容，必要时恢复维护前备份。

## 常见故障
权限不足标记permission_denied；iptables冲突检查宿主网络栈；镜像架构错误按uname/镜像平台对齐。

## 参考
[官方文档](https://docs.docker.com/engine/install/debian/)

## 执行与证据
本文是待审阅的运维资料。CVM不执行其中命令；外部操作者确认目标与权限后执行。回写操作记录默认claimed，探针采集到的事实另标observed。','medium','["容器", "SOP"]'::jsonb,'["debian", "ubuntu"]'::jsonb,'["vps"]'::jsonb,'[]'::jsonb) on conflict(slug) do nothing;
insert into infra_documents(id,slug,title,category,content,risk,tags,environments,asset_kinds,asset_ids) values('25280263-c3a7-50d4-aa9e-f0b7278c0797','compose-maintenance','Compose 服务维护','容器','# Compose 服务维护

## 目标
可追踪地升级指定服务，并保证数据和依赖一致。

## 适用环境
Docker Compose v2；项目名、部署目录和环境文件已核实

## 前置条件
确认工作目录、项目名、当前镜像digest、卷和数据库备份；验证恢复方案与健康检查。

## 环境检测
`docker compose version`、`docker compose ps`、`docker compose config --quiet`；不要将展开后的完整config传到CVM，它可能含秘密。

## 操作步骤
1. 将项目与仓库、部署实例、VPS和网站关联。
2. 查看版本变更与迁移兼容性，固定目标镜像标签/digest。
3. 先备份持久卷和数据库，记录校验和及恢复点。
4. 在维护窗口内只更新目标服务，按已确认依赖顺序执行compose操作。
5. 检查健康、错误日志、连接、外部路由；观察后再更新其他实例。
6. 外部Harness回写claimed变更，后续探针观测镜像与健康形成独立证据。

## 风险
数据库迁移可能不可逆；重建服务会中断连接。

## 禁止事项
禁止 `down -v`、全局prune或使用latest做不可追溯升级；禁止把环境变量上传资产。

## 验证方法
镜像digest、健康和端口符合计划；数据读写与备份恢复点有效；CVM变化时间线有两类来源。

## 回滚方法
恢复原compose和镜像；如执行过不兼容数据库迁移，按恢复方案恢复数据库与应用一致版本。

## 常见故障
启动循环先查健康/依赖/权限；端口冲突核对监听；磁盘爆满按专门SOP处理。

## 参考
[官方文档](https://docs.docker.com/compose/)

## 执行与证据
本文是待审阅的运维资料。CVM不执行其中命令；外部操作者确认目标与权限后执行。回写操作记录默认claimed，探针采集到的事实另标observed。','medium','["容器", "SOP"]'::jsonb,'[]'::jsonb,'["compose", "container", "deployment", "vps"]'::jsonb,'[]'::jsonb) on conflict(slug) do nothing;
insert into infra_documents(id,slug,title,category,content,risk,tags,environments,asset_kinds,asset_ids) values('6a037088-94a0-53d9-9af5-8965d016f41d','reverse-proxy','Caddy / Nginx 反向代理','网络','# Caddy / Nginx 反向代理

## 目标
让域名、TLS与后端服务关系清晰且可验证。

## 适用环境
Caddy / Nginx；NPM / Traefik 应通过各自配置源管理

## 前置条件
确认配置文件真正来源、容器挂载、上游端口、SNI、DNS与回退文件；代理管理器生成文件不可手动覆盖。

## 环境检测
检查版本与监听；本机测试后端的健康路径。Caddy使用 `caddy validate --config <文件>`；Nginx使用 `nginx -t`。不上传完整配置。

## 操作步骤
1. 在台账建立 Domain→ReverseProxy→Container/Service→VPS 关系。
2. 编辑实际配置源，限制仅必要Host与路径；检查WebSocket与超时需求。
3. 验证语法、文件权限和证书路径；不要输出私钥。
4. 按运行方式reload，容器和systemd需使用对应流程。
5. 从外部测试DNS、TLS、路径、重定向与错误页面。
6. 记录配置位置、变更摘要与关联SOP。

## 风险
错误Host/SNI或上游协议可能产生502、证书错误与重定向循环。

## 禁止事项
禁止上传密钥；禁止直接覆盖NPM/Traefik生成配置；禁止在校验失败后reload。

## 验证方法
新旧路径都符合预期；证书链与域名匹配；后端仅在需要的网络暴露。

## 回滚方法
恢复上次通过校验的配置并reload；如DNS也改动，按TTL及缓存评估回切。

## 常见故障
502检查上游协议/端口与容器网络；TLS错误检查SNI和完整链；循环检查代理头和HTTPS模式。

## 参考
[官方文档](https://caddyserver.com/docs/command-line)

## 执行与证据
本文是待审阅的运维资料。CVM不执行其中命令；外部操作者确认目标与权限后执行。回写操作记录默认claimed，探针采集到的事实另标observed。','medium','["网络", "SOP"]'::jsonb,'[]'::jsonb,'["reverse_proxy", "website", "api", "service"]'::jsonb,'[]'::jsonb) on conflict(slug) do nothing;
insert into infra_documents(id,slug,title,category,content,risk,tags,environments,asset_kinds,asset_ids) values('82320de8-aacd-525a-a336-9808307cefec','cloudflare-services','Cloudflare DNS / Workers / Pages / Tunnel','云平台','# Cloudflare DNS / Workers / Pages / Tunnel

## 目标
维护资源关系并避免跨账户、路由或DNS误操作。

## 适用环境
Cloudflare；具体账户、Zone、Worker、Pages项目和Tunnel均已确认

## 前置条件
记录准确资源ID、当前DNS/路由/部署版本与备份；API Token限只读发现或此次必要资源，不能存到CVM。

## 环境检测
查看Zone状态、记录type/name/content/proxied、Worker路由与Pages自定义域名；Tunnel只检查连接器健康与公开映射，不采集凭据文件。

## 操作步骤
1. 用本地只读连接器分页发现资源，检查collector状态与截断标志。
2. 在Discovery Inbox匹配或合并，建立域名到Worker/Pages/反代的关系。
3. DNS变更前明确TTL、代理状态和证书验证方式；对服务变更先准备回退部署。
4. 外部Harness执行已授权变更；CVM只接收脱敏结果。
5. 从多地区检查解析和HTTP/TLS；区分边缘缓存与源站故障。
6. 记录部署ID、commit、回退版本及实际验证。

## 风险
代理开关、通配路由及Tunnel权限影响多个服务；API权限不足不能认定资源已删除。

## 禁止事项
禁止上传Cloudflare Token、Tunnel凭据或完整Worker secrets；禁止自动删除一次未发现的资源。

## 验证方法
权威DNS与公共解析逐步一致；Worker/Pages版本和自定义域名正确；Tunnel健康且源站可达。

## 回滚方法
恢复原DNS/route或回退既有部署，观察TTL；密钥处理在平台单独进行，CVM只记轮换事实。

## 常见故障
403检查Token资源范围；分页失败保留complete=false；522/525区分连接和TLS故障。

## 参考
[官方文档](https://developers.cloudflare.com/)

## 执行与证据
本文是待审阅的运维资料。CVM不执行其中命令；外部操作者确认目标与权限后执行。回写操作记录默认claimed，探针采集到的事实另标observed。','medium','["云平台", "SOP"]'::jsonb,'["cloudflare"]'::jsonb,'["cloudflare_worker", "cloudflare_pages", "domain", "provider", "deployment", "service", "website"]'::jsonb,'[]'::jsonb) on conflict(slug) do nothing;
insert into infra_documents(id,slug,title,category,content,risk,tags,environments,asset_kinds,asset_ids) values('c35511ef-5ca5-50ac-9fb4-c9f352c8c453','database-backup-restore','数据库备份与恢复','备份','# 数据库备份与恢复

## 目标
取得可实际恢复、权限受控的备份。

## 适用环境
PostgreSQL / Supabase；MySQL等必须使用对应工具和兼容流程

## 前置条件
明确数据库版本、存储量、RPO/RTO、备份加密与异地目的地；恢复必须先到隔离目标。

## 环境检测
检查备份工具版本、磁盘空间、连接权限、数据库大小和扩展；密码通过本地凭据机制而非命令行明文。

## 操作步骤
1. CVM加密配置备份覆盖监控配置与资产/文档/基线；完整历史需数据库级备份。
2. 使用兼容版本pg_dump生成custom格式，检查退出状态、文件大小和校验和。
3. 在隔离库用pg_restore检查与恢复，确认角色/扩展/RLS/序列符合目标环境。
4. 抽样验证表计数、关键业务查询、登录和关系完整性。
5. 记录备份时间、范围、加密保管人、校验和与演练结果。
6. 生产恢复须另有明确授权和维护窗口。

## 风险
逻辑备份不等于所有角色、物理WAL或平台Auth配置备份；恢复到错误库可覆盖数据。

## 禁止事项
禁止在唯一生产库练习restore、无验证删除旧备份或将凭据嵌入CVM。

## 验证方法
独立恢复环境可启动并通过核心业务；备份校验和一致；明确未覆盖对象。

## 回滚方法
生产恢复前保留当前快照与回切路径；回滚数据库和应用版本必须一致。

## 常见故障
版本不兼容使用匹配工具；角色/RLS错误检查授权与扩展；大库超时采用分批/并行恢复计划。

## 参考
[官方文档](https://www.postgresql.org/docs/current/backup-dump.html)

## 执行与证据
本文是待审阅的运维资料。CVM不执行其中命令；外部操作者确认目标与权限后执行。回写操作记录默认claimed，探针采集到的事实另标observed。','high','["备份", "SOP"]'::jsonb,'[]'::jsonb,'["database", "storage"]'::jsonb,'[]'::jsonb) on conflict(slug) do nothing;
insert into infra_documents(id,slug,title,category,content,risk,tags,environments,asset_kinds,asset_ids) values('f308e8d2-59bd-5300-8479-6e3082897f29','service-migration','服务迁移','迁移','# 服务迁移

## 目标
迁移服务并保留一致的数据与可回退入口。

## 适用环境
跨VPS、数据库或云项目；每个部署实例独立记录

## 前置条件
已绘制依赖图、列出DNS/TLS/存储/数据库/外部回调；明确数据冻结或增量同步方式。

## 环境检测
核对架构、软件版本、数据库编码/时区/扩展、存储容量与网络出口；检查源站和目标站ID避免误操作。

## 操作步骤
1. 创建新的Deployment资产关联同一Repository，不复用旧实例身份。
2. 迁移前完成数据库与卷备份，记录恢复点。
3. 在隔离目标恢复并用临时Host验证；不让两端同时执行定时写任务。
4. 规划短暂停写/增量追平，核实最终一致性。
5. 在窗口内切换路由或DNS，监测错误率、延迟与写入。
6. 保留旧环境只读与回退时限，稳定后再单独批准下线。

## 风险
双写会分叉；DNS缓存存在旧连接；任务重复执行可能造成数据损坏。

## 禁止事项
禁止迁移一完成立即删除源数据、忽略密钥/回调绑定或把IP相同视作部署相同。

## 验证方法
关键读写、后台任务、外部回调、监控及备份在目标通过；图谱显示当前路由。

## 回滚方法
若已有目标写入，先决定数据对账/反向同步再回切；不得无条件把DNS指回旧数据库。

## 常见故障
出现旧站流量检查TTL；文件权限按UID/GID核对；回调失败检查允许列表和TLS。

## 参考
[官方文档](https://www.postgresql.org/docs/current/backup.html)

## 执行与证据
本文是待审阅的运维资料。CVM不执行其中命令；外部操作者确认目标与权限后执行。回写操作记录默认claimed，探针采集到的事实另标observed。','high','["迁移", "SOP"]'::jsonb,'[]'::jsonb,'["vps", "service", "website", "api", "container", "compose", "reverse_proxy", "deployment", "cloudflare_worker", "cloudflare_pages", "database", "storage"]'::jsonb,'[]'::jsonb) on conflict(slug) do nothing;
insert into infra_documents(id,slug,title,category,content,risk,tags,environments,asset_kinds,asset_ids) values('bd16d26a-7b71-5b68-b26e-acd6f0c02aba','tls-troubleshooting','TLS 证书故障处理','故障','# TLS 证书故障处理

## 目标
定位过期、域名、链及自动续期故障。

## 适用环境
HTTPS、Caddy/Nginx、Cloudflare边缘与源站证书

## 前置条件
确认域名、SNI、代理层、证书终止位置和系统时间；不需要私钥内容。

## 环境检测
用 `openssl s_client -connect <主机>:443 -servername <域名>` 查看协商与链，在本地记录notAfter/issuer/SAN摘要；分别测试边缘和源站。

## 操作步骤
1. 区分证书过期、未知CA、域名不匹配、链不完整或网络问题。
2. 检查DNS及ACME验证路径、端口、CAA和限频；代理模式可能影响HTTP验证。
3. 在实际证书管理器中修复续期前置条件，避免手动覆盖受管理文件。
4. 验证新证书与完整链后reload对应服务。
5. 让探针重新采集TLS到期时间；Worker无法读取证书期限时保持unknown。
6. 记录证书指纹/到期和已观察验证，不记录私钥。

## 风险
频繁重复签发触发限流；关闭校验会隐藏中间人或配置错误。

## 禁止事项
禁止用 insecure_skip_verify 永久解决问题，禁止上传私钥或删除全部证书存储。

## 验证方法
正确SNI下链验证成功、域名匹配、有效期合理；从多个网络验证。

## 回滚方法
恢复原可用证书和配置；仅在证书仍有效且匹配时回退，否则保持故障状态并修复。

## 常见故障
时钟偏差校准NTP；525检查源站握手；部分客户端失败检查完整链和TLS版本。

## 参考
[官方文档](https://caddyserver.com/docs/automatic-https)

## 执行与证据
本文是待审阅的运维资料。CVM不执行其中命令；外部操作者确认目标与权限后执行。回写操作记录默认claimed，探针采集到的事实另标observed。','medium','["故障", "SOP"]'::jsonb,'[]'::jsonb,'["website", "api", "domain", "certificate", "reverse_proxy", "cloudflare_worker", "cloudflare_pages"]'::jsonb,'[]'::jsonb) on conflict(slug) do nothing;
insert into infra_documents(id,slug,title,category,content,risk,tags,environments,asset_kinds,asset_ids) values('4a5fef06-2cd1-5d30-bed6-f35d44f072b8','http-502','网站 502 排查','故障','# 网站 502 排查

## 目标
定位代理与上游之间的故障，而不误改DNS或重启整台主机。

## 适用环境
反向代理到HTTP/HTTPS/UnixSocket上游

## 前置条件
确认请求域名、路径、发生时间、变更窗口和受影响实例；保留请求ID，日志脱敏。

## 环境检测
从外到内检查DNS、边缘、反代、容器/服务、数据库；读取服务健康、监听和重启次数。

## 操作步骤
1. 确定502由哪一层生成，比较代理响应和源站响应。
2. 在代理所在网络测试上游健康URL；确认协议、端口、SNI及容器DNS。
3. 检查上游是否启动、监听正确地址、依赖就绪和资源不足。
4. 检查代理timeout/body/WebSocket设置是否匹配业务，不盲目放大超时。
5. 只修复已证实的问题，配置先校验再reload。
6. 在CVM记录故障起止、影响关系、根因和验证证据。

## 风险
反复重启可能丢失证据并扩大中断；错误超时掩盖后端卡死。

## 禁止事项
禁止清空配置、全机重启或把所有错误都判成DNS问题。

## 验证方法
正常与原失败路径都成功；代理与上游日志无新增错误；P95与资源恢复。

## 回滚方法
恢复最近配置/镜像变更；涉及数据迁移时依对应恢复方案。

## 常见故障
容器localhost指向自身；UnixSocket权限需同时核实用户/目录；Cloudflare与源站错误分层检查。

## 参考
[官方文档](https://nginx.org/en/docs/beginners_guide.html)

## 执行与证据
本文是待审阅的运维资料。CVM不执行其中命令；外部操作者确认目标与权限后执行。回写操作记录默认claimed，探针采集到的事实另标observed。','medium','["故障", "SOP"]'::jsonb,'[]'::jsonb,'["website", "api", "reverse_proxy", "service", "container"]'::jsonb,'[]'::jsonb) on conflict(slug) do nothing;
insert into infra_documents(id,slug,title,category,content,risk,tags,environments,asset_kinds,asset_ids) values('a39b9e32-b291-5381-bb9b-34c64396e7b9','disk-full','磁盘爆满排查','故障','# 磁盘爆满排查

## 目标
识别真实占用并安全恢复必要空间。

## 适用环境
Linux文件系统、容器overlay、数据卷

## 前置条件
确认挂载点与数据所有者；数据库存储、日志和容器层分别处理；必要时暂停新增写入需业务授权。

## 环境检测
`df -hT`、`df -i`、`findmnt`；针对确定挂载点做有界du；检查deleted-but-open文件、只读挂载和配额。

## 操作步骤
1. 区分块空间、inode、配额与宿主/容器视图。
2. 优先确认可重建缓存与按策略过期日志；先估算释放量。
3. 数据库按其维护工具处理，不能删除数据文件。
4. Docker检查镜像/容器/卷归属，不执行全局清理。
5. 对仍被进程持有的已删文件，评估服务级平滑重载；保留诊断证据。
6. 设置空间、inode与增长告警及保留策略。

## 风险
删除数据卷或数据库文件不可逆；大规模du可能加重I/O。

## 禁止事项
禁止rm数据库文件、docker system prune -a --volumes或清空未知目录。

## 验证方法
空间和inode恢复，服务读写正常；CVM标记实际磁盘数据来源，容器宿主指标不混淆。

## 回滚方法
误删立即停止进一步写入并按备份恢复；能回收站/快照恢复时先验证内容。

## 常见故障
df与du不同检查打开已删文件、挂载覆盖和保留块；扩容后未增长检查分区/文件系统。

## 参考
[官方文档](https://docs.docker.com/engine/manage-resources/)

## 执行与证据
本文是待审阅的运维资料。CVM不执行其中命令；外部操作者确认目标与权限后执行。回写操作记录默认claimed，探针采集到的事实另标observed。','medium','["故障", "SOP"]'::jsonb,'["linux"]'::jsonb,'["vps", "container", "storage", "database"]'::jsonb,'[]'::jsonb) on conflict(slug) do nothing;
insert into infra_documents(id,slug,title,category,content,risk,tags,environments,asset_kinds,asset_ids) values('5e5c1fe3-069b-514e-b6b6-42dac04a4112','high-load','高负载排查','故障','# 高负载排查

## 目标
识别CPU、I/O、内存或阻塞引起的性能退化。

## 适用环境
Linux/Unix；容器负载与宿主负载不能混用

## 前置条件
记录时间窗口、业务峰值、最近部署和监控来源；先只读观察。

## 环境检测
`uptime`、`vmstat 1 5`、`free -h`、`ps`；有工具时使用iostat/pidstat，按CPU核心数和容器限额解释。

## 操作步骤
1. 将CPU利用、load、iowait、内存/Swap、磁盘I/O与应用延迟关联。
2. 定位可疑进程或容器，确认归属及是否批处理任务。
3. 检查OOM、磁盘、连接数与依赖超时，但日志只记录脱敏摘要。
4. 对已证实瓶颈选择限速、扩容、回退或服务级调整，需明确影响授权。
5. 对比变更前后P95、错误率与资源，而不只观察瞬时CPU。
6. 为基线缺口补SOP和告警规则。

## 风险
杀进程可能中断数据库事务；全量诊断和高频采集会放大负载。

## 禁止事项
禁止直接kill -9未知进程、清空缓存或无条件关闭Swap。

## 验证方法
持续观察多个采样周期，延迟与错误率改善且未知指标不伪填零。

## 回滚方法
撤销本次限流/配置；回退应用版本按数据兼容条件；容量变更独立评估。

## 常见故障
低CPU高load检查I/O等待/不可中断任务；容器load不可归属时保持unavailable。

## 参考
[官方文档](https://docs.kernel.org/admin-guide/cgroup-v2.html)

## 执行与证据
本文是待审阅的运维资料。CVM不执行其中命令；外部操作者确认目标与权限后执行。回写操作记录默认claimed，探针采集到的事实另标observed。','medium','["故障", "SOP"]'::jsonb,'["linux", "freebsd", "openbsd", "darwin", "macos"]'::jsonb,'["vps", "container", "service", "database"]'::jsonb,'[]'::jsonb) on conflict(slug) do nothing;
insert into infra_documents(id,slug,title,category,content,risk,tags,environments,asset_kinds,asset_ids) values('baf87f29-2db9-5b9d-93b0-e4f4690ac4c2','vps-offline','VPS 离线排查','故障','# VPS 离线排查

## 目标
区分主机离线、网络问题与监控链路失败。

## 适用环境
公网VPS、探针网络与Cloudflare/Supabase链路

## 前置条件
记录最后成功采集、探针版本和配置变更；确认供应商控制台和账单到期。

## 环境检测
比较多个探测源，检查主机控制台、网站可用性、探针服务状态、DNS与HTTPS/WSS出口。

## 操作步骤
1. 若网站仍可用而探针离线，优先检查探针进程、Token吊销、时钟和网络出口。
2. 若多源同时失败，核查供应商网络、实例状态与到期。
3. 区分Worker额度/数据库Proxy故障与节点故障，检查面板健康与错误码。
4. 控制台恢复前保留故障截图和日志摘要；按根因修复，不先重装。
5. 验证新Token仅对应正确节点，旧Token失效按预期记录。
6. 连续恢复采样后关闭事件，记录真实恢复时间。

## 风险
重装或硬重启可能丢数据；反复注册可能产生重复节点。

## 禁止事项
禁止因一次上报失败删除节点或正式资产；禁止在日志中打印完整Token。

## 验证方法
节点身份稳定，采集时间持续更新，多源检查恢复；先前未知期间保持unknown。

## 回滚方法
恢复最后有效探针配置/版本；主机回退使用供应商快照前先核查数据时间点。

## 常见故障
401检查Token/节点绑定；DNS/TLS失败检查时间与解析；429降低频率并查看配额。

## 参考
[官方文档](https://developers.cloudflare.com/workers/platform/limits/)

## 执行与证据
本文是待审阅的运维资料。CVM不执行其中命令；外部操作者确认目标与权限后执行。回写操作记录默认claimed，探针采集到的事实另标observed。','medium','["故障", "SOP"]'::jsonb,'[]'::jsonb,'["vps"]'::jsonb,'[]'::jsonb) on conflict(slug) do nothing;
insert into infra_document_versions(document_id,version,document,actor) select id,version,to_jsonb(d),'builtin-sop' from infra_documents d where slug in ('vps-initialization','debian-ubuntu-hardening','ssh-safety','firewall-fail2ban','docker-install','compose-maintenance','reverse-proxy','cloudflare-services','database-backup-restore','service-migration','tls-troubleshooting','http-502','disk-full','high-load','vps-offline') on conflict do nothing;
insert into infra_baselines(id,name,description,environments,asset_kinds,rules) values ('57017f8b-1a56-5904-a749-9c28a969b492','Debian / Ubuntu 最小安全核查','只检测并展示；不自动整改。条件不满足或权限不足保持未知。','["debian","ubuntu"]','["vps"]','[{"id": "ssh-root", "path": "ssh.value.permitrootlogin", "operator": "in", "expected": ["no", "prohibit-password", "without-password"], "severity": "critical", "sop_id": "cdc09d6a-149a-5b04-a74b-ce256dcba512", "description": "Root SSH不得使用密码，先验证备用登录再整改"}, {"id": "ssh-password", "path": "ssh.value.passwordauthentication", "operator": "eq", "expected": "no", "severity": "warning", "sop_id": "cdc09d6a-149a-5b04-a74b-ce256dcba512", "description": "密钥与备用入口确认后关闭密码认证"}, {"id": "clock", "path": "timezone.value", "operator": "exists", "severity": "info", "description": "记录时区，未知不得视作合规"}]'::jsonb) on conflict(id) do nothing;
insert into infra_baseline_versions(baseline_id,version,baseline,actor) select id,version,to_jsonb(b),'builtin' from infra_baselines b where id='57017f8b-1a56-5904-a749-9c28a969b492' on conflict do nothing;
