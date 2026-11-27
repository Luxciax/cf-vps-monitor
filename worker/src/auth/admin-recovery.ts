import { constantTimeStringEqual, machineTokenDigest } from './admin-api-token';

type RecoveryEnv = { ADMIN_RECOVERY_ENABLED?: string; ADMIN_RECOVERY_TOKEN?: string };

export function adminRecoveryEnabled(env: RecoveryEnv): boolean {
  const token = env.ADMIN_RECOVERY_TOKEN?.trim() || '';
  return env.ADMIN_RECOVERY_ENABLED === 'true' && token.length >= 32 && token.length <= 1024;
}

export async function authorizeAdminRecovery(env: RecoveryEnv, provided: unknown): Promise<boolean> {
  if (!adminRecoveryEnabled(env) || typeof provided !== 'string' || provided.length < 32 || provided.length > 1024) return false;
  const [actual, expected] = await Promise.all([machineTokenDigest(provided), machineTokenDigest(env.ADMIN_RECOVERY_TOKEN!.trim())]);
  return constantTimeStringEqual(actual, expected);
}
