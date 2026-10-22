import { auditMutation } from '@/lib/axiom/audit'
import { badRequest } from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import { indexSearchDocument } from '@/src/lib/search/index-hooks'
import { parseContactImportCsv } from '@/src/lib/whatsapp/contact-import'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
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

    const parsed = parseContactImportCsv(dto.csv)
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
