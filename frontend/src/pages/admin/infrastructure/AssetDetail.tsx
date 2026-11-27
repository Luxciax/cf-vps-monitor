import { useEffect, useMemo, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { Button, Dialog } from "@radix-ui/themes";
import {
  Copy,
  Download,
  GitMerge,
  Link2,
  Pencil,
  Plus,
  RefreshCw,
  Shield,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useApi } from "../../../contexts/AuthContext";
import {
  assetKindLabels,
  type Asset,
  type Change,
  type DocumentRecord,
  type Relationship,
  type Snapshot,
} from "../../../infrastructure/types";
import Configuration from "../../../infrastructure/Configuration";
import StructuredFacts from "../../../infrastructure/StructuredFacts";
import AssetMonitors from "../../../infrastructure/AssetMonitors";
import { safeDocumentLink } from "../../../infrastructure/Markdown";
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  JsonView,
  LoadingState,
  PageHeader,
  Status,
  Tags,
  downloadFile,
  formatTime,
  useResource,
  type PageResult,
} from "../../../infrastructure/ui";
import { AssetEditor } from "../../../infrastructure/AssetEditor";
import { ChangeTimeline } from "./Changes";

type AssetContext = {
  asset: Asset;
  monitors?: Array<Record<string, unknown>>;
  configuration?: Snapshot[];
  relationships?: Relationship[];
  changes?: Change[];
  documents?: DocumentRecord[];
  baselines?: Array<{
    baseline_id: string;
    baseline_version: number;
    status: string;
    results: unknown[];
  }>;
  trust?: unknown;
  limits?: {
    truncated_sections: string[];
    per_section: number;
    max_bytes: number;
  };
};
type Topology = {
  nodes: Asset[];
  edges: Relationship[];
  truncated?: boolean;
  impact?: Asset[];
};
const tabs = [
  ["overview", "概览"],
  ["configuration", "配置"],
  ["relations", "关系拓扑"],
  ["changes", "变更"],
  ["documents", "运维文档"],
  ["context", "AI Context"],
] as const;
const contextFields = [
  "asset",
  "monitors",
  "configuration",
  "relationships",
  "changes",
  "documents",
  "baselines",
];

export default function AssetDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") || "overview";
  const direction = ["upstream", "downstream"].includes(
    params.get("direction") || "",
  )
    ? params.get("direction")!
    : "both";
  const depth = ["1", "2", "3", "4", "5"].includes(params.get("depth") || "")
    ? params.get("depth")!
    : "3";
  const topologyFilter = (key: string, value: string) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set(key, value);
      return next;
    });
  const resource = useResource<AssetContext>(
    id ? `/admin/assets/${id}/context?limit=20` : null,
  );
  const topology = useResource<Topology>(
    id && tab === "relations"
      ? `/admin/assets/${id}/topology?direction=${direction}&depth=${depth}`
      : null,
  );
  const api = useApi();
  const [editing, setEditing] = useState(false);
  const [relationship, setRelationship] = useState(false);
  const [merge, setMerge] = useState(false);
  const [target, setTarget] = useState("");
  const [targetSearch, setTargetSearch] = useState("");
  const [relationKind, setRelationKind] = useState("depends_on");
  const [relationDirection, setRelationDirection] = useState("outgoing");
  const [busy, setBusy] = useState(false);
  const [mutationError, setMutationError] = useState("");
  const [removing, setRemoving] = useState<Relationship | null>(null);
  const [fields, setFields] = useState(contextFields);
  const [since, setSince] = useState("");
  const [limit, setLimit] = useState("20");
  const [customContextPath, setCustomContextPath] = useState<string | null>(
    null,
  );
  const activeContextPath = customContextPath?.startsWith(
    `/admin/assets/${id}/context?`,
  )
    ? customContextPath
    : null;
  const filteredContext = useResource<AssetContext>(activeContextPath);
  useEffect(() => {
    setCustomContextPath(null);
    setFields(contextFields);
    setSince("");
    setLimit("20");
    setEditing(false);
    setRelationship(false);
    setMerge(false);
    setMutationError("");
  }, [id]);
  const targets = useResource<PageResult<Asset>>(
    relationship || merge
      ? `/admin/assets?q=${encodeURIComponent(targetSearch)}&limit=30&offset=0${merge && resource.data?.asset.kind ? `&kind=${encodeURIComponent(resource.data.asset.kind)}` : ""}`
      : null,
  );
  const asset = resource.data?.asset;
  const context = activeContextPath ? filteredContext.data : resource.data;
  const nodeById = useMemo(
    () => new Map((topology.data?.nodes || []).map((node) => [node.id, node])),
    [topology.data],
  );
  const reload = () => {
    resource.reload();
    topology.reload();
    filteredContext.reload();
  };
  const startRelation = () => {
    setRelationship(true);
    setTarget("");
    setTargetSearch("");
    setMutationError("");
  };
  async function saveRelation() {
    if (!id || !target) return;
    setBusy(true);
    setMutationError("");
    try {
      await api("/admin/relationships", {
        method: "POST",
        body: JSON.stringify({
          source_id: relationDirection === "outgoing" ? id : target,
          target_id: relationDirection === "outgoing" ? target : id,
          kind: relationKind,
        }),
      });
      toast.success("关系已建立");
      setRelationship(false);
      reload();
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }
  async function removeRelation() {
    if (!removing) return;
    setBusy(true);
    try {
      await api(`/admin/relationships/${removing.id}`, { method: "DELETE" });
      setRemoving(null);
      toast.success("关系已移除");
      reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "移除失败");
    } finally {
      setBusy(false);
    }
  }
  async function mergeAsset() {
    if (!id || !target) return;
    setBusy(true);
    setMutationError("");
    try {
      await api(`/admin/assets/${id}/merge`, {
        method: "POST",
        body: JSON.stringify({ target_id: target }),
      });
      toast.success("资产已合并");
      setMerge(false);
      navigate(`/admin/assets/${target}`);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "合并失败");
    } finally {
      setBusy(false);
    }
  }
  async function copyContext() {
    if (!context) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(context, null, 2));
      toast.success("已复制结构化上下文");
    } catch {
      toast.error("无法访问剪贴板，请使用导出按钮");
    }
  }
  const title = asset?.name || "资产详情";
  return (
    <div className="infra-page">
      <PageHeader
        title={title}
        eyebrow={asset ? assetKindLabels[asset.kind] || asset.kind : "资产"}
        description={
          asset?.description || "监控、配置、依赖与运维知识在同一处关联。"
        }
        back="/admin/infrastructure"
        actions={
          <>
            <Button variant="soft" onClick={reload} aria-label="刷新资产详情">
              <RefreshCw size={15} />
            </Button>
            <Button
              variant="soft"
              disabled={!asset}
              onClick={() => {
                setMerge(true);
                setTarget("");
                setMutationError("");
              }}
            >
              <GitMerge size={15} />
              合并
            </Button>
            <Button disabled={!asset} onClick={() => setEditing(true)}>
              <Pencil size={15} />
              编辑资产
            </Button>
          </>
        }
      />
      {resource.error && (
        <ErrorState error={resource.error} retry={resource.reload} />
      )}{" "}
      {resource.loading && !asset ? (
        <LoadingState />
      ) : (
        asset && (
          <>
            <div className="infra-inline" style={{ marginBottom: 20 }}>
              <Status value={asset.status} />
              <Tags values={asset.tags} />
              <code
                className="infra-muted"
                style={{ marginLeft: "auto", overflowWrap: "anywhere" }}
              >
                {asset.id}
              </code>
            </div>
            <nav
              className="infra-tabs"
              aria-label="资产详情分区"
              role="tablist"
            >
              {tabs.map(([key, label]) => (
                <button
                  role="tab"
                  aria-selected={tab === key}
                  key={key}
                  onClick={() => setParams({ tab: key })}
                >
                  {label}
                </button>
              ))}
            </nav>
            {tab === "overview" && (
              <div className="infra-split">
                <div>
                  <section className="infra-panel">
                    <div className="infra-panel-heading">
                      <h2>资产信息</h2>
                    </div>
                    <div className="infra-panel-body">
                      <dl className="infra-properties">
                        {[
                          ["类型", assetKindLabels[asset.kind] || asset.kind],
                          ["分类", asset.category || "未分类"],
                          ["服务商", asset.provider || "未填写"],
                          ["来源", asset.source || "手动维护"],
                          ["稳定标识", asset.external_id || "未设置"],
                          [
                            "费用",
                            asset.cost == null
                              ? "未登记"
                              : `${asset.currency || ""} ${asset.cost} / ${asset.billing_cycle || "未设周期"}`,
                          ],
                          [
                            "到期",
                            asset.expires_at
                              ? formatTime(asset.expires_at)
                              : "未设到期日",
                          ],
                          ["创建时间", formatTime(asset.created_at)],
                          ["更新时间", formatTime(asset.updated_at)],
                        ].map(([label, value]) => (
                          <div key={label} style={{ display: "contents" }}>
                            <dt>{label}</dt>
                            <dd>{value}</dd>
                          </div>
                        ))}
                        {asset.url && (
                          <>
                            <dt>服务地址</dt>
                            <dd>
                              {safeDocumentLink(asset.url) ? (
                                <a
                                  href={asset.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {asset.url}
                                </a>
                              ) : (
                                asset.url
                              )}
                            </dd>
                          </>
                        )}
                        {asset.client_id && (
                          <>
                            <dt>VPS 实时监控</dt>
                            <dd>
                              <Link to={`/instance/${asset.client_id}`}>
                                打开服务器详情
                              </Link>
                            </dd>
                          </>
                        )}
                      </dl>
                    </div>
                  </section>
                  {Object.keys(asset.metadata || {}).length > 0 && (
                    <section className="infra-panel">
                      <div className="infra-panel-heading">
                        <h2>部署与补充信息</h2>
                      </div>
                      <div className="infra-panel-body">
                        <StructuredFacts value={asset.metadata} />
                      </div>
                    </section>
                  )}
                  {Object.keys(asset.observed || {}).length > 0 && (
                    <section className="infra-panel">
                      <div className="infra-panel-heading">
                        <h2>最近发现</h2>
                        <Status
                          value={asset.observed_confidence || "unknown"}
                        />
                      </div>
                      <div className="infra-panel-body">
                        <p className="infra-muted" style={{ marginTop: 0 }}>
                          来源：{asset.observed_source || "未知"} · 采集时间：
                          {formatTime(asset.observed_at)}
                          {asset.observed_confidence === "reported"
                            ? " · 外部报告，待探针观测验证"
                            : ""}
                        </p>
                        <StructuredFacts value={asset.observed} />
                        <details style={{ marginTop: 16 }}>
                          <summary
                            className="infra-muted"
                            style={{ cursor: "pointer" }}
                          >
                            结构化原始记录
                          </summary>
                          <JsonView value={asset.observed} />
                        </details>
                      </div>
                    </section>
                  )}
                </div>
                <div>
                  <AssetMonitors
                    assetId={asset.id}
                    monitors={resource.data?.monitors || []}
                    onChanged={reload}
                  />
                  <section className="infra-panel">
                    <div className="infra-panel-heading">
                      <h2>配置基线</h2>
                      <Link to="/admin/baselines" className="infra-muted">
                        管理基线 →
                      </Link>
                    </div>
                    <div className="infra-panel-body">
                      {!resource.data?.baselines?.length ? (
                        <p className="infra-muted">尚未关联适用基线。</p>
                      ) : (
                        resource.data.baselines.map((item) => (
                          <div
                            className="infra-inline"
                            key={item.baseline_id}
                            style={{
                              justifyContent: "space-between",
                              marginBottom: 12,
                            }}
                          >
                            <span className="infra-muted">
                              {item.baseline_id.slice(0, 8)} · v
                              {item.baseline_version}
                            </span>
                            <Status value={item.status} />
                          </div>
                        ))
                      )}
                    </div>
                  </section>
                </div>
              </div>
            )}
            {tab === "configuration" && (
              <Configuration snapshots={resource.data?.configuration || []} />
            )}
            {tab === "changes" && (
              <ChangeTimeline changes={resource.data?.changes || []} />
            )}
            {tab === "documents" &&
              (!resource.data?.documents?.length ? (
                <EmptyState
                  title="暂无关联文档"
                  description="在运维知识库中编辑文档的关联资产，即可在这里聚合适用 SOP。"
                  action={
                    <Button asChild variant="soft">
                      <Link to="/admin/knowledge">打开知识库</Link>
                    </Button>
                  }
                />
              ) : (
                <div className="infra-grid">
                  {resource.data.documents.map((document) => (
                    <article className="infra-asset-card" key={document.id}>
                      <Link
                        to={`/admin/knowledge?document=${document.id}`}
                        className="infra-asset-name"
                      >
                        {document.title}
                      </Link>
                      <p className="infra-muted">
                        {document.category} · v{document.version}
                      </p>
                      <Tags values={document.environments} />
                      <div className="infra-asset-footer">
                        <span>风险等级</span>
                        <Status value={document.risk} />
                      </div>
                    </article>
                  ))}
                </div>
              ))}
            {tab === "relations" && (
              <>
                <div className="infra-toolbar">
                  <select
                    aria-label="拓扑查询方向"
                    className="infra-select"
                    style={{ width: "auto" }}
                    value={direction}
                    onChange={(event) =>
                      topologyFilter("direction", event.target.value)
                    }
                  >
                    <option value="both">全部关系</option>
                    <option value="upstream">上游依赖（当前 → 目标）</option>
                    <option value="downstream">潜在影响（源 → 当前）</option>
                  </select>
                  <select
                    aria-label="拓扑查询深度"
                    className="infra-select"
                    style={{ width: "auto" }}
                    value={depth}
                    onChange={(event) =>
                      topologyFilter("depth", event.target.value)
                    }
                  >
                    {[1, 2, 3, 4, 5].map((value) => (
                      <option key={value} value={value}>
                        {value} 层
                      </option>
                    ))}
                  </select>
                  <p className="infra-muted">
                    按已记录关系方向查询。潜在影响是依赖线索，不代表已观测到故障。
                  </p>
                  <Button
                    style={{ marginLeft: "auto" }}
                    onClick={startRelation}
                  >
                    <Plus size={14} />
                    添加关系
                  </Button>
                </div>
                {topology.error && (
                  <ErrorState error={topology.error} retry={topology.reload} />
                )}{" "}
                {topology.loading && !topology.data ? (
                  <LoadingState />
                ) : topology.error && !topology.data ? null : (
                  <>
                    <div className="infra-topology">
                      <div className="infra-topology-column">
                        <h3>指向当前资产</h3>
                        {(topology.data?.edges || [])
                          .filter((edge) => edge.target_id === id)
                          .map((edge) => (
                            <Link
                              className="infra-topology-node"
                              to={`/admin/assets/${edge.source_id}?tab=relations`}
                              key={edge.id}
                            >
                              {nodeById.get(edge.source_id)?.name ||
                                edge.source_id}
                              <small>{edge.kind} →</small>
                            </Link>
                          ))}
                      </div>
                      <div className="infra-topology-column">
                        <h3>当前资产</h3>
                        <div className="infra-topology-node is-current">
                          <strong>{asset.name}</strong>
                          <small>
                            {assetKindLabels[asset.kind] || asset.kind}
                          </small>
                        </div>
                      </div>
                      <div className="infra-topology-column">
                        <h3>当前资产指向</h3>
                        {(topology.data?.edges || [])
                          .filter((edge) => edge.source_id === id)
                          .map((edge) => (
                            <Link
                              className="infra-topology-node"
                              to={`/admin/assets/${edge.target_id}?tab=relations`}
                              key={edge.id}
                            >
                              {nodeById.get(edge.target_id)?.name ||
                                edge.target_id}
                              <small>→ {edge.kind}</small>
                            </Link>
                          ))}
                      </div>
                    </div>
                    {(topology.data?.nodes.length || 0) > 1 && (
                      <div className="infra-panel" style={{ marginTop: 20 }}>
                        <div className="infra-panel-heading">
                          <h2>
                            {direction === "downstream"
                              ? "潜在影响范围"
                              : "查询范围内的关联资产"}{" "}
                            · {(topology.data?.nodes.length || 1) - 1}
                          </h2>
                        </div>
                        <div className="infra-panel-body infra-inline">
                          {topology.data?.nodes
                            .filter((node) => node.id !== id)
                            .map((node) => (
                              <Link
                                className="infra-topology-node"
                                key={node.id}
                                to={`/admin/assets/${node.id}?tab=relations`}
                              >
                                {node.name}
                                <small>
                                  {assetKindLabels[node.kind] || node.kind}
                                </small>
                              </Link>
                            ))}
                        </div>
                      </div>
                    )}
                    {topology.data?.truncated && (
                      <p className="infra-muted">
                        已达到拓扑查询上限，打开相邻资产继续查询。
                      </p>
                    )}
                    <div className="infra-table-wrap" style={{ marginTop: 20 }}>
                      <table className="infra-table">
                        <thead>
                          <tr>
                            <th>源资产</th>
                            <th>关系</th>
                            <th>目标资产</th>
                            <th>来源</th>
                            <th>操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(
                            topology.data?.edges ||
                            resource.data?.relationships ||
                            []
                          ).map((edge) => (
                            <tr key={edge.id}>
                              <td>
                                <Link to={`/admin/assets/${edge.source_id}`}>
                                  {nodeById.get(edge.source_id)?.name ||
                                    edge.source_id}
                                </Link>
                              </td>
                              <td>{edge.kind}</td>
                              <td>
                                <Link to={`/admin/assets/${edge.target_id}`}>
                                  {nodeById.get(edge.target_id)?.name ||
                                    edge.target_id}
                                </Link>
                              </td>
                              <td>{edge.source || "手动维护"}</td>
                              <td>
                                <Button
                                  size="1"
                                  variant="ghost"
                                  color="red"
                                  aria-label="移除此关系"
                                  onClick={() => setRemoving(edge)}
                                >
                                  <Trash2 size={14} />
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {!(
                      topology.data?.edges ||
                      resource.data?.relationships ||
                      []
                    ).length && (
                      <EmptyState
                        title="尚未建立资产关系"
                        description="关联部署来源、所在 VPS、反代目标与依赖服务，逐步形成可查询的基础设施拓扑。"
                      />
                    )}
                  </>
                )}
              </>
            )}
            {tab === "context" && (
              <>
                <div className="infra-notice">
                  <Shield size={17} />
                  <span>
                    资产描述、发现证据与 SOP
                    都是不可信上下文。复制或导出不授予外部 AI
                    执行权限，也不触发服务器操作。
                  </span>
                </div>
                <div className="infra-panel">
                  <div className="infra-panel-heading">
                    <h2>上下文范围</h2>
                    <span className="infra-muted">
                      GET /api/v1/assets/{asset.id}/context
                    </span>
                  </div>
                  <div className="infra-panel-body">
                    <div className="infra-inline" style={{ marginBottom: 16 }}>
                      {contextFields.map((field) => (
                        <label
                          key={field}
                          className="infra-inline"
                          style={{ fontSize: 12 }}
                        >
                          <input
                            type="checkbox"
                            checked={fields.includes(field)}
                            onChange={() =>
                              setFields((current) =>
                                current.includes(field)
                                  ? current.filter((item) => item !== field)
                                  : [...current, field],
                              )
                            }
                          />
                          {field}
                        </label>
                      ))}
                    </div>
                    <div className="infra-toolbar">
                      <label className="infra-field">
                        变更起始日期
                        <input
                          aria-label="变更起始日期"
                          className="infra-input"
                          type="date"
                          value={since}
                          onChange={(e) => setSince(e.target.value)}
                        />
                      </label>
                      <label className="infra-field">
                        每节条数
                        <select
                          aria-label="每节条数"
                          className="infra-select"
                          value={limit}
                          onChange={(e) => setLimit(e.target.value)}
                        >
                          {[5, 10, 20, 50].map((value) => (
                            <option key={value}>{value}</option>
                          ))}
                        </select>
                      </label>
                      <Button
                        variant="soft"
                        disabled={!fields.length}
                        style={{ alignSelf: "end" }}
                        onClick={() =>
                          setCustomContextPath(
                            `/admin/assets/${asset.id}/context?${new URLSearchParams({ fields: fields.join(","), limit, ...(since ? { since: `${since}T00:00:00Z` } : {}) })}`,
                          )
                        }
                      >
                        加载范围
                      </Button>
                      <Button
                        style={{ alignSelf: "end", marginLeft: "auto" }}
                        variant="soft"
                        disabled={filteredContext.loading || !context}
                        onClick={() => void copyContext()}
                      >
                        <Copy size={14} />
                        复制
                      </Button>
                      <Button
                        style={{ alignSelf: "end" }}
                        disabled={filteredContext.loading || !context}
                        onClick={() =>
                          downloadFile(
                            `cvm-context-${asset.id}.json`,
                            JSON.stringify(context, null, 2),
                          )
                        }
                      >
                        <Download size={14} />
                        导出 JSON
                      </Button>
                    </div>
                    {filteredContext.error && (
                      <ErrorState
                        error={filteredContext.error}
                        retry={filteredContext.reload}
                      />
                    )}{" "}
                    {!!context?.limits?.truncated_sections.length && (
                      <p className="infra-muted">
                        以下分区已截断：
                        {context.limits.truncated_sections.join("、")}
                        。请缩小范围或使用相应分页接口。
                      </p>
                    )}
                    {filteredContext.loading ? (
                      <LoadingState label="正在生成上下文" />
                    ) : (
                      <JsonView value={context} label="AI 结构化上下文" />
                    )}
                  </div>
                </div>
              </>
            )}
          </>
        )
      )}
      <AssetEditor
        asset={asset}
        open={editing}
        onClose={() => setEditing(false)}
        onSaved={reload}
      />
      <Dialog.Root
        open={relationship || merge}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setRelationship(false);
            setMerge(false);
          }
        }}
      >
        <Dialog.Content maxWidth="540px">
          <Dialog.Title>{merge ? "合并资产" : "建立资产关系"}</Dialog.Title>
          <Dialog.Description>
            {merge
              ? "当前资产将合并到目标资产，请确认两者属于同一资源。"
              : "关联资产之间的部署、路由和依赖关系。"}
          </Dialog.Description>
          <div className="infra-form">
            {mutationError && <ErrorState error={mutationError} />}
            <label className="infra-field">
              搜索目标资产
              <input
                aria-label="搜索目标资产"
                className="infra-input"
                value={targetSearch}
                onChange={(e) => setTargetSearch(e.target.value)}
              />
            </label>
            <label className="infra-field">
              目标资产
              <select
                aria-label="目标资产"
                className="infra-select"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">请选择</option>
                {targets.data?.data
                  .filter((item) => item.id !== id)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {item.id.slice(0, 8)}
                    </option>
                  ))}
              </select>
            </label>
            {targets.error && (
              <ErrorState error={targets.error} retry={targets.reload} />
            )}{" "}
            {!merge && (
              <>
                <label className="infra-field">
                  方向
                  <select
                    aria-label="方向"
                    className="infra-select"
                    value={relationDirection}
                    onChange={(e) => setRelationDirection(e.target.value)}
                  >
                    <option value="outgoing">当前资产 → 目标资产</option>
                    <option value="incoming">目标资产 → 当前资产</option>
                  </select>
                </label>
                <label className="infra-field">
                  关系类型
                  <select
                    aria-label="关系类型"
                    className="infra-select"
                    value={relationKind}
                    onChange={(e) => setRelationKind(e.target.value)}
                  >
                    {[
                      "depends_on",
                      "hosted_on",
                      "routes_to",
                      "deployed_from",
                      "part_of",
                      "resolves_to",
                      "uses",
                      "monitors",
                    ].map((value) => (
                      <option value={value} key={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
          </div>
          <div className="infra-dialog-actions">
            <Button
              variant="soft"
              color="gray"
              disabled={busy}
              onClick={() => {
                setMerge(false);
                setRelationship(false);
              }}
            >
              取消
            </Button>
            <Button
              disabled={busy || !target}
              onClick={() => void (merge ? mergeAsset() : saveRelation())}
            >
              <Link2 size={14} />
              {busy ? "提交中…" : merge ? "确认合并" : "保存关系"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Root>
      <ConfirmDialog
        open={!!removing}
        title="移除资产关系"
        description={`仅移除 ${removing?.source_id} → ${removing?.target_id} 的 ${removing?.kind} 关系。资产和监控数据保留。`}
        pending={busy}
        confirmLabel="移除关系"
        onClose={() => setRemoving(null)}
        onConfirm={() => void removeRelation()}
      />
    </div>
  );
}
