import { PlatformFlagRepository } from '@/src/repositories/platform-flag.repository'
import { err, ok, type Result } from './result'

const TTL_MS = 15_000
const cache = new Map<string, { keys: string[]; expiresAt: number }>()

/** Descarta o cache local (chamado após qualquer mudança no painel admin). */
export function invalidatePlatformFlagsCache(): void {
  cache.clear()
}

/**
 * Chaves de flags ativas para o workspace. Cache em memória de 15 s por
 * instância: a mudança feita no admin chega às outras réplicas em até 15 s.
 */
export async function getActiveFlagKeys(
  workspaceId: string,
  now: number = Date.now(),
): Promise<Result<string[]>> {
  const hit = cache.get(workspaceId)
  if (hit && hit.expiresAt > now) return ok(hit.keys)

  const result = await PlatformFlagRepository.listActiveKeys(workspaceId)
  if (!result.ok) return err(result.error)
  cache.set(workspaceId, { keys: result.value, expiresAt: now + TTL_MS })
  return ok(result.value)
}

/**
 * Uso no servidor. Falha de leitura conta como desligada (o gate nunca
 * libera nada por engano).
 */
export async function isFeatureEnabled(
  key: string,
  workspaceId: string,
): Promise<boolean> {
  const keys = await getActiveFlagKeys(workspaceId)
  return keys.ok && keys.value.includes(key)
}
