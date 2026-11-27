import { useState, type FormEvent } from "react";
import { Button, Dialog } from "@radix-ui/themes";
import {
  Copy,
  KeyRound,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useApi } from "../../../contexts/AuthContext";
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  JsonView,
  LoadingState,
  PageHeader,
  Status,
  Tags,
  formatTime,
  useResource,
} from "../../../infrastructure/ui";

type Token = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
  last_used_at: string | null;
};
type TokenList = {
  tokens: Token[];
  scopes: string[];
  legacy_env_token_configured: boolean;
};
const contextScopes = [
  "assets:read",
  "monitors:read",
  "config:read",
  "knowledge:read",
  "changes:read",
  "baselines:read",
];
const scopeDescription: Record<string, string> = {
  read: "全部常规只读权限",
  write: "全部常规写入权限",
  backup: "导出备份",
  restore: "恢复备份",
  "assets:read": "查询资产、关系与上下文",
  "assets:write": "维护资产与关系",
  "discovery:read": "查看发现候选和运行",
  "discovery:write": "提交发现并处理候选",
  "config:read": "读取配置快照",
  "config:write": "提交配置报告",
  "knowledge:read": "搜索和读取文档",
  "knowledge:write": "维护版本化文档",
  "changes:read": "读取变更历史",
  "changes:write": "回写外部运维报告",
  "baselines:read": "读取基线",
  "baselines:write": "维护与检测基线",
  "monitors:read": "读取监控信息",
  "monitors:write": "配置监控任务",
  "settings:read": "读取系统设置",
  "settings:write": "修改系统设置",
  "audit:read": "读取审计记录",
};

export default function ApiAccess() {
  const resource = useResource<TokenList>("/admin/account/machine-tokens");
  const api = useApi();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(contextScopes);
  const [expires, setExpires] = useState(() =>
    new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [secret, setSecret] = useState("");
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<Token | null>(null);
  const [rotating, setRotating] = useState<Token | null>(null);
  const status = (token: Token) =>
    token.revoked_at
      ? "revoked"
      : token.expires_at && Date.parse(token.expires_at) < Date.now()
        ? "expired"
        : "active";
  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api("/admin/account/machine-tokens", {
        method: "POST",
        body: JSON.stringify({
          name,
          scopes,
          expires_at: expires
            ? new Date(`${expires}T23:59:59Z`).toISOString()
            : null,
        }),
      });
      if (typeof result.token !== "string" || !result.token)
        throw new Error("未收到新 Token，请刷新列表核对后重试");
      setCreating(false);
      setSecret(result.token);
      setCopied(false);
      setName("");
      resource.reload();
    } catch (error) {
      setError(error instanceof Error ? error.message : "创建失败");
    } finally {
      setBusy(false);
    }
  }
  async function revoke() {
    if (!revoking) return;
    setBusy(true);
    try {
      await api(`/admin/account/machine-tokens/${revoking.id}/revoke`, {
        method: "POST",
      });
      toast.success("Token 已吊销");
      setRevoking(null);
      resource.reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "吊销失败");
    } finally {
      setBusy(false);
    }
  }
  async function rotate() {
    if (!rotating) return;
    setBusy(true);
    try {
      const result = await api(
        `/admin/account/machine-tokens/${rotating.id}/rotate`,
        { method: "POST" },
      );
      if (typeof result.token !== "string" || !result.token)
        throw new Error("未收到新凭据，请核对 Token 状态");
      setRotating(null);
      setSecret(result.token);
      setCopied(false);
      resource.reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "轮换失败");
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      toast.success("Token 已复制");
    } catch {
      toast.error("无法访问剪贴板，请手动复制");
    }
  }
  const origin = window.location.origin;
  return (
    <div className="infra-page">
      <PageHeader
        title="AI 与 API 访问"
        description="为每个外部工具分配独立身份、明确的权限和有效期。资产上下文复用同一套 API。"
        actions={
          <>
            <Button
              variant="soft"
              onClick={resource.reload}
              aria-label="刷新 Token"
            >
              <RefreshCw size={15} />
            </Button>
            <Button
              disabled={!resource.data}
              onClick={() => {
                setCreating(true);
                setError("");
                setScopes(contextScopes);
              }}
            >
              <Plus size={15} />
              创建 Token
            </Button>
          </>
        }
      />
      <div className="infra-notice">
        <ShieldCheck size={17} />
        <span>
          Machine Token 无权修改管理员账户、密码、MFA
          或发放凭据。备份与恢复是独立权限；所有资产、文档与发现内容均作为不可信数据提供。
        </span>
      </div>
      {resource.error && (
        <ErrorState error={resource.error} retry={resource.reload} />
      )}{" "}
      {resource.data?.legacy_env_token_configured && (
        <p className="infra-muted" style={{ marginBottom: 18 }}>
          部署环境中仍配置了旧版
          ADMIN_API_TOKEN。该凭据的权限与轮换由部署配置管理。
        </p>
      )}
      {resource.loading && !resource.data ? (
        <LoadingState />
      ) : resource.error && !resource.data ? null : !resource.data?.tokens
          .length ? (
        <EmptyState
          title="还没有独立 Machine Token"
          description="按工具分别创建 Token，便于追踪使用、限制访问和单独吊销。"
          action={
            <Button disabled={!resource.data} onClick={() => setCreating(true)}>
              <KeyRound size={15} />
              创建第一个 Token
            </Button>
          }
        />
      ) : (
        <div className="infra-table-wrap">
          <table className="infra-table">
            <thead>
              <tr>
                <th>名称 / 前缀</th>
                <th>权限</th>
                <th>状态</th>
                <th>有效期</th>
                <th>最近使用</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {resource.data.tokens.map((token) => (
                <tr key={token.id}>
                  <td>
                    <strong>{token.name}</strong>
                    <div className="infra-muted">
                      <code>{token.prefix}…</code>
                    </div>
                  </td>
                  <td style={{ maxWidth: 310 }}>
                    <Tags values={token.scopes} />
                  </td>
                  <td>
                    <Status value={status(token)} />
                  </td>
                  <td>
                    {token.expires_at
                      ? formatTime(token.expires_at)
                      : "无到期时间"}
                  </td>
                  <td>{formatTime(token.last_used_at)}</td>
                  <td>
                    <Button
                      size="1"
                      variant="ghost"
                      disabled={status(token) !== "active"}
                      onClick={() => setRotating(token)}
                    >
                      <RefreshCw size={13} />
                      轮换
                    </Button>
                    <Button
                      size="1"
                      color="red"
                      variant="ghost"
                      disabled={!!token.revoked_at}
                      onClick={() => setRevoking(token)}
                    >
                      <Trash2 size={13} />
                      吊销
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="infra-grid" style={{ marginTop: 24 }}>
        <section className="infra-panel">
          <div className="infra-panel-heading">
            <h2>Machine API / CLI</h2>
          </div>
          <div className="infra-panel-body">
            <p className="infra-muted">
              在独立环境中配置 CFVM_URL 和
              CFVM_TOKEN，再从能力发现读取可用接口。不要把 Token 放在 URL 中。
            </p>
            <JsonView
              value={{
                base_url: `${origin}/api/v1`,
                capabilities: "/api/v1/capabilities",
                openapi: "/api/v1/openapi.json",
                authorization: "Bearer <CFVM_TOKEN>",
              }}
            />
            <pre className="infra-json" style={{ marginTop: 12 }}>
              {
                "npm run cfvm -- discover\nnpm run cfvm -- request GET /assets\nnpm run cfvm -- request GET /assets/<asset-id>/context?limit=10"
              }
            </pre>
          </div>
        </section>
        <section className="infra-panel">
          <div className="infra-panel-heading">
            <h2>MCP Server</h2>
          </div>
          <div className="infra-panel-body">
            <p className="infra-muted">
              使用仓库中的 stdio MCP 服务；与 Machine API 共用身份和
              Scope。默认只读，可显式启用结构化回写。
            </p>
            <JsonView
              value={{
                mcpServers: {
                  cvm: {
                    command: "node",
                    args: ["/absolute/path/cf-vps-monitor/scripts/cvm-mcp.mjs"],
                    env: {
                      CFVM_URL: origin,
                      CFVM_TOKEN: "<独立的 Machine Token>",
                    },
                  },
                },
              }}
            />
            <p className="infra-muted">
              MCP 仅提供查询与受限数据回写，不提供 SSH、Shell、Docker Exec
              或远程文件操作。
            </p>
          </div>
        </section>
      </div>
      <Dialog.Root
        open={creating}
        onOpenChange={(open) => {
          if (!busy) setCreating(open);
        }}
      >
        <Dialog.Content maxWidth="720px">
          <Dialog.Title>创建 Machine Token</Dialog.Title>
          <Dialog.Description>
            每个工具使用独立 Token，按实际任务选择权限。
          </Dialog.Description>
          <form className="infra-form" onSubmit={create}>
            {error && <ErrorState error={error} />}
            <div className="infra-form-grid">
              <label className="infra-field">
                名称
                <input
                  aria-label="名称"
                  className="infra-input"
                  required
                  maxLength={80}
                  value={name}
                  placeholder="例如 Codex — 只读上下文"
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label className="infra-field">
                到期日期
                <input
                  aria-label="到期日期"
                  className="infra-input"
                  type="date"
                  value={expires}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setExpires(e.target.value)}
                />
                <small>默认 90 天；留空表示无到期时间。</small>
              </label>
            </div>
            <div className="infra-inline">
              <span className="infra-muted">权限预设</span>
              <Button
                type="button"
                size="1"
                variant="soft"
                onClick={() => setScopes(contextScopes)}
              >
                读取上下文
              </Button>
              <Button
                type="button"
                size="1"
                variant="soft"
                onClick={() => setScopes(["discovery:read", "discovery:write"])}
              >
                发现同步
              </Button>
              <Button
                type="button"
                size="1"
                variant="soft"
                onClick={() =>
                  setScopes(["assets:read", "changes:read", "changes:write"])
                }
              >
                运维报告
              </Button>
            </div>
            <div className="infra-scope-list">
              {resource.data?.scopes.map((scope) => (
                <label key={scope}>
                  <input
                    type="checkbox"
                    checked={scopes.includes(scope)}
                    onChange={() =>
                      setScopes((current) =>
                        current.includes(scope)
                          ? current.filter((item) => item !== scope)
                          : [...current, scope],
                      )
                    }
                  />
                  <span>
                    <code>{scope}</code>
                    <small
                      style={{
                        display: "block",
                        color: "var(--gray-11)",
                        marginTop: 5,
                      }}
                    >
                      {scopeDescription[scope] || scope}
                    </small>
                  </span>
                </label>
              ))}
            </div>
            <div className="infra-dialog-actions">
              <Button
                type="button"
                variant="soft"
                color="gray"
                disabled={busy}
                onClick={() => setCreating(false)}
              >
                取消
              </Button>
              <Button type="submit" disabled={busy || !scopes.length}>
                {busy ? "创建中…" : "创建 Token"}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Root>
      <Dialog.Root
        open={!!secret}
        onOpenChange={(open) => {
          if (!open) {
            setSecret("");
            setCopied(false);
          }
        }}
      >
        <Dialog.Content maxWidth="650px">
          <Dialog.Title>保存新 Token</Dialog.Title>
          <Dialog.Description>
            完整凭据只显示这一次，关闭后仅保留哈希与前缀。请保存到外部工具的安全凭据配置。
          </Dialog.Description>
          <textarea
            className="infra-textarea"
            readOnly
            spellCheck={false}
            aria-label="新建的 Machine Token"
            value={secret}
            style={{
              marginTop: 20,
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              minHeight: 80,
            }}
          />
          <div className="infra-dialog-actions">
            <Button variant="soft" onClick={() => void copy()}>
              <Copy size={14} />
              {copied ? "已复制" : "复制 Token"}
            </Button>
            <Dialog.Close>
              <Button>已保存，关闭</Button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Root>
      <ConfirmDialog
        open={!!rotating}
        title="轮换 Machine Token"
        description={`将替换“${rotating?.name}”的访问凭据。旧凭据立即失效，身份、权限、有效期与发现来源保持不变。`}
        pending={busy}
        confirmLabel="轮换凭据"
        onClose={() => setRotating(null)}
        onConfirm={() => void rotate()}
      />
      <ConfirmDialog
        open={!!revoking}
        title="吊销 Machine Token"
        description={`将立即停用“${revoking?.name}”（${revoking?.prefix}…）。使用此身份的外部工具后续请求将被拒绝。`}
        pending={busy}
        confirmLabel="吊销此 Token"
        onClose={() => setRevoking(null)}
        onConfirm={() => void revoke()}
      />
    </div>
  );
}
