import type { FeatureFlag } from '@prisma/client'
import { conflict, notFound } from '@/src/errors'
import { recordAdminAction } from '@/src/lib/admin-audit'
import { invalidatePlatformFlagsCache } from '@/src/lib/platform-flags'
import { err, ok, type Result } from '@/src/lib/result'
import {
  type FeatureFlagWithCount,
  PlatformFlagRepository,
} from '@/src/repositories/platform-flag.repository'
import type {
  CreatePlatformFlagInput,
  SetFlagWorkspaceInput,
  SetWorkspaceBetaInput,
  UpdatePlatformFlagInput,
} from '@/src/schemas/platform-flag.schema'
import type {
  PlatformFlagDTO,
  PlatformFlagWorkspaceDTO,
} from '@/types/platform-flag'
import { assertPlatformAdmin } from './authz'

export function toPlatformFlagDTO(
  flag: FeatureFlag & { _count?: { workspaces: number } },
): PlatformFlagDTO {
  return {
    id: flag.id,
    key: flag.key,
    name: flag.name,
    description: flag.description,
    enabled: flag.enabled,
    betaEnabled: flag.betaEnabled,
    workspaceCount: flag._count?.workspaces ?? 0,
    createdAt: flag.createdAt.toISOString(),
    updatedAt: flag.updatedAt.toISOString(),
  }
}

async function loadFlag(id: string): Promise<Result<FeatureFlagWithCount>> {
  const found = await PlatformFlagRepository.findById(id)
  if (!found.ok) return found
  if (!found.value) return err(notFound('FeatureFlag'))
  return ok(found.value)
}

/** Feature flags da plataforma e workspaces beta (painel `/admin/feature-flags`). */
export const AdminFeatureFlagService = {
  async list(actorId: string): Promise<Result<PlatformFlagDTO[]>> {
    const admin = await assertPlatformAdmin(actorId)
    if (!admin.ok) return admin
    const flags = await PlatformFlagRepository.list()
    if (!flags.ok) return flags
    return ok(flags.value.map(toPlatformFlagDTO))
  },

  async create(
    actorId: string,
    input: CreatePlatformFlagInput,
  ): Promise<Result<PlatformFlagDTO>> {
    const admin = await assertPlatformAdmin(actorId)
    if (!admin.ok) return admin

    const existing = await PlatformFlagRepository.findByKey(input.key)
    if (!existing.ok) return existing
    if (existing.value) return err(conflict('Já existe uma flag com essa chave'))

    const created = await PlatformFlagRepository.create(input)
    if (!created.ok) return created

    invalidatePlatformFlagsCache()
    await recordAdminAction({
      actor: admin.value,
      action: 'feature_flag.create',
      audit: { entity: 'platform_feature_flag', action: 'create' },
      targetType: 'platform',
      targetId: created.value.id,
      targetLabel: created.value.key,
    })
    return ok(toPlatformFlagDTO(created.value))
  },

  async update(
    actorId: string,
    id: string,
    input: UpdatePlatformFlagInput,
  ): Promise<Result<PlatformFlagDTO>> {
    const admin = await assertPlatformAdmin(actorId)
    if (!admin.ok) return admin

    const current = await loadFlag(id)
    if (!current.ok) return current

    const updated = await PlatformFlagRepository.update(id, input)
    if (!updated.ok) return updated

    invalidatePlatformFlagsCache()
    await recordAdminAction({
      actor: admin.value,
      action: 'feature_flag.update',
      audit: { entity: 'platform_feature_flag', action: 'update' },
      targetType: 'platform',
      targetId: id,
      targetLabel: current.value.key,
      meta: { changes: input },
    })
    return ok(toPlatformFlagDTO(updated.value))
  },

  async remove(actorId: string, id: string): Promise<Result<{ id: string }>> {
    const admin = await assertPlatformAdmin(actorId)
    if (!admin.ok) return admin

    const current = await loadFlag(id)
    if (!current.ok) return current

    const deleted = await PlatformFlagRepository.delete(id)
    if (!deleted.ok) return deleted

    invalidatePlatformFlagsCache()
    await recordAdminAction({
      actor: admin.value,
      action: 'feature_flag.delete',
      audit: { entity: 'platform_feature_flag', action: 'delete' },
      targetType: 'platform',
      targetId: id,
      targetLabel: current.value.key,
    })
    return ok({ id })
  },

  /** Libera ou revoga a flag para um workspace específico. */
  async setWorkspaceGrant(
    actorId: string,
    flagId: string,
    input: SetFlagWorkspaceInput,
  ): Promise<Result<PlatformFlagDTO>> {
    const admin = await assertPlatformAdmin(actorId)
    if (!admin.ok) return admin

    const current = await loadFlag(flagId)
    if (!current.ok) return current

    const saved = await PlatformFlagRepository.setGrant(
      flagId,
      input.workspaceId,
      input.granted,
    )
    if (!saved.ok) return saved

    invalidatePlatformFlagsCache()
    await recordAdminAction({
      actor: admin.value,
      action: input.granted ? 'feature_flag.grant' : 'feature_flag.revoke',
      audit: {
        entity: 'platform_feature_flag',
        action: input.granted ? 'grant' : 'revoke',
      },
      targetType: 'workspace',
      targetId: input.workspaceId,
      targetLabel: current.value.key,
    })

    const refreshed = await loadFlag(flagId)
    if (!refreshed.ok) return refreshed
    return ok(toPlatformFlagDTO(refreshed.value))
  },

  /** Workspaces com busca; com `flagId`, marca quais têm a flag liberada. */
  async listWorkspaces(
    actorId: string,
    query: { search?: string; flagId?: string } = {},
  ): Promise<Result<PlatformFlagWorkspaceDTO[]>> {
    const admin = await assertPlatformAdmin(actorId)
    if (!admin.ok) return admin

    const rows = await PlatformFlagRepository.listWorkspaces(query.search)
    if (!rows.ok) return rows

    let granted: Set<string> | null = null
    if (query.flagId) {
      const ids = await PlatformFlagRepository.listGrantedWorkspaceIds(
        query.flagId,
      )
      if (!ids.ok) return ids
      granted = new Set(ids.value)
    }

    return ok(
      rows.value.map((ws) => ({
        id: ws.id,
        name: ws.name,
        slug: ws.slug,
        beta: ws.beta,
        ...(granted && { granted: granted.has(ws.id) }),
      })),
    )
  },

  async setWorkspaceBeta(
    actorId: string,
    input: SetWorkspaceBetaInput,
  ): Promise<Result<PlatformFlagWorkspaceDTO>> {
    const admin = await assertPlatformAdmin(actorId)
    if (!admin.ok) return admin

    const saved = await PlatformFlagRepository.setWorkspaceBeta(
      input.workspaceId,
      input.beta,
    )
    if (!saved.ok) return saved

    invalidatePlatformFlagsCache()
    await recordAdminAction({
      actor: admin.value,
      action: input.beta ? 'workspace.beta_on' : 'workspace.beta_off',
      audit: { entity: 'workspace', action: 'update' },
      targetType: 'workspace',
      targetId: saved.value.id,
      targetLabel: saved.value.slug,
    })
    return ok(saved.value)
  },
}
