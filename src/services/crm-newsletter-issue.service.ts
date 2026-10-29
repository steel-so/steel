import type { CrmNewsletterIssue, Prisma } from '@prisma/client'
import { logger } from '@/lib/axiom/logger'
import { BETTER_AUTH_URL } from '@/lib/env/server'
import {
  conflict,
  crmEmailCanvasHtmlForbidden,
  crmNewsletterAbAudienceTooSmall,
  crmNewsletterArchived,
  crmNewsletterIssueLocked,
  crmNewsletterIssueNotFound,
  crmNewsletterNotFound,
  mailError,
} from '@/src/errors'
import { openEmailDocument } from '@/src/lib/canvas-email/convert-v1'
import { createBlankEmailDocument } from '@/src/lib/canvas-email/presets'
import { changesHtmlBlocks } from '@/src/lib/canvas-email/validate'
import { SAMPLE_CONTACT } from '@/src/lib/crm-email-builder/variables'
import {
  newsletterFromHeader,
  slugifyIssueSubject,
} from '@/src/lib/crm-newsletter/email'
import { newsletterTestSendLimiter } from '@/src/lib/crm-newsletter/test-send-limiter'
import { defaultFrom } from '@/src/lib/mail/client'
import { sendEmail } from '@/src/lib/mail/send'
import { newsletterIssueUrl } from '@/src/lib/newsletter/urls'
import type { PermissionAction } from '@/src/lib/permissions'
import { consume } from '@/src/lib/rate-limit'
import { err, ok, type Result } from '@/src/lib/result'
import { resolveVerifiedSender } from '@/src/lib/sending-domain/resolve-sender'
import {
  toCrmNewsletterIssueDTO,
  toCrmNewsletterIssueRecipientDTO,
  toCrmNewsletterIssueTrendDTO,
} from '@/src/mappers/crm-newsletter-issue.mapper'
import { CrmEmailTemplateRepository } from '@/src/repositories/crm-email-template.repository'
import { CrmNewsletterDeliveryRepository } from '@/src/repositories/crm-newsletter-delivery.repository'
import {
  CrmNewsletterIssueRepository,
  EDITABLE_ISSUE_STATUSES,
  type NewsletterWithWorkspace,
} from '@/src/repositories/crm-newsletter-issue.repository'
import { CRM_NEWSLETTER_AB_MIN_AUDIENCE } from '@/src/schemas/crm-newsletter-ab.schema'
import type {
  CreateCrmNewsletterIssueDTO,
  CrmNewsletterIssueDTO,
  CrmNewsletterIssuePreflightDTO,
  CrmNewsletterIssueRecipientDTO,
  CrmNewsletterIssueReportDTO,
  CrmNewsletterIssueTestSendDTO,
  CrmNewsletterIssueTrendDTO,
  CrmNewsletterPreflightCheckDTO,
  ListCrmNewsletterIssueRecipientsQuery,
  ListCrmNewsletterIssuesQuery,
  UpdateCrmNewsletterIssueDTO,
} from '@/src/schemas/crm-newsletter-issue.schema'
import { assertModuleMember, type MembershipContext } from './authz'
import {
  issueChecklist,
  personalizeIssue,
  renderIssueBase,
  validateIssueDocument,
} from './crm-newsletter-render'
import { CrmNewsletterUsageService } from './crm-newsletter-usage.service'

/**
 * Newsletter issues (ADR 0054, slice nl-issues): CRUD of the editions, the
 * editor autosave, test sends, the send dialog's pre-flight and the
 * report. Sending itself lives in `crm-newsletter-send.service.ts`.
 * Permissions: CRM module, resource `email` (same as the campaigns).
 */

/** Issues shown in the newsletter trend chart. */
export const ISSUE_TREND_SIZE = 12

export type Paged<T> = {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export type IssueScope = {
  membership: MembershipContext
  newsletter: NewsletterWithWorkspace
}

/** Authorizes `action` on the CRM e-mail resource and loads the newsletter. */
export async function loadNewsletterScope(
  actorId: string,
  workspaceId: string,
  newsletterId: string,
  action: PermissionAction,
): Promise<Result<IssueScope>> {
  const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
    resource: 'email',
    action,
  })
  if (!membership.ok) return membership
  const newsletter = await CrmNewsletterIssueRepository.findNewsletter(
    workspaceId,
    newsletterId,
  )
  if (!newsletter.ok) return newsletter
  if (!newsletter.value) return err(crmNewsletterNotFound())
  return ok({ membership: membership.value, newsletter: newsletter.value })
}

export async function loadIssue(
  workspaceId: string,
  newsletterId: string,
  issueId: string,
): Promise<Result<CrmNewsletterIssue>> {
  const issue = await CrmNewsletterIssueRepository.findById(
    workspaceId,
    newsletterId,
    issueId,
  )
  if (!issue.ok) return issue
  if (!issue.value) return err(crmNewsletterIssueNotFound())
  return ok(issue.value)
}

/** Public web version, when the issue went out and the archive is on. */
export function issueWebUrl(
  issue: Pick<CrmNewsletterIssue, 'status' | 'slug'>,
  newsletter: NewsletterWithWorkspace,
): string | null {
  if (!newsletter.archiveEnabled || issue.status !== 'SENT') return null
  return newsletterIssueUrl(
    BETTER_AUTH_URL,
    newsletter.workspace.slug,
    newsletter.slug,
    issue.slug,
  )
}

/** Root preheader of a canvas document (`''` when absent). */
function documentPreheader(doc: unknown): string {
  const opened = openEmailDocument(doc)
  if (!opened) return ''
  const root = opened.nodes[opened.rootId]
  const value = (root?.props as { preheader?: unknown } | undefined)?.preheader
  return typeof value === 'string' ? value : ''
}

/** The document with the root preheader replaced. */
function withPreheader(doc: unknown, preheader: string): unknown {
  const opened = openEmailDocument(doc)
  if (!opened) return doc
  const root = opened.nodes[opened.rootId]
  return {
    ...opened,
    nodes: {
      ...opened.nodes,
      [opened.rootId]: { ...root, props: { ...root.props, preheader } },
    },
  }
}

/** A free slug for the newsletter: `base`, `base-2`, `base-3`… */
async function freeSlug(
  newsletterId: string,
  base: string,
): Promise<Result<string>> {
  for (let attempt = 1; attempt <= 50; attempt++) {
    const candidate = attempt === 1 ? base : `${base}-${attempt}`.slice(-60)
    const taken = await CrmNewsletterIssueRepository.slugTaken(
      newsletterId,
      candidate,
    )
    if (!taken.ok) return taken
    if (!taken.value) return ok(candidate)
  }
  return ok(`${base.slice(0, 45)}-${Date.now().toString(36)}`)
}

/** Starting document and subject of a new issue. */
async function startingContent(
  workspaceId: string,
  newsletter: NewsletterWithWorkspace,
  dto: CreateCrmNewsletterIssueDTO,
): Promise<Result<{ document: unknown; preheader: string | null }>> {
  if (dto.duplicateOfIssueId) {
    const source = await loadIssue(
      workspaceId,
      newsletter.id,
      dto.duplicateOfIssueId,
    )
    if (!source.ok) return source
    return ok({
      document: source.value.builderDocument,
      preheader: source.value.preheader,
    })
  }
  const templateId = dto.templateId ?? newsletter.templateId
  if (templateId) {
    const template = await CrmEmailTemplateRepository.findById(
      templateId,
      workspaceId,
    )
    // A template removed from the newsletter falls back to a blank issue;
    // an explicit `templateId` that does not exist is an error.
    if (!template.ok && dto.templateId) return template
    const doc = template.ok
      ? openEmailDocument(template.value.builderDocument)
      : null
    if (doc) return ok({ document: doc, preheader: null })
  }
  return ok({ document: createBlankEmailDocument(), preheader: null })
}

export const CrmNewsletterIssueService = {
  async list(
    actorId: string,
    workspaceId: string,
    newsletterId: string,
    query: ListCrmNewsletterIssuesQuery,
  ): Promise<Result<Paged<CrmNewsletterIssueDTO>>> {
    const scope = await loadNewsletterScope(
      actorId,
      workspaceId,
      newsletterId,
      'VIEW',
    )
    if (!scope.ok) return scope
    const page = await CrmNewsletterIssueRepository.list(
      workspaceId,
      newsletterId,
      query,
    )
    if (!page.ok) return page
    const stats = await CrmNewsletterDeliveryRepository.statsFor(
      page.value.items
        .filter((issue) => issue.status !== 'DRAFT')
        .map((issue) => issue.id),
    )
    if (!stats.ok) return stats
    return ok({
      items: page.value.items.map((issue) =>
        toCrmNewsletterIssueDTO(issue, {
          stats: stats.value.get(issue.id) ?? null,
          webUrl: issueWebUrl(issue, scope.value.newsletter),
        }),
      ),
      total: page.value.total,
      page: query.page,
      pageSize: query.pageSize,
    })
  },

  async get(
    actorId: string,
    workspaceId: string,
    newsletterId: string,
    issueId: string,
  ): Promise<Result<CrmNewsletterIssueDTO>> {
    const scope = await loadNewsletterScope(
      actorId,
      workspaceId,
      newsletterId,
      'VIEW',
    )
    if (!scope.ok) return scope
    const issue = await loadIssue(workspaceId, newsletterId, issueId)
    if (!issue.ok) return issue
    const stats = await CrmNewsletterDeliveryRepository.statsFor([issueId])
    if (!stats.ok) return stats
    return ok(
      toCrmNewsletterIssueDTO(issue.value, {
        stats: stats.value.get(issueId) ?? null,
        webUrl: issueWebUrl(issue.value, scope.value.newsletter),
        includeDocument: true,
      }),
    )
  },

  async create(
    actorId: string,
    workspaceId: string,
    newsletterId: string,
    dto: CreateCrmNewsletterIssueDTO,
  ): Promise<Result<CrmNewsletterIssueDTO>> {
    const scope = await loadNewsletterScope(
      actorId,
      workspaceId,
      newsletterId,
      'CREATE',
    )
    if (!scope.ok) return scope
    const { newsletter } = scope.value
    if (newsletter.status !== 'ACTIVE') return err(crmNewsletterArchived())

    let slug: string
    if (dto.slug) {
      const taken = await CrmNewsletterIssueRepository.slugTaken(
        newsletterId,
        dto.slug,
      )
      if (!taken.ok) return taken
      if (taken.value) {
        return err(conflict('Já existe uma edição com este endereço'))
      }
      slug = dto.slug
    } else {
      const free = await freeSlug(
        newsletterId,
        slugifyIssueSubject(dto.subject),
      )
      if (!free.ok) return free
      slug = free.value
    }

    const content = await startingContent(workspaceId, newsletter, dto)
    if (!content.ok) return content
    const preheader = dto.preheader ?? content.value.preheader
    const document =
      preheader !== null && preheader !== undefined
        ? withPreheader(content.value.document, preheader)
        : content.value.document

    const created = await CrmNewsletterIssueRepository.create({
      workspaceId,
      newsletterId,
      subject: dto.subject,
      preheader: preheader ?? (documentPreheader(document) || null),
      slug,
      builderDocument: document as Prisma.InputJsonValue,
      createdById: actorId,
    })
    if (!created.ok) return created
    logger.info('crm.newsletter.issue_created', {
      component: 'CrmNewsletterIssueService',
      workspaceId,
      newsletterId,
      issueId: created.value.id,
      duplicated: Boolean(dto.duplicateOfIssueId),
    })
    return ok(toCrmNewsletterIssueDTO(created.value, { includeDocument: true }))
  },

  /**
   * Editor autosave and the settings panel. Only DRAFT/SCHEDULED issues
   * change; HTML blocks follow the template rule (OWNER/ADMIN only). The
   * root preheader of the document and the `preheader` column stay in sync.
   */
  async update(
    actorId: string,
    workspaceId: string,
    newsletterId: string,
    issueId: string,
    dto: UpdateCrmNewsletterIssueDTO,
  ): Promise<Result<CrmNewsletterIssueDTO>> {
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

    if (dto.slug && dto.slug !== issue.value.slug) {
      const taken = await CrmNewsletterIssueRepository.slugTaken(
        newsletterId,
        dto.slug,
        issueId,
      )
      if (!taken.ok) return taken
      if (taken.value) {
        return err(conflict('Já existe uma edição com este endereço'))
      }
    }

    let builderDocument: Prisma.InputJsonValue | undefined
    let preheader: string | null | undefined = dto.preheader
    if (dto.builderDocument !== undefined) {
      const doc = validateIssueDocument(dto.builderDocument)
      if (!doc.ok) return doc
      if (
        !scope.value.membership.isPrivileged &&
        changesHtmlBlocks(
          openEmailDocument(issue.value.builderDocument),
          doc.value,
        )
      ) {
        return err(crmEmailCanvasHtmlForbidden())
      }
      const next =
        dto.preheader !== undefined
          ? withPreheader(doc.value, dto.preheader ?? '')
          : doc.value
      builderDocument = next as Prisma.InputJsonValue
      preheader = documentPreheader(next) || null
    } else if (dto.preheader !== undefined) {
      builderDocument = withPreheader(
        issue.value.builderDocument,
        dto.preheader ?? '',
      ) as Prisma.InputJsonValue
    }

    const updated = await CrmNewsletterIssueRepository.updateEditable(issueId, {
      ...(dto.subject !== undefined ? { subject: dto.subject } : {}),
      ...(dto.slug !== undefined ? { slug: dto.slug } : {}),
      ...(preheader !== undefined ? { preheader } : {}),
      ...(builderDocument !== undefined ? { builderDocument } : {}),
      updatedById: actorId,
    })
    if (!updated.ok) return updated
    if (!updated.value) return err(crmNewsletterIssueLocked())
    return ok(toCrmNewsletterIssueDTO(updated.value, { includeDocument: true }))
  },

  async remove(
    actorId: string,
    workspaceId: string,
    newsletterId: string,
    issueId: string,
    now: Date,
  ): Promise<Result<void>> {
    const scope = await loadNewsletterScope(
      actorId,
      workspaceId,
      newsletterId,
      'DELETE',
    )
    if (!scope.ok) return scope
    const issue = await loadIssue(workspaceId, newsletterId, issueId)
    if (!issue.ok) return issue
    if (issue.value.status !== 'DRAFT') return err(crmNewsletterIssueLocked())
    const deleted = await CrmNewsletterIssueRepository.softDeleteDraft(
      issueId,
      now,
    )
    if (!deleted.ok) return deleted
    if (!deleted.value) return err(crmNewsletterIssueLocked())
    return ok(undefined)
  },

  /**
   * Test send (≤ 5 addresses, 10 per hour per issue, outside the quota):
   * sample variables, "[Teste]" in the subject, footer links that only
   * point at the test page. From the newsletter's sender when its domain is
   * verified; otherwise from Steel's default sender (so the content can be
   * checked before the DNS is done).
   */
  async testSend(
    actorId: string,
    workspaceId: string,
    newsletterId: string,
    issueId: string,
    dto: CrmNewsletterIssueTestSendDTO,
  ): Promise<Result<{ to: string[] }>> {
    const scope = await loadNewsletterScope(
      actorId,
      workspaceId,
      newsletterId,
      'EDIT',
    )
    if (!scope.ok) return scope
    const issue = await loadIssue(workspaceId, newsletterId, issueId)
    if (!issue.ok) return issue

    const limited = await consume(newsletterTestSendLimiter, `issue:${issueId}`)
    if (!limited.ok) return limited

    const base = await renderIssueBase(
      workspaceId,
      issue.value.builderDocument,
      issue.value.subject,
    )
    if (!base.ok) return base

    const { newsletter } = scope.value
    const sender = await resolveVerifiedSender(
      workspaceId,
      newsletter.fromEmail,
    )
    const from = sender.ok
      ? newsletterFromHeader(newsletter.fromName, newsletter.fromEmail)
      : defaultFrom
    const testLink = `${BETTER_AUTH_URL.replace(/\/$/, '')}/newsletter/sair/teste`
    const email = personalizeIssue(base.value, {
      newsletterName: newsletter.name,
      contact: SAMPLE_CONTACT,
      links: { unsubscribeUrl: testLink, preferencesUrl: testLink },
    })

    const to = [...new Set(dto.emails.map((value) => value.toLowerCase()))]
    try {
      for (const recipient of to) {
        await sendEmail({
          from,
          to: recipient,
          subject: `[Teste] ${email.subject}`,
          html: email.html,
          text: email.text,
          ...(newsletter.replyTo ? { replyTo: newsletter.replyTo } : {}),
          tags: [{ name: 'kind', value: 'newsletter-test' }],
        })
      }
    } catch (error) {
      logger.warn('crm.newsletter.test_send_failed', {
        component: 'CrmNewsletterIssueService',
        workspaceId,
        issueId,
        message: error instanceof Error ? error.message : String(error),
      })
      return err(mailError('Não foi possível enviar o teste. Tente de novo.'))
    }
    logger.info('crm.newsletter.test_sent', {
      component: 'CrmNewsletterIssueService',
      workspaceId,
      issueId,
      count: to.length,
    })
    return ok({ to })
  },

  /**
   * What the send dialog shows: audience, the month's quota, the checklist
   * and every blocker in the order the send checks them.
   */
  async preflight(
    actorId: string,
    workspaceId: string,
    newsletterId: string,
    issueId: string,
    now: Date,
  ): Promise<Result<CrmNewsletterIssuePreflightDTO>> {
    const scope = await loadNewsletterScope(
      actorId,
      workspaceId,
      newsletterId,
      'VIEW',
    )
    if (!scope.ok) return scope
    const issue = await loadIssue(workspaceId, newsletterId, issueId)
    if (!issue.ok) return issue
    const { newsletter } = scope.value

    const [sender, audience, usage, base] = await Promise.all([
      resolveVerifiedSender(workspaceId, newsletter.fromEmail),
      CrmNewsletterIssueRepository.countAudience(workspaceId, newsletterId),
      CrmNewsletterUsageService.getUsage(workspaceId, now),
      renderIssueBase(
        workspaceId,
        issue.value.builderDocument,
        issue.value.subject,
      ),
    ])
    if (!audience.ok) return audience
    if (!usage.ok) return usage
    if (!sender.ok && sender.error.code !== 'SENDING_DOMAIN_NOT_VERIFIED') {
      return sender
    }

    const blockers: CrmNewsletterPreflightCheckDTO[] = []
    if (newsletter.status !== 'ACTIVE') {
      blockers.push({
        code: 'NEWSLETTER_ARCHIVED',
        message: crmNewsletterArchived().message,
      })
    }
    if (!sender.ok) {
      blockers.push({
        code: 'SENDER_NOT_VERIFIED',
        message: sender.error.message,
      })
    }
    const checklist = base.ok
      ? issueChecklist(base.value, issue.value.subject)
      : []
    const firstError = base.ok
      ? checklist.find((item) => item.level === 'error')?.message
      : base.error.message
    if (firstError) {
      blockers.push({ code: 'CONTENT_INVALID', message: firstError })
    }
    if (audience.value === 0) {
      blockers.push({
        code: 'NO_SUBSCRIBERS',
        message: 'A newsletter ainda não tem assinantes ativos',
      })
    }
    if (
      issue.value.abSubjectB &&
      audience.value > 0 &&
      audience.value < CRM_NEWSLETTER_AB_MIN_AUDIENCE
    ) {
      blockers.push({
        code: 'AB_AUDIENCE_TOO_SMALL',
        message: crmNewsletterAbAudienceTooSmall(CRM_NEWSLETTER_AB_MIN_AUDIENCE)
          .message,
      })
    }
    const remaining = CrmNewsletterUsageService.remaining(usage.value)
    if (remaining !== null && audience.value > remaining) {
      blockers.push({
        code: 'LIMIT_REACHED',
        message: limitMessage(audience.value, remaining, usage.value.limit),
      })
    }

    return ok({
      audience: audience.value,
      usage: usage.value,
      remaining,
      senderVerified: sender.ok,
      checklist: checklist.map(({ code, level, message }) => ({
        code,
        level,
        message,
      })),
      blockers,
    })
  },

  async report(
    actorId: string,
    workspaceId: string,
    newsletterId: string,
    issueId: string,
  ): Promise<Result<CrmNewsletterIssueReportDTO>> {
    const scope = await loadNewsletterScope(
      actorId,
      workspaceId,
      newsletterId,
      'VIEW',
    )
    if (!scope.ok) return scope
    const issue = await loadIssue(workspaceId, newsletterId, issueId)
    if (!issue.ok) return issue
    const [stats, links] = await Promise.all([
      CrmNewsletterDeliveryRepository.statsFor([issueId]),
      CrmNewsletterDeliveryRepository.linkStats(issueId),
    ])
    if (!stats.ok) return stats
    if (!links.ok) return links
    return ok({
      stats: stats.value.get(issueId) ?? {
        recipients: 0,
        sent: 0,
        skipped: 0,
        failed: 0,
        delivered: 0,
        opened: 0,
        clicked: 0,
        bounced: 0,
        complained: 0,
        unsubscribed: 0,
      },
      links: links.value,
    })
  },

  async recipients(
    actorId: string,
    workspaceId: string,
    newsletterId: string,
    issueId: string,
    query: ListCrmNewsletterIssueRecipientsQuery,
  ): Promise<Result<Paged<CrmNewsletterIssueRecipientDTO>>> {
    const scope = await loadNewsletterScope(
      actorId,
      workspaceId,
      newsletterId,
      'VIEW',
    )
    if (!scope.ok) return scope
    const issue = await loadIssue(workspaceId, newsletterId, issueId)
    if (!issue.ok) return issue
    const page = await CrmNewsletterDeliveryRepository.listRecipients(
      issueId,
      query,
    )
    if (!page.ok) return page
    return ok({
      items: page.value.items.map(toCrmNewsletterIssueRecipientDTO),
      total: page.value.total,
      page: query.page,
      pageSize: query.pageSize,
    })
  },

  /** Header data of the issue screens: name and whether sending is open. */
  async summary(
    actorId: string,
    workspaceId: string,
    newsletterId: string,
  ): Promise<
    Result<{
      id: string
      name: string
      senderVerified: boolean
      archived: boolean
    }>
  > {
    const scope = await loadNewsletterScope(
      actorId,
      workspaceId,
      newsletterId,
      'VIEW',
    )
    if (!scope.ok) return scope
    const { newsletter } = scope.value
    const sender = await resolveVerifiedSender(
      workspaceId,
      newsletter.fromEmail,
    )
    if (!sender.ok && sender.error.code !== 'SENDING_DOMAIN_NOT_VERIFIED') {
      return sender
    }
    return ok({
      id: newsletter.id,
      name: newsletter.name,
      senderVerified: sender.ok,
      archived: newsletter.status !== 'ACTIVE',
    })
  },

  /** Newsletter overview: open/click rates of the last sent issues. */
  async trend(
    actorId: string,
    workspaceId: string,
    newsletterId: string,
  ): Promise<Result<CrmNewsletterIssueTrendDTO>> {
    const scope = await loadNewsletterScope(
      actorId,
      workspaceId,
      newsletterId,
      'VIEW',
    )
    if (!scope.ok) return scope
    const issues = await CrmNewsletterIssueRepository.listLastSent(
      workspaceId,
      newsletterId,
      ISSUE_TREND_SIZE,
    )
    if (!issues.ok) return issues
    const stats = await CrmNewsletterDeliveryRepository.statsFor(
      issues.value.map((issue) => issue.id),
    )
    if (!stats.ok) return stats
    return ok(toCrmNewsletterIssueTrendDTO(issues.value, stats.value))
  },
}

/** pt-BR quota message with the numbers (send refusal and dialog). */
export function limitMessage(
  audience: number,
  remaining: number,
  limit: number | null,
): string {
  const n = (value: number) => value.toLocaleString('pt-BR')
  return `Esta edição iria para ${n(audience)} assinantes, mas restam ${n(remaining)} de ${n(limit ?? 0)} e-mails no limite deste mês.`
}
