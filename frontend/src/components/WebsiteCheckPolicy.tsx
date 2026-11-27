import { useEffect, useState } from "react";
import { Button } from "@radix-ui/themes";
import { Plus, Trash2 } from "lucide-react";
import "../infrastructure/infrastructure.css";
import {
  toLocalDateTime as localDate,
  fromLocalDateTime as isoDate,
} from "../utils/localDateTime";

export type WebsiteCheckPolicyValue = {
  kind?: "http" | "tcp" | "dns" | "websocket";
  keyword?: string;
  keyword_absent?: boolean;
  json_path?: string;
  json_equals?: string | number | boolean | null;
  dns_type?: "A" | "AAAA" | "CNAME" | "MX" | "TXT" | "NS";
  dns_expected?: string[];
  tls_warning_days?: number;
  maintenance?: Array<{ start: string; end: string }>;
  silenced_until?: string;
};
export default function WebsiteCheckPolicy({
  value,
  method,
  onChange,
  onMethodChange,
  onValidChange,
}: {
  value: WebsiteCheckPolicyValue;
  method: "GET" | "HEAD" | "TCP";
  onChange: (value: WebsiteCheckPolicyValue) => void;
  onMethodChange: (method: "GET" | "HEAD" | "TCP") => void;
  onValidChange: (valid: boolean) => void;
}) {
  const kind = value.kind || (method === "TCP" ? "tcp" : "http");
  const [jsonText, setJsonText] = useState(() =>
    JSON.stringify(value.json_equals ?? null),
  );
  const [jsonValid, setJsonValid] = useState(true);
  useEffect(() => {
    setJsonText(JSON.stringify(value.json_equals ?? null));
    setJsonValid(true);
  }, [value.json_equals]);
  useEffect(() => {
    onValidChange(jsonValid);
  }, [jsonValid, onValidChange]);
  const update = (patch: Partial<WebsiteCheckPolicyValue>) => {
    const next = { ...value, ...patch };
    for (const key of Object.keys(next) as Array<keyof WebsiteCheckPolicyValue>)
      if (next[key] === undefined) delete next[key];
    onChange(next);
  };
  function changeKind(next: WebsiteCheckPolicyValue["kind"]) {
    onChange({
      kind: next,
      tls_warning_days: value.tls_warning_days,
      maintenance: value.maintenance,
      silenced_until: value.silenced_until,
    });
    onMethodChange(next === "tcp" ? "TCP" : "GET");
    setJsonText("null");
    setJsonValid(true);
  }
  const windows = value.maintenance || [];
  return (
    <section className="infra-panel" style={{ margin: "12px 0" }}>
      <div className="infra-panel-heading">
        <h2>检测内容与维护策略</h2>
      </div>
      <div className="infra-panel-body">
        <div className="infra-form" style={{ marginTop: 0 }}>
          <label className="infra-field">
            探测类型
            <select
              aria-label="探测类型"
              className="infra-select"
              value={kind}
              onChange={(e) =>
                changeKind(e.target.value as WebsiteCheckPolicyValue["kind"])
              }
            >
              <option value="http">HTTP / HTTPS</option>
              <option value="tcp">TCP 端口</option>
              <option value="dns">DNS 解析</option>
              <option value="websocket">WebSocket 握手</option>
            </select>
            <small>
              DNS 使用网址中的域名；WebSocket 可输入 https:// 或
              wss://。内容检查需要 HTTP GET。
            </small>
          </label>
          {kind === "http" && (
            <>
              <label className="infra-field">
                HTTP 关键词
                <input
                  aria-label="HTTP 关键词"
                  className="infra-input"
                  value={value.keyword || ""}
                  maxLength={512}
                  placeholder="留空则不检查响应正文"
                  onChange={(e) => {
                    update({
                      keyword: e.target.value || undefined,
                      keyword_absent: e.target.value
                        ? value.keyword_absent
                        : undefined,
                    });
                    if (e.target.value && method !== "GET")
                      onMethodChange("GET");
                  }}
                />
              </label>
              {value.keyword && (
                <label className="infra-inline" style={{ fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={!!value.keyword_absent}
                    onChange={(e) =>
                      update({ keyword_absent: e.target.checked })
                    }
                  />
                  关键词必须不存在
                </label>
              )}
              <div className="infra-form-grid">
                <label className="infra-field">
                  JSON 字段路径
                  <input
                    aria-label="JSON 字段路径"
                    className="infra-input"
                    value={value.json_path || ""}
                    placeholder="data.status"
                    onChange={(e) => {
                      update({
                        json_path: e.target.value || undefined,
                        json_equals: e.target.value
                          ? (value.json_equals ?? null)
                          : undefined,
                      });
                      if (e.target.value && method !== "GET")
                        onMethodChange("GET");
                    }}
                  />
                </label>
                <label className="infra-field">
                  JSON 期望值
                  <input
                    aria-label="JSON 期望值"
                    className="infra-input"
                    disabled={!value.json_path}
                    value={jsonText}
                    aria-invalid={!jsonValid}
                    placeholder={'"ok" 或 true'}
                    onChange={(e) => {
                      setJsonText(e.target.value);
                      try {
                        const parsed = JSON.parse(e.target.value);
                        if (
                          parsed !== null &&
                          !["string", "number", "boolean"].includes(
                            typeof parsed,
                          )
                        )
                          throw new Error();
                        setJsonValid(true);
                        update({ json_equals: parsed });
                      } catch {
                        setJsonValid(false);
                      }
                    }}
                  />
                  {!jsonValid && (
                    <small style={{ color: "var(--red-11)" }}>
                      请输入 JSON 字符串、数字、布尔值或 null。
                    </small>
                  )}
                </label>
              </div>
            </>
          )}
          {kind === "dns" && (
            <div className="infra-form-grid">
              <label className="infra-field">
                DNS 记录类型
                <select
                  aria-label="DNS 记录类型"
                  className="infra-select"
                  value={value.dns_type || "A"}
                  onChange={(e) =>
                    update({
                      dns_type: e.target
                        .value as WebsiteCheckPolicyValue["dns_type"],
                    })
                  }
                >
                  {["A", "AAAA", "CNAME", "MX", "TXT", "NS"].map((type) => (
                    <option key={type}>{type}</option>
                  ))}
                </select>
              </label>
              <label className="infra-field">
                期望记录
                <input
                  aria-label="期望记录"
                  className="infra-input"
                  value={value.dns_expected?.join(", ") || ""}
                  placeholder="逗号分隔，留空检查存在可用结果"
                  onChange={(e) =>
                    update({
                      dns_expected: e.target.value
                        .split(",")
                        .map((item) => item.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </label>
            </div>
          )}
          <label className="infra-field">
            TLS 到期预警（天）
            <input
              aria-label="TLS 到期预警（天）"
              className="infra-input"
              type="number"
              min={0}
              max={90}
              value={value.tls_warning_days ?? 14}
              onChange={(e) =>
                update({ tls_warning_days: Number(e.target.value) })
              }
            />
            <small>
              证书有效期来自支持 TLS 采集的 VPS 探针。仅 Worker
              采集时期限显示未知。
            </small>
          </label>
          <div
            className="infra-inline"
            style={{ justifyContent: "space-between" }}
          >
            <h3 style={{ margin: 0 }}>计划维护窗口</h3>
            <Button
              type="button"
              variant="soft"
              size="1"
              disabled={windows.length >= 32}
              onClick={() =>
                update({
                  maintenance: [
                    ...windows,
                    {
                      start: new Date().toISOString(),
                      end: new Date(Date.now() + 3600000).toISOString(),
                    },
                  ],
                })
              }
            >
              <Plus size={13} />
              添加
            </Button>
          </div>
          <p className="infra-muted" style={{ margin: 0 }}>
            维护期间暂停检测与告警，并从 SLA
            的统计区间中排除。时间按当前浏览器时区输入。
          </p>
          {windows.map((window, index) => (
            <div className="infra-inline" key={index}>
              <label className="infra-field" style={{ flex: 1 }}>
                开始
                <input
                  aria-label="开始"
                  className="infra-input"
                  type="datetime-local"
                  required
                  value={localDate(window.start)}
                  onChange={(e) =>
                    update({
                      maintenance: windows.map((item, i) =>
                        i === index
                          ? { ...item, start: isoDate(e.target.value) }
                          : item,
                      ),
                    })
                  }
                />
              </label>
              <label className="infra-field" style={{ flex: 1 }}>
                结束
                <input
                  aria-label="结束"
                  className="infra-input"
                  type="datetime-local"
                  required
                  value={localDate(window.end)}
                  onChange={(e) =>
                    update({
                      maintenance: windows.map((item, i) =>
                        i === index
                          ? { ...item, end: isoDate(e.target.value) }
                          : item,
                      ),
                    })
                  }
                />
              </label>
              <Button
                type="button"
                color="red"
                variant="ghost"
                aria-label={`删除维护窗口 ${index + 1}`}
                onClick={() =>
                  update({ maintenance: windows.filter((_, i) => i !== index) })
                }
              >
                <Trash2 size={14} />
              </Button>
            </div>
          ))}
          <label className="infra-field">
            静默告警至
            <input
              aria-label="静默告警至"
              className="infra-input"
              type="datetime-local"
              value={localDate(value.silenced_until)}
              onChange={(e) =>
                update({
                  silenced_until: e.target.value
                    ? isoDate(e.target.value)
                    : undefined,
                })
              }
            />
            <small>静默保留检测与统计，仅抑制通知。</small>
          </label>
        </div>
      </div>
    </section>
  );
}
