import { maskSecretPreview } from '../utils/secret-preview';

const SECRET_SETTINGS = ['telegram_bot_token','telegram_chat_id','email_smtp_password','webhook_secret','webhook_password','webhook_headers_json','webhook_url'] as const;

export function adminSettingsResponse(settings: Record<string,string>): Record<string,string> {
  const result = { ...settings };
  for (const key of SECRET_SETTINGS) {
    if (!Object.hasOwn(result,key)) continue;
    result[`${key}_set`] = settings[key] ? 'true' : 'false';
    if (key !== 'webhook_headers_json' && key !== 'webhook_url') result[`${key}_preview`] = maskSecretPreview(settings[key]);
    delete result[key];
  }
  return result;
}
