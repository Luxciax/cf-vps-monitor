import { Button } from "@radix-ui/themes";
import { Boxes, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import type { Asset } from "./types";
import { useResource, type PageResult } from "./ui";

/** Resolve on detail views only; never request private assets for public visitors. */
export default function MonitorAssetLink({
  monitorType,
  monitorId,
}: {
  monitorType: "website" | "client" | "ping";
  monitorId: string | number;
}) {
  const { isAuthenticated } = useAuth();
  const query = new URLSearchParams(
    monitorType === "client"
      ? { client_id: String(monitorId) }
      : { monitor_type: monitorType, monitor_id: String(monitorId) },
  );
  const resource = useResource<PageResult<Asset>>(
    isAuthenticated ? `/admin/assets?${query}&limit=2` : null,
  );
  if (!isAuthenticated) return null;
  if (resource.error)
    return (
      <Button
        size="1"
        variant="soft"
        color="gray"
        onClick={resource.reload}
        title={resource.error}
      >
        <RefreshCw size={14} />
        重试读取关联资产
      </Button>
    );
  if (resource.loading && !resource.data)
    return (
      <span className="infra-muted" role="status">
        正在读取关联资产…
      </span>
    );
  const single =
    resource.data?.data.length === 1 ? resource.data.data[0] : null;
  return (
    <Button asChild variant="soft" size="1">
      <Link
        to={
          single
            ? `/admin/assets/${single.id}`
            : `/admin/infrastructure?${query}`
        }
      >
        <Boxes size={14} />
        {single ? "资产、配置与关系" : "打开关联资产台账"}
      </Link>
    </Button>
  );
}
