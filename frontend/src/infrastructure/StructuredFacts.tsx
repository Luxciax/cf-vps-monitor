import type { ReactNode } from "react";
import { JsonView, Status } from "./ui";
import { formatBytes } from "../utils/format";

export const fieldLabels: Record<string, string> = {
  os: "操作系统",
  kernel: "内核",
  architecture: "架构",
  arch: "架构",
  ssh: "SSH 配置",
  firewall: "防火墙",
  fail2ban: "Fail2ban",
  updates: "自动安全更新",
  automatic_updates: "自动安全更新",
  bbr: "BBR",
  swap: "Swap",
  timezone: "时区",
  network: "网卡与 IP",
  interfaces: "网络接口",
  ports: "监听端口",
  listening_ports: "监听端口",
  docker: "Docker",
  compose: "Compose",
  runtime: "软件运行环境",
  runtimes: "软件运行环境",
  reverse_proxy: "反向代理",
  services: "Systemd 服务",
  systemd: "Systemd 服务",
  cron: "Cron 摘要",
  timers: "Systemd Timer",
  disks: "磁盘与挂载",
  disk_io: "磁盘 I/O（采样周期平均）",
  read_iops: "读取 IOPS（周期平均）",
  write_iops: "写入 IOPS（周期平均）",
  read_bytes_per_sec: "读取字节 / 秒（周期平均）",
  write_bytes_per_sec: "写入字节 / 秒（周期平均）",
  sample_interval_sec: "采样周期（秒）",
  mounts: "挂载点",
  deployment: "部署位置",
  backup: "备份",
  backups: "备份策略",
  host: "主机信息",
  container_id: "容器 ID",
  image: "镜像",
  image_id: "镜像 ID",
  state: "运行状态",
  health: "健康状态",
  restart_count: "重启次数",
  networks: "容器网络",
  address: "监听地址",
  private_port: "容器端口",
  public_port: "映射端口",
  protocol: "协议",
  compose_project: "Compose 项目",
  compose_service: "Compose 服务",
  compose_version: "Compose 版本",
  deployment_directory: "部署目录",
  configuration_path: "配置位置",
  configuration_paths: "配置位置",
  resources: "资源采样",
  resources_status: "资源采样状态",
  resources_reason: "采样说明",
  sampled_at: "资源采样时间",
  cpu_percent: "CPU（采样周期平均）",
  cpu_sample_interval_sec: "CPU 采样周期（秒）",
  memory_bytes: "内存使用",
  memory_limit_bytes: "内存上限",
  network_rx_bytes: "累计网络接收",
  network_tx_bytes: "累计网络发送",
  disk_read_bytes: "累计磁盘读取",
  disk_write_bytes: "累计磁盘写入",
  counter_semantics: "计量方式",
  collected_at: "采集时间",
  source: "来源",
  confidence: "可信程度",
  status: "状态",
  value: "检测值",
  environment: "适用环境",
  reason: "说明",
  dns_verified: "DNS 已验证",
  route_evidence: "路由证据",
  effective_configuration: "配置有效性",
  routes_status: "路由采集范围",
  permitrootlogin: "Root 登录策略",
  passwordauthentication: "密码认证",
  pubkeyauthentication: "公钥认证",
  unit: "服务单元",
  load: "加载状态",
  active: "激活状态",
  sub: "子状态",
  description: "说明",
};
function valueView(value: unknown, depth = 0): ReactNode {
  if (value == null) return <span className="infra-muted">未知</span>;
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "string" || typeof value === "number")
    return String(value);
  if (Array.isArray(value)) {
    if (!value.length)
      return <span className="infra-muted">已采集，未发现条目</span>;
    return depth > 1 ? (
      <JsonView value={value} />
    ) : (
      <div style={{ display: "grid", gap: 10 }}>
        {value.slice(0, 30).map((item, i) => (
          <div
            key={i}
            style={{
              padding: "8px 0",
              borderBottom: "1px solid var(--gray-4)",
            }}
          >
            {valueView(item, depth + 1)}
          </div>
        ))}
        {value.length > 30 && (
          <details>
            <summary>其余 {value.length - 30} 项</summary>
            <JsonView value={value.slice(30)} />
          </details>
        )}
      </div>
    );
  }
  if (typeof value === "object")
    return (
      <dl className="infra-properties">
        {Object.entries(value as Record<string, unknown>).map(
          ([key, entry]) => (
            <div key={key} style={{ display: "contents" }}>
              <dt>{fieldLabels[key] || key.replace(/_/g, " ")}</dt>
              <dd>
                {[
                  "status",
                  "confidence",
                  "resources_status",
                  "state",
                  "health",
                ].includes(key) && typeof entry === "string" ? (
                  <Status value={entry} />
                ) : entry != null &&
                  typeof entry === "number" &&
                  [
                    "memory_bytes",
                    "memory_limit_bytes",
                    "network_rx_bytes",
                    "network_tx_bytes",
                    "disk_read_bytes",
                    "disk_write_bytes",
                  ].includes(key) ? (
                  formatBytes(entry)
                ) : entry != null &&
                  typeof entry === "number" &&
                  key === "cpu_percent" ? (
                  `${entry.toFixed(1)}%`
                ) : depth < 3 ? (
                  valueView(entry, depth + 1)
                ) : (
                  <JsonView value={entry} />
                )}
              </dd>
            </div>
          ),
        )}
      </dl>
    );
  return String(value);
}

export default function StructuredFacts({ value }: { value: unknown }) {
  return <>{valueView(value)}</>;
}
