import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Button, Dialog } from "@radix-ui/themes";
import {
  CheckCheck,
  History,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useApi } from "../../../contexts/AuthContext";
import { toLocalDateTime } from "../../../utils/localDateTime";
import {
  assetKindLabels,
  assetKinds,
  type Asset,
  type Baseline,
} from "../../../infrastructure/types";
import {
  EmptyState,
  ErrorState,
  JsonView,
  LoadingState,
  PageHeader,
  Pagination,
  Status,
  Tags,
  formatTime,
  useResource,
  type PageResult,
} from "../../../infrastructure/ui";

type RuleDraft = {
  id: string;
  path: string;
  operator: string;
  expected: string;
  severity: string;
  sop_id: string;
  description: string;
};
type ExceptionDraft = {
  rule_id: string;
  asset_id: string;
  reason: string;
  expires_at: string;
};
type Evaluation = {
  baseline_id: string;
  baseline_version: number;
  asset_id: string;
  snapshot_id: string | null;
  evaluated_at: string;
  status: string;
  results: Array<{
    rule_id: string;
    status: string;
    actual?: unknown;
    expected?: unknown;
    description: string;
    severity: string;
    sop_id?: string;
    exception_reason?: string;
    evidence?: { source: string; confidence: string; collected_at: string };
  }>;
};
const newRule = (): RuleDraft => ({
  id: crypto.randomUUID(),
  path: "",
  operator: "eq",
  expected: "true",
  severity: "warning",
  sop_id: "",
  description: "",
});
const operators: Record<string, string> = {
  eq: "等于",
  neq: "不等于",
  exists: "存在",
  in: "属于列表",
  gte: "大于等于",
  lte: "小于等于",
  contains: "包含",
};

export default function Baselines() {
  const [offset, setOffset] = useState(0);
  const resource = useResource<PageResult<Baseline>>(
    `/admin/baselines?limit=20&offset=${offset}`,
  );
  const api = useApi();
  const [editing, setEditing] = useState<Baseline | null | undefined>(
    undefined,
  );
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [environments, setEnvironments] = useState("");
  const [kinds, setKinds] = useState<string[]>(["vps"]);
  const [maxAge, setMaxAge] = useState(24);
  const [rules, setRules] = useState<RuleDraft[]>([]);
  const [exceptions, setExceptions] = useState<ExceptionDraft[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [evaluating, setEvaluating] = useState<Baseline | null>(null);
  const [target, setTarget] = useState("");
  const [search, setSearch] = useState("");
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [history, setHistory] = useState<Baseline | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<Baseline | null>(null);
  const targets = useResource<PageResult<Asset>>(
    evaluating
      ? `/admin/assets?q=${encodeURIComponent(search)}&limit=30&offset=0`
      : null,
  );
  const versions = useResource<PageResult<Baseline>>(
    history
      ? `/admin/baselines/${history.id}/versions?limit=50&offset=0`
      : null,
  );
  function openEditor(baseline: Baseline | null) {
    setEditing(baseline);
    setName(baseline?.name || "");
    setDescription(baseline?.description || "");
    setEnvironments(baseline?.environments.join(", ") || "");
    setKinds(baseline?.asset_kinds || ["vps"]);
    setMaxAge(baseline?.max_age_hours || 24);
    setRules(
      baseline?.rules.map((rule) => ({
        id: rule.id || crypto.randomUUID(),
        path: rule.path,
        operator: rule.operator,
        expected: JSON.stringify(rule.expected ?? null),
        severity: rule.severity || "warning",
        sop_id: rule.sop_id || "",
        description: rule.description || "",
      })) || [newRule()],
    );
    setExceptions(
      (baseline?.exceptions || []).map((exception) => ({
        ...exception,
        expires_at: toLocalDateTime(exception.expires_at),
      })),
    );
    setError("");
  }
  function updateRule(index: number, key: keyof RuleDraft, value: string) {
    setRules((current) =>
      current.map((rule, i) =>
        i === index ? { ...rule, [key]: value } : rule,
      ),
    );
  }
  function updateException(
    index: number,
    key: keyof ExceptionDraft,
    value: string,
  ) {
    setExceptions((current) =>
      current.map((exception, i) =>
        i === index ? { ...exception, [key]: value } : exception,
      ),
    );
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload = {
        name,
        description,
        environments: environments
          .split(/[,，]/)
          .map((item) => item.trim())
          .filter(Boolean),
        asset_kinds: kinds,
        max_age_hours: maxAge,
        rules: rules.map((rule) => ({
          ...rule,
          expected:
            rule.operator === "exists" ? null : JSON.parse(rule.expected),
          ...(rule.sop_id ? { sop_id: rule.sop_id } : { sop_id: undefined }),
        })),
        exceptions: exceptions.map((exception) => ({
          ...exception,
          expires_at: new Date(exception.expires_at).toISOString(),
        })),
        ...(editing ? { version: editing.version } : {}),
      };
      await api(
        editing ? `/admin/baselines/${editing.id}` : "/admin/baselines",
        { method: editing ? "PATCH" : "POST", body: JSON.stringify(payload) },
      );
      toast.success("配置基线已保存");
      setEditing(undefined);
      resource.reload();
    } catch (error) {
      setError(
        error instanceof SyntaxError
          ? '期望值必须是有效 JSON，例如 true、22 或 "no"。'
          : error instanceof Error
            ? error.message
            : "保存失败",
      );
    } finally {
      setBusy(false);
    }
  }
  async function evaluate() {
    if (!evaluating || !target) return;
    setBusy(true);
    setError("");
    setEvaluation(null);
    try {
      setEvaluation(
        (await api(`/admin/baselines/${evaluating.id}/evaluate`, {
          method: "POST",
          body: JSON.stringify({ asset_id: target }),
        })) as Evaluation,
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : "检测失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="infra-page">
      <PageHeader
        title="配置基线"
        description="定义适用环境、版本与例外，用实际配置快照识别偏差。检测只读，修复由你决定。"
        actions={
          <>
            <Button
              variant="soft"
              onClick={resource.reload}
              aria-label="刷新基线"
            >
              <RefreshCw size={15} />
            </Button>
            <Button onClick={() => openEditor(null)}>
              <Plus size={15} />
              创建基线
            </Button>
          </>
        }
      />
      <div className="infra-notice">
        <ShieldCheck size={17} />
        <span>
          缺失、未知、过期和偏差分别呈现。环境不适用或采集信息不足时，不会被当成合规。
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
          title="开始定义你的配置标准"
          description="为 Debian、Ubuntu 或特定服务建立规则，并关联修复 SOP。"
          action={
            <Button onClick={() => openEditor(null)}>
              <Plus size={14} />
              创建基线
            </Button>
          }
        />
      ) : (
        <div className="infra-grid">
          {resource.data.data.map((baseline) => (
            <article className="infra-asset-card" key={baseline.id}>
              <div
                className="infra-inline"
                style={{ justifyContent: "space-between" }}
              >
                <h3>{baseline.name}</h3>
                <span className="infra-muted">v{baseline.version}</span>
              </div>
              <p className="infra-asset-description">
                {baseline.description || "未填写基线说明"}
              </p>
              <Tags values={baseline.environments} />
              <div className="infra-asset-footer">
                <span>
                  {baseline.rules.length} 条规则 ·{" "}
                  {baseline.exceptions?.length || 0} 个例外
                </span>
                <span>时效 {baseline.max_age_hours || 24}h</span>
              </div>
              <div className="infra-inline" style={{ marginTop: 16 }}>
                <Button
                  size="1"
                  onClick={() => {
                    setEvaluating(baseline);
                    setTarget("");
                    setSearch("");
                    setEvaluation(null);
                    setError("");
                  }}
                >
                  <CheckCheck size={13} />
                  检测
                </Button>
                <Button
                  variant="soft"
                  size="1"
                  onClick={() => openEditor(baseline)}
                >
                  <Pencil size={13} />
                  编辑
                </Button>
                <Button
                  variant="ghost"
                  size="1"
                  onClick={() => {
                    setHistory(baseline);
                    setSelectedVersion(null);
                  }}
                >
                  <History size={13} />
                  版本
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
      <Pagination
        total={resource.data?.total}
        offset={offset}
        limit={20}
        onChange={setOffset}
      />
      <Dialog.Root
        open={editing !== undefined}
        onOpenChange={(open) => {
          if (!open && !busy) setEditing(undefined);
        }}
      >
        <Dialog.Content maxWidth="980px">
          <Dialog.Title>
            {editing ? `编辑基线 · v${editing.version}` : "创建配置基线"}
          </Dialog.Title>
          <Dialog.Description>
            规则路径对应配置快照中的字段。保存时检查版本，避免覆盖其他维护者的修改。
          </Dialog.Description>
          <form className="infra-form" onSubmit={save}>
            {error && <ErrorState error={error} />}
            <div className="infra-form-grid">
              <label className="infra-field">
                名称
                <input
                  aria-label="名称"
                  className="infra-input"
                  required
                  maxLength={200}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label className="infra-field">
                快照有效期（小时）
                <input
                  aria-label="快照有效期（小时）"
                  className="infra-input"
                  type="number"
                  min={1}
                  max={8760}
                  required
                  value={maxAge}
                  onChange={(e) => setMaxAge(Number(e.target.value))}
                />
              </label>
            </div>
            <label className="infra-field">
              说明
              <textarea
                aria-label="说明"
                className="infra-textarea"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <label className="infra-field">
              适用环境
              <input
                aria-label="适用环境"
                className="infra-input"
                value={environments}
                placeholder="Debian, Ubuntu（留空表示所有环境）"
                onChange={(e) => setEnvironments(e.target.value)}
              />
            </label>
            <div className="infra-field">
              适用资产类型
              <div className="infra-inline">
                {assetKinds.map((kind) => (
                  <label
                    className="infra-inline"
                    key={kind}
                    style={{ fontWeight: 400 }}
                  >
                    <input
                      type="checkbox"
                      checked={kinds.includes(kind)}
                      onChange={() =>
                        setKinds((current) =>
                          current.includes(kind)
                            ? current.filter((item) => item !== kind)
                            : [...current, kind],
                        )
                      }
                    />
                    {assetKindLabels[kind]}
                  </label>
                ))}
              </div>
            </div>
            <h3>检测规则</h3>
            {rules.map((rule, index) => (
              <div
                key={rule.id}
                className="infra-panel"
                style={{ marginBottom: 0 }}
              >
                <div className="infra-panel-heading">
                  <strong style={{ fontSize: 12 }}>规则 {index + 1}</strong>
                  <Button
                    variant="ghost"
                    color="red"
                    size="1"
                    type="button"
                    aria-label={`移除规则 ${index + 1}`}
                    disabled={rules.length < 2}
                    onClick={() =>
                      setRules((current) =>
                        current.filter((_, i) => i !== index),
                      )
                    }
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
                <div className="infra-panel-body">
                  <div className="infra-form-grid">
                    <label className="infra-field">
                      规则 ID
                      <input
                        aria-label="规则 ID"
                        className="infra-input"
                        required
                        value={rule.id}
                        onChange={(e) =>
                          updateRule(index, "id", e.target.value)
                        }
                      />
                    </label>
                    <label className="infra-field">
                      字段路径
                      <input
                        aria-label="字段路径"
                        className="infra-input"
                        required
                        placeholder="ssh.value.permitrootlogin"
                        value={rule.path}
                        onChange={(e) =>
                          updateRule(index, "path", e.target.value)
                        }
                      />
                    </label>
                    <label className="infra-field">
                      比较方式
                      <select
                        aria-label="比较方式"
                        className="infra-select"
                        value={rule.operator}
                        onChange={(e) =>
                          updateRule(index, "operator", e.target.value)
                        }
                      >
                        {Object.entries(operators).map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="infra-field">
                      期望值（JSON）
                      <input
                        aria-label="期望值（JSON）"
                        className="infra-input"
                        disabled={rule.operator === "exists"}
                        required={rule.operator !== "exists"}
                        value={rule.expected}
                        onChange={(e) =>
                          updateRule(index, "expected", e.target.value)
                        }
                      />
                    </label>
                    <label className="infra-field">
                      偏差等级
                      <select
                        aria-label="偏差等级"
                        className="infra-select"
                        value={rule.severity}
                        onChange={(e) =>
                          updateRule(index, "severity", e.target.value)
                        }
                      >
                        <option value="info">提示</option>
                        <option value="warning">警告</option>
                        <option value="critical">严重</option>
                      </select>
                    </label>
                    <label className="infra-field">
                      修复 SOP ID
                      <input
                        aria-label="修复 SOP ID"
                        className="infra-input"
                        placeholder="可选文档 UUID"
                        value={rule.sop_id}
                        onChange={(e) =>
                          updateRule(index, "sop_id", e.target.value)
                        }
                      />
                    </label>
                  </div>
                  <label className="infra-field" style={{ marginTop: 16 }}>
                    规则说明
                    <input
                      aria-label="规则说明"
                      className="infra-input"
                      value={rule.description}
                      onChange={(e) =>
                        updateRule(index, "description", e.target.value)
                      }
                    />
                  </label>
                </div>
              </div>
            ))}
            <Button
              type="button"
              variant="soft"
              style={{ alignSelf: "start" }}
              onClick={() => setRules((current) => [...current, newRule()])}
              disabled={rules.length >= 100}
            >
              <Plus size={14} />
              添加规则
            </Button>
            <h3>有期限的例外</h3>
            {exceptions.map((exception, index) => (
              <div
                className="infra-form-grid"
                key={index}
                style={{
                  borderBottom: "1px solid var(--gray-5)",
                  paddingBottom: 16,
                }}
              >
                <label className="infra-field">
                  规则
                  <select
                    aria-label="规则"
                    className="infra-select"
                    required
                    value={exception.rule_id}
                    onChange={(e) =>
                      updateException(index, "rule_id", e.target.value)
                    }
                  >
                    <option value="">选择规则</option>
                    {rules.map((rule) => (
                      <option key={rule.id} value={rule.id}>
                        {rule.description || rule.path || rule.id}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="infra-field">
                  资产 ID
                  <input
                    aria-label="资产 ID"
                    className="infra-input"
                    required
                    value={exception.asset_id}
                    onChange={(e) =>
                      updateException(index, "asset_id", e.target.value)
                    }
                  />
                </label>
                <label className="infra-field">
                  原因
                  <input
                    aria-label="原因"
                    className="infra-input"
                    required
                    value={exception.reason}
                    onChange={(e) =>
                      updateException(index, "reason", e.target.value)
                    }
                  />
                </label>
                <label className="infra-field">
                  到期时间
                  <input
                    aria-label="到期时间"
                    className="infra-input"
                    type="datetime-local"
                    required
                    value={exception.expires_at}
                    onChange={(e) =>
                      updateException(index, "expires_at", e.target.value)
                    }
                  />
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  color="red"
                  size="1"
                  style={{ justifySelf: "start" }}
                  onClick={() =>
                    setExceptions((current) =>
                      current.filter((_, i) => i !== index),
                    )
                  }
                >
                  移除此例外
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="soft"
              style={{ justifySelf: "start" }}
              onClick={() =>
                setExceptions((current) => [
                  ...current,
                  {
                    rule_id: rules[0]?.id || "",
                    asset_id: "",
                    reason: "",
                    expires_at: "",
                  },
                ])
              }
            >
              <Plus size={14} />
              添加例外
            </Button>
            <div className="infra-dialog-actions">
              <Button
                type="button"
                variant="soft"
                color="gray"
                disabled={busy}
                onClick={() => setEditing(undefined)}
              >
                取消
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "保存中…" : "保存基线版本"}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Root>
      <Dialog.Root
        open={!!evaluating}
        onOpenChange={(open) => {
          if (!open && !busy) setEvaluating(null);
        }}
      >
        <Dialog.Content maxWidth="960px">
          <Dialog.Title>检测 · {evaluating?.name}</Dialog.Title>
          <Dialog.Description>
            比较最新配置快照，记录基线版本与采集证据。
          </Dialog.Description>
          <div className="infra-form">
            <div className="infra-form-grid">
              <label className="infra-field">
                搜索资产
                <input
                  aria-label="搜索资产"
                  className="infra-input"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <label className="infra-field">
                目标资产
                <select
                  aria-label="目标资产"
                  className="infra-select"
                  value={target}
                  onChange={(e) => {
                    setTarget(e.target.value);
                    setEvaluation(null);
                  }}
                >
                  <option value="">选择资产</option>
                  {targets.data?.data.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.name} · {assetKindLabels[asset.kind] || asset.kind}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {targets.error && (
              <ErrorState error={targets.error} retry={targets.reload} />
            )}{" "}
            {error && <ErrorState error={error} />}
            <Button
              disabled={!target || busy}
              onClick={() => void evaluate()}
              style={{ justifySelf: "start" }}
            >
              <CheckCheck size={15} />
              {busy ? "检测中…" : "运行只读检测"}
            </Button>
            {evaluation && (
              <>
                <div className="infra-inline">
                  <Status value={evaluation.status} />
                  <span className="infra-muted">
                    基线 v{evaluation.baseline_version} ·{" "}
                    {formatTime(evaluation.evaluated_at)} · 快照{" "}
                    {evaluation.snapshot_id?.slice(0, 8) || "无"}
                  </span>
                </div>
                <div className="infra-table-wrap">
                  <table className="infra-table">
                    <thead>
                      <tr>
                        <th>规则</th>
                        <th>结果</th>
                        <th>实际</th>
                        <th>期望</th>
                        <th>证据来源</th>
                        <th>修复依据</th>
                      </tr>
                    </thead>
                    <tbody>
                      {evaluation.results.map((result) => (
                        <tr key={result.rule_id}>
                          <td>
                            {result.description || result.rule_id}
                            {result.exception_reason && (
                              <p className="infra-muted">
                                例外：{result.exception_reason}
                              </p>
                            )}
                          </td>
                          <td>
                            <Status value={result.status} />
                          </td>
                          <td>
                            <code>
                              {result.actual === undefined
                                ? "未知"
                                : JSON.stringify(result.actual)}
                            </code>
                          </td>
                          <td>
                            <code>{JSON.stringify(result.expected)}</code>
                          </td>
                          <td>
                            <Status
                              value={result.evidence?.confidence || "unknown"}
                            />
                            {result.evidence?.confidence === "reported" && (
                              <div className="infra-muted">待探针观测验证</div>
                            )}
                            <div className="infra-muted">
                              {result.evidence?.source || "来源未知"}
                            </div>
                            <div className="infra-muted">
                              {formatTime(result.evidence?.collected_at)}
                            </div>
                          </td>
                          <td>
                            {result.sop_id ? (
                              <Link
                                to={`/admin/knowledge?document=${result.sop_id}`}
                              >
                                查看 SOP
                              </Link>
                            ) : (
                              "未关联"
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
          <div className="infra-dialog-actions">
            <Button
              variant="soft"
              disabled={busy}
              onClick={() => setEvaluating(null)}
            >
              关闭
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Root>
      <Dialog.Root
        open={!!history}
        onOpenChange={(open) => {
          if (!open) setHistory(null);
        }}
      >
        <Dialog.Content maxWidth="900px">
          <Dialog.Title>基线版本 · {history?.name}</Dialog.Title>
          <Dialog.Description>
            查看规则、适用范围和例外在各版本中的变化。
          </Dialog.Description>
          <div className="infra-form">
            {versions.error && (
              <ErrorState error={versions.error} retry={versions.reload} />
            )}
            <select
              className="infra-select"
              aria-label="选择基线历史版本"
              value={selectedVersion?.version || ""}
              onChange={(e) =>
                setSelectedVersion(
                  versions.data?.data.find(
                    (item) => item.version === Number(e.target.value),
                  ) || null,
                )
              }
            >
              <option value="">选择历史版本</option>
              {versions.data?.data.map((item) => (
                <option key={item.version} value={item.version}>
                  v{item.version} ·{" "}
                  {formatTime(item.updated_at || item.created_at)}
                </option>
              ))}
            </select>
            {selectedVersion && (
              <div className="infra-diff">
                <div>
                  <span>历史 v{selectedVersion.version}</span>
                  <JsonView value={selectedVersion} />
                </div>
                <div>
                  <span>当前 v{history?.version}</span>
                  <JsonView value={history} />
                </div>
              </div>
            )}
          </div>
          <div className="infra-dialog-actions">
            <Dialog.Close>
              <Button variant="soft">关闭</Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Root>
    </div>
  );
}
