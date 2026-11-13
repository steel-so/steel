import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { sdCustomerNotFound, validationError } from '@/src/errors'
import type { PermissionAction } from '@/src/lib/permissions'
import { err, ok, type Result } from '@/src/lib/result'
import { indexSearchDocument } from '@/src/lib/search/index-hooks'
import { mapSdContactImportRecord } from '@/src/lib/servicedesk/directory-import'
import {
  formatPhone,
  normalizeDocument,
  normalizePhone,
  whatsappCandidates,
} from '@/src/lib/servicedesk/document'
import {
  toSdContactDetailDTO,
  toSdContactDTO,
} from '@/src/mappers/sd-contact.mapper'
import {
  type SdContactLinkInput,
  SdContactRepository,
  type SdContactWriteData,
} from '@/src/repositories/sd-contact.repository'
import { SdCustomerRepository } from '@/src/repositories/sd-customer.repository'
import {
  type CreateSdContactDTO,
  CreateSdContactSchema,
  type ListSdContactsDTO,
  type SdContactLookupDTO,
  type SdContactOptionsDTO,
  type UpdateSdContactDTO,
} from '@/src/schemas/sd-contact.schema'
import type {
  SdImportRowsDTO,
  SdOptionsQueryDTO,
} from '@/src/schemas/sd-directory.schema'
import type { SdContactDetailDTO, SdContactDTO } from '@/types/sd-contact'
import type {
  SdImportResultDTO,
  SdOptionDTO,
  SdPage,
} from '@/types/sd-directory'
import { SdAccess } from './sd-access'
import { validateSdEntityCustomFields } from './sd-entity-custom-fields'
import { emitEntityWebhook } from './webhook-entity-events'

const RESOURCE = 'sd-contacts'

function agent(actorId: string, workspaceId: string, action: PermissionAction) {
  return SdAccess.requireAgent(actorId, workspaceId, {
    resource: RESOURCE,
    action,
  })
}

/**
 * Remove vínculos repetidos e garante um único principal (o marcado, ou o
 * primeiro da lista); depois confere que todos existem na workspace.
 */
async function resolveLinks(
  workspaceId: string,
  input: { customerId: string; isPrimary: boolean }[],
): Promise<Result<SdContactLinkInput[]>> {
  const byId = new Map<string, SdContactLinkInput>()
  for (const link of input) {
    const current = byId.get(link.customerId)
    byId.set(link.customerId, {
      customerId: link.customerId,
      isPrimary: Boolean(current?.isPrimary || link.isPrimary),
    })
  }
  const links = [...byId.values()]
  if (links.length > 0 && !links.some((l) => l.isPrimary)) {
    links[0].isPrimary = true
  }

  const existing = await SdCustomerRepository.findExistingIds(
    workspaceId,
    links.map((l) => l.customerId),
  )
  if (!existing.ok) return existing
  if (existing.value.length !== links.length) return err(sdCustomerNotFound())
  return ok(links)
}

async function assertMember(
  workspaceId: string,
  userId: string | null | undefined,
): Promise<Result<void>> {
  if (!userId) return ok(undefined)
  const member = await SdContactRepository.isWorkspaceMember(
    workspaceId,
    userId,
  )
  if (!member.ok) return member
  if (!member.value) {
    return err(
      validationError('O usuário vinculado precisa ser membro do workspace'),
    )
  }
  return ok(undefined)
}

function phones(dto: {
  phone?: string | null
  whatsapp?: string | null
}): Pick<SdContactWriteData, 'phone' | 'whatsapp'> {
  return {
    ...(dto.phone !== undefined ? { phone: normalizePhone(dto.phone) } : {}),
    ...(dto.whatsapp !== undefined
      ? { whatsapp: normalizePhone(dto.whatsapp) }
      : {}),
  }
}

export const SdContactService = {
  async list(
    actorId: string,
    workspaceId: string,
    filters: ListSdContactsDTO,
  ): Promise<Result<SdPage<SdContactDTO>>> {
    const ctx = await agent(actorId, workspaceId, 'VIEW')
    if (!ctx.ok) return ctx

    const result = await SdContactRepository.list(workspaceId, filters)
    if (!result.ok) return result

    return ok({
      items: result.value.items.map(toSdContactDTO),
      total: result.value.total,
      page: filters.page,
      pageSize: filters.pageSize,
    })
  },

  async get(
    actorId: string,
    workspaceId: string,
    contactId: string,
  ): Promise<Result<SdContactDetailDTO>> {
    const ctx = await agent(actorId, workspaceId, 'VIEW')
    if (!ctx.ok) return ctx

    const contact = await SdContactRepository.findById(contactId, workspaceId)
    if (!contact.ok) return contact

    const tickets = await SdContactRepository.listRecentTickets(
      workspaceId,
      contactId,
    )
    if (!tickets.ok) return tickets

    return ok(toSdContactDetailDTO(contact.value, tickets.value))
  },

  /** Busca leve para o seletor, opcionalmente só contatos de um cliente. */
  async options(
    actorId: string,
    workspaceId: string,
    query: SdContactOptionsDTO,
  ): Promise<Result<SdOptionDTO[]>> {
    const ctx = await agent(actorId, workspaceId, 'VIEW')
    if (!ctx.ok) return ctx

    const rows = await SdContactRepository.options(workspaceId, query)
    if (!rows.ok) return rows

    return ok(
      rows.value.map((row) => {
        const parts = [
          row.jobTitle,
          row.customers[0]?.customer.name ?? null,
          row.email ?? (row.whatsapp ? formatPhone(row.whatsapp) : null),
        ].filter(Boolean)
        return {
          id: row.id,
          label: row.name,
          sublabel: parts.length ? parts.join(' · ') : null,
        }
      }),
    )
  },

  /**
   * Membros da workspace para os seletores de usuário (contato ↔ usuário da
   * plataforma, responsável do CI). Agentes não têm `members:VIEW`, por isso
   * a busca mora aqui.
   */
  async userOptions(
    actorId: string,
    workspaceId: string,
    query: SdOptionsQueryDTO,
  ): Promise<Result<SdOptionDTO[]>> {
    const ctx = await agent(actorId, workspaceId, 'VIEW')
    if (!ctx.ok) return ctx

    const rows = await SdContactRepository.listMemberOptions(workspaceId, query)
    if (!rows.ok) return rows
    return ok(
      rows.value.map((u) => ({ id: u.id, label: u.name, sublabel: u.email })),
    )
  },

  /**
   * Contato ativo pelo WhatsApp (com/sem o nono dígito) ou e-mail — contexto
   * de sistema, sem ator (webhook do WhatsApp do ServiceDesk, e-mail de
   * entrada). `null` quando nenhum casa.
   */
  async findByChannel(
    workspaceId: string,
    channel: { whatsapp?: string | null; email?: string | null },
  ): Promise<Result<SdContactDTO | null>> {
    const result = await SdContactRepository.findByChannel(workspaceId, {
      whatsapp: whatsappCandidates(channel.whatsapp),
      email: channel.email?.trim() || undefined,
    })
    if (!result.ok) return result
    return ok(result.value ? toSdContactDTO(result.value) : null)
  },

  /** `findByChannel` para agentes (rota `contacts/lookup`). */
  async lookup(
    actorId: string,
    workspaceId: string,
    query: SdContactLookupDTO,
  ): Promise<Result<SdContactDTO | null>> {
    const ctx = await agent(actorId, workspaceId, 'VIEW')
    if (!ctx.ok) return ctx
    return SdContactService.findByChannel(workspaceId, query)
  },

  /**
   * Importação de planilha de contatos. A coluna `documento_cliente` (ou
   * equivalentes) vincula o contato, como principal, ao cliente/empresa com
   * aquele CPF/CNPJ. Linhas recusadas voltam com o número da linha.
   */
  async importRows(
    actorId: string,
    workspaceId: string,
    dto: SdImportRowsDTO,
  ): Promise<Result<SdImportResultDTO>> {
    const ctx = await agent(actorId, workspaceId, 'CREATE')
    if (!ctx.ok) return ctx

    let created = 0
    const createdIds: string[] = []
    const rejected: SdImportResultDTO['rejected'] = []
    for (const [index, record] of dto.rows.entries()) {
      const line = index + 2
      const { customerDocument, ...fields } = mapSdContactImportRecord(record)
      const parsed = CreateSdContactSchema.safeParse(fields)
      if (!parsed.success) {
        const issue = parsed.error.issues[0]
        rejected.push({
          line,
          message: `${issue.path.join('.') || 'linha'}: ${issue.message}`,
        })
        continue
      }

      let links: SdContactLinkInput[] = []
      if (customerDocument) {
        const customer = await SdCustomerRepository.findByDocument(
          workspaceId,
          normalizeDocument(customerDocument),
        )
        if (!customer.ok) {
          rejected.push({ line, message: customer.error.message })
          continue
        }
        if (!customer.value) {
          rejected.push({
            line,
            message: `Nenhum cliente/empresa com o documento ${customerDocument}`,
          })
          continue
        }
        links = [{ customerId: customer.value.id, isPrimary: true }]
      }

      const result = await SdContactRepository.create(
        {
          workspaceId,
          createdById: actorId,
          name: parsed.data.name,
          jobTitle: parsed.data.jobTitle,
          email: parsed.data.email,
          ...phones(parsed.data),
          notes: parsed.data.notes,
          customFields: parsed.data.customFields,
          active: parsed.data.active,
        },
        links,
      )
      if (result.ok) {
        created++
        createdIds.push(result.value.id)
        void emitEntityWebhook(workspaceId, actorId, {
          entity: 'sd_contact',
          action: 'created',
          record: toSdContactDTO(result.value),
        })
      } else rejected.push({ line, message: result.error.message })
    }

    auditMutation({
      entity: 'sd_contact',
      action: 'create',
      actorId,
      meta: { workspaceId, import: true, created, rejected: rejected.length },
    })
    void indexSearchDocument('sd-contact', workspaceId, createdIds)
    return ok({ created, rejected })
  },

  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateSdContactDTO,
  ): Promise<Result<SdContactDTO>> {
    const ctx = await agent(actorId, workspaceId, 'CREATE')
    if (!ctx.ok) return ctx

    const links = await resolveLinks(workspaceId, dto.customers)
    if (!links.ok) return links
    const member = await assertMember(workspaceId, dto.userId)
    if (!member.ok) return member

    const customFields = await validateSdEntityCustomFields(
      workspaceId,
      'CONTACT',
      dto.customFields,
    )
    if (!customFields.ok) return customFields
    const result = await SdContactRepository.create(
      {
        workspaceId,
        createdById: actorId,
        name: dto.name,
        jobTitle: dto.jobTitle,
        email: dto.email,
        ...phones(dto),
        userId: dto.userId,
        notes: dto.notes,
        customFields: customFields.value,
        active: dto.active,
      },
      links.value,
    )
    if (!result.ok) {
      auditMutation({
        entity: 'sd_contact',
        action: 'create',
        actorId,
        outcome: 'failure',
        reason: result.error.code,
      })
      return result
    }

    auditMutation({
      entity: 'sd_contact',
      action: 'create',
      actorId,
      targetId: result.value.id,
      meta: { workspaceId, customers: links.value.length },
    })
    logger.info('servicedesk.contact.created', {
      workspaceId,
      contactId: result.value.id,
    })
    void indexSearchDocument('sd-contact', workspaceId, result.value.id)
    void emitEntityWebhook(workspaceId, actorId, {
      entity: 'sd_contact',
      action: 'created',
      record: toSdContactDTO(result.value),
    })
    return ok(toSdContactDTO(result.value))
  },

  async update(
    actorId: string,
    workspaceId: string,
    contactId: string,
    dto: UpdateSdContactDTO,
  ): Promise<Result<SdContactDTO>> {
    const ctx = await agent(actorId, workspaceId, 'EDIT')
    if (!ctx.ok) return ctx

    const existing = await SdContactRepository.findById(contactId, workspaceId)
    if (!existing.ok) return existing

    let links: SdContactLinkInput[] | undefined
    if (dto.customers) {
      const resolved = await resolveLinks(workspaceId, dto.customers)
      if (!resolved.ok) return resolved
      links = resolved.value
    }
    if (dto.userId && dto.userId !== existing.value.userId) {
      const member = await assertMember(workspaceId, dto.userId)
      if (!member.ok) return member
    }

    const customFields = await validateSdEntityCustomFields(
      workspaceId,
      'CONTACT',
      dto.customFields,
      existing.value.customFields,
    )
    if (!customFields.ok) return customFields
    const result = await SdContactRepository.update(
      contactId,
      {
        name: dto.name,
        jobTitle: dto.jobTitle,
        email: dto.email,
        ...phones(dto),
        userId: dto.userId,
        notes: dto.notes,
        customFields: customFields.value,
        active: dto.active,
      },
      links,
    )
    if (!result.ok) return result

    auditMutation({
      entity: 'sd_contact',
      action: 'update',
      actorId,
      targetId: contactId,
      meta: { workspaceId, fields: Object.keys(dto) },
    })
    void indexSearchDocument('sd-contact', workspaceId, contactId)
    void emitEntityWebhook(workspaceId, actorId, {
      entity: 'sd_contact',
      action: 'updated',
      record: toSdContactDTO(result.value),
    })
    return ok(toSdContactDTO(result.value))
  },

  async remove(
    actorId: string,
    workspaceId: string,
    contactId: string,
  ): Promise<Result<void>> {
    const ctx = await agent(actorId, workspaceId, 'DELETE')
    if (!ctx.ok) return ctx

    const existing = await SdContactRepository.findById(contactId, workspaceId)
    if (!existing.ok) return existing

    const result = await SdContactRepository.softDelete(contactId)
    if (!result.ok) return result

    auditMutation({
      entity: 'sd_contact',
      action: 'delete',
      actorId,
      targetId: contactId,
      meta: { workspaceId },
    })
    void indexSearchDocument('sd-contact', workspaceId, contactId)
    void emitEntityWebhook(workspaceId, actorId, {
      entity: 'sd_contact',
      action: 'deleted',
      record: toSdContactDTO(existing.value),
    })
    return ok(undefined)
  },
}
