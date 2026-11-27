import { useSearchParams, Link } from "react-router-dom";
import { Button } from "@radix-ui/themes";
import { Activity, RefreshCw, ShieldCheck } from "lucide-react";
import type { Change } from "../../../infrastructure/types";
import {
  EmptyState,
  ErrorState,
  JsonView,
  LoadingState,
  PageHeader,
  Pagination,
  Status,
  formatTime,
  useResource,
  type PageResult,
} from "../../../infrastructure/ui";

export function ChangeTimeline({ changes }: { changes: Change[] }) {
  return changes.length === 0 ? (
    <EmptyState
      title="暂无变更记录"
      description="资产修改、发现同步与外部运维报告将在此留下记录。"
    />
  ) : (
    <ol className="infra-timeline">
      {changes.map((change) => (
        <li key={change.id}>
          <span className="infra-timeline-icon">
            <Activity size={14} />
          </span>
          <div>
            <div className="infra-timeline-title">
              {change.summary || change.kind || "资产变更"}
              <Status value={change.verification || "unknown"} />
            </div>
            <div className="infra-timeline-meta">
              <time>{formatTime(change.created_at)}</time>
              <span>来源：{change.source}</span>
              {change.asset_id && (
                <Link to={`/admin/assets/${change.asset_id}`}>查看资产</Link>
              )}
            </div>
            {(change.before != null || change.after != null) && (
              <details>
                <summary className="infra-muted" style={{ cursor: "pointer" }}>
                  查看前后差异
                </summary>
                <div className="infra-diff">
                  <div>
                    <span>变更前</span>
                    <JsonView
                      value={change.before ?? null}
                      label="变更前的数据"
                    />
                  </div>
                  <div>
                    <span>变更后</span>
                    <JsonView
                      value={change.after ?? null}
                      label="变更后的数据"
                    />
                  </div>
                </div>
              </details>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

export default function Changes() {
  const [params, setParams] = useSearchParams();
  const offset = Math.max(0, Number(params.get("offset")) || 0);
  const query = new URLSearchParams(params);
  query.set("limit", "30");
  query.set("offset", String(offset));
  const resource = useResource<PageResult<Change>>(`/admin/changes?${query}`);
  const filter = (key: string, value: string) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      value ? next.set(key, value) : next.delete(key);
      if (key !== "offset") next.delete("offset");
      return next;
    });
  return (
    <div className="infra-page">
      <PageHeader
        title="变更时间线"
        description="记录资产与配置如何变化，并明确区分实际观测、人工维护和外部 AI 报告。"
        actions={
          <Button variant="soft" onClick={resource.reload}>
            <RefreshCw size={15} />
            刷新
          </Button>
        }
      />
      <div className="infra-notice">
        <ShieldCheck size={17} />
        <span>
          外部 AI
          回写只表示已提交运维记录。只有后续探针观测能够证实实际配置状态。
        </span>
      </div>
      <div className="infra-toolbar">
        <select
          className="infra-select"
          aria-label="变更验证类型"
          style={{ width: "auto" }}
          value={params.get("verification") || ""}
          onChange={(e) => filter("verification", e.target.value)}
        >
          <option value="">全部证据类型</option>
          <option value="observed">探针观测</option>
          <option value="claimed">外部报告</option>
          <option value="manual">手动维护</option>
        </select>
        <input
          className="infra-input"
          type="date"
          aria-label="开始日期"
          style={{ width: "auto" }}
          value={(params.get("since") || "").slice(0, 10)}
          onChange={(e) =>
            filter("since", e.target.value ? `${e.target.value}T00:00:00Z` : "")
          }
        />
        <input
          className="infra-input"
          placeholder="资产 ID"
          aria-label="筛选资产 ID"
          style={{ width: 280 }}
          value={params.get("asset_id") || ""}
          onChange={(e) => filter("asset_id", e.target.value)}
        />
      </div>
      {resource.error && (
        <ErrorState error={resource.error} retry={resource.reload} />
      )}
      <div className="infra-panel">
        <div className="infra-panel-body">
          {resource.loading && !resource.data ? (
            <LoadingState />
          ) : resource.error && !resource.data ? null : (
            <ChangeTimeline changes={resource.data?.data || []} />
          )}
        </div>
      </div>
      <Pagination
        total={resource.data?.total}
        offset={offset}
        limit={30}
        onChange={(value) => filter("offset", String(value))}
      />
    </div>
  );
}
