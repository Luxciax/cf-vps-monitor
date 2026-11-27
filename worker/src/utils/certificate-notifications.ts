import type { WebsiteMonitor } from '../db/types.ts';
import { callSupabaseRpc, type SupabaseApiEnv } from '../db/supabase-api/client.ts';
import { formatNotificationTime, type NotificationMessage } from './notification-templates.ts';
import { shouldNotifyCertificateExpiry } from './website-check-config.ts';

export function certificateReminderDue(monitor: WebsiteMonitor, now = new Date()): boolean {
  return monitor.enabled && shouldNotifyCertificateExpiry({
    check_config: monitor.check_config,
    details: { tls_expires_at: monitor.tls_expires_at },
    last_notified_expiry: monitor.tls_notification_expires_at,
    checked_at: monitor.tls_observed_at || '',
  }, now);
}
export function buildCertificateExpiryNotification(monitor: WebsiteMonitor, now = new Date()): NotificationMessage {
  const expiresAt = monitor.tls_expires_at || '';
  const days = Math.floor((Date.parse(expiresAt)-now.getTime())/86400000);
  const message = `${monitor.name}；证书${days < 0 ? `已过期 ${Math.abs(days)} 天` : `剩余 ${days} 天`}；到期时间 ${formatNotificationTime(expiresAt)}；最近探针观测 ${formatNotificationTime(monitor.tls_observed_at || '')}`;
  return { subject: 'CF VPS Monitor TLS 证书到期提醒', body: message, event: 'TLS 证书到期提醒', clients: monitor.name, message, time: formatNotificationTime(now) };
}
export function markCertificateNotified(env: SupabaseApiEnv, monitor: WebsiteMonitor): Promise<boolean> {
  return callSupabaseRpc<boolean>(env,'cfm_mark_certificate_notified',{
    input_monitor_id:monitor.id,input_expires_at:monitor.tls_expires_at,input_config_revision:monitor.config_revision,
  });
}
