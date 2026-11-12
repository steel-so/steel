import { auditMutation } from '@/lib/axiom/audit'
import { badRequest } from '@/src/errors'
import { customFieldKeyFromLabel } from '@/src/lib/custom-field-value'
import { err, ok, type Result } from '@/src/lib/result'
import { indexSearchDocument } from '@/src/lib/search/index-hooks'
import { normalizeCsvHeader } from '@/src/lib/servicedesk/csv'
import {
  extraContactImportHeaders,
  parseContactImportCsv,
} from '@/src/lib/whatsapp/contact-import'
import {
  CrmCustomFieldDefinitionRepository,
  CrmCustomFieldValueRepository,
} from '@/src/repositories/crm-custom-field.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WHATSAPP_CONTACT_FIELD_LIMIT } from '@/src/schemas/whatsapp-contact-field.schema'
import type { ImportWhatsAppContactsDTO } from '@/src/schemas/whatsapp-contact-import.schema'
import type { WhatsAppContactImportResultDTO } from '@/types/whatsapp-contact-import'
import { assertModuleMember } from './authz'
import { WhatsAppContactValidationService } from './whatsapp-contact-validation.service'

export const WhatsAppContactImportService = {
  async import(
    actorId: string,
    workspaceId: string,
    dto: ImportWhatsAppContactsDTO,
  ): Promise<Result<WhatsAppContactImportResultDTO>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'contacts', action: 'CREATE' },
    )
    if (!membership.ok) return membership

    // The contact fields the sheet may carry as extra columns (header = label).
    const definitions =
      await CrmCustomFieldDefinitionRepository.listByWorkspace(workspaceId, {
        entity: 'WHATSAPP_CONTACT',
      })
    if (!definitions.ok) return definitions

    // Any extra column becomes a contact field (text, or CPF/CNPJ by name), so
    // the table shows it right after the import.
    const known = [...definitions.value]
    for (const header of extraContactImportHeaders(dto.csv, known)) {
      if (known.length >= WHATSAPP_CONTACT_FIELD_LIMIT) break
      const normalized = normalizeCsvHeader(header)
      const made = await CrmCustomFieldDefinitionRepository.create({
        workspaceId,
        createdById: actorId,
        entity: 'WHATSAPP_CONTACT',
        key: customFieldKeyFromLabel(header),
        label: header.slice(0, 80),
        type:
          normalized === 'cpf'
            ? 'CPF'
            : normalized === 'cnpj'
              ? 'CNPJ'
              : 'TEXT',
      })
      if (made.ok) known.push(made.value)
    }

    const parsed = parseContactImportCsv(
      dto.csv,
      known.map((definition) => ({
        id: definition.id,
        label: definition.label,
        type: definition.type,
        options: definition.options,
      })),
    )
    if (parsed.fileError) return err(badRequest(parsed.fileError))

    const rejected = [...parsed.rejected]
    const existing = await WhatsAppContactRepository.findManyByWaIds(
      workspaceId,
      parsed.valid.map((row) => row.waId),
    )
    if (!existing.ok) return existing
    const existingByWaId = new Map(existing.value.map((c) => [c.waId, c]))

    let created = 0
    let updated = 0
    const savedIds: string[] = []
    for (const row of parsed.valid) {
      const current = existingByWaId.get(row.waId)
      // Blank cells never erase data already stored on the contact.
      const saved = current
        ? await WhatsAppContactRepository.update(current.id, {
            ...(row.name ? { name: row.name } : {}),
            ...(row.description ? { description: row.description } : {}),
          })
        : await WhatsAppContactRepository.create({
            workspaceId,
            waId: row.waId,
            name: row.name,
            description: row.description,
          })
      if (!saved.ok) {
        rejected.push({ line: row.line, message: 'Falha ao salvar o contato.' })
        continue
      }
      if (current) updated++
      else created++
      if (row.customFields) {
        const written = await CrmCustomFieldValueRepository.applyForRecord(
          Object.entries(row.customFields).map(([definitionId, value]) => ({
            definitionId,
            recordId: saved.value.id,
            value,
          })),
        )
        if (!written.ok) {
          rejected.push({
            line: row.line,
            message: 'Contato salvo, mas falhou ao gravar os campos extras.',
          })
        }
      }
      savedIds.push(saved.value.id)
      void indexSearchDocument('zap-contact', workspaceId, saved.value.id)
    }

    rejected.sort((a, b) => a.line - b.line)

    auditMutation({
      entity: 'whatsapp_contact',
      action: 'create',
      actorId,
      meta: {
        source: 'spreadsheet_import',
        created,
        updated,
        skipped: rejected.length,
      },
    })

    const result: WhatsAppContactImportResultDTO = {
      created,
      updated,
      skipped: rejected.length,
      rejected,
    }
    // Optional "validar se tem WhatsApp" step. A refusal (no Z-API, run
    // already in progress...) never undoes the import: it is reported.
    if (dto.validateWhatsapp) {
      const validation = await WhatsAppContactValidationService.startInternal(
        actorId,
        workspaceId,
        { scope: 'IMPORT', scopeId: null, contactIds: savedIds },
      )
      result.validation = validation.ok ? validation.value : null
      result.validationUnavailable = validation.ok
        ? null
        : validation.error.message
    }

    return ok(result)
  },
}
