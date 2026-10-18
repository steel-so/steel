import { createHash } from 'node:crypto'
import type { ModuleKind } from '@prisma/client'
import { logger } from '@/lib/axiom/logger'
import { appError } from '@/src/errors/app-error'
import type { ApiScope } from '@/src/lib/api/session'
import { ensureRedisConnected } from '@/src/lib/redis'
import { err, ok, type Result } from '@/src/lib/result'

/**
 * Pending CLI logins of the device flow (ADR 0035), in Redis — no table:
 *
 * - `device:auth:<sha256(deviceCode)>` → the entry (JSON). Only the hash of
 *   the device code is a key, so a Redis dump never holds a usable code.
 * - `device:user:<userCode>` → the device-code hash, for `/device`.
 * - `device:decided:<hash>` → `SET NX` marker, so a code is answered once.
 *
 * Keys live `expiresIn + CLAIM_GRACE`: a login approved at the last second
 * can still be picked up by the next poll. The personal token itself is
 * minted only when the CLI claims the approval (`consume`, a `GETDEL`), so
 * its value never sits in Redis.
 *
 * Unlike the counters elsewhere, Redis is load-bearing here: without it
 * there is no login, so failures come back as `INTERNAL_SERVER_ERROR`.
 */

export const DEVICE_CLAIM_GRACE_SECONDS = 120

export type DeviceAuthorizationStatus = 'pending' | 'approved' | 'denied'

export interface DeviceApproval {
  userId: string
  workspaceId: string
  scopes: ApiScope[]
  modules: ModuleKind[]
  expiresInDays: number
}

export interface DeviceAuthorizationEntry {
  userCode: string
  /** Client that started the login (`clientName` of the request). */
  clientName?: string | null
  deviceName: string | null
  status: DeviceAuthorizationStatus
  createdAt: string
  expiresAt: string
  /** Seconds between polls. */
  interval: number
  lastPolledAt: string | null
  approval: DeviceApproval | null
  /** Who answered (approved or denied). */
  decidedBy: string | null
}

export function hashDeviceCode(deviceCode: string): string {
  return createHash('sha256').update(deviceCode).digest('hex')
}

const entryKey = (hash: string) => `device:auth:${hash}`
const userKey = (userCode: string) => `device:user:${userCode}`
const decidedKey = (hash: string) => `device:decided:${hash}`

function unavailable(event: string, cause: unknown) {
  logger.error(event, {
    component: 'DeviceAuthorizationCache',
    message: cause instanceof Error ? cause.message : String(cause),
  })
  return err(
    appError(
      'INTERNAL_SERVER_ERROR',
      'O login pelo terminal está indisponível agora. Tente de novo em instantes.',
    ),
  )
}

function parse(raw: string | null): DeviceAuthorizationEntry | null {
  if (raw === null) return null
  try {
    const entry = JSON.parse(raw) as DeviceAuthorizationEntry
    return entry && typeof entry.userCode === 'string' ? entry : null
  } catch {
    return null
  }
}

export const DeviceAuthorizationCache = {
  /**
   * Stores a new pending login. `ok(false)` when the user code is already
   * taken by another pending login (the caller draws a new one).
   */
  async create(
    deviceCodeHash: string,
    entry: DeviceAuthorizationEntry,
    ttlSeconds: number,
  ): Promise<Result<boolean>> {
    try {
      const client = await ensureRedisConnected()
      const expiration = { type: 'EX' as const, value: ttlSeconds }
      const claimed = await client.set(
        userKey(entry.userCode),
        deviceCodeHash,
        { expiration, condition: 'NX' },
      )
      if (claimed !== 'OK') return ok(false)
      await client.set(entryKey(deviceCodeHash), JSON.stringify(entry), {
        expiration,
      })
      return ok(true)
    } catch (cause) {
      return unavailable('device_authorization.create_failed', cause)
    }
  },

  async findByDeviceCodeHash(
    deviceCodeHash: string,
  ): Promise<Result<DeviceAuthorizationEntry | null>> {
    try {
      const client = await ensureRedisConnected()
      return ok(parse(await client.get(entryKey(deviceCodeHash))))
    } catch (cause) {
      return unavailable('device_authorization.read_failed', cause)
    }
  },

  async findByUserCode(
    userCode: string,
  ): Promise<
    Result<{ deviceCodeHash: string; entry: DeviceAuthorizationEntry } | null>
  > {
    try {
      const client = await ensureRedisConnected()
      const deviceCodeHash = await client.get(userKey(userCode))
      if (!deviceCodeHash) return ok(null)
      const entry = parse(await client.get(entryKey(deviceCodeHash)))
      return ok(entry ? { deviceCodeHash, entry } : null)
    } catch (cause) {
      return unavailable('device_authorization.read_failed', cause)
    }
  },

  /** Rewrites the entry keeping its TTL; a no-op when it is already gone. */
  async update(
    deviceCodeHash: string,
    entry: DeviceAuthorizationEntry,
  ): Promise<Result<void>> {
    try {
      const client = await ensureRedisConnected()
      await client.set(entryKey(deviceCodeHash), JSON.stringify(entry), {
        expiration: 'KEEPTTL',
        condition: 'XX',
      })
      return ok(undefined)
    } catch (cause) {
      return unavailable('device_authorization.update_failed', cause)
    }
  },

  /**
   * Takes the right to answer a login: `ok(true)` for the first caller
   * only, so two tabs (or two users) never both decide.
   */
  async claimDecision(
    deviceCodeHash: string,
    ttlSeconds: number,
  ): Promise<Result<boolean>> {
    try {
      const client = await ensureRedisConnected()
      const set = await client.set(decidedKey(deviceCodeHash), '1', {
        expiration: { type: 'EX', value: Math.max(1, ttlSeconds) },
        condition: 'NX',
      })
      return ok(set === 'OK')
    } catch (cause) {
      return unavailable('device_authorization.decide_failed', cause)
    }
  },

  /**
   * Removes the login and returns what it was, atomically (`GETDEL`): of
   * two concurrent polls on an approved code, only one gets the entry.
   */
  async consume(
    deviceCodeHash: string,
  ): Promise<Result<DeviceAuthorizationEntry | null>> {
    try {
      const client = await ensureRedisConnected()
      const entry = parse(await client.getDel(entryKey(deviceCodeHash)))
      if (entry) await client.del(userKey(entry.userCode))
      return ok(entry)
    } catch (cause) {
      return unavailable('device_authorization.consume_failed', cause)
    }
  },
}
