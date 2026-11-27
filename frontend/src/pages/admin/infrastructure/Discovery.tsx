import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button, Dialog } from "@radix-ui/themes";
import { Check, GitMerge, Info, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { useApi } from "../../../contexts/AuthContext";
import { assetKindLabels, type Asset } from "../../../infrastructure/types";
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

type Candidate = {
  id: string;
  source: string;
  external_id: string;
  kind: string;
  name: string;
  metadata: Record<string, unknown>;
  evidence: Record<string, unknown>;
  status: string;
  asset_id?: string;
  first_seen: string;
  last_seen: string;
  missing_since?: string;
  last_run_id?: string;
};
type Run = {
  id: string;
  source: string;
  status?: string;
  complete: boolean;
  collected_at: string;
  created_at: string;
  collectors?: Array<{ name: string; status: string; reason?: string }>;
  asset_count?: number;
};

export default function Discovery() {
  const [params, setParams] = useSearchParams();
  const status = params.get("status") || "pending",
    offset = Math.max(0, Number(params.get("offset")) || 0);
  const resource = useResource<PageResult<Candidate>>(
    `/admin/discovery/candidates?status=${encodeURIComponent(status)}&limit=30&offset=${offset}`,
  );
  const runs = useResource<PageResult<Run>>(
    "/admin/discovery/runs?limit=8&offset=0",
  );
  const api = useApi();
  const [detail, setDetail] = useState<Candidate | null>(null);
  const [resolving, setResolving] = useState<{
    candidate: Candidate;
    action: "import" | "merge" | "ignore";
  } | null>(null);
  const [target, setTarget] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const targets = useResource<PageResult<Asset>>(
    resolving?.action === "merge"
      ? `/admin/assets?q=${encodeURIComponent(search)}&kind=${encodeURIComponent(resolving.candidate.kind)}&limit=30&offset=0`
      : null,
  );
  const reload = () => {
    resource.reload();
    runs.reload();
  };
  const resolve = (
    candidate: Candidate,
    action: "import" | "merge" | "ignore",
  ) => {
    setResolving({ candidate, action });
    setTarget("");
    setSearch("");
    setError("");
  };
  async function submit() {
    if (!resolving) return;
    setBusy(true);
    setError("");
    try {
      await api(
        `/admin/discovery/candidates/${resolving.candidate.id}/resolve`,
        {
          method: "POST",
          body: JSON.stringify({
            action: resolving.action,
            ...(resolving.action === "merge" ? { asset_id: target } : {}),
          }),
        },
      );
      toast.success("发现项已处理");
      setResolving(null);
      reload();
    } catch (error) {
      setError(error instanceof Error ? error.message : "处理失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="infra-page">
      <PageHeader
        title="发现收件箱"
        description="检查采集证据，把发现的服务纳入台账；重复发现会持续更新同一稳定标识。"
        actions={
          <Button variant="soft" onClick={reload}>
            <RefreshCw size={15} />
            刷新
          </Button>
        }
      />
      <div className="infra-notice">
        <Info size={17} />
        <span>
          一次离线或采集失败不会删除正式资产。采集器权限不足和信息不可用会明确记录；手动填写的资产信息保持独立。
        </span>
      </div>
      <div className="infra-split">
        <section>
          <div className="infra-toolbar">
            <select
              className="infra-select"
              style={{ width: "auto" }}
              aria-label="发现处理状态"
              value={status}
              onChange={(e) => setParams({ status: e.target.value })}
            >
              <option value="pending">待确认</option>
              <option value="imported">已导入</option>
              <option value="merged">已合并</option>
              <option value="ignored">已忽略</option>
            </select>
            <span className="infra-muted">
              {resource.data?.total ?? "—"} 项发现
            </span>
          </div>
          {resource.error && (
            <ErrorState error={resource.error} retry={resource.reload} />
          )}{" "}
          {resource.loading && !resource.data ? (
            <LoadingState />
          ) : resource.error && !resource.data ? null : !resource.data?.data
              .length ? (
            <EmptyState
              title="收件箱已清空"
              description="探针或外部 Harness 提交新的发现后，候选资产会显示在这里。"
            />
          ) : (
            <div className="infra-grid" style={{ gridTemplateColumns: "1fr" }}>
              {resource.data.data.map((candidate) => (
                <article className="infra-asset-card" key={candidate.id}>
                  <div
                    className="infra-inline"
                    style={{ justifyContent: "space-between" }}
                  >
                    <div>
                      <h3>{candidate.name}</h3>
                      <span className="infra-muted">
                        {assetKindLabels[candidate.kind] || candidate.kind} ·{" "}
                        {candidate.source}
                      </span>
                    </div>
                    <Status value={candidate.status} />
                  </div>
                  <p
                    className="infra-muted"
                    style={{ overflowWrap: "anywhere" }}
                  >
                    稳定标识：{candidate.external_id}
                  </p>
                  {candidate.missing_since && (
                    <p className="infra-muted">
                      最近完整采集未发现：{formatTime(candidate.missing_since)}
                      （正式资产保留）
                    </p>
                  )}
                  <div
                    className="infra-inline"
                    style={{ justifyContent: "space-between", marginTop: 16 }}
                  >
                    <span className="infra-muted">
                      最近观测 {formatTime(candidate.last_seen)}
                    </span>
                    <Button
                      size="1"
                      variant="ghost"
                      onClick={() => setDetail(candidate)}
                    >
                      查看证据
                    </Button>
                  </div>
                  {candidate.status === "pending" ? (
                    <div className="infra-inline" style={{ marginTop: 14 }}>
                      <Button
                        size="1"
                        onClick={() => resolve(candidate, "import")}
                      >
                        <Check size={13} />
                        导入资产
                      </Button>
                      <Button
                        size="1"
                        variant="soft"
                        onClick={() => resolve(candidate, "merge")}
                      >
                        <GitMerge size={13} />
                        合并已有
                      </Button>
                      <Button
                        size="1"
                        variant="ghost"
                        color="gray"
                        onClick={() => resolve(candidate, "ignore")}
                      >
                        <X size={13} />
                        忽略
                      </Button>
                    </div>
                  ) : (
                    candidate.asset_id && (
                      <Link
                        className="infra-asset-name"
                        to={`/admin/assets/${candidate.asset_id}`}
                      >
                        查看关联资产 →
                      </Link>
                    )
                  )}
                </article>
              ))}
            </div>
          )}
          <Pagination
            total={resource.data?.total}
            limit={30}
            offset={offset}
            onChange={(value) => setParams({ status, offset: String(value) })}
          />
        </section>
        <aside className="infra-panel" style={{ alignSelf: "start" }}>
          <div className="infra-panel-heading">
            <h2>最近采集</h2>
          </div>
          <div className="infra-panel-body">
            {runs.error && (
              <ErrorState error={runs.error} retry={runs.reload} />
            )}{" "}
            {runs.loading && !runs.data ? (
              <LoadingState label="正在读取采集记录" />
            ) : runs.error && !runs.data ? null : !runs.data?.data.length ? (
              <p className="infra-muted">暂无采集运行记录</p>
            ) : (
              runs.data.data.map((run) => (
                <div
                  key={run.id}
                  style={{
                    borderBottom: "1px solid var(--gray-5)",
                    padding: "0 0 16px",
                    marginBottom: 16,
                  }}
                >
                  <div
                    className="infra-inline"
                    style={{ justifyContent: "space-between" }}
                  >
                    <strong style={{ fontSize: 12 }}>{run.source}</strong>
                    <Status
                      value={
                        run.status || (run.complete ? "complete" : "partial")
                      }
                    />
                  </div>
                  <p className="infra-muted">
                    {formatTime(run.collected_at || run.created_at)}
                  </p>
                  {run.collectors?.map((collector) => (
                    <div key={collector.name} style={{ marginTop: 9 }}>
                      <div
                        className="infra-inline"
                        style={{
                          justifyContent: "space-between",
                          fontSize: 11,
                        }}
                      >
                        {collector.name}
                        <Status value={collector.status} />
                      </div>
                      {collector.reason && (
                        <p className="infra-muted">{collector.reason}</p>
                      )}
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </aside>
      </div>
      <Dialog.Root
        open={!!detail}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
      >
        <Dialog.Content maxWidth="760px">
          <Dialog.Title>发现证据 · {detail?.name}</Dialog.Title>
          <Dialog.Description>
            来源、采集时间与经过过滤的结构化观测。
          </Dialog.Description>
          <div style={{ marginTop: 20 }}>
            <JsonView value={detail} />
          </div>
          <div className="infra-dialog-actions">
            <Dialog.Close>
              <Button variant="soft">关闭</Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Root>
      <Dialog.Root
        open={!!resolving}
        onOpenChange={(open) => {
          if (!open && !busy) setResolving(null);
        }}
      >
        <Dialog.Content maxWidth="540px">
          <Dialog.Title>
            {resolving?.action === "import"
              ? "导入新资产"
              : resolving?.action === "merge"
                ? "合并到已有资产"
                : "忽略发现项"}
          </Dialog.Title>
          <Dialog.Description>
            {resolving?.candidate.name} · {resolving?.candidate.external_id}
          </Dialog.Description>
          {error && <ErrorState error={error} />}
          <div className="infra-form">
            {resolving?.action === "merge" ? (
              <>
                <label className="infra-field">
                  搜索目标资产
                  <input
                    aria-label="搜索目标资产"
                    className="infra-input"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <label className="infra-field">
                  合并目标
                  <select
                    aria-label="合并目标"
                    className="infra-select"
                    value={target}
                    required
                    onChange={(e) => setTarget(e.target.value)}
                  >
                    <option value="">选择目标资产</option>
                    {targets.data?.data.map((asset) => (
                      <option key={asset.id} value={asset.id}>
                        {asset.name} · {asset.id.slice(0, 8)}
                      </option>
                    ))}
                  </select>
                </label>
                {targets.error && (
                  <ErrorState error={targets.error} retry={targets.reload} />
                )}
                <p className="infra-muted">
                  候选项的持续发现将关联此资产；不会覆盖手工维护的名称、说明或标签。
                </p>
              </>
            ) : (
              <p className="infra-muted">
                {resolving?.action === "import"
                  ? "该发现将形成正式资产，并保留来源与稳定标识供后续同步。"
                  : "此发现会保留为已忽略记录，不创建正式资产。"}
              </p>
            )}
          </div>
          <div className="infra-dialog-actions">
            <Button
              variant="soft"
              color="gray"
              disabled={busy}
              onClick={() => setResolving(null)}
            >
              取消
            </Button>
            <Button
              disabled={busy || (resolving?.action === "merge" && !target)}
              onClick={() => void submit()}
            >
              {busy ? "处理中…" : "确认"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Root>
    </div>
  );
}
