import { useEffect, useState, type FormEvent } from "react";
import { Button, Dialog } from "@radix-ui/themes";
import { toast } from "sonner";
import { useApi } from "../contexts/AuthContext";
import { assetKinds, assetKindLabels, type Asset } from "./types";
import { ErrorState } from "./ui";
import { fromLocalDateTime, toLocalDateTime } from "../utils/localDateTime";

const emptyDraft = {
  name: "",
  kind: "website",
  status: "active",
  category: "",
  description: "",
  tags: "",
  url: "",
  external_id: "",
  provider: "",
  cost: "",
  currency: "USD",
  billing_cycle: "monthly",
  expires_at: "",
};
type Draft = typeof emptyDraft;

export function AssetEditor({
  asset,
  open,
  onClose,
  onSaved,
}: {
  asset?: Asset;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const api = useApi();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (open) {
      setDraft(
        asset
          ? {
              name: asset.name,
              kind: asset.kind,
              status: asset.status,
              category: asset.category || "",
              description: asset.description || "",
              tags: (asset.tags || []).join(", "),
              url: asset.url || "",
              external_id: asset.external_id || "",
              provider: asset.provider || "",
              cost: asset.cost == null ? "" : String(asset.cost),
              currency: asset.currency || "USD",
              billing_cycle: String(asset.billing_cycle || "monthly"),
              expires_at: toLocalDateTime(asset.expires_at),
            }
          : emptyDraft,
      );
      setError("");
    }
  }, [asset, open]);
  const update = (key: keyof Draft, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));
  async function save(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const { external_id, ...values } = draft;
      const payload = {
        ...values,
        ...(!asset || asset.source === "manual" ? { external_id } : {}),
        tags: draft.tags
          .split(/[,，]/)
          .map((x) => x.trim())
          .filter(Boolean),
        cost: draft.cost === "" ? null : Number(draft.cost),
        expires_at:
          asset && draft.expires_at === toLocalDateTime(asset.expires_at)
            ? asset.expires_at || null
            : fromLocalDateTime(draft.expires_at) || null,
      };
      await api(asset ? `/admin/assets/${asset.id}` : "/admin/assets", {
        method: asset ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      toast.success(asset ? "资产已更新" : "资产已创建");
      onSaved();
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : "保存失败");
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!value && !pending) onClose();
      }}
    >
      <Dialog.Content maxWidth="660px">
        <Dialog.Title>{asset ? "编辑资产" : "添加资产"}</Dialog.Title>
        <Dialog.Description>
          资产可独立存在，监控任务通过关联接入。
        </Dialog.Description>
        <form onSubmit={save} className="infra-form">
          {error && <ErrorState error={error} />}
          <div className="infra-form-grid">
            <label className="infra-field">
              名称
              <input
                aria-label="名称"
                className="infra-input"
                value={draft.name}
                maxLength={200}
                required
                onChange={(e) => update("name", e.target.value)}
              />
            </label>
            <label className="infra-field">
              类型
              <select
                aria-label="类型"
                className="infra-select"
                value={draft.kind}
                disabled={Boolean(asset?.client_id)}
                onChange={(e) => update("kind", e.target.value)}
              >
                {assetKinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {assetKindLabels[kind]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="infra-form-grid">
            <label className="infra-field">
              生命周期
              <select
                aria-label="生命周期"
                className="infra-select"
                value={draft.status}
                onChange={(e) => update("status", e.target.value)}
              >
                <option value="active">使用中</option>
                <option value="planned">规划中</option>
                <option value="archived">已归档</option>
              </select>
            </label>
            <label className="infra-field">
              分类
              <input
                aria-label="分类"
                className="infra-input"
                value={draft.category}
                maxLength={100}
                onChange={(e) => update("category", e.target.value)}
              />
            </label>
          </div>
          <label className="infra-field">
            地址
            <input
              aria-label="地址"
              className="infra-input"
              value={draft.url}
              maxLength={2000}
              placeholder="https://、tcp://、dns:// 或内部服务地址"
              onChange={(e) => update("url", e.target.value)}
            />
            <small>
              资产地址仅供管理后台使用；公开展示仍遵循网站监控可见性设置。
            </small>
          </label>
          <label className="infra-field">
            外部稳定标识
            <input
              className="infra-input"
              aria-label="外部稳定标识"
              value={draft.external_id}
              readOnly={!!asset && asset.source !== "manual"}
              maxLength={240}
              onChange={(event) => update("external_id", event.target.value)}
              placeholder="可选，例如 personal:knowledge:production"
            />
            <small>
              {asset && asset.source !== "manual"
                ? "此标识由采集来源维护，不能在编辑资产时改写。"
                : "用于与外部台账匹配；同一来源中的标识保持唯一。"}
            </small>
          </label>
          <label className="infra-field">
            标签
            <input
              aria-label="标签"
              className="infra-input"
              value={draft.tags}
              maxLength={1000}
              placeholder="production, personal"
              onChange={(e) => update("tags", e.target.value)}
            />
          </label>
          <label className="infra-field">
            说明
            <textarea
              aria-label="说明"
              className="infra-textarea"
              value={draft.description}
              maxLength={4000}
              onChange={(e) => update("description", e.target.value)}
            />
          </label>
          <div className="infra-form-grid">
            <label className="infra-field">
              服务商
              <input
                aria-label="服务商"
                className="infra-input"
                value={draft.provider}
                onChange={(e) => update("provider", e.target.value)}
              />
            </label>
            <label className="infra-field">
              到期时间（本地）
              <input
                aria-label="到期时间（本地）"
                className="infra-input"
                type="datetime-local"
                value={draft.expires_at}
                onChange={(e) => update("expires_at", e.target.value)}
              />
            </label>
          </div>
          <div className="infra-form-grid">
            <label className="infra-field">
              费用
              <input
                aria-label="费用"
                className="infra-input"
                type="number"
                min="0"
                step="0.01"
                value={draft.cost}
                onChange={(e) => update("cost", e.target.value)}
              />
            </label>
            <label className="infra-field">
              币种
              <input
                aria-label="币种"
                className="infra-input"
                value={draft.currency}
                maxLength={8}
                onChange={(e) =>
                  update("currency", e.target.value.toUpperCase())
                }
              />
            </label>
          </div>
          <label className="infra-field">
            计费周期
            <select
              aria-label="计费周期"
              className="infra-select"
              value={draft.billing_cycle}
              onChange={(e) => update("billing_cycle", e.target.value)}
            >
              {![
                "monthly",
                "quarterly",
                "yearly",
                "one_time",
                "other",
              ].includes(draft.billing_cycle) && (
                <option value={draft.billing_cycle}>
                  原有周期：{draft.billing_cycle}
                </option>
              )}
              <option value="monthly">每月</option>
              <option value="quarterly">每季度</option>
              <option value="yearly">每年</option>
              <option value="one_time">一次性</option>
              <option value="other">其他</option>
            </select>
          </label>
          <div className="infra-dialog-actions">
            <Button
              type="button"
              variant="soft"
              color="gray"
              disabled={pending}
              onClick={onClose}
            >
              取消
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "保存中…" : "保存资产"}
            </Button>
          </div>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  );
}
