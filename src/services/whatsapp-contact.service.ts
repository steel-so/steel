import { auditMutation } from '@/lib/axiom/audit'
import {
  validationError,
  whatsappContactNotFound,
  whatsappContactPhotoUnavailable,
  whatsappProviderError,
} from '@/src/errors'
import { decryptConnectionSecret } from '@/src/lib/crypto'
import { err, ok, type Result } from '@/src/lib/result'
import { indexSearchDocument } from '@/src/lib/search/index-hooks'
import { startOfSaoPauloDay } from '@/src/lib/whatsapp/contact-created-today'
import { getZapiContactProfilePicture } from '@/src/lib/whatsapp/zapi-client'
import { toWhatsAppContactDTO } from '@/src/mappers/whatsapp-contact.mapper'
import { CrmCustomFieldValueRepository } from '@/src/repositories/crm-custom-field.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import type {
  CreateWhatsAppContactDTO,
  FindOrCreateWhatsAppContactDTO,
  ListWhatsAppContactsDTO,
  UpdateWhatsAppContactBroadcastOptOutDTO,
  UpdateWhatsAppContactDTO,
} from '@/src/schemas/whatsapp-contact.schema'
import type { WhatsAppContactDTO } from '@/types/whatsapp-contact'
import { assertModuleMember, assertModulePrivileged } from './authz'
import {
  CUSTOM_FIELD_PREFIX,
  loadCustomFieldMaps,
  resolveCustomFieldWrites,
} from './crm-custom-field-sync'

type ContactFieldValues = NonNullable<WhatsAppContactDTO['customFields']>

/** Attaches `customFields` (`definitionId -> value`) to contact DTOs, in batch. */
async function withContactFields(
  dtos: WhatsAppContactDTO[],
): Promise<Result<WhatsAppContactDTO[]>> {
  if (dtos.length === 0) return ok(dtos)
  const maps = await loadCustomFieldMaps(dtos.map((dto) => dto.id))
  if (!maps.ok) return maps
  return ok(
    dtos.map((dto) => {
      const flat = maps.value.get(dto.id) ?? {}
      const customFields: ContactFieldValues = {}
      for (const [key, value] of Object.entries(flat)) {
        customFields[key.slice(CUSTOM_FIELD_PREFIX.length)] =
          value as ContactFieldValues[string]
      }
      return { ...dto, customFields }
    }),
  )
}

async function withContactField(
  dto: WhatsAppContactDTO,
): Promise<Result<WhatsAppContactDTO>> {
  const withFields = await withContactFields([dto])
  return withFields.ok ? ok(withFields.value[0]) : withFields
}

/** Writes already-validated field values for a contact. */
async function writeContactFields(
  workspaceId: string,
  contactId: string,
  values: Record<string, unknown> | undefined,
): Promise<Result<void>> {
  if (!values || Object.keys(values).length === 0) return ok(undefined)
  const writes = await resolveCustomFieldWrites(
    workspaceId,
    'WHATSAPP_CONTACT',
    contactId,
    values,
  )
  if (!writes.ok) return writes
  return CrmCustomFieldValueRepository.applyForRecord(writes.value)
}

export const WhatsAppContactService = {
  async list(
    actorId: string,
    workspaceId: string,
    options: ListWhatsAppContactsDTO,
  ): Promise<Result<WhatsAppContactDTO[]>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'contacts', action: 'VIEW' },
    )
    if (!membership.ok) return membership

    // A search also matches the contacts' custom field values (a CPF typed
    // with or without punctuation finds the contact).
    let extraIds: string[] = []
    if (options.search) {
      const digits = options.search.replace(/\D/g, '')
      const byField = await CrmCustomFieldValueRepository.searchContactIds(
        workspaceId,
        digits.length >= 3 ? [options.search, digits] : [options.search],
      )
      if (!byField.ok) return byField
      extraIds = byField.value
    }

    const result = await WhatsAppContactRepository.listByWorkspace(
      workspaceId,
      options.search,
      options.whatsapp,
      options.created === 'today' ? startOfSaoPauloDay() : undefined,
      options.description,
      extraIds,
    )
    if (!result.ok) return result

    return withContactFields(result.value.map(toWhatsAppContactDTO))
  },

  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateWhatsAppContactDTO,
  ): Promise<Result<WhatsAppContactDTO>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'contacts', action: 'CREATE' },
    )
    if (!membership.ok) return membership

    // Validate the field values before creating anything.
    const checked = await resolveCustomFieldWrites(
      workspaceId,
      'WHATSAPP_CONTACT',
      '',
      dto.customFields ?? {},
    )
    if (!checked.ok) return checked

    const result = await WhatsAppContactRepository.create({
      workspaceId,
      waId: dto.waId,
      name: dto.name,
      avatarUrl: dto.avatarUrl,
      description: dto.description,
    })
    if (!result.ok) {
      auditMutation({
        entity: 'whatsapp_contact',
        action: 'create',
        actorId,
        outcome: 'failure',
        reason: result.error.code,
      })
      return result
    }

    auditMutation({
      entity: 'whatsapp_contact',
      action: 'create',
      actorId,
      targetId: result.value.id,
    })

    const written = await writeContactFields(
      workspaceId,
      result.value.id,
      dto.customFields,
    )
    if (!written.ok) return written

    void indexSearchDocument('zap-contact', workspaceId, result.value.id)
    return withContactField(toWhatsAppContactDTO(result.value))
  },

  async findOrCreate(
    actorId: string,
    workspaceId: string,
    dto: FindOrCreateWhatsAppContactDTO,
  ): Promise<Result<WhatsAppContactDTO>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'contacts', action: 'CREATE' },
    )
    if (!membership.ok) return membership

    const result = await WhatsAppContactRepository.upsertByWaId({
      workspaceId,
      waId: dto.waId,
      name: dto.name,
    })
    if (!result.ok) return result

    void indexSearchDocument('zap-contact', workspaceId, result.value.id)
    return ok(toWhatsAppContactDTO(result.value))
  },

  async syncAvatar(
    actorId: string,
    workspaceId: string,
    id: string,
  ): Promise<Result<WhatsAppContactDTO>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'contacts', action: 'EDIT' },
    )
    if (!membership.ok) return membership

    const existing = await WhatsAppContactRepository.findById(id, workspaceId)
    if (!existing.ok) return existing
    if (!existing.value) return err(whatsappContactNotFound())

    const connections =
      await WhatsAppConnectionRepository.listByWorkspace(workspaceId)
    if (!connections.ok) return connections
    const zapiConnection = connections.value.find(
      (connection) =>
        connection.provider === 'ZAPI' &&
        connection.zapiInstanceId &&
        connection.encryptedZapiToken,
    )
    if (!zapiConnection) {
      return err(
        whatsappContactPhotoUnavailable(
          'Buscar foto de perfil exige uma conexão Z-API — a API oficial da Meta não expõe fotos de contato',
        ),
      )
    }

    let avatarUrl: string | null
    try {
      const token = await decryptConnectionSecret(
        zapiConnection.encryptedZapiToken as string,
      )
      const clientToken = zapiConnection.encryptedZapiClientToken
        ? await decryptConnectionSecret(zapiConnection.encryptedZapiClientToken)
        : undefined
      avatarUrl = await getZapiContactProfilePicture(
        {
          instanceId: zapiConnection.zapiInstanceId as string,
          token,
          clientToken,
        },
        existing.value.waId,
      )
    } catch (error) {
      return err(
        whatsappProviderError(
          error instanceof Error ? error.message : 'Falha ao buscar foto',
        ),
      )
    }

    if (!avatarUrl) {
      return err(
        whatsappContactPhotoUnavailable(
          'Este contato não tem foto de perfil disponível no WhatsApp',
        ),
      )
    }

    const result = await WhatsAppContactRepository.update(id, { avatarUrl })
    if (!result.ok) return result

    return ok(toWhatsAppContactDTO(result.value))
  },

  async update(
    actorId: string,
    workspaceId: string,
    id: string,
    dto: UpdateWhatsAppContactDTO,
  ): Promise<Result<WhatsAppContactDTO>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'contacts', action: 'EDIT' },
    )
    if (!membership.ok) return membership

    const existing = await WhatsAppContactRepository.findById(id, workspaceId)
    if (!existing.ok) return existing
    if (!existing.value) return err(whatsappContactNotFound())

    const { customFields, ...columns } = dto
    // Validate the field values before touching the contact.
    const checked = await resolveCustomFieldWrites(
      workspaceId,
      'WHATSAPP_CONTACT',
      id,
      customFields ?? {},
    )
    if (!checked.ok) return checked

    const result = await WhatsAppContactRepository.update(id, columns)
    if (!result.ok) return result

    const written = await writeContactFields(workspaceId, id, customFields)
    if (!written.ok) return written

    auditMutation({
      entity: 'whatsapp_contact',
      action: 'update',
      actorId,
      targetId: id,
      // Field ids only: CPF/CNPJ values never go to the log.
      meta: {
        fields: Object.keys(columns),
        customFieldIds: Object.keys(customFields ?? {}),
      },
    })

    void indexSearchDocument('zap-contact', workspaceId, id)
    return withContactField(toWhatsAppContactDTO(result.value))
  },

  /**
   * Opt-out LGPD de transmissões pelo admin (OWNER/ADMIN). Descadastrar é
   * livre (ex: pedido por telefone/e-mail); reinscrever exige que o próprio
   * contato tenha pedido explicitamente (`contactRequested`) — o admin não
   * pode reverter um "SAIR" por conta própria. Tudo auditado.
   */
  async setBroadcastOptOut(
    actorId: string,
    workspaceId: string,
    id: string,
    dto: UpdateWhatsAppContactBroadcastOptOutDTO,
  ): Promise<Result<WhatsAppContactDTO>> {
    const membership = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!membership.ok) return membership

    if (!dto.optedOut && dto.contactRequested !== true) {
      return err(
        validationError(
          'Reinscrição só é permitida a pedido explícito do contato',
        ),
      )
    }

    const existing = await WhatsAppContactRepository.findById(id, workspaceId)
    if (!existing.ok) return existing
    if (!existing.value) return err(whatsappContactNotFound())

    const result = await WhatsAppContactRepository.setBroadcastOptOut(
      id,
      dto.optedOut ? { at: new Date(), source: 'ADMIN' } : null,
    )
    if (!result.ok) return result

    auditMutation({
      entity: 'whatsapp_contact',
      action: dto.optedOut ? 'opt_out' : 'opt_in',
      actorId,
      targetId: id,
      meta: {
        workspaceId,
        channel: 'whatsapp',
        source: 'ADMIN',
        ...(dto.optedOut
          ? {}
          : {
              contactRequested: true,
              previousOptOutAt:
                existing.value.broadcastOptedOutAt?.toISOString() ?? null,
              previousOptOutSource: existing.value.broadcastOptOutSource,
            }),
      },
    })

    return ok(toWhatsAppContactDTO(result.value))
  },

  async remove(
    actorId: string,
    workspaceId: string,
    id: string,
  ): Promise<Result<void>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'contacts', action: 'DELETE' },
    )
    if (!membership.ok) return membership

    const existing = await WhatsAppContactRepository.findById(id, workspaceId)
    if (!existing.ok) return existing
    if (!existing.value) return err(whatsappContactNotFound())

    const result = await WhatsAppContactRepository.delete(id)
    if (!result.ok) return result

    auditMutation({
      entity: 'whatsapp_contact',
      action: 'delete',
      actorId,
      targetId: id,
    })

    void indexSearchDocument('zap-contact', workspaceId, id)
    return ok(undefined)
  },
}
