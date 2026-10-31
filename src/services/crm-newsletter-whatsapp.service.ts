import {
  type CrmNewsletterIssue,
  type CrmNewsletterIssueWhatsApp,
  Prisma,
  type WhatsAppConnection,
  type WhatsAppTemplate,
} from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { BETTER_AUTH_URL } from '@/lib/env/server'
import {
  crmNewsletterIssueLocked,
  crmNewsletterWhatsappUnavailable,
  validationError,
} from '@/src/errors'
import {
  type CampaignMessageContext,
  META_DAILY_CONVERSATION_LIMIT,
  renderZapiText,
  resolveTemplateValues,
  templateFields,
} from '@/src/lib/crm-campaign/whatsapp-rules'
import { newsletterIssueUrl } from '@/src/lib/newsletter/urls'
import {
  applyIssueTextTokens,
  buildNewsletterWhatsAppAudience,
  candidateWaId,
  type IssueWhatsAppContent,
  issueLinkCode,
  newsletterWhatsAppProblems,
  toCampaignVariables,
  whatsappSummary,
} from '@/src/lib/newsletter/whatsapp'
import { CrmNewsletterJob } from '@/src/lib/queue/jobs'
import { getCrmNewsletterQueue } from '@/src/lib/queue/queues'
import { err, ok, type Result } from '@/src/lib/result'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { applyTemplateSendExtras } from '@/src/lib/whatsapp/template-send'
import { buildMetaSendComponents } from '@/src/lib/whatsapp/template-variables'
import type { WhatsAppSendResult } from '@/src/lib/whatsapp/types'
import {
  toCrmNewsletterIssueWhatsAppDTO,
  toCrmNewsletterWhatsAppRecipientDTO,
  toWhatsAppVariables,
} from '@/src/mappers/crm-newsletter-engage.mapper'
import { CrmCampaignRecipientRepository } from '@/src/repositories/crm-campaign.repository'
import { CrmCampaignLookupRepository } from '@/src/repositories/crm-campaign-lookup.repository'
import {
  CrmNewsletterIssueRepository,
  EDITABLE_ISSUE_STATUSES,
  type NewsletterWithWorkspace,
} from '@/src/repositories/crm-newsletter-issue.repository'
import { CrmNewsletterWhatsAppRepository } from '@/src/repositories/crm-newsletter-whatsapp.repository'
import type {
  CrmNewsletterIssueWhatsAppDTO,
  CrmNewsletterWhatsAppReachDTO,
  CrmNewsletterWhatsAppReportDTO,
  ListCrmNewsletterWhatsAppRecipientsQuery,
  UpdateCrmNewsletterIssueWhatsAppDTO,
} from '@/src/schemas/crm-newsletter-engage.schema'
import { assertModuleEnabled } from './authz'
import { loadIssue, loadNewsletterScope } from './crm-newsletter-issue.service'

/**
 * WhatsApp version of a newsletter issue (slice nl2-engage): "Enviar também
 * no WhatsApp" sends the issue link + a short summary to the subscribers
 * whose CRM person has a WhatsApp number, through a Comunicação connection
 * (Meta approved template or Z-API text), reusing the multichannel campaign
 * rules and renderers (ADR 0025).
 *
 * Consent: the member declares the LGPD legal basis (as in campaigns) and
 * every number that asked to stop broadcasts (SAIR/PARAR) is skipped, at
 * the snapshot and again right before each send. The monthly limits of the
 * Comunicação module are enforced by `WhatsAppSend` itself.
 *
 * Timing: the message links to the public web version, which exists once
 * the e-mail send finished (`SENT`), so the dispatch waits for it.
 */

const SEND_INTERVAL_MS = { META: 1000, ZAPI: 4000 } as const
const BATCH_SIZE = { META: 10, ZAPI: 1 } as const
/** The archive caches a 404 for a minute: give the web version time. */
export const WEB_VERSION_GRACE_MS = 2 * 60_000
const WAIT_FOR_EMAIL_MS = 60_000
const STUCK_AFTER_MS = 15 * 60_000
const TIER_RETRY_MS = 60 * 60_000
const HOUR_MS = 60 * 60_000

export type WhatsAppDispatchOutcome =
  | { status: 'missing' | 'inactive' | 'drained' }
  | { status: 'waiting'; retryAt: string }
  | { status: 'stopped' | 'unavailable' | 'limit_reached'; skipped: number }
  | {
      status: 'sent'
      sent: number
      failed: number
      skipped: number
      more: boolean
    }

type Evaluation = {
  available: boolean
  unavailableReason: string | null
  problems: string[]
  connection: WhatsAppConnection | null
  template: WhatsAppTemplate | null
}

/** Module, connection, content, legal basis and web version checks. */
async function evaluate(
  workspaceId: string,
  newsletter: Pick<NewsletterWithWorkspace, 'archiveEnabled'>,
  config: CrmNewsletterIssueWhatsApp | null,
): Promise<Result<Evaluation>> {
  const empty = { connection: null, template: null }
  const enabled = await assertModuleEnabled(workspaceId, 'COMMUNICATION')
  if (!enabled.ok) {
    if (enabled.error.code !== 'MODULE_DISABLED') return enabled
    const reason = 'O módulo Comunicação não está ativo neste workspace'
    return ok({
      ...empty,
      available: false,
      unavailableReason: reason,
      problems: [reason],
    })
  }
  const problems: string[] = []
  if (!newsletter.archiveEnabled) {
    problems.push(
      'Ative o arquivo público da newsletter: a mensagem leva o link da versão web',
    )
  }
  if (!config?.connectionId) {
    problems.push('Escolha a conexão de WhatsApp')
    return ok({ ...empty, available: true, unavailableReason: null, problems })
  }
  const connection = await CrmCampaignLookupRepository.findConnection(
    workspaceId,
    config.connectionId,
  )
  if (!connection.ok) return connection
  if (!connection.value) {
    problems.push('A conexão de WhatsApp escolhida não existe mais')
    return ok({ ...empty, available: true, unavailableReason: null, problems })
  }
  if (connection.value.status !== 'CONNECTED') {
    problems.push('A conexão de WhatsApp não está ativa')
  }
  let template: WhatsAppTemplate | null = null
  if (connection.value.provider === 'META' && config.templateId) {
    const found = await CrmCampaignLookupRepository.findWhatsAppTemplate(
      workspaceId,
      connection.value.id,
      config.templateId,
    )
    if (!found.ok) return found
    template = found.value
  }
  problems.push(
    ...newsletterWhatsAppProblems({
      provider: connection.value.provider === 'META' ? 'META' : 'ZAPI',
      template,
      variables: toWhatsAppVariables(config.variables),
      text: config.text,
    }),
  )
  if (!config.legalBasis || !config.consentConfirmedAt) {
    problems.push('Declare a base legal do envio no WhatsApp')
  }
  return ok({
    available: true,
    unavailableReason: null,
    problems,
    connection: connection.value,
    template,
  })
}

/** Who would get the WhatsApp version if the issue went out now. */
async function reachOf(
  workspaceId: string,
  newsletterId: string,
): Promise<Result<CrmNewsletterWhatsAppReachDTO>> {
  const candidates = await CrmNewsletterWhatsAppRepository.subscriberCandidates(
    workspaceId,
    newsletterId,
  )
  if (!candidates.ok) return candidates
  const waIds = candidates.value.candidates
    .map(candidateWaId)
    .filter((id): id is string => Boolean(id))
  const optedOut = await CrmNewsletterWhatsAppRepository.optedOut(
    workspaceId,
    waIds,
  )
  if (!optedOut.ok) return optedOut
  return ok(
    buildNewsletterWhatsAppAudience(candidates.value.candidates, optedOut.value)
      .reach,
  )
}

async function toDetail(
  issue: CrmNewsletterIssue,
  newsletter: NewsletterWithWorkspace,
  config: CrmNewsletterIssueWhatsApp | null,
): Promise<Result<CrmNewsletterIssueWhatsAppDTO>> {
  const evaluation = await evaluate(issue.workspaceId, newsletter, config)
  if (!evaluation.ok) return evaluation
  let reach: CrmNewsletterWhatsAppReachDTO | null = null
  if (
    evaluation.value.available &&
    EDITABLE_ISSUE_STATUSES.includes(issue.status)
  ) {
    const computed = await reachOf(issue.workspaceId, issue.newsletterId)
    if (!computed.ok) return computed
    reach = computed.value
  }
  return ok(
    toCrmNewsletterIssueWhatsAppDTO(issue.id, config, {
      available: evaluation.value.available,
      unavailableReason: evaluation.value.unavailableReason,
      problems: config?.enabled ? evaluation.value.problems : [],
      reach,
    }),
  )
}

async function enqueue(issueId: string, at: Date, now: Date): Promise<void> {
  const delay = Math.max(0, at.getTime() - now.getTime())
  await getCrmNewsletterQueue().add(
    CrmNewsletterJob.WhatsAppDispatch,
    { issueId },
    { delay, jobId: `crm-newsletter-wa-${issueId}-${at.getTime()}` },
  )
}

function issueContent(issue: CrmNewsletterIssue): IssueWhatsAppContent {
  return {
    subject: issue.subject,
    summary: whatsappSummary(issue.excerpt ?? issue.preheader),
  }
}

/** Sends the issue to one number, per provider (campaign renderers). */
export async function sendIssueWhatsApp(input: {
  connection: WhatsAppConnection
  template: WhatsAppTemplate | null
  config: Pick<CrmNewsletterIssueWhatsApp, 'variables' | 'text'>
  content: IssueWhatsAppContent
  to: CampaignMessageContext & { waId: string }
}): Promise<Result<WhatsAppSendResult>> {
  const { connection, template, config, content, to } = input
  if (connection.provider === 'META') {
    if (template?.status !== 'APPROVED') {
      return err(
        crmNewsletterWhatsappUnavailable(
          'Template da Meta ausente ou não aprovado',
        ),
      )
    }
    const fields = templateFields(template.components)
    const values = resolveTemplateValues(
      fields,
      toCampaignVariables(toWhatsAppVariables(config.variables), content),
      to,
    )
    return WhatsAppSend.template(
      connection,
      {
        to: to.waId,
        templateName: template.name,
        language: template.language,
        components: applyTemplateSendExtras(
          template,
          buildMetaSendComponents(fields, values),
        ).components,
      },
      { cost: { source: 'CRM_CAMPAIGN', templateCategory: template.category } },
    )
  }
  return WhatsAppSend.text(
    connection,
    {
      to: to.waId,
      text: renderZapiText(
        applyIssueTextTokens(config.text ?? '', content),
        to,
      ),
    },
    { cost: { source: 'CRM_CAMPAIGN' } },
  )
}

export const CrmNewsletterWhatsAppService = {
  async get(
    actorId: string,
    workspaceId: string,
    newsletterId: string,
    issueId: string,
  ): Promise<Result<CrmNewsletterIssueWhatsAppDTO>> {
    const scope = await loadNewsletterScope(
      actorId,
      workspaceId,
      newsletterId,
      'VIEW',
    )
    if (!scope.ok) return scope
    const issue = await loadIssue(workspaceId, newsletterId, issueId)
    if (!issue.ok) return issue
    const config = await CrmNewsletterWhatsAppRepository.findConfig(issueId)
    if (!config.ok) return config
    return toDetail(issue.value, scope.value.newsletter, config.value)
  },

  /** Saves the WhatsApp version of a DRAFT/SCHEDULED issue. */
  async update(
    actorId: string,
    workspaceId: string,
    newsletterId: string,
    issueId: string,
    dto: UpdateCrmNewsletterIssueWhatsAppDTO,
    now: Date,
  ): Promise<Result<CrmNewsletterIssueWhatsAppDTO>> {
    const scope = await loadNewsletterScope(
      actorId,
      workspaceId,
      newsletterId,
      'EDIT',
    )
    if (!scope.ok) return scope
    const issue = await loadIssue(workspaceId, newsletterId, issueId)
    if (!issue.ok) return issue
    if (!EDITABLE_ISSUE_STATUSES.includes(issue.value.status)) {
      return err(crmNewsletterIssueLocked())
    }
    const current = await CrmNewsletterWhatsAppRepository.findConfig(issueId)
    if (!current.ok) return current

    const next = {
      enabled: dto.enabled ?? current.value?.enabled ?? false,
      connectionId:
        dto.connectionId !== undefined
          ? dto.connectionId
          : (current.value?.connectionId ?? null),
      templateId:
        dto.templateId !== undefined
          ? dto.templateId
          : (current.value?.templateId ?? null),
      legalBasis:
        dto.legalBasis !== undefined
          ? dto.legalBasis
          : (current.value?.legalBasis ?? null),
    }
    if (next.enabled) {
      const access = await assertModuleEnabled(workspaceId, 'COMMUNICATION')
      if (!access.ok) {
        return access.error.code === 'MODULE_DISABLED'
          ? err(
              crmNewsletterWhatsappUnavailable(
                'O módulo Comunicação não está ativo neste workspace',
              ),
            )
          : access
      }
    }
    if (next.connectionId && dto.connectionId !== undefined) {
      const connection = await CrmCampaignLookupRepository.findConnection(
        workspaceId,
        next.connectionId,
      )
      if (!connection.ok) return connection
      if (!connection.value) {
        return err(validationError('Conexão de WhatsApp não encontrada'))
      }
    }
    if (next.connectionId && next.templateId && dto.templateId) {
      const template = await CrmCampaignLookupRepository.findWhatsAppTemplate(
        workspaceId,
        next.connectionId,
        next.templateId,
      )
      if (!template.ok) return template
      if (!template.value) {
        return err(validationError('Template não encontrado nesta conexão'))
      }
    }

    // A new legal basis must be declared again.
    const basisChanged =
      dto.legalBasis !== undefined &&
      dto.legalBasis !== current.value?.legalBasis
    let consent: {
      consentConfirmedAt: Date | null
      consentConfirmedById: string | null
    } = {
      consentConfirmedAt: current.value?.consentConfirmedAt ?? null,
      consentConfirmedById: current.value?.consentConfirmedById ?? null,
    }
    if (basisChanged)
      consent = { consentConfirmedAt: null, consentConfirmedById: null }
    if (dto.confirmLegalBasis === true && next.legalBasis) {
      consent = { consentConfirmedAt: now, consentConfirmedById: actorId }
    }
    if (dto.confirmLegalBasis === false) {
      consent = { consentConfirmedAt: null, consentConfirmedById: null }
    }

    const saved = await CrmNewsletterWhatsAppRepository.upsertConfig(
      issueId,
      workspaceId,
      {
        ...next,
        ...(dto.variables !== undefined
          ? { variables: dto.variables ?? Prisma.DbNull }
          : {}),
        ...(dto.text !== undefined ? { text: dto.text } : {}),
        ...consent,
        updatedById: actorId,
      },
    )
    if (!saved.ok) return saved
    auditMutation({
      entity: 'crm_newsletter_issue_whatsapp',
      action: 'update',
      actorId,
      targetId: issueId,
      meta: {
        workspaceId,
        newsletterId,
        enabled: saved.value.enabled,
        connectionId: saved.value.connectionId,
        legalBasis: saved.value.legalBasis,
        legalBasisConfirmed: Boolean(saved.value.consentConfirmedAt),
      },
    })
    return toDetail(issue.value, scope.value.newsletter, saved.value)
  },

  /** Pre-send check of the e-mail send: an enabled WhatsApp version must be
   * ready, so the member never finds out after the e-mail went out. */
  async preSendCheck(
    issue: CrmNewsletterIssue,
    newsletter: NewsletterWithWorkspace,
  ): Promise<Result<void>> {
    const config = await CrmNewsletterWhatsAppRepository.findConfig(issue.id)
    if (!config.ok) return config
    if (!config.value?.enabled) return ok(undefined)
    const evaluation = await evaluate(
      issue.workspaceId,
      newsletter,
      config.value,
    )
    if (!evaluation.ok) return evaluation
    const problem = evaluation.value.problems[0]
    if (problem) {
      return err(
        crmNewsletterWhatsappUnavailable(
          `WhatsApp: ${problem}. Corrija ou desligue o envio no WhatsApp.`,
        ),
      )
    }
    return ok(undefined)
  },

  /**
   * Snapshot when the e-mail send starts: the e-mail audience restricted to
   * linked CRM people with a WhatsApp number (opted-out numbers kept as
   * SKIPPED). Never fails the e-mail send — problems are logged.
   */
  async startForIssue(issueId: string, now: Date): Promise<void> {
    const fail = (reason: string) =>
      logger.error('crm.newsletter.whatsapp_start_failed', {
        component: 'CrmNewsletterWhatsAppService',
        issueId,
        reason,
      })
    const config = await CrmNewsletterWhatsAppRepository.findConfig(issueId)
    if (!config.ok) return fail(config.error.code)
    if (!config.value?.enabled) return
    const won = await CrmNewsletterWhatsAppRepository.markStarted(issueId, now)
    if (!won.ok) return fail(won.error.code)
    if (!won.value) return

    const { workspaceId } = config.value
    const candidates = await CrmNewsletterWhatsAppRepository.issueCandidates(
      workspaceId,
      issueId,
    )
    if (!candidates.ok) return fail(candidates.error.code)
    const waIds = candidates.value
      .map(candidateWaId)
      .filter((id): id is string => Boolean(id))
    const optedOut = await CrmNewsletterWhatsAppRepository.optedOut(
      workspaceId,
      waIds,
    )
    if (!optedOut.ok) return fail(optedOut.error.code)
    const audience = buildNewsletterWhatsAppAudience(
      candidates.value,
      optedOut.value,
    )

    const created = await CrmNewsletterWhatsAppRepository.createRecipients(
      issueId,
      workspaceId,
      audience.rows,
    )
    if (!created.ok) return fail(created.error.code)
    logger.info('crm.newsletter.whatsapp_started', {
      component: 'CrmNewsletterWhatsAppService',
      workspaceId,
      issueId,
      ...audience.reach,
    })
    try {
      await enqueue(issueId, now, now)
    } catch (error) {
      fail(error instanceof Error ? error.message : 'enqueue failed')
    }
  },

  /**
   * One batch of the WhatsApp version (worker). Waits for the web version,
   * stops with the e-mail, re-checks availability, the Meta tier and each
   * number's opt-out, then sends and queues the next batch.
   */
  async dispatch(
    issueId: string,
    now: Date,
  ): Promise<Result<WhatsAppDispatchOutcome>> {
    const found = await CrmNewsletterIssueRepository.findByIdUnscoped(issueId)
    if (!found.ok) return found
    if (!found.value) return ok({ status: 'missing' })
    const { newsletter, ...issue } = found.value
    const config = await CrmNewsletterWhatsAppRepository.findConfig(issueId)
    if (!config.ok) return config
    if (!config.value?.enabled || !config.value.startedAt) {
      return ok({ status: 'inactive' })
    }

    const released = await CrmNewsletterWhatsAppRepository.releaseStuck(
      issueId,
      new Date(now.getTime() - STUCK_AFTER_MS),
    )
    if (!released.ok) return released

    if (issue.status === 'CANCELED' || issue.status === 'FAILED') {
      const skipped = await CrmNewsletterWhatsAppRepository.skipPending(
        issueId,
        'STOPPED',
      )
      if (!skipped.ok) return skipped
      return ok({ status: 'stopped', skipped: skipped.value })
    }
    if (issue.status !== 'SENT' || !issue.sentAt) {
      const retryAt = new Date(now.getTime() + WAIT_FOR_EMAIL_MS)
      await enqueue(issueId, retryAt, now)
      return ok({ status: 'waiting', retryAt: retryAt.toISOString() })
    }
    const readyAt = new Date(issue.sentAt.getTime() + WEB_VERSION_GRACE_MS)
    if (now < readyAt) {
      await enqueue(issueId, readyAt, now)
      return ok({ status: 'waiting', retryAt: readyAt.toISOString() })
    }

    const evaluation = await evaluate(
      issue.workspaceId,
      newsletter,
      config.value,
    )
    if (!evaluation.ok) return evaluation
    const { connection, template, problems } = evaluation.value
    if (!connection || problems.length > 0) {
      logger.warn('crm.newsletter.whatsapp_unavailable', {
        component: 'CrmNewsletterWhatsAppService',
        issueId,
        reason: problems[0] ?? 'no connection',
      })
      const skipped = await CrmNewsletterWhatsAppRepository.skipPending(
        issueId,
        'UNAVAILABLE',
      )
      if (!skipped.ok) return skipped
      return ok({ status: 'unavailable', skipped: skipped.value })
    }
    const provider = connection.provider === 'META' ? 'META' : 'ZAPI'

    if (provider === 'META') {
      const since = new Date(now.getTime() - 24 * HOUR_MS)
      const [ours, campaigns] = await Promise.all([
        CrmNewsletterWhatsAppRepository.countSentSince(connection.id, since),
        CrmCampaignRecipientRepository.countWhatsAppSentSince(
          connection.id,
          since,
        ),
      ])
      if (!ours.ok) return ours
      if (!campaigns.ok) return campaigns
      if (ours.value + campaigns.value >= META_DAILY_CONVERSATION_LIMIT) {
        const retryAt = new Date(now.getTime() + TIER_RETRY_MS)
        await enqueue(issueId, retryAt, now)
        return ok({ status: 'waiting', retryAt: retryAt.toISOString() })
      }
    }

    const claimed = await CrmNewsletterWhatsAppRepository.claimBatch(
      issueId,
      BATCH_SIZE[provider],
    )
    if (!claimed.ok) return claimed
    if (claimed.value.length === 0) return ok({ status: 'drained' })

    const link = newsletterIssueUrl(
      BETTER_AUTH_URL,
      newsletter.workspace.slug,
      newsletter.slug,
      issue.slug,
    )
    const content = issueContent(issue)
    let sent = 0
    let failed = 0
    let skipped = 0
    const rows = claimed.value
    for (const [index, row] of rows.entries()) {
      const optedOut = await CrmNewsletterWhatsAppRepository.optedOut(
        issue.workspaceId,
        [row.waId],
      )
      if (!optedOut.ok) {
        await CrmNewsletterWhatsAppRepository.release(
          rows.slice(index).map((r) => r.id),
        )
        return optedOut
      }
      if (optedOut.value.has(row.waId)) {
        const marked = await CrmNewsletterWhatsAppRepository.markSkipped(
          [row.id],
          'OPTED_OUT',
        )
        if (!marked.ok) return marked
        skipped += 1
        continue
      }
      const result = await sendIssueWhatsApp({
        connection,
        template,
        config: config.value,
        content,
        to: {
          waId: row.waId,
          name: row.name,
          link,
          linkCode: issueLinkCode(link),
        },
      })
      if (!result.ok) {
        const rest = rows.slice(index).map((r) => r.id)
        if (result.error.code === 'WHATSAPP_MESSAGE_LIMIT_REACHED') {
          // Monthly Comunicação limit: nothing else goes out this month.
          const marked = await CrmNewsletterWhatsAppRepository.markSkipped(
            rest,
            'LIMIT_REACHED',
          )
          if (!marked.ok) return marked
          const pending = await CrmNewsletterWhatsAppRepository.skipPending(
            issueId,
            'LIMIT_REACHED',
          )
          if (!pending.ok) return pending
          return ok({
            status: 'limit_reached',
            skipped: skipped + rest.length + pending.value,
          })
        }
        if (result.error.code === 'RATE_LIMITED') {
          await CrmNewsletterWhatsAppRepository.release(rest)
          const retryAt = new Date(
            now.getTime() + 5 * SEND_INTERVAL_MS[provider],
          )
          await enqueue(issueId, retryAt, now)
          return ok({ status: 'waiting', retryAt: retryAt.toISOString() })
        }
        const marked = await CrmNewsletterWhatsAppRepository.markFailed(
          row.id,
          result.error.message,
        )
        if (!marked.ok) return marked
        failed += 1
        continue
      }
      const recorded = await CrmNewsletterWhatsAppRepository.markSent(
        row.id,
        result.value.providerMessageId,
        now,
      )
      // Already sent: never report an error (a retry would send it again).
      if (!recorded.ok) {
        logger.error('crm.newsletter.whatsapp_record_failed', {
          component: 'CrmNewsletterWhatsAppService',
          issueId,
          reason: recorded.error.code,
        })
      }
      sent += 1
    }

    const more = rows.length === BATCH_SIZE[provider]
    if (more) {
      await enqueue(
        issueId,
        new Date(now.getTime() + rows.length * SEND_INTERVAL_MS[provider]),
        now,
      )
    }
    return ok({ status: 'sent', sent, failed, skipped, more })
  },

  /** Per-number delivery report of the WhatsApp version. */
  async report(
    actorId: string,
    workspaceId: string,
    newsletterId: string,
    issueId: string,
    query: ListCrmNewsletterWhatsAppRecipientsQuery,
  ): Promise<Result<CrmNewsletterWhatsAppReportDTO>> {
    const scope = await loadNewsletterScope(
      actorId,
      workspaceId,
      newsletterId,
      'VIEW',
    )
    if (!scope.ok) return scope
    const issue = await loadIssue(workspaceId, newsletterId, issueId)
    if (!issue.ok) return issue
    const config = await CrmNewsletterWhatsAppRepository.findConfig(issueId)
    if (!config.ok) return config
    const [stats, page] = await Promise.all([
      CrmNewsletterWhatsAppRepository.stats(issueId),
      CrmNewsletterWhatsAppRepository.listRecipients(issueId, query),
    ])
    if (!stats.ok) return stats
    if (!page.ok) return page
    let provider: 'META' | 'ZAPI' | null = null
    if (config.value?.connectionId) {
      const connection = await CrmCampaignLookupRepository.findConnection(
        workspaceId,
        config.value.connectionId,
      )
      if (!connection.ok) return connection
      provider = connection.value
        ? connection.value.provider === 'META'
          ? 'META'
          : 'ZAPI'
        : null
    }
    return ok({
      enabled: config.value?.enabled ?? false,
      provider,
      stats: stats.value,
      items: page.value.items.map(toCrmNewsletterWhatsAppRecipientDTO),
      total: page.value.total,
      page: query.page,
      pageSize: query.pageSize,
    })
  },
}
