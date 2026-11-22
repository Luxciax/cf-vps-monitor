/**
 * 管理员 API 路由
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Bindings, Variables } from '../index';
import * as db from '../db/queries';
import { AuthConfigurationError, generateToken } from '../auth/jwt';
import { decryptTotpSecret, encryptTotpSecret, generateRecoveryCodes, hashRecoveryCode } from '../auth/mfa';
import { generateMfaSetupToken, generateMfaToken, verifyMfaSetupToken } from '../auth/mfa-token';
import { buildTotpUri, generateTotpSecret, verifyTotpCode } from '../auth/totp';
import { invalidateAdminSessionCache } from '../auth/admin-session';
import { hashPassword, validateAdminPasswordStrength, verifyPassword } from '../auth/password';
import { clearMfaStepUpCookie, setAdminSessionCookie, setMfaStepUpCookie } from '../auth/session';
import { SETTING_SCHEMA, buildAdminSettings, sanitizeSettingsForStorage } from '../settings/schema';
import {
  BACKUP_ENCRYPTION_ALGORITHM,
  ENCRYPTED_BACKUP_SCHEMA_ID,
  BACKUP_SCOPE,
  MAX_BACKUP_BYTES,
  decryptBackup,
  encryptBackup,
  summarizeBackup,
  validateBackup,
} from '../utils/backup';
import { buildBackupSnapshot } from '../utils/backup-snapshot';
import { measureRestoredClientSnapshot } from '../utils/restore-client-snapshot';
import { getCloudflareClientIp } from '../utils/request-ip';
import { validatePingTaskInput } from '../utils/ping-task';
import { generateAgentToken, validateClientCreateInput, validateClientUpdateInput } from '../utils/client';
import { validateExpiryNotificationInput, validateLoadNotificationInput, validateOfflineNotificationInput } from '../utils/notification';
import { NOTIFICATION_DISPATCH_SETTING_KEYS, dispatchNotification, pickNotificationSettingOverrides } from '../utils/notification-dispatch';
import { maskSecretPreview, isMaskedSecretPreview } from '../utils/secret-preview';
import { TELEGRAM_MESSAGE_MAX_CHARS } from '../utils/telegram';
import { EMAIL_MESSAGE_MAX_CHARS } from '../utils/email';
import { WEBHOOK_MESSAGE_MAX_CHARS } from '../utils/webhook';
import { sanitizeSetupDiagnosticDetail } from '../utils/setup-diagnostics';
import { checkWebsiteMonitorHttp, validateWebsiteMonitorInput } from '../utils/website-monitor';
import { readLiveSnapshot, readRateLimitResult } from '../utils/do-response';
import { readJsonWithLimit, readRequestBytesWithLimit } from '../utils/request-body';
import { bytesToBase64 } from '../utils/theme-package';
import { APP_VERSION } from '../utils/app-version';
import {
  formatAppVersion,
  repositoryUrlFromRepositoryUrl,
  normalizeGitSha,
  shortGitSha,
  type UpdateCheckResult,
} from '../utils/update-check';
import {
  auditLoginFailure,
  clearLoginFailures,
  deleteAdminSessionEdgeCache,
  getLoginRetryAfterSeconds,
  invalidatePublicMetadataCache,
  loadLoginRateLimitStates,
  mfaRateLimitBuckets,
  purgePublicMetadataEdgeCache,
  recordLoginFailure,
} from './public';
import { invalidateAgentClientAuthCache, invalidateAgentPingTaskCache } from './client';
import { invalidateLiveViewerSettingsCache } from './websocket';
import { getDatabase, type AppDatabase } from '../db/provider';
import {
  bestEffortRecordHealthEvent,
  errorDetail,
  healthComponentsOk,
  markStaleEvents,
  readHealthEvents,
  type HealthEvent,
} from '../utils/observability';
import { readScheduledDatabaseStartupHealth } from '../utils/scheduled-observability';
import {
  ESTIMATED_GPU_SNAPSHOT_BYTES,
  ESTIMATED_MONITOR_RECORD_BYTES,
  ESTIMATED_PING_SNAPSHOT_BYTES,
  buildQuotaReference,
} from '../utils/quota';
import { buildResourceEstimates } from '../utils/capacity-estimate';

const adminRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();
type AdminContext = Context<{ Bindings: Bindings; Variables: Variables }>;
const MAX_ADMIN_USERNAME_BYTES = 64;
const MIN_JWT_SECRET_BYTES = 32;
const CAPACITY_ESTIMATE_CACHE_MS = 30_000;
const CAPACITY_ROW_COUNT_CACHE_MS = 60_000;
const CAPACITY_ROW_COUNT_LIMIT = 100_000;
const ADMIN_CLIENTS_CACHE_MS = 5_000;
const ADMIN_PING_TASKS_CACHE_MS = 5_000;
const ADMIN_PING_TASKS_EDGE_CACHE_SECONDS = 15;
const ADMIN_SETTINGS_SCOPE_CACHE_MS = 10_000;
const HEALTH_CACHE_MS = 30_000;
const ALLOWED_CLIENT_IDS_CACHE_MS = 30_000;
const OFFICIAL_UPDATE_REPOSITORY = 'kadidalax/cf-vps-monitor';
const OFFICIAL_UPDATE_BRANCH = 'main';
const UPDATE_CHECK_CACHE_MS = 10 * 60 * 1000;
const updateCheckCache = new Map<string, { expiresAt: number; value: UpdateCheckResult }>();
const LIVE_POLICY_SETTING_KEYS = new Set([
  'live_poll_active_interval_sec',
  'live_poll_idle_interval_sec',
  'live_poll_active_max_duration_sec',
]);
const RECORD_PERSISTENCE_SETTING_KEYS = new Set([
  'record_enabled',
  'record_persist_interval_sec',
  'ping_record_persist_interval_sec',
  'record_high_watermark_rows',
  'record_high_watermark_bytes',
]);
const CAPACITY_ESTIMATE_SETTING_KEYS = [
  'record_enabled',
  'record_preserve_time',
  'ping_record_preserve_time',
  'live_poll_active_interval_sec',
  'live_poll_idle_interval_sec',
  'record_persist_interval_sec',
  'ping_record_persist_interval_sec',
  'record_high_watermark_rows',
  'record_high_watermark_bytes',
  'audit_log_preserve_time',
  'capacity_daily_view_minutes',
];
const CAPACITY_ESTIMATE_SETTING_KEY_SET = new Set(CAPACITY_ESTIMATE_SETTING_KEYS);
const SETTINGS_SCOPE_KEYS = {
  site: [
    'site_title',
    'site_subtitle',
    'site_description',
    'language',
    'script_domain',
    'site_logo_url',
  ],
  general: [
    'record_enabled',
    'record_preserve_time',
    'ping_record_preserve_time',
    'live_poll_active_interval_sec',
    'live_poll_idle_interval_sec',
    'live_poll_active_max_duration_sec',
    'record_persist_interval_sec',
    'ping_record_persist_interval_sec',
    'record_high_watermark_rows',
    'record_high_watermark_bytes',
    'capacity_daily_view_minutes',
    'offline_confirm_rounds',
  ],
  notification: [
    'notification_method',
    'telegram_bot_token',
    'telegram_chat_id',
    'email_smtp_host',
    'email_smtp_port',
    'email_smtp_security',
    'email_smtp_username',
    'email_smtp_password',
    'email_smtp_from_address',
    'email_smtp_from_name',
    'email_smtp_recipients',
    'email_smtp_auth_method',
    'webhook_url',
    'webhook_format',
    'webhook_secret',
    'webhook_method',
    'webhook_content_type',
    'webhook_headers_json',
    'webhook_body_template',
    'webhook_username',
    'webhook_password',
    'webhook_retry_count',
    'enable_ip_change_notification',
    'offline_notify_never_reported',
  ],
  update: [
    'update_repository_url',
  ],
} as const satisfies Record<string, readonly (keyof typeof SETTING_SCHEMA)[]>;
const MAINTENANCE_CLEANUP_SETTING_KEYS = [
  'record_preserve_time',
  'ping_record_preserve_time',
  'audit_log_preserve_time',
];
const EMPTY_AGENT_PING_TASK_POLL_SEC = 600;
const DEFAULT_UNIFIED_PING_INTERVAL_SEC = 120;
const MIN_UNIFIED_PING_INTERVAL_SEC = 60;
const MAX_UNIFIED_PING_INTERVAL_SEC = 3600;
const AGENT_BASIC_INFO_REPORTS_PER_DAY = 48;
// 与 wrangler.toml 的 crons 配置保持一致（每 2 分钟一次）。
const WORKER_CRON_INTERVAL_SEC = 120;
// Cloudflare 对入站 WebSocket 消息按 20:1 折算计费（出站消息与协议 ping 免费）。
const WEBSOCKET_MESSAGE_BILLING_RATIO = 20;
// 实测：走遍所有后台页面一轮的 Worker 请求数。
const ADMIN_TOUR_WORKER_REQUESTS = 23;
const CAPACITY_COUNT_FAR_CHECK_SEC = 6 * 60 * 60;
const CAPACITY_COUNT_NEAR_CHECK_SEC = 10 * 60;
const CAPACITY_COUNT_CRITICAL_CHECK_SEC = 60;
const AGENT_TOKEN_ROTATION_WARNING_MS = 180 * 24 * 60 * 60 * 1000;
const AGENT_TOKEN_UNUSED_WARNING_MS = 7 * 24 * 60 * 60 * 1000;
const AGENT_TOKEN_STALE_USE_WARNING_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ADMIN_JSON_BYTES = 256 * 1024;
const MAX_SITE_LOGO_BYTES = 1024 * 1024;

type LiveClientMeta = Partial<Omit<db.Client, 'token' | 'token_hash'>> & Pick<db.Client, 'uuid'>;
type AdminClientsSnapshot = {
  clients: Array<Omit<db.Client, 'token' | 'token_hash'>>;
  removed: string[];
  updatedAt: number;
  complete: boolean;
};
type HealthCheckBody = {
  ok: boolean;
  database_provider: AppDatabase['provider'];
  checked_at: string;
  cache: 'hit' | 'miss' | 'refresh';
  deep: boolean;
  components: Record<string, HealthEvent | null>;
};
type HealthCheckCacheEntry = {
  value: HealthCheckBody;
  status: 200 | 503;
  expiresAt: number;
};
type JsonObjectBodyResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: Response };
type JsonObjectOrArrayBodyResult =
  | { ok: true; body: Record<string, unknown> | Record<string, unknown>[] }
  | { ok: false; response: Response };
type AdminJsonBodyMessages = {
  invalidJson: string;
  invalidShape: string;
};

type TimingMetric = { name: string; dur: number };

let allowedClientIdsCache: { value: Set<string>; expiresAt: number } | null = null;
let adminClientsCache: { value: db.Client[]; expiresAt: number } | null = null;
let adminPingTasksCache: { value: db.PingTask[]; expiresAt: number } | null = null;
const adminSettingsScopeCache = new Map<string, { value: Record<string, string>; expiresAt: number }>();
let healthCheckCache: HealthCheckCacheEntry | null = null;

async function timed<T>(metrics: TimingMetric[], name: string, fn: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try {
    return await fn();
  } finally {
    metrics.push({ name, dur: performance.now() - started });
  }
}

function setServerTiming(c: AdminContext, metrics: TimingMetric[]): void {
  if (metrics.length === 0) return;
  c.header('Server-Timing', metrics.map(metric => `${metric.name};dur=${metric.dur.toFixed(1)}`).join(', '));
}

function runAdminBackground(c: AdminContext, task: Promise<unknown>): void {
  const guarded = task.catch((error) => {
    console.warn('[admin] background task failed:', sanitizeSetupDiagnosticDetail(error));
  });
  if (c.executionCtx?.waitUntil) c.executionCtx.waitUntil(guarded);
  else void guarded;
}

function isJsonObjectBody(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isUploadedFile(value: unknown): value is { arrayBuffer(): Promise<ArrayBuffer>; type?: string } {
  return !!value && typeof value === 'object' && 'arrayBuffer' in value && typeof value.arrayBuffer === 'function';
}

function webhookUrlHost(value: string): string {
  try {
    return value ? new URL(value).hostname.toLowerCase() : '';
  } catch {
    return '';
  }
}

function detectSiteLogoType(bytes: Uint8Array): string | null {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return 'image/webp';
  return null;
}

function isJsonObjectArrayBody(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every(isJsonObjectBody);
}

async function readAdminJsonBody<T>(
  c: AdminContext,
  messages: AdminJsonBodyMessages,
  acceptsBody: (body: unknown) => body is T,
  maxBytes = MAX_ADMIN_JSON_BYTES,
): Promise<{ ok: true; body: T } | { ok: false; response: Response }> {
  const parsed = await readJsonWithLimit(c.req.raw, maxBytes);
  if (!parsed.ok && parsed.reason === 'too_large') {
    return { ok: false, response: c.json({ error: `请求内容不能超过 ${maxBytes} 字节` }, 413) };
  }
  if (!parsed.ok) {
    return { ok: false, response: c.json({ error: messages.invalidJson }, 400) };
  }
  const body = parsed.body;
  if (!acceptsBody(body)) {
    return { ok: false, response: c.json({ error: messages.invalidShape }, 400) };
  }
  return { ok: true, body };
}

async function readAdminJsonObject(c: AdminContext): Promise<JsonObjectBodyResult> {
  const result = await readAdminJsonBody(
    c,
    { invalidJson: '请求 JSON 格式错误', invalidShape: '请求内容必须是 JSON 对象' },
    isJsonObjectBody,
  );
  return result.ok ? { ok: true, body: result.body } : result;
}

async function readAdminJsonObjectOrArray(c: AdminContext): Promise<JsonObjectOrArrayBodyResult> {
  const result = await readAdminJsonBody(
    c,
    { invalidJson: '请求 JSON 格式错误', invalidShape: '请求内容必须是 JSON 对象或对象数组' },
    (body): body is Record<string, unknown> | Record<string, unknown>[] =>
      isJsonObjectBody(body) || isJsonObjectArrayBody(body),
  );
  return result.ok ? { ok: true, body: result.body } : result;
}

async function readAdminBackupJsonObject(c: AdminContext): Promise<JsonObjectBodyResult> {
  const result = await readAdminJsonBody(
    c,
    { invalidJson: '备份 JSON 格式错误', invalidShape: '备份内容无效' },
    isJsonObjectBody,
    MAX_BACKUP_BYTES,
  );
  return result.ok ? { ok: true, body: result.body } : result;
}

export function invalidateAllowedClientIdsCache(): void {
  allowedClientIdsCache = null;
}

function adminClientsEdgeCacheRequest(): Request {
  return new Request('https://cf-monitor.internal/cache/admin/clients/v2', { method: 'GET' });
}

function adminPingTasksEdgeCacheRequest(): Request {
  return new Request('https://cf-monitor.internal/cache/admin/ping/v2', { method: 'GET' });
}

function invalidateAdminClientsCache(): void {
  adminClientsCache = null;
}

function invalidateAdminPingTasksCache(): void {
  adminPingTasksCache = null;
}

function invalidateAdminSettingsCache(): void {
  adminSettingsScopeCache.clear();
}

function invalidateAdminPublicMetadata(c: AdminContext): Promise<unknown[]> {
  invalidatePublicMetadataCache();
  return purgePublicMetadataEdgeCache(c);
}

function purgeAdminClientsEdgeCache(c: AdminContext): Promise<boolean> {
  if (typeof caches === 'undefined') return Promise.resolve(false);
  const task = caches.default.delete(adminClientsEdgeCacheRequest()).catch(() => false);
  if (c?.executionCtx?.waitUntil) c.executionCtx.waitUntil(task);
  return task;
}

function purgeAdminPingTasksEdgeCache(c: AdminContext): void {
  if (typeof caches === 'undefined') return;
  const task = caches.default.delete(adminPingTasksEdgeCacheRequest()).catch(() => false);
  if (c?.executionCtx?.waitUntil) c.executionCtx.waitUntil(task);
  else void task;
}

async function getAdminPingTasksEdgeCache(): Promise<Response | null> {
  if (typeof caches === 'undefined') return null;
  try {
    const cached = await caches.default.match(adminPingTasksEdgeCacheRequest());
    if (!cached) return null;
    const headers = new Headers(cached.headers);
    headers.set('Cache-Control', 'no-store');
    headers.set('X-CF-VPS-Monitor-Admin-Ping-Cache', 'edge-hit');
    return new Response(cached.body, {
      status: cached.status,
      statusText: cached.statusText,
      headers,
    });
  } catch {
    return null;
  }
}

function putAdminPingTasksEdgeCache(c: AdminContext, tasks: db.PingTask[]): void {
  if (typeof caches === 'undefined') return;
  const response = new Response(JSON.stringify(tasks), {
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'Cache-Control': `public, max-age=${ADMIN_PING_TASKS_EDGE_CACHE_SECONDS}`,
    },
  });
  const task = caches.default.put(adminPingTasksEdgeCacheRequest(), response).catch(() => undefined);
  if (c.executionCtx?.waitUntil) c.executionCtx.waitUntil(task);
  else void task;
}

function hideAdminClientToken(client: db.Client): Omit<db.Client, 'token' | 'token_hash'> {
  const { token: _token, token_hash: _tokenHash, ...safeClient } = client;
  return safeClient;
}

function liveDataStub(c: AdminContext) {
  return c.env.LIVE_DATA.get(c.env.LIVE_DATA.idFromName('global'));
}

async function readAdminClientsSnapshot(c: AdminContext): Promise<AdminClientsSnapshot | null> {
  const response = await liveDataStub(c).fetch(new Request('https://do/admin-clients-snapshot'));
  if (!response.ok) return null;
  const body = await response.json().catch(() => null);
  const clients = body && typeof body === 'object' && Array.isArray((body as { clients?: unknown }).clients)
    ? (body as { clients: unknown[] }).clients
    : null;
  const removed = body && typeof body === 'object' && Array.isArray((body as { removed?: unknown }).removed)
    ? (body as { removed: unknown[] }).removed.filter((uuid): uuid is string => typeof uuid === 'string' && uuid.trim() !== '')
    : [];
  return clients && clients.every(item => item && typeof item === 'object')
    ? { clients: clients as Array<Omit<db.Client, 'token' | 'token_hash'>>, removed,
      updatedAt: Number((body as { updatedAt?: unknown }).updatedAt || 0),
      complete: (body as { complete?: unknown }).complete !== false }
    : null;
}

async function writeAdminClientsSnapshot(
  c: AdminContext,
  clients: Array<Omit<db.Client, 'token' | 'token_hash'>>,
  options: { expectedVersion?: number | null; confirmedRemoved?: string[]; mode?: 'reorder' } = {},
): Promise<boolean> {
  const response = await liveDataStub(c).fetch(new Request('https://do/admin-clients-snapshot', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clients, expected_version: options.expectedVersion,
      confirmed_removed: options.confirmedRemoved, mode: options.mode }),
  }));
  return response.ok;
}

function applyAdminClientsSnapshot(
  clients: Array<Omit<db.Client, 'token' | 'token_hash'>>,
  snapshot: AdminClientsSnapshot | null,
): Array<Omit<db.Client, 'token' | 'token_hash'>> {
  if (!snapshot) return clients;
  const removed = new Set(snapshot.removed);
  const byUuid = new Map(clients.map(client => [client.uuid, client]));
  for (const uuid of removed) byUuid.delete(uuid);
  for (const client of snapshot.clients) {
    if (!removed.has(client.uuid)) byUuid.set(client.uuid, { ...byUuid.get(client.uuid), ...client });
  }
  return [...byUuid.values()];
}

async function listAdminClientsCached(database: db.QueryDatabase, force = false): Promise<db.Client[]> {
  const now = Date.now();
  if (!force && adminClientsCache && adminClientsCache.expiresAt > now) {
    return adminClientsCache.value;
  }

  const clients = await db.listClients(database, force);
  adminClientsCache = {
    value: clients,
    expiresAt: Date.now() + ADMIN_CLIENTS_CACHE_MS,
  };
  return clients;
}

async function listAdminPingTasksCached(database: db.QueryDatabase, force = false): Promise<db.PingTask[]> {
  const now = Date.now();
  if (!force && adminPingTasksCache && adminPingTasksCache.expiresAt > now) {
    return adminPingTasksCache.value;
  }
  const tasks = await db.listPingTasks(database, force);
  adminPingTasksCache = {
    value: tasks,
    expiresAt: Date.now() + ADMIN_PING_TASKS_CACHE_MS,
  };
  return tasks;
}

async function syncLiveClientMeta(c: AdminContext, client: LiveClientMeta): Promise<void> {
  const stub = liveDataStub(c);
