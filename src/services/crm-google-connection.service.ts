import { auditMutation } from '@/lib/axiom/audit'
import {
  crmGoogleApiFailed,
  crmSocialNotConfigured,
  crmSocialOauthFailed,
  crmSocialScopeMissing,
  crmSocialStateInvalid,
  forbidden,
} from '@/src/errors'
import { listAccounts, listLocations } from '@/src/lib/google-business/client'
import {
  buildGoogleBusinessAuthorizeUrl,
  exchangeGoogleBusinessCode,
  fetchGoogleEmail,
  hasBusinessScope,
  isGoogleBusinessConfigured,
  revokeGoogleToken,
} from '@/src/lib/google-business/oauth'
import { formatAddress } from '@/src/lib/google-business/profile'
import {
  createGoogleBusinessState,
  verifyGoogleBusinessState,
} from '@/src/lib/google-business/state'
import { err, ok, type Result } from '@/src/lib/result'
import { decryptToken, encryptToken } from '@/src/lib/social/crypto'
import { toCrmGoogleConnectionDTO } from '@/src/mappers/crm-google-presence.mapper'
import { CrmGoogleConnectionRepository } from '@/src/repositories/crm-google-presence.repository'
import { WorkspaceRepository } from '@/src/repositories/workspace.repository'
import type {
  CrmGoogleConnectionDTO,
  CrmGoogleLocationOptionDTO,
  SelectGoogleLocationDTO,
  UpdateGoogleSettingsDTO,
} from '@/src/schemas/crm-google-presence.schema'
import { assertModuleMember } from './authz'
import { syncReviews } from './crm-google-sync.service'
import { googleAccessFor } from './crm-google-token'

const SOCIAL = 'social' as const

export const CrmGoogleConnectionService = {
  /** Connection state for the three screens (also valid when not connected). */
  async get(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<CrmGoogleConnectionDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: SOCIAL,
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const found =
      await CrmGoogleConnectionRepository.findByWorkspace(workspaceId)
    if (!found.ok) return found
    return ok(
      toCrmGoogleConnectionDTO(found.value, isGoogleBusinessConfigured()),
    )
  },

  /** Authorization URL of Google (the route answers with a 302). */
  async beginConnect(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<{ authorizeUrl: string }>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: SOCIAL,
      action: 'CREATE',
    })
    if (!membership.ok) return membership
    if (!isGoogleBusinessConfigured()) return err(crmSocialNotConfigured())

    const workspace = await WorkspaceRepository.findById(workspaceId)
    if (!workspace.ok) return workspace

    const state = createGoogleBusinessState({
      workspaceId,
      slug: workspace.value.slug,
      userId: actorId,
    })
    return ok({ authorizeUrl: buildGoogleBusinessAuthorizeUrl(state) })
  },

  /** Callback of Google: trades the code for tokens and stores them encrypted. */
  async completeConnect(
    actorId: string,
    state: string,
    code: string,
  ): Promise<Result<{ workspaceSlug: string }>> {
    const verified = verifyGoogleBusinessState(state)
    if (!verified.ok) return err(crmSocialStateInvalid())
    const { workspaceId, slug, userId } = verified.value
    // The flow must finish in the session that started it.
    if (userId !== actorId) return err(forbidden())

    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: SOCIAL,
      action: 'CREATE',
    })
    if (!membership.ok) return membership
    if (!isGoogleBusinessConfigured()) return err(crmSocialNotConfigured())

    const tokens = await exchangeGoogleBusinessCode(code)
    if (!tokens.ok) return tokens
    // The user can untick the Business Profile permission on Google's screen.
    if (!hasBusinessScope(tokens.value.scope))
      return err(crmSocialScopeMissing())

    const email = await fetchGoogleEmail(tokens.value.accessToken)
    const saved = await CrmGoogleConnectionRepository.upsertOAuth({
      workspaceId,
      connectedById: actorId,
      googleEmail: email,
      accessToken: encryptToken(tokens.value.accessToken),
      refreshToken: tokens.value.refreshToken
        ? encryptToken(tokens.value.refreshToken)
        : null,
      tokenExpiresAt: tokens.value.expiresAt,
      scope: tokens.value.scope,
    })
    if (!saved.ok) return saved

    auditMutation({
      entity: 'crm_google_connection',
      action: 'create',
      actorId,
      targetId: saved.value.id,
      meta: { workspaceId, via: 'oauth' },
    })
    return ok({ workspaceSlug: slug })
  },

  /** Locations the connected Google account can manage, across its accounts. */
  async listLocations(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<CrmGoogleLocationOptionDTO[]>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: SOCIAL,
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const access = await googleAccessFor(workspaceId)
    if (!access.ok) return access
    const { accessToken } = access.value

    const accounts = await listAccounts(accessToken)
    if (!accounts.ok) return accounts

    const options: CrmGoogleLocationOptionDTO[] = []
    let lastError: Result<never> | null = null
    for (const account of accounts.value.slice(0, 10)) {
      if (!account.name) continue
      const locations = await listLocations(accessToken, account.name)
      if (!locations.ok) {
        lastError = locations
        continue
      }
      for (const location of locations.value) {
        if (!location.name) continue
        options.push({
          accountName: account.name,
          accountLabel: account.accountName ?? account.name,
          locationName: location.name,
          title: location.title ?? 'Local sem nome',
          address: formatAddress(location.storefrontAddress),
          placeId: location.metadata?.placeId ?? null,
        })
      }
    }
    // Every account failed: surface the reason instead of an empty list.
    if (options.length === 0 && lastError && !lastError.ok) return lastError
    return ok(options)
  },

  /** Picks the location this workspace manages and primes the review cache. */
  async selectLocation(
    actorId: string,
    workspaceId: string,
    dto: SelectGoogleLocationDTO,
  ): Promise<Result<CrmGoogleConnectionDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: SOCIAL,
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    const access = await googleAccessFor(workspaceId)
    if (!access.ok) return access

    // The location must belong to the account sent with it.
    const locations = await listLocations(
      access.value.accessToken,
      dto.accountName,
    )
    if (!locations.ok) return locations
    const location = locations.value.find((l) => l.name === dto.locationName)
    if (!location) {
      return err(
        crmGoogleApiFailed(
          'Este local não pertence à conta do Google escolhida.',
        ),
      )
    }

    const updated = await CrmGoogleConnectionRepository.setLocation(
      access.value.connection.id,
      {
        accountName: dto.accountName,
        locationName: dto.locationName,
        locationTitle: location.title ?? 'Local do Google',
        placeId: location.metadata?.placeId ?? null,
        mapsUri: location.metadata?.mapsUri ?? null,
        newReviewUri: location.metadata?.newReviewUri ?? null,
      },
    )
    if (!updated.ok) return updated

    auditMutation({
      entity: 'crm_google_connection',
      action: 'update',
      actorId,
      targetId: updated.value.id,
      meta: { workspaceId, locationName: dto.locationName },
    })

    // First look at the reviews right away; the worker brings the rest. A
    // failure is stored on the connection and shown on the screen.
    await syncReviews(updated.value, { maxPages: 2 })
    const refreshed =
      await CrmGoogleConnectionRepository.findByWorkspace(workspaceId)
    if (!refreshed.ok) return refreshed
    return ok(
      toCrmGoogleConnectionDTO(refreshed.value, isGoogleBusinessConfigured()),
    )
  },

  async updateSettings(
    actorId: string,
    workspaceId: string,
    dto: UpdateGoogleSettingsDTO,
  ): Promise<Result<CrmGoogleConnectionDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: SOCIAL,
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    const found =
      await CrmGoogleConnectionRepository.findByWorkspace(workspaceId)
    if (!found.ok) return found
    if (!found.value)
      return err(crmSocialOauthFailed('Conecte o Google antes.'))

    const updated = await CrmGoogleConnectionRepository.updateReplyTone(
      found.value.id,
      dto.replyTone,
    )
    if (!updated.ok) return updated

    auditMutation({
      entity: 'crm_google_connection',
      action: 'update',
      actorId,
      targetId: updated.value.id,
      meta: { workspaceId, field: 'replyTone' },
    })
    return ok(
      toCrmGoogleConnectionDTO(updated.value, isGoogleBusinessConfigured()),
    )
  },

  /** Removes the connection (and the cache) and revokes the Google grant. */
  async disconnect(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<void>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: SOCIAL,
      action: 'DELETE',
    })
    if (!membership.ok) return membership

    const found =
      await CrmGoogleConnectionRepository.findByWorkspace(workspaceId)
    if (!found.ok) return found
    if (!found.value) return ok(undefined)

    const removed =
      await CrmGoogleConnectionRepository.removeByWorkspace(workspaceId)
    if (!removed.ok) return removed

    try {
      const token = found.value.refreshToken ?? found.value.accessToken
      await revokeGoogleToken(decryptToken(token))
    } catch {
      // Undecryptable token: nothing to revoke.
    }

    auditMutation({
      entity: 'crm_google_connection',
      action: 'delete',
      actorId,
      targetId: found.value.id,
      meta: { workspaceId },
    })
    return ok(undefined)
  },
}
