import { formatTime, Status } from "../infrastructure/ui";
export type WebsiteProbeResult = {
  checked_at: string;
  ok: boolean;
  latency_ms: number | null;
  source_type?: "worker" | "agent";
  source_client?: string | null;
  effective_reason?: string | null;
  details?: {
    tls_expires_at?: string | null;
    tls_status?: "valid" | "expiring" | "unknown";
    dns_answers?: string[];
    content_checked?: boolean;
  };
};
export default function WebsiteProbeEvidence({
  checks,
}: {
  checks: WebsiteProbeResult[];
}) {
  if (!checks.length)
    return (
      <p className="infra-muted">
        尚无检测结果，无法判断内容、DNS 或 TLS 状态。
      </p>
    );
  return (
    <details className="infra-panel">
      <summary className="infra-panel-heading" style={{ cursor: "pointer" }}>
        最近检测证据（最多 12 条）
      </summary>
      <div className="infra-table-wrap">
        <table className="infra-table">
          <thead>
            <tr>
              <th>时间 / 来源</th>
              <th>状态 / 延迟</th>
              <th>检测证据</th>
            </tr>
          </thead>
          <tbody>
            {checks.slice(0, 12).map((check, index) => (
              <tr
                key={`${check.source_client || "worker"}:${check.checked_at}:${index}`}
              >
                <td>
                  {formatTime(check.checked_at)}
                  <div className="infra-muted">
                    {check.source_type === "agent"
                      ? `VPS · ${check.source_client || "未知节点"}`
                      : "Cloudflare Worker"}
                  </div>
                </td>
                <td>
                  <Status value={check.ok ? "up" : "down"} />
                  <div className="infra-muted">
                    {check.latency_ms == null
                      ? "延迟未知"
                      : `${check.latency_ms} ms`}
                  </div>
                </td>
                <td>
                  {check.effective_reason && (
                    <div className="infra-muted">{check.effective_reason}</div>
                  )}
                  {check.details?.content_checked && (
                    <div className="infra-muted">已执行响应内容检测</div>
                  )}
                  {check.details?.dns_answers && (
                    <div
                      className="infra-muted"
                      style={{ overflowWrap: "anywhere" }}
                    >
                      DNS：
                      {check.details.dns_answers.join(" · ") || "未返回记录"}
                    </div>
                  )}
                  {check.details?.tls_expires_at ? (
                    <div className="infra-muted">
                      证书到期：{formatTime(check.details.tls_expires_at)}
                    </div>
                  ) : (
                    <div className="infra-muted">证书到期：未知</div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
