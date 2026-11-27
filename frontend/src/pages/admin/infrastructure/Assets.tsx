import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button, Dialog, DropdownMenu } from "@radix-ui/themes";
import {
  Activity,
  Archive,
  Boxes,
  ChevronDown,
  Download,
  Globe2,
  LayoutGrid,
  List,
  Plus,
  Pencil,
  Tag,
  RefreshCw,
  Search,
  Server,
  SlidersHorizontal,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { useApi } from "../../../contexts/AuthContext";
import {
  getLocalStorageItem,
  setLocalStorageItem,
} from "../../../utils/browserStorage";
import {
  assetKinds,
  assetKindLabels,
  type Asset,
} from "../../../infrastructure/types";
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
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

import { AssetEditor } from "../../../infrastructure/AssetEditor";

const LIMIT = 30;
export const assetIcon = (kind: string, size = 18) =>
  kind === "vps" ? (
    <Server size={size} />
  ) : ["website", "domain", "api"].includes(kind) ? (
    <Globe2 size={size} />
  ) : (
    <Boxes size={size} />
  );

type Summary = {
  assets_total: number;
  assets_by_kind: Record<string, number>;
  assets_by_status: Record<string, number>;
  discovery_pending: number;
  changes_24h: number;
  documents_total: number;
};

export default function Assets() {
  const [params, setParams] = useSearchParams();
  const api = useApi();
  const q = params.get("q") || "",
    kind = params.get("kind") || "",
    status = params.get("status") || "",
    offset = Math.max(0, Number(params.get("offset")) || 0);
  const [query, setQuery] = useState(q);
  const [view, setView] = useState(
    () => getLocalStorageItem("cvm-assets-view") || "table",
  );
  const [density, setDensity] = useState(
    () => getLocalStorageItem("cvm-assets-density") || "comfortable",
  );
  const [showSummary, setShowSummary] = useState(
    () => getLocalStorageItem("cvm-assets-summary") !== "hidden",
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const [editingAsset, setEditingAsset] = useState<Asset | undefined>();
  const [tagging, setTagging] = useState(false);
  const [bulkTags, setBulkTags] = useState("");
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [imported, setImported] = useState<unknown[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const filter = (key: string, value: string) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value);
      else next.delete(key);
      if (key !== "offset") next.delete("offset");
      return next;
    });
  useEffect(() => {
    setQuery(q);
  }, [q]);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (query !== q) filter("q", query);
    }, 250);
    return () => clearTimeout(timer);
  }, [query, q]);
  const queryString = new URLSearchParams({
    q,
    kind,
    status,
    limit: String(LIMIT),
    offset: String(offset),
    sort: params.get("sort") || "updated_at",
    ...Object.fromEntries(
      ["tag", "client_id", "monitor_type", "monitor_id"]
        .filter((key) => params.has(key))
        .map((key) => [key, params.get(key)!]),
    ),
  }).toString();
  const resource = useResource<PageResult<Asset>>(
    `/admin/assets?${queryString}`,
  );
  const summary = useResource<Summary>("/admin/infrastructure/summary");
  const assets = resource.data?.data || [];
  const groupBy = ["kind", "category", "provider"].includes(
    params.get("group") || "",
  )
    ? params.get("group")!
    : "";
  const groupValue = (asset: Asset) =>
    groupBy === "kind"
      ? assetKindLabels[asset.kind] || asset.kind
      : groupBy === "category"
        ? asset.category || "未分类"
        : asset.provider || "未设置服务商";
  const displayAssets = useMemo(
    () =>
      groupBy
        ? [...assets].sort((a, b) => groupValue(a).localeCompare(groupValue(b)))
        : assets,
    [assets, groupBy],
  );
  const startEdit = (asset?: Asset) => {
    setEditingAsset(asset);
    setEditing(true);
  };
  const reload = () => {
    resource.reload();
    summary.reload();
  };
  useEffect(() => {
    setSelected([]);
  }, [queryString]);
  const setDisplay = (key: "view" | "density", value: string) => {
    if (key === "view") setView(value);
    else setDensity(value);
    setLocalStorageItem(`cvm-assets-${key}`, value);
  };
  const allSelected =
    assets.length > 0 && assets.every((asset) => selected.includes(asset.id));
  const selectedRecords = useMemo(
    () => assets.filter((asset) => selected.includes(asset.id)),
    [assets, selected],
  );
  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );
  async function archive() {
    setBusy(true);
    try {
      await api("/admin/assets/batch", {
        method: "POST",
        body: JSON.stringify({ ids: selected, action: "archive" }),
      });
      toast.success("所选资产已归档");
      setSelected([]);
      setConfirmArchive(false);
      reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "归档失败");
    } finally {
      setBusy(false);
    }
  }
  async function applyTags() {
    setBusy(true);
    try {
      await api("/admin/assets/batch", {
        method: "POST",
        body: JSON.stringify({
          ids: selected,
          action: "tag",
          tags: [
            ...new Set(
              bulkTags
                .split(/[,，]/)
                .map((value) => value.trim())
                .filter(Boolean),
            ),
          ],
        }),
      });
      toast.success("所选资产标签已更新");
      setTagging(false);
      setSelected([]);
      reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "更新标签失败");
    } finally {
      setBusy(false);
    }
  }
  async function readImport(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > 1024 * 1024) throw new Error("导入文件不能超过 1 MB");
      const parsed = JSON.parse(await file.text());
      const list = Array.isArray(parsed) ? parsed : parsed.assets;
      if (!Array.isArray(list) || !list.length || list.length > 200)
        throw new Error("文件需要包含 1–200 项资产数组");
      if (
        list.some(
          (item) =>
            !item ||
            typeof item !== "object" ||
            typeof item.name !== "string" ||
            typeof item.kind !== "string",
        )
      )
        throw new Error("每项资产必须包含 name 和 kind");
      setImported(list);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "文件读取失败");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }
  async function importAssets() {
    if (!imported) return;
    setBusy(true);
    try {
      const result = await api("/admin/assets/import", {
        method: "POST",
        body: JSON.stringify({ assets: imported }),
      });
      toast.success(
        `导入处理完成${typeof result.imported === "number" ? `：${result.imported} 项` : ""}`,
      );
      setImported(null);
      reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "导入失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={`infra-page infra-density-${density}`}>
      <PageHeader
        title="基础设施"
        description="把服务器、网站、容器与部署放在同一份台账中，沿着资产关系理解服务。"
        actions={
          <>
            <Button variant="soft" onClick={reload} aria-label="刷新资产">
              <RefreshCw size={15} />
            </Button>
            <Button variant="soft" onClick={() => inputRef.current?.click()}>
              <Upload size={15} />
              导入
            </Button>
            <Button onClick={() => startEdit()}>
              <Plus size={15} />
              添加资产
            </Button>
          </>
        }
      />
      <input
        type="file"
        accept=".json,application/json"
        hidden
        ref={inputRef}
        onChange={(e) => void readImport(e.target.files?.[0])}
      />
      {showSummary && summary.data && (
        <div className="infra-kpis">
          {[
            {
              label: "资产总数",
              value: summary.data.assets_total,
              detail: "统一台账",
              icon: <Boxes size={17} />,
            },
            {
              label: "待确认发现",
              value: summary.data.discovery_pending,
              detail: "人工确认后导入",
              icon: <Search size={17} />,
            },
            {
              label: "最近 24 小时变更",
              value: summary.data.changes_24h,
              detail: "追踪来源与观测证据",
              icon: <Activity size={17} />,
            },
            {
              label: "运维文档",
              value: summary.data.documents_total,
              detail: "关联资产与适用环境",
              icon: <Archive size={17} />,
            },
          ].map((item) => (
            <div className="infra-kpi" key={item.label}>
              <div className="infra-kpi-label">
                {item.label}
                {item.icon}
              </div>
              <div className="infra-kpi-value">{item.value ?? "—"}</div>
              <span className="infra-kpi-detail">{item.detail}</span>
            </div>
          ))}
        </div>
      )}
      {summary.error && showSummary && (
        <ErrorState error={summary.error} retry={summary.reload} />
      )}
      <div className="infra-toolbar">
        <label className="infra-search">
          <span className="sr-only">搜索资产</span>
          <input
            className="infra-input"
            placeholder="搜索名称、地址或标签…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select
          className="infra-select"
          aria-label="资产类型"
          style={{ width: "auto" }}
          value={kind}
          onChange={(e) => filter("kind", e.target.value)}
        >
          <option value="">所有类型</option>
          {assetKinds.map((value) => (
            <option value={value} key={value}>
              {assetKindLabels[value]}
            </option>
          ))}
        </select>
        <select
          className="infra-select"
          aria-label="生命周期"
          style={{ width: "auto" }}
          value={status}
          onChange={(e) => filter("status", e.target.value)}
        >
          <option value="">所有生命周期</option>
          <option value="active">使用中</option>
          <option value="planned">规划中</option>
          <option value="archived">已归档</option>
        </select>
        <select
          className="infra-select"
          aria-label="排序方式"
          style={{ width: "auto" }}
          value={params.get("sort") || "updated_at"}
          onChange={(e) => filter("sort", e.target.value)}
        >
          <option value="updated_at">最近更新</option>
          <option value="name">名称</option>
          <option value="kind">类型</option>
          <option value="expires_at">到期日期</option>
        </select>
        <div className="infra-inline" style={{ marginLeft: "auto" }}>
          <Button
            variant={view === "table" ? "solid" : "soft"}
            onClick={() => setDisplay("view", "table")}
            aria-label="表格视图"
          >
            <List size={16} />
          </Button>
          <Button
            variant={view === "grid" ? "solid" : "soft"}
            onClick={() => setDisplay("view", "grid")}
            aria-label="卡片视图"
          >
            <LayoutGrid size={16} />
          </Button>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              <Button variant="soft">
                <SlidersHorizontal size={15} />
                <ChevronDown size={12} />
                <span className="sr-only">布局选项</span>
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content>
              <DropdownMenu.Label>当前页分组</DropdownMenu.Label>
              <DropdownMenu.RadioGroup
                value={groupBy}
                onValueChange={(value) => filter("group", value)}
              >
                <DropdownMenu.RadioItem value="">不分组</DropdownMenu.RadioItem>
                <DropdownMenu.RadioItem value="kind">
                  按资产类型
                </DropdownMenu.RadioItem>
                <DropdownMenu.RadioItem value="category">
                  按分类
                </DropdownMenu.RadioItem>
                <DropdownMenu.RadioItem value="provider">
                  按服务商
                </DropdownMenu.RadioItem>
              </DropdownMenu.RadioGroup>
              <DropdownMenu.Separator />
              <DropdownMenu.CheckboxItem
                checked={density === "compact"}
                onCheckedChange={(value) =>
                  setDisplay("density", value ? "compact" : "comfortable")
                }
              >
                紧凑密度
              </DropdownMenu.CheckboxItem>
              <DropdownMenu.CheckboxItem
                checked={showSummary}
                onCheckedChange={(value) => {
                  setShowSummary(value);
                  setLocalStorageItem(
                    "cvm-assets-summary",
                    value ? "visible" : "hidden",
                  );
                }}
              >
                显示概览指标
              </DropdownMenu.CheckboxItem>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </div>
      </div>
      {(params.has("client_id") ||
        params.has("monitor_id") ||
        params.has("tag")) && (
        <div className="infra-selection">
          <span>
            已按{params.has("tag") ? `标签 ${params.get("tag")}` : "监控关联"}
            筛选台账
          </span>
          <Button
            size="1"
            variant="ghost"
            onClick={() =>
              setParams((current) => {
                const next = new URLSearchParams(current);
                ["client_id", "monitor_type", "monitor_id", "tag"].forEach(
                  (key) => next.delete(key),
                );
                return next;
              })
            }
          >
            清除此筛选
          </Button>
        </div>
      )}
      {!!selected.length && (
        <div className="infra-selection">
          <span>已选择当前页 {selected.length} 项资产</span>
          <div className="infra-inline">
            <Button
              size="1"
              variant="soft"
              onClick={() => {
                setTagging(true);
                setBulkTags("");
              }}
            >
              <Tag size={13} />
              批量标签
            </Button>
            <Button
              size="1"
              variant="soft"
              onClick={() =>
                downloadFile(
                  "cvm-selected-assets.json",
                  JSON.stringify({ assets: selectedRecords }, null, 2),
                )
              }
            >
              <Download size={13} />
              导出所选
            </Button>
            <Button
              size="1"
              variant="soft"
              onClick={() => setConfirmArchive(true)}
            >
              <Archive size={13} />
              归档
            </Button>
            <Button size="1" variant="ghost" onClick={() => setSelected([])}>
              取消选择
            </Button>
          </div>
        </div>
      )}
      {resource.error && (
        <ErrorState error={resource.error} retry={resource.reload} />
      )}
      {resource.loading && !resource.data ? (
        <LoadingState />
      ) : resource.error && !resource.data ? null : assets.length === 0 ? (
        <EmptyState
          title="还没有符合条件的资产"
          description={
            q || kind || status
              ? "调整筛选条件，或者通过资产 ID 查找。"
              : "添加内部服务、导入现有台账，或到发现收件箱确认探针发现的资产。"
          }
          action={
            <Button variant="soft" onClick={() => startEdit()}>
              <Plus size={15} />
              添加第一项资产
            </Button>
          }
        />
      ) : view === "table" ? (
        <div className="infra-table-wrap">
          <table className="infra-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="选择当前页全部资产"
                    checked={allSelected}
                    onChange={() =>
                      setSelected(
                        allSelected ? [] : assets.map((asset) => asset.id),
                      )
                    }
                  />
                </th>
                <th>资产</th>
                <th>类型</th>
                <th>生命周期</th>
                <th>分类 / 标签</th>
                <th>费用 / 到期</th>
                <th>最近更新</th>
                <th>
                  <span className="sr-only">操作</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {displayAssets.map((asset, index) => (
                <Fragment key={asset.id}>
                  {!!groupBy &&
                    (index === 0 ||
                      groupValue(asset) !==
                        groupValue(displayAssets[index - 1])) && (
                      <tr className="infra-group-row">
                        <th colSpan={8} scope="rowgroup">
                          {groupValue(asset)}
                        </th>
                      </tr>
                    )}
                  <tr>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`选择 ${asset.name}`}
                        checked={selected.includes(asset.id)}
                        onChange={() => toggle(asset.id)}
                      />
                    </td>
                    <td>
                      <Link
                        className="infra-asset-name"
                        to={`/admin/assets/${asset.id}`}
                      >
                        {asset.name}
                      </Link>
                      <div className="infra-asset-type">
                        {asset.provider || asset.source || "手动维护"}
                      </div>
                    </td>
                    <td>
                      <span className="infra-inline">
                        {assetIcon(asset.kind, 14)}
                        {assetKindLabels[asset.kind] || asset.kind}
                      </span>
                    </td>
                    <td>
                      <Status value={asset.status} />
                    </td>
                    <td>
                      <div className="infra-muted">
                        {asset.category || "未分类"}
                      </div>
                      <Tags values={asset.tags} />
                    </td>
                    <td>
                      <div>
                        {asset.cost == null
                          ? "—"
                          : `${asset.currency || ""} ${asset.cost}`}
                      </div>
                      <div className="infra-asset-type">
                        {asset.expires_at
                          ? formatTime(asset.expires_at)
                          : "未设到期日"}
                      </div>
                    </td>
                    <td className="infra-muted">
                      {formatTime(asset.updated_at)}
                    </td>
                    <td>
                      <Button
                        size="1"
                        variant="ghost"
                        aria-label={`快速编辑 ${asset.name}`}
                        onClick={() => startEdit(asset)}
                      >
                        <Pencil size={14} />
                      </Button>
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="infra-grid">
          {displayAssets.map((asset, index) => (
            <Fragment key={asset.id}>
              {!!groupBy &&
                (index === 0 ||
                  groupValue(asset) !==
                    groupValue(displayAssets[index - 1])) && (
                  <h2 className="infra-group-heading">{groupValue(asset)}</h2>
                )}
              <article className="infra-asset-card">
                <div className="infra-asset-card-title">
                  <span className="infra-asset-icon">
                    {assetIcon(asset.kind)}
                  </span>
                  <div style={{ flex: 1 }}>
                    <Link
                      className="infra-asset-name"
                      to={`/admin/assets/${asset.id}`}
                    >
                      {asset.name}
                    </Link>
                    <div className="infra-asset-type">
                      {assetKindLabels[asset.kind] || asset.kind}
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    aria-label={`选择 ${asset.name}`}
                    checked={selected.includes(asset.id)}
                    onChange={() => toggle(asset.id)}
                  />
                </div>
                <Status value={asset.status} />
                <p className="infra-asset-description">
                  {asset.description || "尚未填写资产说明"}
                </p>
                <Tags values={asset.tags} />
                <div className="infra-asset-footer">
                  <span>{asset.category || "未分类"}</span>
                  <span>{asset.source || "手动维护"}</span>
                  <Button
                    size="1"
                    variant="ghost"
                    aria-label={`快速编辑 ${asset.name}`}
                    onClick={() => startEdit(asset)}
                  >
                    <Pencil size={13} />
                  </Button>
                </div>
              </article>
            </Fragment>
          ))}
        </div>
      )}
      {!!assets.length && (
        <Pagination
          total={resource.data?.total}
          offset={offset}
          limit={LIMIT}
          hasMore={resource.data?.has_more}
          onChange={(value) => filter("offset", String(value))}
        />
      )}
      <AssetEditor
        asset={editingAsset}
        open={editing}
        onClose={() => setEditing(false)}
        onSaved={reload}
      />
      <Dialog.Root
        open={tagging}
        onOpenChange={(value) => {
          if (!busy) setTagging(value);
        }}
      >
        <Dialog.Content maxWidth="520px">
          <Dialog.Title>批量设置标签</Dialog.Title>
          <Dialog.Description>
            将替换所选 {selected.length}{" "}
            项资产的完整标签列表；留空会清空这些资产的标签。
          </Dialog.Description>
          <form
            className="infra-form"
            onSubmit={(event) => {
              event.preventDefault();
              void applyTags();
            }}
          >
            <label className="infra-field">
              标签
              <input
                className="infra-input"
                aria-label="批量标签"
                value={bulkTags}
                maxLength={1000}
                onChange={(event) => setBulkTags(event.target.value)}
                placeholder="production, personal"
              />
            </label>
            <div className="infra-dialog-actions">
              <Button
                variant="soft"
                type="button"
                disabled={busy}
                onClick={() => setTagging(false)}
              >
                取消
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "保存中…" : "替换所选标签"}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Root>
      <ConfirmDialog
        open={confirmArchive}
        title="归档所选资产"
        description={`将归档以下 ${selectedRecords.length} 项资产：${selectedRecords.map((asset) => asset.name).join("、")}。历史变更与关联记录保留。`}
        pending={busy}
        confirmLabel="归档资产"
        onClose={() => setConfirmArchive(false)}
        onConfirm={() => void archive()}
      />
      <ConfirmDialog
        open={!!imported}
        title="确认导入台账"
        description={`文件中共 ${imported?.length || 0} 项资产。将按稳定标识匹配已有资产，导入结果由服务端校验。`}
        pending={busy}
        confirmLabel="开始导入"
        onClose={() => setImported(null)}
        onConfirm={() => void importAssets()}
      />
    </div>
  );
}
