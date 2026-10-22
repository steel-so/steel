import { auditMutation } from '@/lib/axiom/audit'
import {
  badRequest,
  whatsappConnectionNotFound,
  whatsappTemplateNotApproved,
  whatsappTemplateNotFound,
} from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import {
  parseBroadcastImportCsv,
  validateBroadcastImportRows,
} from '@/src/lib/whatsapp/broadcast-import'
import {
  extractTemplateFillableFields,
  parseMetaTemplateComponents,
} from '@/src/lib/whatsapp/template-variables'
import { toWhatsAppBroadcastListDTO } from '@/src/mappers/whatsapp-broadcast.mapper'
import { WhatsAppBroadcastRepository } from '@/src/repositories/whatsapp-broadcast.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WhatsAppTemplateRepository } from '@/src/repositories/whatsapp-template.repository'
import type { CreateWhatsAppBroadcastImportDTO } from '@/src/schemas/whatsapp-broadcast-import.schema'
import type { WhatsAppBroadcastImportResultDTO } from '@/types/whatsapp-broadcast-import'
import { assertModuleMember } from './authz'
import { assertFeature } from './feature-flag.service'
import { WhatsAppContactValidationService } from './whatsapp-contact-validation.service'

export const WhatsAppBroadcastImportService = {
  async import(
    actorId: string,
    workspaceId: string,
    dto: CreateWhatsAppBroadcastImportDTO,
  ): Promise<Result<WhatsAppBroadcastImportResultDTO>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'broadcasts', action: 'CREATE' },
    )
    if (!membership.ok) return membership
    const feature = await assertFeature(workspaceId, 'communication.broadcasts')
    if (!feature.ok) return feature

    const connection = await WhatsAppConnectionRepository.findById(
      dto.connectionId,
      workspaceId,
    )
    if (!connection.ok) return connection
    if (!connection.value) return err(whatsappConnectionNotFound())

    const template = await WhatsAppTemplateRepository.findById(
      dto.templateId,
      workspaceId,
    )
    if (!template.ok) return template
    if (!template.value) return err(whatsappTemplateNotFound())
    if (template.value.status !== 'APPROVED') {
      return err(whatsappTemplateNotApproved())
    }

    const { rows, parseErrors } = parseBroadcastImportCsv(dto.csv)
    if (parseErrors.length > 0) {
      return err(badRequest(parseErrors.join('; ')))
    }

    const fields = extractTemplateFillableFields(
      parseMetaTemplateComponents(template.value.components as unknown[]),
    )
    const { valid, rejected } = validateBroadcastImportRows(
      rows,
      fields.body.variableCount,
      dto.sendOffsetHours,
    )

    if (valid.length === 0) {
      return ok({
        broadcastList: null,
        createdCount: 0,
        rejectedRows: rejected,
      })
    }

    const recipients = []
    const rejectedRows = [...rejected]
    for (const row of valid) {
      const contact = await WhatsAppContactRepository.upsertByWaId({
        workspaceId,
        waId: row.phone,
        name: row.contactName,
      })
      if (!contact.ok) return contact
      // Opt-out LGPD: contato que pediu para sair não entra na transmissão.
      if (contact.value.broadcastOptedOutAt) {
        rejectedRows.push({
          rowNumber: row.rowNumber,
          reason: 'Contato descadastrado das transmissões (opt-out)',
        })
        continue
      }
      recipients.push({
        contactId: contact.value.id,
        variableValues: row.variableValues,
        scheduledAt: row.scheduledAt,
        appointmentAt: row.appointmentAt,
      })
    }

    rejectedRows.sort((a, b) => a.rowNumber - b.rowNumber)
    if (recipients.length === 0) {
      return ok({ broadcastList: null, createdCount: 0, rejectedRows })
    }

    const created = await WhatsAppBroadcastRepository.createScheduled(
      {
        workspaceId,
        connectionId: dto.connectionId,
        templateId: dto.templateId,
        name: dto.name,
        messageBody: template.value.name,
        skipNoWhatsapp: dto.skipNoWhatsapp ?? false,
        createdById: actorId,
      },
      recipients,
    )
    if (!created.ok) return created

    auditMutation({
      entity: 'whatsapp_broadcast_list',
      action: 'create',
      actorId,
      targetId: created.value.id,
      meta: {
        source: 'csv_import',
        created: recipients.length,
        rejected: rejectedRows.length,
      },
    })

    const result: WhatsAppBroadcastImportResultDTO = {
      broadcastList: toWhatsAppBroadcastListDTO(created.value),
      createdCount: recipients.length,
      rejectedRows,
    }
    // Optional "validar se tem WhatsApp" step. A refusal (no Z-API, run
    // already in progress...) never undoes the import: it is reported.
    if (dto.validateWhatsapp) {
      const validation = await WhatsAppContactValidationService.startInternal(
        actorId,
        workspaceId,
        {
          scope: 'BROADCAST',
          scopeId: created.value.id,
          contactIds: recipients.map((recipient) => recipient.contactId),
        },
      )
      result.validation = validation.ok ? validation.value : null
      result.validationUnavailable = validation.ok
        ? null
        : validation.error.message
    }

    return ok(result)
  },
}
