import { auditMutation } from '@/lib/axiom/audit'
import { ok, type Result } from '@/src/lib/result'
import { toCrmDealsSettingsDTO } from '@/src/mappers/crm-deals.mapper'
import { CrmDealsSettingsRepository } from '@/src/repositories/crm-deals-settings.repository'
import type { UpdateCrmDealsSettingsDTO } from '@/src/schemas/crm-deals.schema'
import type { CrmDealsSettingsDTO } from '@/types/crm-deals'
import { assertModuleMember, assertModulePrivileged } from './authz'

/** Switches of the deal tools: proposal payment/signature and renewals. */
export const CrmDealsSettingsService = {
  /** Any CRM member reads them (the screens adapt to the switches). */
  async get(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<CrmDealsSettingsDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM')
    if (!membership.ok) return membership
    return CrmDealsSettingsService.resolve(workspaceId)
  },

  /** Only OWNER/ADMIN change them. */
  async update(
    actorId: string,
    workspaceId: string,
    dto: UpdateCrmDealsSettingsDTO,
  ): Promise<Result<CrmDealsSettingsDTO>> {
    const membership = await assertModulePrivileged(actorId, workspaceId, 'CRM')
    if (!membership.ok) return membership

    const saved = await CrmDealsSettingsRepository.upsert(
      workspaceId,
      actorId,
      dto,
    )
    if (!saved.ok) return saved

    auditMutation({
      entity: 'crm_deals_settings',
      action: 'update',
      actorId,
      targetId: workspaceId,
      meta: { ...dto },
    })
    return ok(toCrmDealsSettingsDTO(saved.value))
  },

  /** Effective settings without an access check (callers already authorized). */
  async resolve(workspaceId: string): Promise<Result<CrmDealsSettingsDTO>> {
    const row = await CrmDealsSettingsRepository.findByWorkspace(workspaceId)
    if (!row.ok) return row
    return ok(toCrmDealsSettingsDTO(row.value))
  },
}
