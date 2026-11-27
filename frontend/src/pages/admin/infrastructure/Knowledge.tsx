import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button, Dialog } from "@radix-ui/themes";
import {
  BookOpen,
  Download,
  Eye,
  History,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { useApi } from "../../../contexts/AuthContext";
import { assetKinds, assetKindLabels, type DocumentRecord } from "../../../infrastructure/types";
import Markdown from "../../../infrastructure/Markdown";
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  JsonView,
  LoadingState,
  PageHeader,
  Pagination,
  Status,
  Tags,
  downloadFile,
  formatTime,
  useResource,
  type PageResult,
} from "../../../infrastructure/ui";

type Draft = {
  title: string;
  category: string;
  tags: string;
  environments: string;
  risk: string;
  asset_ids: string;
  asset_kinds: string[];
  content: string;
};
const emptyDraft: Draft = {
  title: "",
  category: "",
  tags: "",
  environments: "",
  risk: "medium",
  asset_ids: "",
  asset_kinds: [],
  content:
    "# 目标\n\n## 适用环境\n\n## 前置条件\n\n## 环境检测\n\n## 操作步骤\n\n## 风险\n\n## 禁止事项\n\n## 验证方法\n\n## 回滚方法\n\n## 常见故障\n",
};
const toDraft = (document: DocumentRecord): Draft => ({
  title: document.title,
  category: document.category || "",
  tags: document.tags.join(", "),
  environments: document.environments.join(", "),
  risk: document.risk,
  asset_ids: document.asset_ids.join("\n"),
  asset_kinds: document.asset_kinds || [],
  content: document.content,
});
const split = (value: string) =>
  value
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);

export default function Knowledge() {
  const [params, setParams] = useSearchParams();
  const selected = params.get("document");
  const q = params.get("q") || "";
  const offset = Math.max(0, Number(params.get("offset")) || 0);
  const [query, setQuery] = useState(q);
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [draftVersion, setDraftVersion] = useState<number | undefined>();
  const [latestVersion, setLatestVersion] = useState<DocumentRecord | null>(
    null,
  );
  const [categoryFilter, setCategoryFilter] = useState(
    params.get("category") || "",
  );
  const [tagFilter, setTagFilter] = useState(params.get("tag") || "");
  const [preview, setPreview] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [discard, setDiscard] = useState<(() => void) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versionDetail, setVersionDetail] = useState<DocumentRecord | null>(
    null,
  );
  const [restoring, setRestoring] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const list = useResource<PageResult<DocumentRecord>>(
    `/admin/documents?q=${encodeURIComponent(q)}&limit=20&offset=${offset}${params.get("category") ? `&category=${encodeURIComponent(params.get("category")!)}` : ""}${params.get("tag") ? `&tag=${encodeURIComponent(params.get("tag")!)}` : ""}`,
  );
  const document = useResource<DocumentRecord>(
    selected ? `/admin/documents/${selected}` : null,
  );
  const versions = useResource<PageResult<DocumentRecord>>(
    selected && versionsOpen
      ? `/admin/documents/${selected}/versions?limit=50&offset=0`
      : null,
  );
  const api = useApi();
  useEffect(() => {
    setQuery(q);
  }, [q]);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (query !== q)
        setParams((current) => {
          const next = new URLSearchParams(current);
          query ? next.set("q", query) : next.delete("q");
          next.delete("offset");
          return next;
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [query, q, setParams]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const runSafe = (action: () => void) => {
    if (dirty) setDiscard(() => action);
    else action();
  };
  const select = (id: string) =>
    runSafe(() => {
      setEditing(false);
      setCreating(false);
      setError("");
      setVersionDetail(null);
      setParams((current) => {
        const next = new URLSearchParams(current);
        next.set("document", id);
        return next;
      });
    });
  const update = (key: keyof Draft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setDirty(true);
  };
  const create = () =>
    runSafe(() => {
      setDraft(emptyDraft);
      setCreating(true);
      setEditing(true);
      setDirty(false);
      setError("");
      setPreview(false);
    });
  const edit = () => {
    if (!document.data) return;
    setDraft(toDraft(document.data));
    setDraftVersion(document.data.version);
    setEditing(true);
    setCreating(false);
    setDirty(false);
    setError("");
    setPreview(false);
  };
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload = {
        ...draft,
        tags: split(draft.tags),
        environments: split(draft.environments),
        asset_ids: split(draft.asset_ids),
        ...(!creating && document.data
          ? { version: draftVersion ?? document.data.version }
          : {}),
      };
      const result = (await api(
        creating ? "/admin/documents" : `/admin/documents/${selected}`,
        { method: creating ? "POST" : "PATCH", body: JSON.stringify(payload) },
      )) as DocumentRecord;
      toast.success("文档已保存");
      setEditing(false);
      setCreating(false);
      setDirty(false);
      list.reload();
      document.reload();
      if (result.id)
        setParams((current) => {
          const next = new URLSearchParams(current);
          next.set("document", result.id);
          return next;
        });
    } catch (error) {
      setError(error instanceof Error ? error.message : "保存失败，草稿已保留");
    } finally {
      setBusy(false);
    }
  }
  async function compareLatest() {
    if (!selected) return;
    setBusy(true);
    try {
      setLatestVersion(
        (await api(`/admin/documents/${selected}`)) as DocumentRecord,
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : "读取当前版本失败");
    } finally {
      setBusy(false);
    }
  }
  async function readImport(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > 150000) throw new Error("文档不能超过 150 KB");
      const text = await file.text();
      const value = file.name.endsWith(".json")
        ? JSON.parse(text)
        : {
            ...emptyDraft,
            title: file.name.replace(/\.md$/i, ""),
            content: text,
          };
      if (typeof value.content !== "string" || !value.content.trim())
        throw new Error("文档内容不能为空");
      const next: Draft = {
        ...emptyDraft,
        title: String(value.title || file.name),
        content: value.content,
        category: String(value.category || ""),
        tags: Array.isArray(value.tags) ? value.tags.join(", ") : "",
        environments: Array.isArray(value.environments)
          ? value.environments.join(", ")
          : "",
        risk: ["low", "medium", "high"].includes(value.risk)
          ? value.risk
          : "medium",
        asset_ids: Array.isArray(value.asset_ids)
          ? value.asset_ids.join("\n")
          : "",
        asset_kinds: Array.isArray(value.asset_kinds)
          ? value.asset_kinds.filter((kind: unknown): kind is string => typeof kind === "string" && assetKinds.includes(kind as typeof assetKinds[number]))
          : [],
      };
      runSafe(() => {
        setDraft(next);
        setCreating(true);
        setEditing(true);
        setDirty(true);
        setPreview(true);
        setError("");
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "导入读取失败");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }
  async function restore() {
    if (restoring == null || !selected) return;
    setBusy(true);
    try {
      await api(`/admin/documents/${selected}/restore`, {
        method: "POST",
        body: JSON.stringify({ version: restoring }),
      });
      toast.success("历史内容已恢复为新版本");
      setRestoring(null);
      setVersionDetail(null);
      versions.reload();
      document.reload();
      list.reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "恢复失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="infra-page">
      <PageHeader
        title="运维知识库"
        description="版本化 SOP、排障记录与环境约束，为每项资产保留可核验的操作依据。"
        actions={
          <>
            <Button variant="soft" onClick={() => inputRef.current?.click()}>
              <Upload size={15} />
              导入文档
            </Button>
            <Button onClick={create}>
              <Plus size={15} />
              新建文档
            </Button>
          </>
        }
      />
      <input
        type="file"
        hidden
        ref={inputRef}
        accept=".md,.markdown,.json,text/markdown,application/json"
        onChange={(e) => void readImport(e.target.files?.[0])}
      />
      <div className="infra-knowledge-layout">
        <aside>
          <label className="infra-field" style={{ marginBottom: 15 }}>
            搜索全文
            <input
              aria-label="搜索全文"
              className="infra-input"
              placeholder="搜索 SOP、配置和排障…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <details style={{ marginBottom: 16 }}>
            <summary className="infra-muted" style={{ cursor: "pointer" }}>
              分类与标签
              {params.has("category") || params.has("tag") ? " · 已筛选" : ""}
            </summary>
            <form
              className="infra-form"
              onSubmit={(event) => {
                event.preventDefault();
                setParams((current) => {
                  const next = new URLSearchParams(current);
                  categoryFilter.trim()
                    ? next.set("category", categoryFilter.trim())
                    : next.delete("category");
                  tagFilter.trim()
                    ? next.set("tag", tagFilter.trim())
                    : next.delete("tag");
                  next.delete("offset");
                  return next;
                });
              }}
            >
              <label className="infra-field">
                分类
                <input
                  aria-label="文档分类筛选"
                  className="infra-input"
                  value={categoryFilter}
                  onChange={(event) => setCategoryFilter(event.target.value)}
                />
              </label>
              <label className="infra-field">
                标签
                <input
                  aria-label="文档标签筛选"
                  className="infra-input"
                  value={tagFilter}
                  onChange={(event) => setTagFilter(event.target.value)}
                />
              </label>
              <Button size="1" variant="soft" type="submit">
                应用筛选
              </Button>
            </form>
          </details>
          {list.error && <ErrorState error={list.error} retry={list.reload} />}{" "}
          {list.loading && !list.data ? (
            <LoadingState />
          ) : (
            <div className="infra-document-list">
              {list.data?.data.map((item) => (
                <button
                  key={item.id}
                  aria-current={selected === item.id && !creating}
                  onClick={() => select(item.id)}
                >
                  <strong>{item.title}</strong>
                  <small>
                    {item.category || "未分类"} · v{item.version} ·{" "}
                    {item.environments?.join(" / ") || "通用"}
                  </small>
                </button>
              ))}
            </div>
          )}
          {list.data?.data.length === 0 && (
            <EmptyState
              title="未找到文档"
              description="换一个关键词，或创建自己的 SOP。"
            />
          )}
          <Pagination
            total={list.data?.total}
            limit={20}
            offset={offset}
            onChange={(value) =>
              setParams((current) => {
                const next = new URLSearchParams(current);
                next.set("offset", String(value));
                return next;
              })
            }
          />
        </aside>
        <section>
          {editing ? (
            <form onSubmit={save}>
              <div className="infra-panel">
                <div className="infra-panel-heading">
                  <h2>
                    {creating
                      ? "新建文档"
                      : `编辑 · v${draftVersion ?? document.data?.version}`}
                    {dirty ? " · 未保存" : ""}
                  </h2>
                  <div className="infra-inline">
                    <Button
                      type="button"
                      variant="soft"
                      size="1"
                      onClick={() => setPreview(!preview)}
                    >
                      {preview ? <Pencil size={13} /> : <Eye size={13} />}{" "}
                      {preview ? "编辑" : "预览"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="1"
                      disabled={busy}
                      onClick={() =>
                        runSafe(() => {
                          setEditing(false);
                          setCreating(false);
                          setDirty(false);
                        })
                      }
                    >
                      取消
                    </Button>
                    <Button type="submit" size="1" disabled={busy}>
                      <Save size={13} />
                      {busy ? "保存中…" : "保存版本"}
                    </Button>
                  </div>
                </div>
                <div className="infra-panel-body">
                  {error && (
                    <>
                      <ErrorState error={error} />
                      {!creating && (
                        <Button
                          size="1"
                          type="button"
                          variant="soft"
                          disabled={busy}
                          onClick={() => void compareLatest()}
                        >
                          与服务器当前版本比较
                        </Button>
                      )}
                    </>
                  )}
                  <div className="infra-form" style={{ marginTop: 0 }}>
                    <label className="infra-field">
                      标题
                      <input
                        aria-label="标题"
                        className="infra-input"
                        value={draft.title}
                        maxLength={200}
                        required
                        onChange={(e) => update("title", e.target.value)}
                      />
                    </label>
                    <div className="infra-form-grid">
                      <label className="infra-field">
                        分类
                        <input
                          aria-label="分类"
                          className="infra-input"
                          value={draft.category}
                          onChange={(e) => update("category", e.target.value)}
                        />
                      </label>
                      <label className="infra-field">
                        风险等级
                        <select
                          aria-label="风险等级"
                          className="infra-select"
                          value={draft.risk}
                          onChange={(e) => update("risk", e.target.value)}
                        >
                          <option value="low">低风险</option>
                          <option value="medium">中风险</option>
                          <option value="high">高风险</option>
                        </select>
                      </label>
                    </div>
                    <div className="infra-form-grid">
                      <label className="infra-field">
                        适用环境
                        <input
                          aria-label="适用环境"
                          className="infra-input"
                          value={draft.environments}
                          placeholder="Debian 12, Ubuntu 24.04"
                          onChange={(e) =>
                            update("environments", e.target.value)
                          }
                        />
                      </label>
                      <label className="infra-field">
                        标签
                        <input
                          aria-label="标签"
                          className="infra-input"
                          value={draft.tags}
                          placeholder="security, docker"
                          onChange={(e) => update("tags", e.target.value)}
                        />
                      </label>
                    </div>
                    <label className="infra-field">
                      关联资产 ID
                      <textarea
                        aria-label="关联资产 ID"
                        className="infra-textarea"
                        style={{ minHeight: 60 }}
                        value={draft.asset_ids}
                        placeholder="每行一个资产 UUID"
                        onChange={(e) => update("asset_ids", e.target.value)}
                      />
                      <small>显式关联的资产优先；未关联时按资产类型和适用环境推荐文档。</small>
                    </label>
                    <fieldset className="infra-field" style={{ border: 0, padding: 0, margin: 0 }}>
                      <legend>适用资产类型</legend>
                      <div className="infra-inline" style={{ flexWrap: "wrap", gap: "10px 16px", marginTop: 8 }}>
                        {assetKinds.map((kind) => (
                          <label key={kind} className="infra-inline" style={{ fontSize: 12 }}>
                            <input
                              type="checkbox"
                              checked={draft.asset_kinds.includes(kind)}
                              onChange={(event) => {
                                const checked = event.target.checked;
                                setDraft((current) => ({
                                  ...current,
                                  asset_kinds: checked ? [...current.asset_kinds, kind] : current.asset_kinds.filter((value) => value !== kind),
                                }));
                                setDirty(true);
                              }}
                            />
                            {assetKindLabels[kind]}
                          </label>
                        ))}
                      </div>
                      <small>留空表示不限制资产类型；环境未知时不会自动推荐要求特定系统的文档。</small>
                    </fieldset>
                    {preview ? (
                      <Markdown content={draft.content} />
                    ) : (
                      <label className="infra-field">
                        Markdown 正文
                        <textarea
                          aria-label="Markdown 正文"
                          className="infra-textarea"
                          style={{
                            minHeight: 500,
                            fontFamily: "var(--font-mono)",
                            fontSize: 12,
                          }}
                          value={draft.content}
                          maxLength={100000}
                          required
                          spellCheck={false}
                          onChange={(e) => update("content", e.target.value)}
                        />
                        <small>
                          支持标题、列表、表格、代码块、引用和安全链接。HTML
                          作为文本显示。
                        </small>
                      </label>
                    )}
                  </div>
                </div>
              </div>
            </form>
          ) : document.loading ? (
            <LoadingState label="正在读取文档" />
          ) : document.error ? (
            <ErrorState error={document.error} retry={document.reload} />
          ) : document.data ? (
            <div className="infra-panel">
              <div className="infra-panel-heading">
                <div>
                  <h2>{document.data.title}</h2>
                  <p className="infra-muted" style={{ margin: "8px 0 0" }}>
                    v{document.data.version} · 更新于{" "}
                    {formatTime(document.data.updated_at)}
                  </p>
                </div>
                <div className="infra-inline">
                  <Button
                    size="1"
                    variant="soft"
                    onClick={() => setVersionsOpen(true)}
                  >
                    <History size={13} />
                    版本
                  </Button>
                  <Button
                    size="1"
                    variant="soft"
                    aria-label="导出 Markdown"
                    onClick={() =>
                      downloadFile(
                        `cvm-sop-${document.data!.id}.md`,
                        document.data!.content,
                        "text/markdown",
                      )
                    }
                  >
                    <Download size={13} />
                  </Button>
                  <Button size="1" onClick={edit}>
                    <Pencil size={13} />
                    编辑
                  </Button>
                </div>
              </div>
              <div className="infra-panel-body">
                <div className="infra-inline" style={{ marginBottom: 18 }}>
                  <Status value={document.data.risk} />
                  <Tags values={document.data.environments} />
                  <Tags values={(document.data.asset_kinds || []).map((kind) => assetKindLabels[kind] || kind)} />
                  <Tags values={document.data.tags} />
                </div>
                {!!document.data.asset_ids.length && (
                  <div className="infra-inline" style={{ marginBottom: 20 }}>
                    {document.data.asset_ids.map((assetId) => (
                      <Link
                        key={assetId}
                        to={`/admin/assets/${assetId}`}
                        className="infra-muted"
                      >
                        资产 {assetId.slice(0, 8)} →
                      </Link>
                    ))}
                  </div>
                )}
                <Markdown content={document.data.content} />
              </div>
            </div>
          ) : (
            <EmptyState
              title="选择一篇运维文档"
              description="在左侧搜索并阅读 SOP，或新建文档记录你的基础设施维护流程。"
              action={
                <Button variant="soft" onClick={create}>
                  <BookOpen size={15} />
                  创建文档
                </Button>
              }
            />
          )}
        </section>
      </div>
      <Dialog.Root
        open={!!latestVersion}
        onOpenChange={(open) => {
          if (!open) setLatestVersion(null);
        }}
      >
        <Dialog.Content maxWidth="1000px">
          <Dialog.Title>比较草稿与服务器当前版本</Dialog.Title>
          <Dialog.Description>
            不会自动覆盖任何版本。检查差异后，可继续编辑草稿，并明确选择下一次保存所基于的版本。
          </Dialog.Description>
          <div className="infra-diff" style={{ marginTop: 20 }}>
            <div>
              <h3>当前草稿 · 基于 v{draftVersion}</h3>
              <JsonView
                value={{
                  title: draft.title,
                  content: draft.content,
                  category: draft.category,
                  tags: split(draft.tags),
                }}
              />
            </div>
            <div>
              <h3>服务器 · v{latestVersion?.version}</h3>
              <JsonView
                value={
                  latestVersion && {
                    title: latestVersion.title,
                    content: latestVersion.content,
                    category: latestVersion.category,
                    tags: latestVersion.tags,
                  }
                }
              />
            </div>
          </div>
          <div className="infra-dialog-actions">
            <Button variant="soft" onClick={() => setLatestVersion(null)}>
              保留原保存基准
            </Button>
            <Button
              onClick={() => {
                setDraftVersion(latestVersion!.version);
                setLatestVersion(null);
                setError("");
              }}
            >
              基于当前版本继续编辑草稿
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Root>
      <Dialog.Root open={versionsOpen} onOpenChange={setVersionsOpen}>
        <Dialog.Content maxWidth="900px">
          <Dialog.Title>文档历史版本</Dialog.Title>
          <Dialog.Description>
            恢复会创建新的当前版本，历史记录继续保留。
          </Dialog.Description>
          <div style={{ marginTop: 20 }}>
            {versions.error && (
              <ErrorState error={versions.error} retry={versions.reload} />
            )}{" "}
            {versions.loading ? (
              <LoadingState />
            ) : (
              <div className="infra-table-wrap">
                <table className="infra-table">
                  <thead>
                    <tr>
                      <th>版本</th>
                      <th>标题</th>
                      <th>时间</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {versions.data?.data.map((item) => (
                      <tr key={item.version}>
                        <td>v{item.version}</td>
                        <td>{item.title}</td>
                        <td>
                          {formatTime(item.updated_at || item.created_at)}
                        </td>
                        <td>
                          <div className="infra-inline">
                            <Button
                              size="1"
                              variant="soft"
                              onClick={() => setVersionDetail(item)}
                            >
                              查看
                            </Button>
                            <Button
                              size="1"
                              variant="ghost"
                              disabled={item.version === document.data?.version}
                              onClick={() => setRestoring(item.version)}
                            >
                              <RotateCcw size={13} />
                              恢复
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {versionDetail && (
              <div style={{ marginTop: 20 }}>
                <h3>
                  v{versionDetail.version} · {versionDetail.title}
                </h3>
                <Markdown content={versionDetail.content} />
                <details>
                  <summary className="infra-muted">结构化版本</summary>
                  <JsonView value={versionDetail} />
                </details>
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
      <ConfirmDialog
        open={!!discard}
        title="放弃未保存的修改？"
        description="当前草稿还没有保存。离开编辑会放弃这些修改。"
        pending={false}
        confirmLabel="放弃修改"
        onClose={() => setDiscard(null)}
        onConfirm={() => {
          const action = discard;
          setDirty(false);
          setDiscard(null);
          action?.();
        }}
      />
      <ConfirmDialog
        open={restoring !== null}
        title={`恢复文档 v${restoring}`}
        description="旧版本的内容将作为一个新版本保存，已有版本历史保留。"
        pending={busy}
        confirmLabel="恢复版本"
        onClose={() => setRestoring(null)}
        onConfirm={() => void restore()}
      />
    </div>
  );
}
