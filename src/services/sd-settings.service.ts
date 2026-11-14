import type { Prisma } from '@prisma/client'
import { sdConfigNotFound } from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import {
  toSdSettingsDTO,
  toSdTicketPrefixes,
} from '@/src/mappers/sd-settings.mapper'
import { SdSettingsRepository } from '@/src/repositories/sd-settings.repository'
import { SdSlaPolicyRepository } from '@/src/repositories/sd-sla-policy.repository'
import type { UpdateSdSettingsDTO } from '@/src/schemas/sd-settings.schema'
import type { SdSettingsDTO } from '@/types/sd-settings'
import { SdAccess } from './sd-access'
import { assertSdRefs, sdAdminMutation } from './sd-config-support'

export const SdSettingsService = {
  /** Qualquer membro com acesso ao módulo lê (a linha nasce com os padrões). */
  async get(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<SdSettingsDTO>> {
    const ctx = await SdAccess.resolve(actorId, workspaceId)
    if (!ctx.ok) return ctx

    const settings = await SdSettingsRepository.getOrCreate(workspaceId)
    if (!settings.ok) return settings
    return ok(toSdSettingsDTO(settings.value))
  },

  async update(
    actorId: string,
    workspaceId: string,
    dto: UpdateSdSettingsDTO,
  ): Promise<Result<SdSettingsDTO>> {
    return sdAdminMutation({
      actorId,
      workspaceId,
      entity: 'sd_settings',
      action: 'update',
      targetId: workspaceId,
      meta: { fields: Object.keys(dto) },
      run: async () => {
        const refs = await assertSdRefs(workspaceId, {
          departmentIds: [dto.defaultDepartmentId],
          slaPolicyIds: [dto.defaultSlaPolicyId],
        })
        if (!refs.ok) return refs

        if (dto.whatsappConnectionId) {
          const exists = await SdSettingsRepository.whatsappConnectionExists(
            workspaceId,
            dto.whatsappConnectionId,
          )
          if (!exists.ok) return exists
          if (!exists.value) {
            return err({
              ...sdConfigNotFound(),
              message:
                'Conexão de WhatsApp não encontrada (precisa ser do módulo ServiceDesk)',
            })
          }
        }

        const current = await SdSettingsRepository.getOrCreate(workspaceId)
        if (!current.ok) return current

        const { ticketPrefixes, requesterWhatsappTemplates, ...rest } = dto
        const updated = await SdSettingsRepository.update(workspaceId, {
          ...rest,
          ...(ticketPrefixes && {
            ticketPrefixes: {
              ...toSdTicketPrefixes(current.value.ticketPrefixes),
              ...ticketPrefixes,
            } as Prisma.InputJsonValue,
          }),
          ...(requesterWhatsappTemplates && {
            requesterWhatsappTemplates:
              requesterWhatsappTemplates as Prisma.InputJsonValue,
          }),
          updatedById: actorId,
        })
        if (!updated.ok) return updated

        if (dto.defaultSlaPolicyId) {
          const synced = await SdSlaPolicyRepository.setDefault(
            workspaceId,
            dto.defaultSlaPolicyId,
          )
          if (!synced.ok) return synced
        }

        return ok(toSdSettingsDTO(updated.value))
      },
    })
  },
}
