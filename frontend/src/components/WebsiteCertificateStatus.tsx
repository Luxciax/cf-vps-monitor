import { ShieldCheck } from "lucide-react";
import { formatTime } from "../infrastructure/ui";

export default function WebsiteCertificateStatus({
  expiresAt,
  observedAt,
  warningDays = 14,
}: {
  expiresAt?: string | null;
  observedAt?: string | null;
  warningDays?: number;
}) {
  const expiry = expiresAt ? Date.parse(expiresAt) : NaN;
  const observed = observedAt ? Date.parse(observedAt) : NaN;
  const known = Number.isFinite(expiry) && Number.isFinite(observed);
  const days = known ? Math.ceil((expiry - Date.now()) / 86400000) : null;
  const stale = known && Date.now() - observed > 86400000;
  return (
    <section
      className="infra-panel"
      style={{ margin: "16px 0" }}
      aria-label="TLS 证书观测"
    >
      <div className="infra-panel-body">
        <div
          className="infra-inline"
          style={{ justifyContent: "space-between" }}
        >
          <strong
            style={{
              fontSize: 13,
              display: "inline-flex",
              gap: 8,
              alignItems: "center",
            }}
          >
            <ShieldCheck size={16} />
            TLS 证书有效期
          </strong>
          <strong
            style={{
              fontSize: 13,
              color:
                days === null
                  ? "var(--gray-11)"
                  : days <= 0
                    ? "var(--red-11)"
                    : days <= warningDays
                      ? "var(--amber-11)"
                      : "var(--green-11)",
            }}
          >
            {days === null ? "未知" : days <= 0 ? "已到期" : `剩余 ${days} 天`}
            {stale ? " · 观测已过期" : ""}
          </strong>
        </div>
        <p className="infra-muted" style={{ margin: "10px 0 0" }}>
          {known
            ? `证书到期：${formatTime(expiresAt)} · VPS 探针观测：${formatTime(observedAt)}。剩余时间以该次观测为依据。`
            : "尚无 VPS 探针的证书到期证据。Worker HTTP 探测不提供此指标；未观测不会被视为证书正常。"}
        </p>
      </div>
    </section>
  );
}
