import { auditMutation } from '@/lib/axiom/audit'
import { crmCustomFieldInvalid } from '@/src/errors'
import { customFieldKeyFromLabel } from '@/src/lib/custom-field-value'
import { err, ok, type Result } from '@/src/lib/result'
import { toCrmCustomFieldDefinitionDTO } from '@/src/mappers/crm-custom-field.mapper'
import { CrmCustomFieldDefinitionRepository } from '@/src/repositories/crm-custom-field.repository'
import {
  type CreateWhatsAppContactFieldDTO,
  type UpdateWhatsAppContactFieldDTO,
  WHATSAPP_CONTACT_FIELD_LIMIT,
} from '@/src/schemas/whatsapp-contact-field.schema'
import type { WhatsAppContactFieldDTO } from '@/types/whatsapp-contact'
import { assertModuleMember, assertModulePrivileged } from './authz'

const ENTITY = 'WHATSAPP_CONTACT' as const

function toFieldDTO(
  definition: Parameters<typeof toCrmCustomFieldDefinitionDTO>[0],
): WhatsAppContactFieldDTO {
  const dto = toCrmCustomFieldDefinitionDTO(definition)
  return {
    id: dto.id,
    key: dto.key,
    label: dto.label,
    type: dto.type,
    options: dto.options,
    required: dto.required,
    position: dto.position,
  }
}

/**
 * Definitions of the custom fields of WhatsApp contacts (CPF, CNPJ...),
 * stored in the shared custom field tables under `WHATSAPP_CONTACT`. Members
 * of Comunicação read them; OWNER/ADMIN manage them. The values themselves
 * are written through `WhatsAppContactService`.
 */
export const WhatsAppContactFieldService = {
  async list(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppContactFieldDTO[]>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'contacts', action: 'VIEW' },
    )
    if (!membership.ok) return membership

    const result = await CrmCustomFieldDefinitionRepository.listByWorkspace(
      workspaceId,
      { entity: ENTITY },
    )
    if (!result.ok) return result
    return ok(result.value.map(toFieldDTO))
  },

  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateWhatsAppContactFieldDTO,
  ): Promise<Result<WhatsAppContactFieldDTO>> {
    const membership = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!membership.ok) return membership

    const existing = await CrmCustomFieldDefinitionRepository.listByWorkspace(
      workspaceId,
      { entity: ENTITY },
    )
    if (!existing.ok) return existing
    if (existing.value.length >= WHATSAPP_CONTACT_FIELD_LIMIT) {
      return err(
        crmCustomFieldInvalid(
          `Limite de ${WHATSAPP_CONTACT_FIELD_LIMIT} campos por workspace atingido`,
        ),
      )
    }

    const result = await CrmCustomFieldDefinitionRepository.create({
      workspaceId,
      createdById: actorId,
      entity: ENTITY,
      key: customFieldKeyFromLabel(dto.label),
      label: dto.label,
      type: dto.type,
      options: dto.type === 'SELECT' ? dto.options : [],
      required: dto.required,
    })
    if (!result.ok) {
      auditMutation({
        entity: 'whatsapp_contact_field',
        action: 'create',
        actorId,
        outcome: 'failure',
        reason: result.error.code,
      })
      return result
    }

    auditMutation({
      entity: 'whatsapp_contact_field',
      action: 'create',
      actorId,
      targetId: result.value.id,
      meta: { workspaceId, type: dto.type },
    })
    return ok(toFieldDTO(result.value))
  },

  async update(
    actorId: string,
    workspaceId: string,
    fieldId: string,
    dto: UpdateWhatsAppContactFieldDTO,
  ): Promise<Result<WhatsAppContactFieldDTO>> {
    const membership = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!membership.ok) return membership

    const existing = await CrmCustomFieldDefinitionRepository.findById(
      fieldId,
      workspaceId,
    )
    if (!existing.ok) return existing
    if (existing.value.entity !== ENTITY) {
      return err(crmCustomFieldInvalid('Campo não pertence aos contatos'))
    }
    if (dto.options && existing.value.type !== 'SELECT') {
      return err(crmCustomFieldInvalid('Só campos de lista têm opções'))
    }
    if (
      existing.value.type === 'SELECT' &&
      dto.options &&
      dto.options.length === 0
    ) {
      return err(crmCustomFieldInvalid('Informe ao menos uma opção'))
    }

    const result = await CrmCustomFieldDefinitionRepository.update(fieldId, {
      ...dto,
      updatedById: actorId,
    })
    if (!result.ok) return result

    auditMutation({
      entity: 'whatsapp_contact_field',
      action: 'update',
      actorId,
      targetId: fieldId,
      meta: { workspaceId, fields: Object.keys(dto) },
    })
    return ok(toFieldDTO(result.value))
  },

  async remove(
    actorId: string,
    workspaceId: string,
    fieldId: string,
  ): Promise<Result<void>> {
    const membership = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!membership.ok) return membership

    const existing = await CrmCustomFieldDefinitionRepository.findById(
      fieldId,
      workspaceId,
    )
    if (!existing.ok) return existing
    if (existing.value.entity !== ENTITY) {
      return err(crmCustomFieldInvalid('Campo não pertence aos contatos'))
    }

    const result = await CrmCustomFieldDefinitionRepository.softDelete(fieldId)
    if (!result.ok) return result

    auditMutation({
      entity: 'whatsapp_contact_field',
      action: 'delete',
      actorId,
      targetId: fieldId,
      meta: { workspaceId },
    })
    return ok(undefined)
  },
}
