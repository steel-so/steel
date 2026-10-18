import { logger } from '@/lib/axiom/logger'
import { unauthorized, validationError } from '@/src/errors/app-error'
import type { ApiSession } from '@/src/lib/api/session'
import { err, ok, type Result } from '@/src/lib/result'
import { csvToRecords, pickCsvValue } from '@/src/lib/servicedesk/csv'
import {
  type SendV1WhatsAppTemplateDTO,
  V1_LEAD_IMPORT_MAX_ROWS,
} from '@/src/schemas/api-v1.schema'
import type { CrmLeadIntakeInput } from '@/src/schemas/crm-lead.schema'
import type {
  ApiV1CrmPipelineDTO,
  ApiV1LeadImportErrorDTO,
  ApiV1LeadImportResultDTO,
  ApiV1MeDTO,
} from '@/types/api-v1'
import type { WhatsAppMessageDTO } from '@/types/whatsapp-message'
import { assertModuleMember } from './authz'
import { CrmLeadService } from './crm-lead.service'
import {
  CrmPipelineService,
  CrmPipelineStageService,
} from './crm-pipeline.service'
import { UserService } from './user.service'
import { WhatsAppConversationService } from './whatsapp-conversation.service'
import { WhatsAppMessageService } from './whatsapp-message.service'

/**
 * The few public API v1 operations (ADR 0035) that are not a single call to
 * an existing service: they only compose existing services — no business
 * rule lives here. Authorization stays in the services they call.
 */

/** CSV columns (normalized headers) accepted by the lead import. */
const LEAD_COLUMNS = {
  name: ['name', 'nome'],
  emails: ['email', 'emails', 'e_mail'],
  phones: ['phone', 'phones', 'telefone', 'telefones', 'celular', 'whatsapp'],
  company: ['company', 'empresa'],
  jobTitle: ['job_title', 'jobtitle', 'cargo'],
  city: ['city', 'cidade'],
  linkedin: ['linkedin'],
  source: ['source', 'origem'],
  channel: ['channel', 'canal'],
} as const

export const V1_LEAD_IMPORT_DEFAULT_SOURCE = 'API'

/** Several e-mails or phones in one cell: `a@x.com; b@x.com`, `11 9999 | 11 8888`. */
function splitCell(value: string | undefined, separator: RegExp): string[] {
  return (value ?? '')
    .split(separator)
    .map((item) => item.trim())
    .filter(Boolean)
}

function leadFromRecord(
  record: Record<string, string>,
  defaultSource: string,
): CrmLeadIntakeInput {
  const pick = (aliases: readonly string[]) => pickCsvValue(record, aliases)
  return {
    name: pick(LEAD_COLUMNS.name) ?? '',
    emails: splitCell(pick(LEAD_COLUMNS.emails), /[,;\s]+/),
    phones: splitCell(pick(LEAD_COLUMNS.phones), /[,;|]+/),
    company: pick(LEAD_COLUMNS.company),
    jobTitle: pick(LEAD_COLUMNS.jobTitle),
    city: pick(LEAD_COLUMNS.city),
    linkedin: pick(LEAD_COLUMNS.linkedin),
    source: pick(LEAD_COLUMNS.source) ?? defaultSource,
    channel: pick(LEAD_COLUMNS.channel),
  }
}

/** First Zod issue of a `VALIDATION_ERROR`, for the per-row report. */
function rowMessage(error: { message: string; details?: unknown }): string {
  if (Array.isArray(error.details)) {
    const issue = error.details[0] as
      | { message?: string; path?: unknown[] }
      | undefined
    if (issue?.message) {
      const field = issue.path?.length ? `${issue.path.join('.')}: ` : ''
      return `${field}${issue.message}`
    }
  }
  return error.message
}

export const ApiV1Service = {
  /** `steel whoami`: the token's owner, workspace, role and the token. */
  async me(session: ApiSession): Promise<Result<ApiV1MeDTO>> {
    const profile = await UserService.getProfile(session.userId)
    if (!profile.ok) return profile

    const membership = profile.value.memberships.find(
      (item) => item.workspaceId === session.workspaceId,
    )
    // `resolveApiSession` already refuses ex-members; a stale cache must not
    // turn that into a 500.
    if (!membership) return err(unauthorized('Token de API inválido'))

    const user = profile.value
    return ok({
      user: { id: user.id, name: user.name, email: user.email },
      workspace: {
        id: membership.workspaceId,
        slug: membership.slug,
        name: membership.name,
      },
      role: membership.role,
      scopes: session.scopes,
      modules: session.modules,
      token: {
        id: session.tokenId,
        expiresAt: session.expiresAt.toISOString(),
      },
    })
  },

  /** Pipelines with their stages (the CLI shows both in one call). */
  async listPipelines(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<ApiV1CrmPipelineDTO[]>> {
    const pipelines = await CrmPipelineService.list(actorId, workspaceId)
    if (!pipelines.ok) return pipelines

    const stages = await Promise.all(
      pipelines.value.map((pipeline) =>
        CrmPipelineStageService.list(actorId, workspaceId, pipeline.id),
      ),
    )
    const out: ApiV1CrmPipelineDTO[] = []
    for (const [index, pipeline] of pipelines.value.entries()) {
      const result = stages[index]
      if (!result.ok) return result
      out.push({ ...pipeline, stages: result.value })
    }
    return ok(out)
  },

  /**
   * CSV import of leads, one row at a time through `CrmLeadService.intake`
   * (the single door of every lead channel: validation, dedupe, scoring,
   * routing, audit, workflows). A row matching an open lead is `skipped`;
   * a refused row goes to `errors` with its CSV line and the rest go on.
   * Rows run in order, so two rows with the same contact dedupe each other.
   */
  async importLeads(
    actorId: string,
    workspaceId: string,
    csv: string,
    defaultSource: string = V1_LEAD_IMPORT_DEFAULT_SOURCE,
  ): Promise<Result<ApiV1LeadImportResultDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'leads',
      action: 'CREATE',
    })
    if (!membership.ok) return membership

    const { headers, records } = csvToRecords(csv)
    if (!LEAD_COLUMNS.name.some((alias) => headers.includes(alias))) {
      return err(
        validationError(
          'O CSV precisa de uma linha de cabeçalho com a coluna name (ou nome)',
        ),
      )
    }
    if (records.length === 0) {
      return err(validationError('O CSV não tem linhas de dados'))
    }
    if (records.length > V1_LEAD_IMPORT_MAX_ROWS) {
      return err(
        validationError(
          `O CSV tem ${records.length} linhas; o limite é ${V1_LEAD_IMPORT_MAX_ROWS} por importação`,
        ),
      )
    }

    let created = 0
    let skipped = 0
    const errors: ApiV1LeadImportErrorDTO[] = []
    for (const [index, record] of records.entries()) {
      const result = await CrmLeadService.intake(
        workspaceId,
        { kind: 'user', userId: actorId },
        leadFromRecord(record, defaultSource),
      )
      if (!result.ok) {
        errors.push({
          row: index + 2,
          code: result.error.code,
          message: rowMessage(result.error),
        })
      } else if (result.value.created) {
        created++
      } else {
        skipped++
      }
    }

    logger.info('api_v1.crm_lead_import', {
      workspaceId,
      actorId,
      total: records.length,
      created,
      skipped,
      failed: errors.length,
    })
    return ok({ total: records.length, created, skipped, errors })
  },

  /**
   * Template message to a conversation, or to a contact on a connection
   * (the contact's open conversation, or a new one — the same as starting
   * a conversation in the inbox).
   */
  async sendWhatsAppTemplate(
    actorId: string,
    workspaceId: string,
    input: SendV1WhatsAppTemplateDTO,
  ): Promise<Result<WhatsAppMessageDTO>> {
    let conversationId = input.conversationId
    if (!conversationId) {
      const started = await WhatsAppConversationService.start(
        actorId,
        workspaceId,
        {
          contactId: input.contactId as string,
          connectionId: input.connectionId as string,
        },
      )
      if (!started.ok) return started
      conversationId = started.value.id
    }

    return WhatsAppMessageService.sendTemplate(
      actorId,
      workspaceId,
      conversationId,
      {
        templateName: input.templateName,
        language: input.language,
        components: input.components,
      },
    )
  },
}
