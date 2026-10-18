import { randomBytes, randomInt } from 'node:crypto'
import type { ModuleKind } from '@prisma/client'
import { auditAuth } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import {
  DEVICE_CLAIM_GRACE_SECONDS,
  DeviceAuthorizationCache,
  type DeviceAuthorizationEntry,
  hashDeviceCode,
} from '@/src/cache/device-authorization.cache'
import {
  apiTokenLimitReached,
  authorizationPending,
  deviceAccessDenied,
  deviceCodeInvalid,
  expiredDeviceCode,
  moduleDisabled,
  slowDown,
} from '@/src/errors'
import { appError } from '@/src/errors/app-error'
import { sortApiModules, toApiScopes } from '@/src/lib/api/token'
import { err, ok, type Result } from '@/src/lib/result'
import { ApiTokenRepository } from '@/src/repositories/api-token.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import type {
  DeviceAuthorizationStartInput,
  DeviceAuthorizeInput,
} from '@/src/schemas/api-token.schema'
import {
  ApiTokenService,
  MAX_ACTIVE_API_TOKENS,
} from '@/src/services/api-token.service'
import { assertMember } from '@/src/services/authz'
import type {
  DeviceAuthorizationContextDTO,
  DeviceAuthorizationDTO,
  DeviceAuthorizeResultDTO,
  DeviceTokenDTO,
} from '@/types/api-token'

/**
 * Device authorization flow of the Steel CLI (ADR 0035, RFC 8628 shaped as
 * the contract in docs/cli/README.md). `steel login` starts it and polls;
 * the user confirms the code on `/device`, picking the workspace, modules,
 * access level and validity; the next poll mints an `ApiToken` named
 * "Steel CLI — <máquina>".
 *
 * State lives in Redis (`DeviceAuthorizationCache`) rather than in the
 * Better Auth `device-authorization` plugin: the plugin answers with a
 * session token, has no room for workspace/modules/scopes, and would need
 * its own table.
 */

/** How long `steel login` has until the user confirms (seconds). */
export const DEVICE_CODE_EXPIRES_IN_SECONDS = 600
/** Minimum seconds between polls; `SLOW_DOWN` adds 5 each time. */
export const DEVICE_POLL_INTERVAL_SECONDS = 5
const MAX_POLL_INTERVAL_SECONDS = 60
const SLOW_DOWN_STEP_SECONDS = 5

/** RFC 8628 §6.1: no vowels or look-alikes (0/O, 1/I). */
const USER_CODE_CHARSET = 'BCDFGHJKLMNPQRSTVWXZ23456789'
const USER_CODE_LENGTH = 8
const USER_CODE_ATTEMPTS = 5

const CLI_TOKEN_NAME = 'Steel CLI'
const MAX_TOKEN_NAME = 100

function generateUserCode(): string {
  let code = ''
  for (let i = 0; i < USER_CODE_LENGTH; i++) {
    code += USER_CODE_CHARSET[randomInt(USER_CODE_CHARSET.length)]
  }
  return code
}

/** `ABCDEFGH` → `ABCD-EFGH`, the way the CLI and `/device` show it. */
export function formatUserCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`
}

export function deviceTokenName(deviceName: string | null): string {
  const name = deviceName ? `${CLI_TOKEN_NAME} — ${deviceName}` : CLI_TOKEN_NAME
  return name.slice(0, MAX_TOKEN_NAME)
}

function isExpired(entry: DeviceAuthorizationEntry, now: Date): boolean {
  return Date.parse(entry.expiresAt) <= now.getTime()
}

/** A code the user can still answer on `/device`. */
function isAnswerable(entry: DeviceAuthorizationEntry, now: Date): boolean {
  return entry.status === 'pending' && !isExpired(entry, now)
}

async function enabledModules(
  workspaceId: string,
): Promise<Result<ModuleKind[]>> {
  const access =
    await WorkspaceModuleAccessRepository.listByWorkspace(workspaceId)
  if (!access.ok) return access
  return ok(
    sortApiModules(access.value.filter((m) => m.enabled).map((m) => m.module)),
  )
}

async function findAnswerable(
  userCode: string,
  now: Date,
): Promise<
  Result<{ deviceCodeHash: string; entry: DeviceAuthorizationEntry }>
> {
  const found = await DeviceAuthorizationCache.findByUserCode(userCode)
  if (!found.ok) return found
  if (!found.value || !isAnswerable(found.value.entry, now)) {
    return err(deviceCodeInvalid())
  }
  return ok(found.value)
}

/** Seconds the entry still lives in Redis (expiry + claim grace). */
function remainingTtl(entry: DeviceAuthorizationEntry, now: Date): number {
  const left = Math.ceil((Date.parse(entry.expiresAt) - now.getTime()) / 1000)
  return Math.max(1, left) + DEVICE_CLAIM_GRACE_SECONDS
}

async function claimApproval(
  deviceCodeHash: string,
  now: Date,
): Promise<Result<DeviceTokenDTO>> {
  const consumed = await DeviceAuthorizationCache.consume(deviceCodeHash)
  if (!consumed.ok) return consumed
  const entry = consumed.value
  // Another poll got here first.
  if (!entry?.approval) return err(expiredDeviceCode())

  const { approval } = entry
  const issued = await ApiTokenService.issue(
    approval.userId,
    {
      workspaceId: approval.workspaceId,
      name: deviceTokenName(entry.deviceName),
      scopes: approval.scopes,
      modules: approval.modules,
      expiresInDays: approval.expiresInDays,
      createdVia: 'DEVICE',
      deviceName: entry.deviceName,
    },
    now,
  )
  if (!issued.ok) {
    logger.warn('device_authorization.issue_failed', {
      userId: approval.userId,
      workspaceId: approval.workspaceId,
      code: issued.error.code,
    })
    return issued
  }

  const token = issued.value
  return ok({
    token: token.token,
    tokenId: token.id,
    expiresAt: token.expiresAt,
    workspace: {
      id: token.workspace.id,
      slug: token.workspace.slug,
      name: token.workspace.name,
    },
    scopes: token.scopes,
    modules: token.modules,
  })
}

export const DeviceAuthorizationService = {
  /** `POST /api/v1/auth/device`: a new pending login. */
  async start(
    input: DeviceAuthorizationStartInput,
    origin: string,
    now: Date = new Date(),
  ): Promise<Result<DeviceAuthorizationDTO>> {
    const deviceCode = randomBytes(32).toString('base64url')
    const deviceCodeHash = hashDeviceCode(deviceCode)
    const expiresAt = new Date(
      now.getTime() + DEVICE_CODE_EXPIRES_IN_SECONDS * 1000,
    )

    for (let attempt = 0; attempt < USER_CODE_ATTEMPTS; attempt++) {
      const userCode = generateUserCode()
      const created = await DeviceAuthorizationCache.create(
        deviceCodeHash,
        {
          userCode,
          clientName: input.clientName ?? null,
          deviceName: input.deviceName ?? null,
          status: 'pending',
          createdAt: now.toISOString(),
          expiresAt: expiresAt.toISOString(),
          interval: DEVICE_POLL_INTERVAL_SECONDS,
          lastPolledAt: null,
          approval: null,
          decidedBy: null,
        },
        DEVICE_CODE_EXPIRES_IN_SECONDS + DEVICE_CLAIM_GRACE_SECONDS,
      )
      if (!created.ok) return created
      if (!created.value) continue

      const base = new URL(origin).origin
      const display = formatUserCode(userCode)
      return ok({
        deviceCode,
        userCode: display,
        verificationUri: `${base}/device`,
        verificationUriComplete: `${base}/device?code=${display}`,
        interval: DEVICE_POLL_INTERVAL_SECONDS,
        expiresIn: DEVICE_CODE_EXPIRES_IN_SECONDS,
      })
    }

    logger.error('device_authorization.user_code_exhausted', {})
    return err(
      appError(
        'INTERNAL_SERVER_ERROR',
        'Não foi possível gerar um código de login. Tente de novo.',
      ),
    )
  },

  /**
   * `POST /api/v1/auth/device/token`: `AUTHORIZATION_PENDING` while the
   * user hasn't answered, `SLOW_DOWN` when polled faster than the interval,
   * `EXPIRED_TOKEN` for an expired or unknown code, `ACCESS_DENIED` when
   * refused; approved, it mints the token (once).
   */
  async poll(
    deviceCode: string,
    now: Date = new Date(),
  ): Promise<Result<DeviceTokenDTO>> {
    const deviceCodeHash = hashDeviceCode(deviceCode)
    const found =
      await DeviceAuthorizationCache.findByDeviceCodeHash(deviceCodeHash)
    if (!found.ok) return found
    const entry = found.value
    if (!entry) return err(expiredDeviceCode())

    if (entry.status === 'approved') return claimApproval(deviceCodeHash, now)

    if (entry.status === 'denied') {
      const consumed = await DeviceAuthorizationCache.consume(deviceCodeHash)
      if (!consumed.ok) return consumed
      return err(deviceAccessDenied())
    }

    if (isExpired(entry, now)) {
      const consumed = await DeviceAuthorizationCache.consume(deviceCodeHash)
      if (!consumed.ok) return consumed
      return err(expiredDeviceCode())
    }

    const tooSoon =
      entry.lastPolledAt !== null &&
      now.getTime() - Date.parse(entry.lastPolledAt) < entry.interval * 1000
    const interval = tooSoon
      ? Math.min(
          entry.interval + SLOW_DOWN_STEP_SECONDS,
          MAX_POLL_INTERVAL_SECONDS,
        )
      : entry.interval
    const updated = await DeviceAuthorizationCache.update(deviceCodeHash, {
      ...entry,
      interval,
      lastPolledAt: now.toISOString(),
    })
    if (!updated.ok) return updated

    return err(tooSoon ? slowDown(interval) : authorizationPending())
  },

  /** What `/device` renders for a code: the workspaces the user may pick. */
  async getContext(
    userId: string,
    userCode: string,
    now: Date = new Date(),
  ): Promise<Result<DeviceAuthorizationContextDTO>> {
    const found = await findAnswerable(userCode, now)
    if (!found.ok) return found
    const { entry } = found.value

    const workspaces = await ApiTokenService.listGrantableWorkspaces(userId)
    if (!workspaces.ok) return workspaces

    return ok({
      userCode: formatUserCode(entry.userCode),
      deviceName: entry.deviceName,
      expiresAt: entry.expiresAt,
      workspaces: workspaces.value,
    })
  },

  /**
   * `POST /api/device/authorize`: the user's answer on `/device`. Approving
   * checks membership, enabled modules and the token cap up front, so the
   * failure shows on the page rather than in the terminal; the token itself
   * is minted on the CLI's next poll.
   */
  async decide(
    userId: string,
    input: DeviceAuthorizeInput,
    now: Date = new Date(),
  ): Promise<Result<DeviceAuthorizeResultDTO>> {
    const found = await findAnswerable(input.userCode, now)
    if (!found.ok) return found
    const { deviceCodeHash, entry } = found.value

    if (input.accept) {
      const membership = await assertMember(userId, input.workspaceId)
      if (!membership.ok) return membership

      const enabled = await enabledModules(input.workspaceId)
      if (!enabled.ok) return enabled
      if (!input.modules.every((module) => enabled.value.includes(module))) {
        return err(moduleDisabled())
      }

      const active = await ApiTokenRepository.countActiveByUser(userId, now)
      if (!active.ok) return active
      if (active.value >= MAX_ACTIVE_API_TOKENS) {
        return err(apiTokenLimitReached(MAX_ACTIVE_API_TOKENS))
      }
    }

    const claimed = await DeviceAuthorizationCache.claimDecision(
      deviceCodeHash,
      remainingTtl(entry, now),
    )
    if (!claimed.ok) return claimed
    if (!claimed.value) return err(deviceCodeInvalid())

    const next: DeviceAuthorizationEntry = input.accept
      ? {
          ...entry,
          status: 'approved',
          decidedBy: userId,
          approval: {
            userId,
            workspaceId: input.workspaceId,
            scopes: toApiScopes(input.scopes),
            modules: sortApiModules(input.modules),
            expiresInDays: input.expiresInDays,
          },
        }
      : { ...entry, status: 'denied', decidedBy: userId }
    const saved = await DeviceAuthorizationCache.update(deviceCodeHash, next)
    if (!saved.ok) return saved

    if (input.accept) {
      auditAuth({
        event: 'auth.device_authorization.approved',
        userId,
        meta: {
          workspaceId: input.workspaceId,
          scopes: next.approval?.scopes,
          modules: next.approval?.modules,
          expiresInDays: input.expiresInDays,
          clientName: entry.clientName ?? null,
          deviceName: entry.deviceName,
        },
      })
      return ok({ status: 'approved' })
    }

    auditAuth({
      event: 'auth.device_authorization.denied',
      userId,
      meta: {
        clientName: entry.clientName ?? null,
        deviceName: entry.deviceName,
      },
    })
    return ok({ status: 'denied' })
  },
}
