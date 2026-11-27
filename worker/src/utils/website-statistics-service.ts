import type { AppDatabase } from "../db/provider";
import type { WebsiteMonitor } from "../db/types";
import { callSupabaseRpc } from "../db/supabase-api/client";
import {
  analyzeWebsiteChecks,
  type StatisticsCheck,
} from "./website-statistics";
export async function websiteStatistics(
  database: AppDatabase,
  monitor: WebsiteMonitor,
  since: string,
  until: string,
  source = "worker",
) {
  const checks = await callSupabaseRpc<StatisticsCheck[]>(
    database.env,
    "cfm_website_statistics_checks",
    {
      input_monitor_id: monitor.id,
      input_since: since,
      input_until: until,
      input_source_client: source === "worker" ? null : source,
    },
  );
  return {
    ...analyzeWebsiteChecks(checks.slice(0, 10000), {
      since,
      until,
      intervalSec: monitor.interval_sec,
      maintenance: monitor.check_config?.maintenance,
      source,
    }),
    sample_limit: 10000,
    limited: checks.length > 10000,
  };
}
