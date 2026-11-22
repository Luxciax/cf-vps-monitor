import type { AuditLogsPage, BoundedTableRowCounts, ClearAllRecordsResult, Client, ClientCapacityCounts, ClientIdentity, ClientReferenceCleanupResult, ClientTokenMeta, ClientVisibility, DeleteClientsResult, DeleteOldRowsOptions, ExpiryNotification, ExpiryNotificationUpdate, GPUHistoryRecord, GPUInfo, HistoryTableRowCounts,
  HistoryTableByteSizes, LoadMetricWindowStats, LoadNotification, LoadNotificationInput, LoadNotificationMetric, LoginRateLimit, MonitorRecord, OfflineNotification, OfflineNotificationUpdate, OrphanClientDataCleanupResult, PingHistoryRecord, PingSnapshotInput, PingTask, PingTaskEstimateRow, PingTaskHistoryRequest, PublicClientRow, PublicWebsiteMonitor, ScheduledClientRow, TableRowCounts, Theme, ThemeAsset, ThemeAssetUpsertInput, ThemeUpsertInput, User, WebsiteCheck, WebsiteCheckInput, WebsiteMonitor, WebsiteMonitorInput } from '../types.ts';
import type { BackupData } from '../../utils/backup.ts';
import type { BackupConfigurationSnapshot, HistoryStorageUsage, NotificationDeliveryClaim, NotificationDeliveryCleanupOptions, NotificationDeliveryCleanupResult } from '../types.ts';
import { redactDatabaseSecrets } from '../../utils/setup-diagnostics.ts';
import { generateAgentToken, hashAgentToken } from '../../utils/client.ts';
import { scheduledFetch } from '../../utils/scheduled-budget.ts';

export type SupabaseApiEnv = {
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
};

export class SupabaseApiConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SupabaseApiConfigurationError';
  }
}

export class SupabaseApiError extends Error {
  readonly status: number;

  constructor(functionName: string, status: number, detail: string) {
    super(`Supabase RPC ${functionName} failed: ${status} ${detail}`.trim());
    this.name = 'SupabaseApiError';
    this.status = status;
  }
}

export function isSupabaseApiConfigured(env: SupabaseApiEnv): boolean {
  return Boolean(env.SUPABASE_URL?.trim() && resolveSupabaseApiKey(env));
}

export function resolveSupabaseApiKey(env: SupabaseApiEnv): string {
  return env.SUPABASE_SECRET_KEY?.trim() || env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '';
}

function readSupabaseConfig(env: SupabaseApiEnv): { url: string; key: string } {
  const url = env.SUPABASE_URL?.trim().replace(/\/+$/, '');
  const key = resolveSupabaseApiKey(env);
  if (!url || !key) {
    throw new SupabaseApiConfigurationError('SUPABASE_URL and SUPABASE_SECRET_KEY are required for Supabase Data API mode.');
  }
  return { url, key };
}

function supabaseRpcHeaders(key: string): Record<string, string> {
  return {
    apikey: key,
    ...(key.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${key}` }),
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

async function callSupabaseTable<T>(
  env: SupabaseApiEnv,
  path: string,
  init: RequestInit = {},
  fetcher: typeof fetch = fetch,
): Promise<T> {
  const { url, key } = readSupabaseConfig(env);
  const response = await scheduledFetch(`${url}/rest/v1/${path.replace(/^\/+/, '')}`, {
    ...init,
    headers: {
      ...supabaseRpcHeaders(key),
      ...(init.headers || {}),
    },
  }, fetcher);
  if (!response.ok) {
    const detail = sanitizeSupabaseDetail(await response.text().catch(() => ''), key);
    throw new SupabaseApiError(`table:${path.split('?')[0]}`, response.status, detail);
  }
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}

function isMissingRpc(error: unknown): error is SupabaseApiError {
  return error instanceof SupabaseApiError
    && error.status === 404
    && /PGRST202|Could not find the function/i.test(error.message);
}

function isStatementTimeout(error: unknown): error is SupabaseApiError {
  return error instanceof SupabaseApiError
    && error.status >= 500
    && /57014|statement timeout|canceling statement/i.test(error.message);
}

function sanitizeSupabaseDetail(detail: string, key: string): string {
  return redactDatabaseSecrets(detail).replaceAll(key, '[REDACTED]').slice(0, 400);
}

export async function callSupabaseRpc<T>(
  env: SupabaseApiEnv,
  functionName: string,
  body: Record<string, unknown> = {},
  fetcher: typeof fetch = fetch,
): Promise<T> {
  const { url, key } = readSupabaseConfig(env);
  const response = await scheduledFetch(`${url}/rest/v1/rpc/${encodeURIComponent(functionName)}`, {
    method: 'POST',
    headers: supabaseRpcHeaders(key),
    body: JSON.stringify(body),
  }, fetcher);
  if (!response.ok) {
    const detail = sanitizeSupabaseDetail(await response.text().catch(() => ''), key);
    throw new SupabaseApiError(functionName, response.status, detail);
  }
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}

function readRpcBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1';
  }
  return false;
}

function normalizeClientBooleans<T extends { hidden?: unknown; auto_renewal?: unknown } | null>(client: T): T {
  if (!client || typeof client !== 'object') return client;
  const record = client as Record<string, unknown>;
  return {
    ...client,
    ...(Object.prototype.hasOwnProperty.call(record, 'hidden') ? { hidden: readRpcBoolean(record.hidden) } : {}),
    ...(Object.prototype.hasOwnProperty.call(record, 'auto_renewal') ? { auto_renewal: readRpcBoolean(record.auto_renewal) } : {}),
  } as T;
}

function normalizeClientList<T extends { hidden?: unknown; auto_renewal?: unknown }>(clients: T[]): T[] {
  return clients.map(normalizeClientBooleans);
}

function readRpcStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (typeof value !== 'string' || value.trim() === '') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return value.split(',').map(item => item.trim()).filter(Boolean);
  }
}

function normalizePingTask<T extends { clients?: unknown; all_clients?: unknown }>(task: T): T {
  return {
    ...task,
    clients: readRpcStringArray((task as Record<string, unknown>).clients),
    all_clients: readRpcBoolean((task as Record<string, unknown>).all_clients),
  } as T;
}

function normalizePingTaskList<T extends { clients?: unknown; all_clients?: unknown }>(tasks: T[]): T[] {
  return tasks.map(normalizePingTask);
}

function normalizeWebsiteMonitor<T extends { agent_probe_clients?: unknown; agent_probe_status_enabled?: unknown; tags?: unknown }>(monitor: T): T {
  return {
    ...monitor,
    agent_probe_clients: readRpcStringArray((monitor as Record<string, unknown>).agent_probe_clients),
    agent_probe_status_enabled: readRpcBoolean((monitor as Record<string, unknown>).agent_probe_status_enabled),
    tags: readRpcStringArray((monitor as Record<string, unknown>).tags),
  } as T;
}

function normalizeWebsiteMonitorList<T extends { agent_probe_clients?: unknown; agent_probe_status_enabled?: unknown; tags?: unknown }>(monitors: T[]): T[] {
  return monitors.map(normalizeWebsiteMonitor);
}

export function getSupabasePublicSettings(env: SupabaseApiEnv): Promise<Record<string, string>> {
  return callSupabaseRpc<Record<string, string>>(env, 'cfm_public_settings');
}

export async function getSupabaseBackupConfigurationSnapshot(env: SupabaseApiEnv): Promise<BackupConfigurationSnapshot> {
  const snapshot = await callSupabaseRpc<BackupConfigurationSnapshot>(env, 'cfm_backup_configuration_snapshot');
  return {
    ...snapshot,
    clients: normalizeClientList(snapshot.clients),
    ping_tasks: normalizePingTaskList(snapshot.ping_tasks),
    load_notifications: snapshot.load_notifications.map(row => ({ ...row, clients: readRpcStringArray(row.clients) })),
    website_monitors: normalizeWebsiteMonitorList(snapshot.website_monitors),
  };
}

export async function getSupabaseSettingsByKeys(
  env: SupabaseApiEnv,
  keys: string[],
  fetcher: typeof fetch = fetch,
): Promise<Record<string, string>> {
  if (keys.length === 0) return {};
  const requested = [...new Set(keys)];
  try {
    return await callSupabaseRpc<Record<string, string>>(
      env,
      'cfm_settings_by_keys',
      { input_keys: requested },
      fetcher,
    );
  } catch (error) {
    if (!isMissingRpc(error)) throw error;
    const rows = await callSupabaseTable<Array<{ key?: unknown; value?: unknown }>>(
      env,
      'settings?select=key,value',
      { method: 'GET' },
      fetcher,
    );
    const allowed = new Set(requested);
    return Object.fromEntries(rows
      .filter((row): row is { key: string; value: string } => (
        typeof row?.key === 'string'
        && typeof row?.value === 'string'
        && allowed.has(row.key)
      ))
      .map(row => [row.key, row.value]));
  }
}

export async function setSupabaseSettings(
  env: SupabaseApiEnv,
  settings: Record<string, string>,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  if (Object.keys(settings).length === 0) return;
  try {
    await callSupabaseRpc<void>(env, 'cfm_set_settings', { input_settings: settings }, fetcher);
    return;
  } catch (error) {
    if (!isMissingRpc(error)) throw error;
    await callSupabaseTable<void>(
      env,
      'settings?on_conflict=key',
      {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(Object.entries(settings).map(([key, value]) => ({ key, value }))),
      },
      fetcher,
    );
  }
}

export function getSupabasePublicClients(env: SupabaseApiEnv): Promise<PublicClientRow[]> {
  return callSupabaseRpc<PublicClientRow[]>(env, 'cfm_public_clients').then(normalizeClientList);
}

export function getSupabaseAdminClients(env: SupabaseApiEnv): Promise<Client[]> {
  return callSupabaseRpc<Client[]>(env, 'cfm_admin_clients').then(normalizeClientList);
}

export function supabaseClientExists(env: SupabaseApiEnv, uuid: string): Promise<boolean> {
  return callSupabaseRpc<boolean>(env, 'cfm_client_exists', { input_uuid: uuid });
}

export function getSupabaseClient(env: SupabaseApiEnv, uuid: string): Promise<Client | null> {
  return callSupabaseRpc<Client | null>(env, 'cfm_client', { input_uuid: uuid }).then(normalizeClientBooleans);
}

export function getSupabaseClientVisibility(env: SupabaseApiEnv, uuid: string): Promise<ClientVisibility | null> {
  return callSupabaseRpc<ClientVisibility | null>(env, 'cfm_client_visibility', { input_uuid: uuid }).then(normalizeClientBooleans);
}

export function listSupabaseScheduledClientRows(env: SupabaseApiEnv): Promise<ScheduledClientRow[]> {
  return callSupabaseRpc<ScheduledClientRow[]>(env, 'cfm_scheduled_clients');
}

export function getSupabaseScheduledClientRowsByIds(env: SupabaseApiEnv, uuids: string[]): Promise<ScheduledClientRow[]> {
  return callSupabaseRpc<ScheduledClientRow[]>(env, 'cfm_scheduled_clients_by_ids', { input_uuids: uuids });
}

export function getSupabaseClientTokenMeta(env: SupabaseApiEnv, uuid: string): Promise<ClientTokenMeta | null> {
  return callSupabaseRpc<ClientTokenMeta | null>(env, 'cfm_client_token_meta', { input_uuid: uuid });
}

export function getSupabaseClientsByIds(env: SupabaseApiEnv, uuids: string[]): Promise<Client[]> {
  return callSupabaseRpc<Client[]>(env, 'cfm_clients_by_ids', { input_uuids: uuids }).then(normalizeClientList);
}

export function getSupabaseClientIds(env: SupabaseApiEnv): Promise<string[]> {
  return callSupabaseRpc<string[]>(env, 'cfm_client_ids');
}

export async function getSupabaseClientByToken(env: SupabaseApiEnv, token: string): Promise<Client | null> {
  const tokenHash = await hashAgentToken(token);
  return callSupabaseRpc<Client | null>(env, 'cfm_agent_client_by_token', {
    input_token_hash: tokenHash,
    input_token: token,
  }).then(normalizeClientBooleans);
}

export async function getSupabaseClientIdentityByToken(env: SupabaseApiEnv, token: string): Promise<ClientIdentity | null> {
  const tokenHash = await hashAgentToken(token);
  return callSupabaseRpc<ClientIdentity | null>(env, 'cfm_agent_client_identity_by_token', {
    input_token_hash: tokenHash,
    input_token: token,
  }).then(normalizeClientBooleans);
}

export async function supabaseClientTokenExists(env: SupabaseApiEnv, token: string): Promise<boolean> {
  const tokenHash = await hashAgentToken(token);
  return callSupabaseRpc<boolean>(env, 'cfm_client_token_exists', {
    input_token_hash: tokenHash,
    input_token: token,
  });
}

export async function getSupabaseClientCreateConflict(env: SupabaseApiEnv, uuid: string, token: string): Promise<'uuid' | 'token' | null> {
  const tokenHash = await hashAgentToken(token);
  return callSupabaseRpc<'uuid' | 'token' | null>(env, 'cfm_client_create_conflict', {
    input_uuid: uuid,
    input_token_hash: tokenHash,
    input_token: token,
  });
}

export async function createSupabaseClient(env: SupabaseApiEnv, client: Partial<Client>): Promise<Client> {
  const token = client.token || generateAgentToken();
  return callSupabaseRpc<Client>(env, 'cfm_create_client', {
    input_client: {
      uuid: client.uuid || crypto.randomUUID(),
      name: client.name || '',
      token,
      token_hash: client.token_hash || await hashAgentToken(token),
      sort_order: client.sort_order,
    },
  }).then(normalizeClientBooleans);
}

export function markSupabaseClientTokenUsed(env: SupabaseApiEnv, uuid: string, ip = ''): Promise<boolean> {
  return callSupabaseRpc<boolean>(env, 'cfm_mark_client_token_used', {
    input_uuid: uuid,
    input_ip: ip,
  });
}

export async function rotateSupabaseClientToken(env: SupabaseApiEnv, uuid: string, token: string): Promise<Client | null> {
  return callSupabaseRpc<Client | null>(env, 'cfm_rotate_client_token', {
    input_uuid: uuid,
    input_token: token,
    input_token_hash: await hashAgentToken(token),
  }).then(normalizeClientBooleans);
}

export function updateSupabaseClient(env: SupabaseApiEnv, uuid: string, data: Partial<Client> | Record<string, unknown>): Promise<boolean> {
  return callSupabaseRpc<boolean>(env, 'cfm_update_client', {
    input_uuid: uuid,
    input_patch: data,
  });
}

export function updateSupabaseClientAndReturn(env: SupabaseApiEnv, uuid: string, data: Partial<Client> | Record<string, unknown>): Promise<Client | null> {
  return callSupabaseRpc<Client | null>(env, 'cfm_update_client_returning', {
    input_uuid: uuid,
    input_patch: data,
  }).then(normalizeClientBooleans);
}

export function deleteSupabaseClients(env: SupabaseApiEnv, uuids: string[]): Promise<DeleteClientsResult> {
  return callSupabaseRpc<DeleteClientsResult>(env, 'cfm_delete_clients', { input_uuids: uuids });
}

export function pruneSupabaseClientReferences(env: SupabaseApiEnv, uuid: string): Promise<ClientReferenceCleanupResult> {
  return pruneSupabaseClientReferencesForClients(env, [uuid]);
}

export function pruneSupabaseClientReferencesForClients(env: SupabaseApiEnv, uuids: string[]): Promise<ClientReferenceCleanupResult> {
  return callSupabaseRpc<ClientReferenceCleanupResult>(env, 'cfm_prune_client_references', { input_uuids: uuids });
}

export function cleanupSupabaseOrphanClientData(env: SupabaseApiEnv): Promise<OrphanClientDataCleanupResult> {
  return callSupabaseRpc<OrphanClientDataCleanupResult>(env, 'cfm_cleanup_orphan_client_data');
}

export function updateSupabaseClientsHidden(env: SupabaseApiEnv, uuids: string[], hidden: boolean): Promise<number> {
  return callSupabaseRpc<number>(env, 'cfm_update_clients_hidden', {
    input_uuids: uuids,
    input_hidden: hidden,
  });
}

export function reorderSupabaseClients(env: SupabaseApiEnv, uuids: string[]): Promise<number> {
  return callSupabaseRpc<number>(env, 'cfm_reorder_clients', { input_uuids: uuids });
}

export function getSupabaseClientCapacityCounts(env: SupabaseApiEnv): Promise<ClientCapacityCounts> {
  return callSupabaseRpc<ClientCapacityCounts>(env, 'cfm_client_capacity_counts');
}

export function getSupabasePingTaskEstimateRows(env: SupabaseApiEnv): Promise<PingTaskEstimateRow[]> {
  return callSupabaseRpc<PingTaskEstimateRow[]>(env, 'cfm_ping_task_estimate_rows').then(normalizePingTaskList);
}

export function getSupabasePingTask(env: SupabaseApiEnv, id: number): Promise<PingTask | null> {
  return callSupabaseRpc<PingTask | null>(env, 'cfm_ping_task', { input_id: id }).then(task => task ? normalizePingTask(task) : null);
}

export function createSupabasePingTask(env: SupabaseApiEnv, task: PingTask): Promise<PingTask> {
  return callSupabaseRpc<PingTask>(env, 'cfm_create_ping_task', { input_task: task }).then(normalizePingTask);
}

export function updateSupabasePingTaskAndReturn(env: SupabaseApiEnv, id: number, task: Partial<PingTask>): Promise<PingTask | null> {
  return callSupabaseRpc<PingTask | null>(env, 'cfm_update_ping_task', {
    input_id: id,
    input_task: task,
  }).then(task => task ? normalizePingTask(task) : null);
}

export function reorderSupabasePingTasks(env: SupabaseApiEnv, ids: number[]): Promise<number> {
  return callSupabaseRpc<number>(env, 'cfm_reorder_ping_tasks', { input_ids: ids });
}

export function deleteSupabasePingTask(env: SupabaseApiEnv, id: number): Promise<PingTask | null> {
  return callSupabaseRpc<PingTask | null>(env, 'cfm_delete_ping_task', { input_id: id }).then(task => task ? normalizePingTask(task) : null);
}

export function deleteSupabaseOldRecords(
  env: SupabaseApiEnv,
  beforeTime: string,
  options: DeleteOldRowsOptions = {},
): Promise<{ records: number; gpu_records: number; gpu_snapshots: number; has_more: boolean }> {
  return callSupabaseRpc(env, 'cfm_delete_old_records', {
    input_before_time: beforeTime,
    input_max_batches: options.maxBatches,
  });
}

export function deleteSupabaseOldWebsiteChecks(
  env: SupabaseApiEnv,
  beforeTime: string,
  options: DeleteOldRowsOptions = {},
): Promise<{ website_checks: number; has_more: boolean }> {
  return callSupabaseRpc(env, 'cfm_delete_old_website_checks', {
    input_before_time: beforeTime,
    input_max_batches: options.maxBatches,
  });
}

export function deleteSupabaseOldPingRecords(
  env: SupabaseApiEnv,
  beforeTime: string,
  options: DeleteOldRowsOptions = {},
): Promise<{ ping_records: number; ping_snapshots: number; has_more: boolean }> {
  return callSupabaseRpc(env, 'cfm_delete_old_ping_records', {
    input_before_time: beforeTime,
    input_max_batches: options.maxBatches,
  });
}

export function deleteSupabaseOldAuditLogs(
  env: SupabaseApiEnv,
  beforeTime: string,
  options: DeleteOldRowsOptions = {},
): Promise<{ audit_logs: number; has_more: boolean }> {
  return callSupabaseRpc(env, 'cfm_delete_old_audit_logs', {
    input_before_time: beforeTime,
    input_max_batches: options.maxBatches,
  });
}

export async function claimSupabaseNotificationDelivery(
  env: SupabaseApiEnv,
  key: string,
  eventId: string,
  now: string,
  repeatMs: number,
  fetcher: typeof fetch = fetch,
): Promise<NotificationDeliveryClaim> {
  try {
    return await callSupabaseRpc<NotificationDeliveryClaim>(
      env,
      'cfm_claim_notification_delivery',
      {
        input_key: key,
        input_event_id: eventId,
        input_now: now,
        input_repeat_ms: repeatMs,
      },
      fetcher,
    );
  } catch (error) {
    if (!isMissingRpc(error)) throw error;
    // Legacy schemas have no persistent delivery lease. Skip the notification
    // attempt rather than aborting the scheduled website-check phase.
    return { claimed: false, delivered: false, token: null };
  }
}

export async function completeSupabaseNotificationDelivery(
  env: SupabaseApiEnv,
  key: string,
  eventId: string,
  token: string,
  success: boolean,
  now: string,
  repeatMs: number,
