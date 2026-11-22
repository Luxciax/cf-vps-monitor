export * from './types';

import type { AppDatabase } from './provider';
import * as sba from './supabase-api/client';
import type * as t from './types';
import type { BackupData } from '../utils/backup';
import { redactDatabaseSecrets } from '../utils/setup-diagnostics';

export type QueryDatabase = AppDatabase;

export async function getBackupConfigurationSnapshot(database: QueryDatabase): Promise<t.BackupConfigurationSnapshot> {
  return sba.getSupabaseBackupConfigurationSnapshot(database.env);
}

function filterSettings(settings: Record<string, string>, keys: string[]): Record<string, string> {
  return Object.fromEntries(keys.flatMap(key => key in settings ? [[key, settings[key]]] : []));
}

export async function getClient(database: QueryDatabase, uuid: string): Promise<t.Client | null> {
  return sba.getSupabaseClient(database.env, uuid);
}

export async function clientExists(database: QueryDatabase, uuid: string): Promise<boolean> {
  return sba.supabaseClientExists(database.env, uuid);
}

export async function getClientTokenMeta(database: QueryDatabase, uuid: string): Promise<t.ClientTokenMeta | null> {
  return sba.getSupabaseClientTokenMeta(database.env, uuid);
}

export async function getClientsByIds(database: QueryDatabase, uuids: string[]): Promise<t.Client[]> {
  return sba.getSupabaseClientsByIds(database.env, uuids);
}

export async function getClientByToken(database: QueryDatabase, token: string, _fresh = false): Promise<t.Client | null> {
  return sba.getSupabaseClientByToken(database.env, token);
}

export async function getClientIdentityByToken(database: QueryDatabase, token: string, _fresh = false): Promise<t.ClientIdentity | null> {
  return sba.getSupabaseClientIdentityByToken(database.env, token);
}

export async function clientTokenExists(database: QueryDatabase, token: string): Promise<boolean> {
  return sba.supabaseClientTokenExists(database.env, token);
}

export async function getClientCreateConflict(database: QueryDatabase, uuid: string, token: string): Promise<'uuid' | 'token' | null> {
  return sba.getSupabaseClientCreateConflict(database.env, uuid, token);
}

export async function listClients(database: QueryDatabase, _fresh = false): Promise<t.Client[]> {
  return sba.getSupabaseAdminClients(database.env);
}

export async function countClientCapacityTargets(database: QueryDatabase): Promise<t.ClientCapacityCounts> {
  return sba.getSupabaseClientCapacityCounts(database.env);
}

export async function listPublicClientRows(database: QueryDatabase, _fresh = false): Promise<t.PublicClientRow[]> {
  return sba.getSupabasePublicClients(database.env);
}

export async function getClientVisibility(database: QueryDatabase, uuid: string): Promise<t.ClientVisibility | null> {
  return sba.getSupabaseClientVisibility(database.env, uuid);
}

export async function listScheduledClientRows(database: QueryDatabase): Promise<t.ScheduledClientRow[]> {
  return sba.listSupabaseScheduledClientRows(database.env);
}

export async function getScheduledClientRowsByIds(database: QueryDatabase, uuids: string[]): Promise<t.ScheduledClientRow[]> {
  return sba.getSupabaseScheduledClientRowsByIds(database.env, uuids);
}

export async function listClientIds(database: QueryDatabase): Promise<string[]> {
  return sba.getSupabaseClientIds(database.env);
}

export async function createClient(database: QueryDatabase, client: Partial<t.Client>): Promise<t.Client> {
  return sba.createSupabaseClient(database.env, client);
}

export async function updateClient(database: QueryDatabase, uuid: string, data: Partial<t.Client> | Record<string, unknown>): Promise<boolean> {
  return sba.updateSupabaseClient(database.env, uuid, data);
}

export async function updateClientAndReturn(database: QueryDatabase, uuid: string, data: Partial<t.Client> | Record<string, unknown>): Promise<t.Client | null> {
  return sba.updateSupabaseClientAndReturn(database.env, uuid, data);
}

export async function rotateClientToken(database: QueryDatabase, uuid: string, token: string): Promise<t.Client | null> {
  return sba.rotateSupabaseClientToken(database.env, uuid, token);
}

export async function markClientTokenUsed(database: QueryDatabase, uuid: string, ip = ''): Promise<boolean> {
  return sba.markSupabaseClientTokenUsed(database.env, uuid, ip);
}

export async function deleteClient(database: QueryDatabase, uuid: string): Promise<t.DeleteClientsResult> {
  return sba.deleteSupabaseClients(database.env, [uuid]);
}

export async function deleteClients(database: QueryDatabase, uuids: string[]): Promise<t.DeleteClientsResult> {
  return sba.deleteSupabaseClients(database.env, uuids);
}

export async function updateClientsHidden(database: QueryDatabase, uuids: string[], hidden: boolean): Promise<number> {
  return sba.updateSupabaseClientsHidden(database.env, uuids, hidden);
}

export async function reorderClients(database: QueryDatabase, orderedUuids: string[]): Promise<number> {
  return sba.reorderSupabaseClients(database.env, orderedUuids);
}

export async function countUsers(database: QueryDatabase): Promise<number> {
  return sba.countSupabaseUsers(database.env);
}

export async function createUser(
  database: QueryDatabase,
  user: { uuid: string; username: string; hashedPassword: string },
): Promise<boolean> {
  return sba.createSupabaseUser(database.env, user);
}

export async function deleteUserIfMatches(
  database: QueryDatabase,
  user: { uuid: string; username: string; hashedPassword: string },
): Promise<boolean> {
  return sba.deleteSupabaseUserIfMatches(database.env, user);
}

export async function createInitialAdmin(
  database: QueryDatabase,
  uuid: string,
  username: string,
  passwordHash: string,
): Promise<boolean> {
  return sba.createSupabaseInitialAdmin(database.env, uuid, username, passwordHash);
}

export async function recoverSingleAdmin(
  database: QueryDatabase,
  user: { uuid: string; username: string; hashedPassword: string },
): Promise<t.User> {
  return sba.recoverSupabaseSingleAdmin(database.env, user);
}

export async function getUserByUsername(database: QueryDatabase, username: string): Promise<t.User | null> {
  return sba.getSupabaseLoginUser(database.env, username);
}

export async function getUserByUuid(database: QueryDatabase, uuid: string): Promise<t.User | null> {
  return sba.getSupabaseUserByUuid(database.env, uuid);
}

export async function enableUserTotp(
  database: QueryDatabase,
  uuid: string,
  secretEnc: string,
  recoveryCodeHashes: string[],
  usedStep: number,
): Promise<t.User | null> {
  return sba.enableSupabaseUserTotp(database.env, uuid, secretEnc, recoveryCodeHashes, usedStep);
}

export async function disableUserTotp(database: QueryDatabase, uuid: string): Promise<t.User | null> {
  return sba.disableSupabaseUserTotp(database.env, uuid);
}

export async function replaceUserRecoveryCodes(
  database: QueryDatabase,
  uuid: string,
  recoveryCodeHashes: string[],
): Promise<t.User | null> {
  return sba.replaceSupabaseUserRecoveryCodes(database.env, uuid, recoveryCodeHashes);
}

export async function consumeTotpStep(database: QueryDatabase, uuid: string, step: number): Promise<boolean> {
  return sba.consumeSupabaseTotpStep(database.env, uuid, step);
}

export async function consumeRecoveryCode(database: QueryDatabase, uuid: string, codeHash: string): Promise<boolean> {
  return sba.consumeSupabaseRecoveryCode(database.env, uuid, codeHash);
}
export async function updateUserUsername(database: QueryDatabase, uuid: string, username: string): Promise<void> {
  return sba.updateSupabaseUserUsername(database.env, uuid, username);
}

export async function updateUserUsernameAndRotateSession(database: QueryDatabase, uuid: string, username: string): Promise<t.User | null> {
  return sba.updateSupabaseUserUsernameAndRotateSession(database.env, uuid, username);
}

export async function updateUserPassword(database: QueryDatabase, uuid: string, hashedPassword: string): Promise<void> {
  return sba.updateSupabaseUserPassword(database.env, uuid, hashedPassword);
}

export async function updateUserPasswordAndRotateSession(
  database: QueryDatabase,
  uuid: string,
  hashedPassword: string,
): Promise<t.User | null> {
  return sba.updateSupabaseUserPasswordAndRotateSession(database.env, uuid, hashedPassword);
}

export async function rotateUserSession(database: QueryDatabase, uuid: string): Promise<t.User | null> {
  return sba.rotateSupabaseUserSession(database.env, uuid);
}

export async function getLoginRateLimit(database: QueryDatabase, bucket: string): Promise<t.LoginRateLimit | null> {
  return sba.getSupabaseLoginRateLimit(database.env, bucket);
}

export async function getLoginRateLimitsByBuckets(database: QueryDatabase, buckets: string[]): Promise<Map<string, t.LoginRateLimit>> {
  const rows = await sba.getSupabaseLoginRateLimitsByBuckets(database.env, buckets);
  return new Map(rows.map(row => [row.bucket, row]));
}

export async function recordLoginRateLimitFailures(database: QueryDatabase, buckets: string[], failedAt: string): Promise<void> {
  return sba.recordSupabaseLoginFailures(database.env, buckets, failedAt);
}

export async function clearObservedLoginRateLimits(database: QueryDatabase, states: t.LoginRateLimit[]): Promise<void> {
  if (states.length === 0) return;
  return sba.clearSupabaseObservedLoginFailures(database.env, states);
}

export async function setLoginRateLimit(database: QueryDatabase, state: t.LoginRateLimit): Promise<void> {
  return sba.setSupabaseLoginRateLimit(database.env, state);
}

export async function setLoginRateLimits(database: QueryDatabase, states: t.LoginRateLimit[]): Promise<void> {
  return sba.setSupabaseLoginRateLimits(database.env, states);
}

export async function clearLoginRateLimit(database: QueryDatabase, bucket: string): Promise<void> {
  return sba.clearSupabaseLoginRateLimit(database.env, bucket);
}

export async function clearLoginRateLimits(database: QueryDatabase, buckets: string[]): Promise<void> {
  return sba.clearSupabaseLoginRateLimits(database.env, buckets);
}

export async function deleteLoginRateLimitsBefore(database: QueryDatabase, beforeTime: string): Promise<void> {
  return sba.deleteSupabaseLoginRateLimitsBefore(database.env, beforeTime);
}

export async function claimNotificationDelivery(
  database: QueryDatabase, key: string, eventId: string, now: string, repeatMs: number,
): Promise<t.NotificationDeliveryClaim> {
  return sba.claimSupabaseNotificationDelivery(database.env, key, eventId, now, repeatMs);
}

export async function completeNotificationDelivery(
  database: QueryDatabase, key: string, eventId: string, token: string, success: boolean, now: string, repeatMs: number,
): Promise<boolean> {
  return sba.completeSupabaseNotificationDelivery(database.env, key, eventId, token, success, now, repeatMs);
}

export async function getSetting(database: QueryDatabase, key: string): Promise<string | null> {
  return (await sba.getSupabaseSettingsByKeys(database.env, [key]))[key] ?? null;
}

export async function getSettingsByKeys(database: QueryDatabase, keys: string[], _fresh = false): Promise<Record<string, string>> {
  return filterSettings(await sba.getSupabaseSettingsByKeys(database.env, keys), keys);
}

export async function getRawSettingsByKeys(database: QueryDatabase, keys: string[]): Promise<Record<string, string>> {
  return filterSettings(await sba.getSupabaseSettingsByKeys(database.env, keys), keys);
}

export async function setSetting(database: QueryDatabase, key: string, value: string): Promise<void> {
  return sba.setSupabaseSettings(database.env, { [key]: value });
}

export async function setSettings(database: QueryDatabase, settings: Record<string, string>): Promise<void> {
  return sba.setSupabaseSettings(database.env, settings);
}

export async function getAllSettings(database: QueryDatabase, _fresh = false): Promise<Record<string, string>> {
  return sba.getSupabasePublicSettings(database.env);
}

export async function listThemes(database: QueryDatabase): Promise<t.Theme[]> {
  return sba.listSupabaseThemes(database.env);
}

export async function getTheme(database: QueryDatabase, short: string): Promise<t.Theme | null> {
  return sba.getSupabaseTheme(database.env, short);
}

export async function upsertTheme(
  database: QueryDatabase,
  theme: t.ThemeUpsertInput,
  assets: t.ThemeAssetUpsertInput[],
): Promise<void> {
  return sba.upsertSupabaseTheme(database.env, theme, assets);
}

export async function updateThemeSettings(
  database: QueryDatabase,
  short: string,
  configJson: string,
  customCss: string,
): Promise<boolean> {
  return sba.updateSupabaseThemeSettings(database.env, short, configJson, customCss);
}

export async function deleteTheme(database: QueryDatabase, short: string): Promise<boolean> {
  return sba.deleteSupabaseTheme(database.env, short);
}

export async function getThemeAsset(database: QueryDatabase, short: string, path: string): Promise<t.ThemeAsset | null> {
  return sba.getSupabaseThemeAsset(database.env, short, path);
}

export async function getPingTask(database: QueryDatabase, id: number): Promise<t.PingTask | null> {
  return sba.getSupabasePingTask(database.env, id);
}

export async function listPingTasks(database: QueryDatabase, _fresh = false): Promise<t.PingTask[]> {
  return sba.getSupabasePublicPingTasks(database.env);
}

export async function listPingTaskEstimateRows(database: QueryDatabase): Promise<t.PingTaskEstimateRow[]> {
  return sba.getSupabasePingTaskEstimateRows(database.env);
}

export async function createPingTask(database: QueryDatabase, task: t.PingTask): Promise<t.PingTask> {
  return sba.createSupabasePingTask(database.env, task);
}

export async function updatePingTaskAndReturn(database: QueryDatabase, id: number, task: Partial<t.PingTask>): Promise<t.PingTask | null> {
  return sba.updateSupabasePingTaskAndReturn(database.env, id, task);
}

export async function reorderPingTasks(database: QueryDatabase, orderedIds: number[]): Promise<number> {
  return sba.reorderSupabasePingTasks(database.env, orderedIds);
}

export async function deletePingTask(database: QueryDatabase, id: number): Promise<t.PingTask | null> {
  return sba.deleteSupabasePingTask(database.env, id);
}

export async function getWebsiteMonitor(database: QueryDatabase, id: number): Promise<t.WebsiteMonitor | null> {
  return sba.getSupabaseWebsiteMonitor(database.env, id);
}

export async function listWebsiteMonitors(database: QueryDatabase, _fresh = false): Promise<t.WebsiteMonitor[]> {
  return sba.listSupabaseWebsiteMonitors(database.env);
}

export async function listPublicWebsiteMonitors(database: QueryDatabase, checkLimit: number = 60, _fresh = false, periodHours = 24, includeHidden = false): Promise<t.PublicWebsiteMonitor[]> {
  return sba.getSupabasePublicWebsites(database.env, periodHours, checkLimit, includeHidden);
}

export async function getPublicWebsiteMonitorById(database: QueryDatabase, id: number, checkLimit: number = 120, includeHidden = false): Promise<t.PublicWebsiteMonitor | null> {
  return sba.getSupabasePublicWebsiteMonitorById(database.env, id, checkLimit, includeHidden);
}

export async function createWebsiteMonitor(database: QueryDatabase, monitor: t.WebsiteMonitorInput): Promise<t.WebsiteMonitor> {
  return sba.createSupabaseWebsiteMonitor(database.env, monitor);
}

export async function updateWebsiteMonitor(database: QueryDatabase, id: number, monitor: Partial<t.WebsiteMonitorInput>): Promise<boolean> {
  return sba.updateSupabaseWebsiteMonitor(database.env, id, monitor);
}

export async function updateWebsiteMonitorAndReturn(database: QueryDatabase, id: number, monitor: Partial<t.WebsiteMonitorInput>): Promise<t.WebsiteMonitor | null> {
  return sba.updateSupabaseWebsiteMonitorAndReturn(database.env, id, monitor);
}

export async function deleteWebsiteMonitor(
  database: QueryDatabase,
  id: number,
): Promise<sba.WebsiteMonitorDeleteResult> {
  return sba.deleteSupabaseWebsiteMonitor(database.env, id);
}

export async function reorderWebsiteMonitors(database: QueryDatabase, orderedIds: number[]): Promise<number> {
  return sba.reorderSupabaseWebsiteMonitors(database.env, orderedIds);
}

export async function setWebsiteMonitorVisibility(database: QueryDatabase, id: number, hidden: boolean): Promise<boolean> {
  return sba.setSupabaseWebsiteMonitorVisibility(database.env, id, hidden);
}

export async function setWebsiteMonitorEnabled(database: QueryDatabase, id: number, enabled: boolean): Promise<boolean> {
  return sba.setSupabaseWebsiteMonitorEnabled(database.env, id, enabled);
}

export async function listDueWebsiteMonitors(database: QueryDatabase, now: string, limit: number = 50): Promise<t.WebsiteMonitor[]> {
  return sba.listSupabaseDueWebsiteMonitors(database.env, now, limit);
}

export async function recordWebsiteCheck(database: QueryDatabase, check: t.WebsiteCheckInput): Promise<t.WebsiteMonitor | null> {
  return sba.recordSupabaseWebsiteCheck(database.env, check);
}

export async function listAgentWebsiteProbeTasks(
  database: QueryDatabase,
  client: string,
  now: string,
  limit: number = 20,
): Promise<t.WebsiteMonitor[]> {
  return sba.listSupabaseAgentWebsiteProbeTasks(database.env, client, now, limit);
}

export async function listWebsiteChecks(database: QueryDatabase, monitorId: number, limit: number = 60): Promise<t.WebsiteCheck[]> {
  return sba.listSupabaseWebsiteChecks(database.env, monitorId, limit);
}

export async function markWebsiteMonitorNotified(
  database: QueryDatabase, id: number, time: string | null, expected: t.WebsiteNotificationExpectation,
): Promise<boolean> {
  return sba.markSupabaseWebsiteMonitorNotified(database.env, id, time, expected);
}

export async function insertRecord(database: QueryDatabase, record: t.MonitorRecord): Promise<void> {
  return sba.insertSupabaseMonitorRecord(database.env, record);
}

export async function getRecentRecords(database: QueryDatabase, client: string, limit: number = 30): Promise<t.MonitorRecord[]> {
  return sba.getSupabaseRecentRecords(database.env, client, limit);
}

export async function getRecordsByTimeRange(database: QueryDatabase, client: string, start: string, end: string): Promise<t.MonitorRecord[]> {
  return sba.getSupabaseRecordsByTimeRange(database.env, client, start, end);
}

export async function getRecordsByTimeRangeLimited(
  database: QueryDatabase,
  client: string,
  start: string,
  end: string,
  limit: number,
): Promise<t.MonitorRecord[]> {
  return sba.getSupabaseRecordsByTimeRangeLimited(database.env, client, start, end, limit);
}

export async function getRecordsByTimeRangePaged(
  database: QueryDatabase,
  client: string,
  start: string,
  end: string,
  page: number = 1,
  limit: number = 100,
): Promise<t.PagedResult<t.MonitorRecord>> {
  return sba.getSupabaseRecordsByTimeRangePaged(database.env, client, start, end, page, limit);
}

export async function getRecordsByTimeRangeCursor(
  database: QueryDatabase,
  client: string,
  start: string,
  end: string,
  cursor: string | undefined,
  limit: number = 100,
): Promise<t.PagedResult<t.MonitorRecord>> {
  return sba.getSupabaseRecordsByTimeRangeCursor(database.env, client, start, end, cursor, limit);
}

export async function getLatestRecordTimes(database: QueryDatabase): Promise<Array<{ client: string; last_time: string }>> {
  return sba.getSupabaseLatestRecordTimes(database.env);
}

export async function getLatestRecordTimesForClients(
  database: QueryDatabase,
  clients: string[],
): Promise<Array<{ client: string; last_time: string }>> {
  return sba.getSupabaseLatestRecordTimesForClients(database.env, clients);
}

export async function getLatestRecords(database: QueryDatabase): Promise<t.MonitorRecord[]> {
  return sba.getSupabaseLatestRecords(database.env);
}

export async function getGPURecords(database: QueryDatabase, client: string, start?: string, end?: string, limit: number = 100): Promise<t.GPUHistoryRecord[]> {
  return sba.getSupabaseGpuRecords(database.env, client, start, end, limit);
}

export async function getGPURecordsPaged(
  database: QueryDatabase,
  client: string,
  start?: string,
  end?: string,
  page: number = 1,
  limit: number = 100,
): Promise<t.PagedResult<t.GPUHistoryRecord>> {
  return sba.getSupabaseGpuRecordsPaged(database.env, client, start, end, page, limit);
}

export async function getGPURecordsCursor(
  database: QueryDatabase,
  client: string,
  start: string | undefined,
  end: string | undefined,
  cursor: string | undefined,
  limit: number = 100,
): Promise<t.PagedResult<t.GPUHistoryRecord>> {
