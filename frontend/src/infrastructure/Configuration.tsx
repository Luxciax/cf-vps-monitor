import { useState } from "react";
import StructuredFacts, { fieldLabels as labels } from "./StructuredFacts";
import { Info } from "lucide-react";
import type { Snapshot } from "./types";
import { EmptyState, JsonView, Status, formatTime } from "./ui";

export default function Configuration({
  snapshots,
}: {
  snapshots: Snapshot[];
}) {
  const [selected, setSelected] = useState("");
  const snapshot =
    snapshots.find((item) => item.id === selected) || snapshots[0];
  if (!snapshot)
    return (
      <EmptyState
        title="尚未收到配置快照"
        description="启用探针的固定只读采集，或由外部 Harness 提交经过脱敏的结构化配置。未采集的项目保持未知。"
      />
    );
  const previousSnapshot =
    snapshots[snapshots.findIndex((item) => item.id === snapshot.id) + 1];
  const stale = Date.now() - Date.parse(snapshot.collected_at) > 24 * 3600000;
  const entries = Object.entries(snapshot.data || {});
  return (
    <>
      <div className="infra-toolbar">
        <select
          className="infra-select"
          aria-label="选择配置快照"
          style={{ width: "auto", maxWidth: "100%" }}
          value={snapshot.id}
          onChange={(e) => setSelected(e.target.value)}
        >
          {snapshots.map((item) => (
            <option key={item.id} value={item.id}>
              {formatTime(item.collected_at)} · {item.source}
            </option>
          ))}
        </select>
        <Status value={snapshot.confidence} />
        {stale && <Status value="stale" />}
      </div>
      <div className="infra-notice">
        <Info size={17} />
        <span>
          来源：{snapshot.source} · 采集：{formatTime(snapshot.collected_at)} ·
          适用环境：{snapshot.environment || "未知"}
          。配置展示不会触发服务器操作。
        </span>
      </div>
      {!!snapshot.collectors?.length && (
        <div className="infra-panel">
          <div className="infra-panel-heading">
            <h2>采集能力</h2>
          </div>
          <div className="infra-panel-body">
            <div className="infra-grid">
              {snapshot.collectors.map((collector) => (
                <div key={collector.name}>
                  <div className="infra-inline">
                    <strong style={{ fontSize: 12 }}>{collector.name}</strong>
                    <Status value={collector.status} />
                  </div>
                  {collector.reason && (
                    <p className="infra-muted">{collector.reason}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      <div className="infra-grid" style={{ alignItems: "start" }}>
        {entries.map(([key, value]) => (
          <section className="infra-panel" key={key}>
            <div className="infra-panel-heading">
              <h2>{labels[key] || key.replace(/_/g, " ")}</h2>
            </div>
            <div className="infra-panel-body" style={{ fontSize: 12 }}>
              <StructuredFacts value={value} />
            </div>
          </section>
        ))}
      </div>
      {!entries.length && (
        <EmptyState
          title="快照未包含配置值"
          description="请查看采集能力与错误原因；未获得的数据不会被推断为正常。"
        />
      )}
      {previousSnapshot && (
        <details className="infra-panel">
          <summary
            className="infra-panel-heading"
            style={{ cursor: "pointer" }}
          >
            与上一个快照对照
          </summary>
          <div className="infra-panel-body infra-diff">
            <div>
              <span>当前快照</span>
              <JsonView value={snapshot.data} />
            </div>
            <div>
              <span>上一快照</span>
              <JsonView value={previousSnapshot.data} />
            </div>
          </div>
        </details>
      )}
    </>
  );
}
