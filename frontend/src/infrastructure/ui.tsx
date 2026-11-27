import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Inbox,
  RefreshCw,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Button, Dialog, Text } from "@radix-ui/themes";
import { useApi } from "../contexts/AuthContext";
import "./infrastructure.css";

export type PageResult<T> = {
  data: T[];
  total: number;
  limit: number;
  offset: number;
  has_more?: boolean;
};

export function useResource<T>(path: string | null) {
  const api = useApi();
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    path: string | null;
    data: T | null;
    loading: boolean;
    error: string | null;
  }>({ path, data: null, loading: Boolean(path), error: null });
  useEffect(() => {
    if (!path) {
      setState({ path, data: null, loading: false, error: null });
      return;
    }
    const controller = new AbortController();
    setState((current) => ({
      path,
      data: current.path === path ? current.data : null,
      loading: true,
      error: null,
    }));
    api(path, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted)
          setState({ path, data: data as T, loading: false, error: null });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState((current) => ({
            ...current,
            loading: false,
            error: error instanceof Error ? error.message : "请求失败",
          }));
      });
    return () => controller.abort();
  }, [api, path, revision]);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  return {
    data: state.path === path ? state.data : null,
    loading: state.path !== path ? Boolean(path) : state.loading,
    error: state.path === path ? state.error : null,
    reload,
  };
}

export function PageHeader({
  eyebrow = "基础设施",
  title,
  description,
  actions,
  back,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
  back?: string;
}) {
  return (
    <header className="infra-page-header">
      <div>
        {back && (
          <Link className="infra-back" to={back}>
            <ArrowLeft size={14} />
            返回
          </Link>
        )}
        <span className="infra-eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="infra-actions">{actions}</div>}
    </header>
  );
}

export function LoadingState({
  label = "正在读取最新数据",
}: {
  label?: string;
}) {
  return (
    <div className="infra-loading" role="status" aria-label={label}>
      <div className="infra-skeleton" />
      <div className="infra-skeleton" />
      <div className="infra-skeleton" />
      <span>{label}…</span>
    </div>
  );
}

export function ErrorState({
  error,
  retry,
}: {
  error: string;
  retry?: () => void;
}) {
  return (
    <div className="infra-error" role="alert">
      <AlertTriangle size={20} />
      <div>
        <strong>请求未完成</strong>
        <p>{error}</p>
      </div>
      {retry && (
        <Button variant="soft" onClick={retry}>
          <RefreshCw size={14} />
          重试
        </Button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="infra-empty">
      <Inbox size={28} aria-hidden="true" />
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

const statusLabels: Record<string, string> = {
  ok: "正常",
  healthy: "健康",
  unhealthy: "不健康",
  running: "运行中",
  stopped: "已停止",
  exited: "已退出",
  starting: "启动中",
  inferred: "推断",
  success: "采集成功",
  error: "采集失败",
  disabled: "未启用",
  unavailable: "不可用",
  active: "使用中",
  archived: "已归档",
  planned: "规划中",
  retired: "已退役",
  online: "在线",
  offline: "离线",
  up: "正常",
  down: "故障",
  pending: "待确认",
  imported: "已导入",
  merged: "已合并",
  ignored: "已忽略",
  missing: "缺失",
  unknown: "未知",
  stale: "已过期",
  compliant: "符合",
  drift: "偏差",
  drifted: "偏差",
  deviation: "偏差",
  reported: "外部报告",
  non_compliant: "偏差",
  exception: "例外",
  observed: "探针观测",
  claimed: "外部报告",
  external_claim: "外部报告",
  manual: "手动维护",
  complete: "采集完成",
  partial: "部分可用",
  failed: "采集失败",
  unsupported: "不支持",
  permission_denied: "权限不足",
  revoked: "已吊销",
  expired: "已过期",
  low: "低",
  medium: "中",
  high: "高",
  critical: "严重",
};
export function Status({ value }: { value?: string | null }) {
  const status = value || "unknown";
  const tone = [
    "ok",
    "healthy",
    "running",
    "success",
    "active",
    "online",
    "up",
    "compliant",
    "complete",
    "observed",
  ].includes(status)
    ? "good"
    : [
          "error",
          "unhealthy",
          "down",
          "drift",
          "drifted",
          "deviation",
          "failed",
          "non_compliant",
          "high",
          "critical",
        ].includes(status)
      ? "bad"
      : [
            "pending",
            "partial",
            "missing",
            "stale",
            "expired",
            "claimed",
            "external_claim",
            "medium",
          ].includes(status)
        ? "warn"
        : "neutral";
  return (
    <span className={`infra-status is-${tone}`}>
      <span aria-hidden="true" />
      {statusLabels[status] || status}
    </span>
  );
}

export function Tags({ values = [] }: { values?: string[] }) {
  return (
    <span className="infra-tags">
      {values.map((value) => (
        <span key={value}>{value}</span>
      ))}
    </span>
  );
}

export function Pagination({
  total,
  offset,
  limit,
  onChange,
  hasMore,
}: {
  total?: number;
  offset: number;
  limit: number;
  hasMore?: boolean;
  onChange: (offset: number) => void;
}) {
  return (
    <div className="infra-pagination">
      <Text size="2" color="gray">
        {typeof total === "number" ? `共 ${total} 项 · ` : ""}第{" "}
        {Math.floor(offset / limit) + 1} 页
      </Text>
      <div>
        <Button
          variant="soft"
          aria-label="上一页"
          disabled={offset === 0}
          onClick={() => onChange(Math.max(0, offset - limit))}
        >
          <ChevronLeft size={16} />
        </Button>
        <Button
          variant="soft"
          aria-label="下一页"
          disabled={
            hasMore === false ||
            (typeof total === "number" && offset + limit >= total)
          }
          onClick={() => onChange(offset + limit)}
        >
          <ChevronRight size={16} />
        </Button>
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  pending,
  confirmLabel = "确认",
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  pending: boolean;
  confirmLabel?: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!value && !pending) onClose();
      }}
    >
      <Dialog.Content maxWidth="460px">
        <Dialog.Title>{title}</Dialog.Title>
        <Dialog.Description>{description}</Dialog.Description>
        <div className="infra-dialog-actions">
          <Button
            variant="soft"
            color="gray"
            disabled={pending}
            onClick={onClose}
          >
            取消
          </Button>
          <Button disabled={pending} onClick={onConfirm}>
            {pending ? "提交中…" : confirmLabel}
          </Button>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}

export function formatTime(value?: string | null) {
  if (!value) return "暂无记录";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
}

export function downloadFile(
  name: string,
  text: string,
  type = "application/json",
) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function JsonView({
  value,
  label = "结构化数据",
}: {
  value: unknown;
  label?: string;
}) {
  return (
    <pre className="infra-json" tabIndex={0} aria-label={label}>
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
