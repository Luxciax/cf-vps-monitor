import { useState } from "react";
import { Link } from "react-router-dom";
import { Button, Dialog } from "@radix-ui/themes";
import { Link2, Plus, Unlink } from "lucide-react";
import { toast } from "sonner";
import { useApi } from "../contexts/AuthContext";
import { normalizeListResponse } from "../utils/api";
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Status,
  formatTime,
  useResource,
} from "./ui";

type MonitorLink = Record<string, unknown>;
const detail = (row: MonitorLink): MonitorLink =>
  row.monitor && typeof row.monitor === "object"
    ? { ...row, ...(row.monitor as MonitorLink) }
    : row;
export default function AssetMonitors({
  assetId,
  monitors,
  onChanged,
}: {
  assetId: string;
  monitors: MonitorLink[];
  onChanged: () => void;
}) {
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("website");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [unlink, setUnlink] = useState<MonitorLink | null>(null);
  const choices = useResource<unknown>(
    open ? (type === "website" ? "/admin/websites" : "/admin/ping") : null,
  );
  const options = normalizeListResponse<MonitorLink>(choices.data);
  async function update(action: "link" | "unlink", row?: MonitorLink) {
    const monitorType = row ? String(row.monitor_type || row.type) : type;
    const monitorId = row ? String(row.monitor_id || row.id) : target;
    if (!monitorId) return;
    setBusy(true);
    setError("");
    try {
      await api(`/admin/assets/${assetId}/monitors`, {
        method: "POST",
        body: JSON.stringify({
          monitor_type: monitorType,
          monitor_id: monitorId,
          ...(action === "unlink" ? { action: "unlink" } : {}),
        }),
      });
      toast.success(action === "link" ? "监控已关联" : "监控关联已解除");
      setOpen(false);
      setUnlink(null);
      onChanged();
    } catch (error) {
      const message = error instanceof Error ? error.message : "保存失败";
      setError(message);
      if (action === "unlink") toast.error(message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="infra-panel">
        <div className="infra-panel-heading">
          <h2>关联监控</h2>
          <Button
            size="1"
            variant="soft"
            onClick={() => {
              setOpen(true);
              setTarget("");
              setError("");
            }}
          >
            <Plus size={13} />
            关联
          </Button>
        </div>
        <div className="infra-panel-body">
          {!monitors.length ? (
            <EmptyState
              title="没有关联监控"
              description="一个资产可关联多个网站、Ping 或 VPS 监控。"
            />
          ) : (
            <div style={{ display: "grid", gap: 16 }}>
              {monitors.map((raw, index) => {
                const monitor = detail(raw);
                return (
                  <div
                    key={`${raw.monitor_type || raw.type}:${raw.monitor_id || raw.id || index}`}
                  >
                    <div
                      className="infra-inline"
                      style={{ justifyContent: "space-between" }}
                    >
                      <Link
                        className="infra-asset-name"
                        style={{ fontSize: 12 }}
                        to={
                          (raw.monitor_type || raw.type) === "client"
                            ? `/instance/${encodeURIComponent(String(raw.monitor_id || raw.id))}`
                            : (raw.monitor_type || raw.type) === "website"
                              ? `/admin/websites?monitor=${encodeURIComponent(String(raw.monitor_id || raw.id))}`
                              : "/admin/ping"
                        }
                      >
                        {String(monitor.name || `监控 ${index + 1}`)}
                      </Link>
                      <Status
                        value={
                          typeof monitor.status === "string"
                            ? monitor.status
                            : "unknown"
                        }
                      />
                    </div>
                    <div
                      className="infra-inline"
                      style={{ marginTop: 6, justifyContent: "space-between" }}
                    >
                      <span className="infra-muted">
                        {String(raw.monitor_type || raw.type || "monitor")} ·{" "}
                        {typeof monitor.last_latency_ms === "number"
                          ? `${monitor.last_latency_ms} ms`
                          : "暂无延迟数据"}
                      </span>
                      {(raw.monitor_type || raw.type) === "client" ? (
                        <span className="infra-muted">服务器固定绑定</span>
                      ) : (
                        <Button
                          variant="ghost"
                          color="gray"
                          size="1"
                          aria-label={`解除 ${String(monitor.name || "监控")} 的关联`}
                          onClick={() => setUnlink(raw)}
                        >
                          <Unlink size={12} />
                        </Button>
                      )}
                    </div>
                    {typeof monitor.last_checked_at === "string" && (
                      <div className="infra-muted">
                        {formatTime(monitor.last_checked_at)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <Link
            to="/admin/websites"
            className="infra-muted"
            style={{ display: "inline-block", marginTop: 16 }}
          >
            管理网站监控 →
          </Link>
        </div>
      </section>
      <Dialog.Root
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <Dialog.Content maxWidth="540px">
          <Dialog.Title>关联现有监控</Dialog.Title>
          <Dialog.Description>
            同一个资产可承载多个监控。已关联其他资产的监控将转移到当前资产。
          </Dialog.Description>
          <div className="infra-form">
            {error && <ErrorState error={error} />}
            <label className="infra-field">
              监控类型
              <select
                aria-label="监控类型"
                className="infra-select"
                value={type}
                onChange={(e) => {
                  setType(e.target.value);
                  setTarget("");
                }}
              >
                <option value="website">网站 / HTTP / DNS / WebSocket</option>
                <option value="ping">Ping 与网络质量</option>
              </select>
            </label>
            <label className="infra-field">
              监控任务
              <select
                aria-label="监控任务"
                className="infra-select"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">请选择已有监控</option>
                {options.map((item) => {
                  const key = String(item.uuid || item.id);
                  return (
                    <option key={key} value={key}>
                      {String(item.name || item.target || key)} · {key}
                    </option>
                  );
                })}
              </select>
            </label>
            {choices.error && (
              <ErrorState error={choices.error} retry={choices.reload} />
            )}
            <p className="infra-muted">
              网站与 Ping 可自由关联；VPS
              探针与台账保持固定绑定，重复台账通过资产合并处理。解除网站或 Ping
              关联不会删除监控历史。
            </p>
          </div>
          <div className="infra-dialog-actions">
            <Button
              variant="soft"
              color="gray"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              取消
            </Button>
            <Button
              disabled={busy || !target}
              onClick={() => void update("link")}
            >
              <Link2 size={14} />
              {busy ? "关联中…" : "确认关联"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Root>
      <ConfirmDialog
        open={!!unlink}
        title="解除监控关联"
        description="仅解除此资产与监控的关系。监控任务及其历史记录继续保留。"
        pending={busy}
        confirmLabel="解除关联"
        onClose={() => setUnlink(null)}
        onConfirm={() => void update("unlink", unlink || undefined)}
      />
    </>
  );
}
