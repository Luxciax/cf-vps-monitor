export interface MaintenanceWindow { start: string; end: string }
export interface WebsiteCheckConfig {
  kind?: 'http' | 'tcp' | 'dns' | 'websocket';
  keyword?: string;
  keyword_absent?: boolean;
  json_path?: string;
  json_equals?: string | number | boolean | null;
  dns_type?: 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT' | 'NS';
  dns_expected?: string[];
  tls_warning_days?: number;
  maintenance?: MaintenanceWindow[];
  silenced_until?: string;
}
export interface WebsiteCheckDetails {
  tls_expires_at?: string | null;
  tls_days_remaining?: number | null;
  tls_status?: 'valid' | 'expiring' | 'unknown';
  dns_answers?: string[];
  content_checked?: boolean;
}
const allowedKeys = new Set(['kind','keyword','keyword_absent','json_path','json_equals','dns_type','dns_expected','tls_warning_days','maintenance','silenced_until']);
const unsafeParts = new Set(['__proto__','prototype','constructor']);
export function parseWebsiteCheckConfig(raw: unknown): { ok: true; value: WebsiteCheckConfig } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, value: {} };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'invalid_check_config' };
  const input = raw as Record<string, unknown>;
  if (Object.keys(input).some(key => !allowedKeys.has(key))) return { ok: false, error: 'unknown_check_config_field' };
  const value: WebsiteCheckConfig = {};
  if (input.kind !== undefined) {
    if (!['http','tcp','dns','websocket'].includes(String(input.kind))) return { ok: false, error: 'invalid_check_kind' };
    value.kind = input.kind as WebsiteCheckConfig['kind'];
  }
  if (input.keyword !== undefined) {
    if (typeof input.keyword !== 'string' || input.keyword.length < 1 || input.keyword.length > 512) return { ok: false, error: 'invalid_keyword' };
    value.keyword = input.keyword;
  }
  if (input.keyword_absent !== undefined) {
    if (typeof input.keyword_absent !== 'boolean' || !value.keyword) return { ok: false, error: 'invalid_keyword_absent' };
    value.keyword_absent = input.keyword_absent;
  }
  if (input.json_path !== undefined) {
    if (typeof input.json_path !== 'string' || !/^[a-zA-Z0-9_$-]+(?:\.[a-zA-Z0-9_$-]+){0,7}$/.test(input.json_path) || input.json_path.length > 200 || input.json_path.split('.').some(part => unsafeParts.has(part))) return { ok: false, error: 'invalid_json_path' };
    if (!Object.prototype.hasOwnProperty.call(input, 'json_equals') || (input.json_equals !== null && !['string','number','boolean'].includes(typeof input.json_equals)) || (typeof input.json_equals === 'string' && input.json_equals.length > 512) || (typeof input.json_equals === 'number' && !Number.isFinite(input.json_equals))) return { ok: false, error: 'invalid_json_equals' };
    value.json_path = input.json_path;
    value.json_equals = input.json_equals as WebsiteCheckConfig['json_equals'];
  } else if (input.json_equals !== undefined) return { ok: false, error: 'json_path_required' };
  if (input.dns_type !== undefined) {
    if (!['A','AAAA','CNAME','MX','TXT','NS'].includes(String(input.dns_type))) return { ok: false, error: 'invalid_dns_type' };
    value.dns_type = input.dns_type as WebsiteCheckConfig['dns_type'];
  }
  if (input.dns_expected !== undefined) {
    if (!Array.isArray(input.dns_expected) || input.dns_expected.length > 20 || input.dns_expected.some(item => typeof item !== 'string' || !item.trim() || item.length > 512)) return { ok: false, error: 'invalid_dns_expected' };
    value.dns_expected = [...new Set(input.dns_expected.map(item => String(item).trim()))];
  }
  if (input.tls_warning_days !== undefined) {
    if (typeof input.tls_warning_days !== 'number' || !Number.isInteger(input.tls_warning_days) || input.tls_warning_days < 0 || input.tls_warning_days > 90) return { ok: false, error: 'invalid_tls_warning_days' };
    value.tls_warning_days = input.tls_warning_days;
  }
  if (input.maintenance !== undefined) {
    if (!Array.isArray(input.maintenance) || input.maintenance.length > 32) return { ok: false, error: 'invalid_maintenance' };
    value.maintenance = [];
    for (const item of input.maintenance) {
      if (!item || typeof item !== 'object' || typeof item.start !== 'string' || typeof item.end !== 'string' || !Number.isFinite(Date.parse(item.start)) || !Number.isFinite(Date.parse(item.end)) || Date.parse(item.end) <= Date.parse(item.start) || Date.parse(item.end)-Date.parse(item.start) > 31*86400000) return { ok: false, error: 'invalid_maintenance' };
      value.maintenance.push({ start: new Date(item.start).toISOString(), end: new Date(item.end).toISOString() });
    }
  }
  if (input.silenced_until !== undefined) {
    if (typeof input.silenced_until !== 'string' || !Number.isFinite(Date.parse(input.silenced_until))) return { ok: false, error: 'invalid_silenced_until' };
    value.silenced_until = new Date(input.silenced_until).toISOString();
  }
  return { ok: true, value };
}
export function isWebsiteInMaintenance(config: WebsiteCheckConfig | undefined, now = new Date()): boolean {
  const at = now.getTime();
  return (config?.maintenance || []).some(window => Date.parse(window.start) <= at && at < Date.parse(window.end));
}
export function isWebsiteAlertSilenced(config: WebsiteCheckConfig | undefined, now = new Date()): boolean {
  return isWebsiteInMaintenance(config, now) || Boolean(config?.silenced_until && Date.parse(config.silenced_until) > now.getTime());
}
export function checkWebsiteContent(text: string, config: WebsiteCheckConfig): string | null {
  if (config.keyword !== undefined && text.includes(config.keyword) === Boolean(config.keyword_absent)) return 'keyword_mismatch';
  if (config.json_path !== undefined) {
    let value: unknown;
    try { value = JSON.parse(text); } catch { return 'invalid_json_content'; }
    for (const part of config.json_path.split('.')) {
      if (!value || typeof value !== 'object' || unsafeParts.has(part) || !Object.prototype.hasOwnProperty.call(value, part)) return 'json_path_missing';
      if (Array.isArray(value) && !/^(?:0|[1-9]\d*)$/.test(part)) return 'json_path_missing';
      value = (value as Record<string, unknown>)[part];
    }
    if (value !== config.json_equals) return 'json_content_mismatch';
  }
  return null;
}
export async function readBoundedMonitorBody(response: Response, limit = 256 * 1024): Promise<string> {
  if (Number(response.headers.get('content-length') || 0) > limit) { await response.body?.cancel(); throw new Error('content_too_large'); }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('content_too_large');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

export function normalizeWebsiteCheckDetails(raw: unknown): WebsiteCheckDetails {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const input = raw as Record<string, unknown>;
  const details: WebsiteCheckDetails = {};
  if (typeof input.tls_expires_at === 'string' && Number.isFinite(Date.parse(input.tls_expires_at))) details.tls_expires_at = new Date(input.tls_expires_at).toISOString();
  else if (input.tls_expires_at === null) details.tls_expires_at = null;
  if (typeof input.tls_days_remaining === 'number' && Number.isInteger(input.tls_days_remaining) && input.tls_days_remaining >= -36500 && input.tls_days_remaining <= 36500) details.tls_days_remaining = input.tls_days_remaining;
  else if (input.tls_days_remaining === null) details.tls_days_remaining = null;
  if (['valid','expiring','unknown'].includes(String(input.tls_status))) details.tls_status = input.tls_status as WebsiteCheckDetails['tls_status'];
  if (typeof input.content_checked === 'boolean') details.content_checked = input.content_checked;
  if (Array.isArray(input.dns_answers)) details.dns_answers = input.dns_answers.filter(item => typeof item === 'string').slice(0,100).map(item => item.slice(0,512));
  return details;
}
export function shouldNotifyCertificateExpiry(input: { details?: WebsiteCheckDetails; check_config?: WebsiteCheckConfig; last_notified_expiry?: string | null; checked_at: string }, now = new Date()): boolean {
  const expiry = input.details?.tls_expires_at;
  const warning = input.check_config?.tls_warning_days;
  if (!expiry || !warning || warning < 1 || isWebsiteAlertSilenced(input.check_config,now) || (input.last_notified_expiry && Date.parse(input.last_notified_expiry) === Date.parse(expiry))) return false;
  const checkedAt = Date.parse(input.checked_at),expiresAt = Date.parse(expiry);
  if (!Number.isFinite(checkedAt) || !Number.isFinite(expiresAt) || checkedAt > now.getTime()+60000 || now.getTime()-checkedAt > 24*3600000) return false;
  return expiresAt-now.getTime() <= warning*86400000;
}
