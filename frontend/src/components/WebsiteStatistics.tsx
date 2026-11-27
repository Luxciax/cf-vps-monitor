import { useState } from "react";
import { Button } from "@radix-ui/themes";
import { RefreshCw } from "lucide-react";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  formatTime,
  useResource,
} from "../infrastructure/ui";

type Statistics = {
  availability_percent: number | null;
  coverage_percent: number | null;
  unknown_ms: number;
  maintenance_ms: number;
  p50_ms: number | null;
  p95_ms: number | null;
  p99_ms: number | null;
  samples: number;
  source?: string;
  limited?: boolean;
  sample_limit?: number;
  incidents: Array<{
    started_at: string;
    recovered_at: string | null;
    observed_duration_ms: number;
    observation_gap: boolean;
  }>;
  tls?: { status: string; expires_at?: string; days_remaining?: number | null };
  since?: string;
  until?: string;
};
const percent = (value: number | null | undefined) =>
  typeof value === "number" ? `${value.toFixed(2)}%` : "—";
const latency = (value: number | null | undefined) =>
  typeof value === "number" ? `${Math.round(value)} ms` : "—";
const duration = (ms: number) =>
  ms < 60000
    ? `${Math.round(ms / 1000)} 秒`
    : ms < 3600000
      ? `${(ms / 60000).toFixed(1)} 分钟`
      : `${(ms / 3600000).toFixed(1)} 小时`;

export default function WebsiteStatistics({
  monitorId,
  admin = false,
}: {
  monitorId: number;
  admin?: boolean;
}) {
  const [hours, setHours] = useState("24");
  const [until, setUntil] = useState(() => new Date().toISOString());
  const range = new URLSearchParams({
    since: new Date(Date.parse(until) - Number(hours) * 3600000).toISOString(),
    until,
  });
  const resource = useResource<Statistics>(
    `/${admin ? "admin/" : ""}websites/${monitorId}/statistics?${range}`,
  );
  const stats = resource.data;
  return (
    <section className="infra-panel" style={{ margin: "20px 0" }}>
      <div className="infra-panel-heading">
        <h2>可用率与延迟</h2>
        <div className="infra-inline">
          <select
            className="infra-select"
            aria-label="网站统计时间范围"
            style={{ width: "auto", fontSize: 11, padding: "6px 8px" }}
            value={hours}
            onChange={(e) => setHours(e.target.value)}
          >
            <option value="24">最近 24 小时</option>
            <option value="72">最近 3 天</option>
            <option value="168">最近 7 天</option>
          </select>
          <Button
            variant="ghost"
            size="1"
            aria-label="刷新网站统计"
            onClick={() => {
              setUntil(new Date().toISOString());
              resource.reload();
            }}
          >
            <RefreshCw size={13} />
          </Button>
        </div>
      </div>
      <div className="infra-panel-body">
        {resource.error && (
          <ErrorState error={resource.error} retry={resource.reload} />
        )}{" "}
        {resource.loading && !stats ? (
          <LoadingState label="正在汇总探测记录" />
        ) : (
          stats && (
            <>
              <div className="website-statistics-grid">
                {[
                  ["可用率", percent(stats.availability_percent)],
                  ["采样覆盖率", percent(stats.coverage_percent)],
                  ["P50", latency(stats.p50_ms)],
                  ["P95", latency(stats.p95_ms)],
                  ["P99", latency(stats.p99_ms)],
                  ["故障事件", String(stats.incidents.length)],
                ].map(([label, value]) => (
                  <div key={label}>
                    <small>{label}</small>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
              <p className="infra-muted">
                按时间加权 · 探测源：
                {stats.source === "worker"
                  ? "Cloudflare Worker"
                  : stats.source || "未知"}
                。未知 {duration(stats.unknown_ms)} · 计划维护{" "}
                {duration(stats.maintenance_ms)} · {stats.samples}{" "}
                个样本。维护区间不计入可用率。
              </p>
              {stats.limited && (
                <p className="infra-muted">
                  达到 {stats.sample_limit || "服务端"}{" "}
                  条样本上限，统计可能不覆盖整个时段。请缩短时间范围。
                </p>
              )}
              {stats.incidents.length > 0 ? (
                <details>
                  <summary
                    className="infra-muted"
                    style={{ cursor: "pointer" }}
                  >
                    查看故障与恢复记录
                  </summary>
                  <div className="infra-table-wrap" style={{ marginTop: 12 }}>
                    <table className="infra-table">
                      <thead>
                        <tr>
                          <th>开始</th>
                          <th>恢复</th>
                          <th>已观测故障时长</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stats.incidents.map((incident, index) => (
                          <tr key={index}>
                            <td>{formatTime(incident.started_at)}</td>
                            <td>
                              {incident.recovered_at
                                ? formatTime(incident.recovered_at)
                                : "未观测到恢复"}
                            </td>
                            <td>
                              {duration(incident.observed_duration_ms)}
                              {incident.observation_gap && (
                                <div className="infra-muted">存在采集空窗</div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              ) : (
                stats.samples === 0 && (
                  <EmptyState
                    title="此时段没有探测样本"
                    description="无法推断可用率或延迟；采集恢复后将显示实际统计。"
                  />
                )
              )}
            </>
          )
        )}
      </div>
      <style>{`.website-statistics-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}.website-statistics-grid small{display:block;font-size:11px;color:var(--gray-11);margin-bottom:7px}.website-statistics-grid strong{font-size:20px;font-weight:650;letter-spacing:-.03em;font-variant-numeric:tabular-nums}@media(max-width:460px){.website-statistics-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}`}</style>
    </section>
  );
}
