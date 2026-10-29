import type { CrmNewsletterDigest, Prisma } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import {
  crmNewsletterArchived,
  crmNewsletterDigestSourceInvalid,
  notFound,
} from '@/src/errors'
import {
  buildDigestDocument,
  type DigestPost,
} from '@/src/lib/crm-newsletter/digest-document'
import {
  digestSubject,
  firstDigestLookbackDays,
  nextDigestRun,
} from '@/src/lib/crm-newsletter/digest-schedule'
import { slugifyIssueSubject } from '@/src/lib/crm-newsletter/email'
import {
  FEED_FAILURE_MESSAGES,
  fetchFeed,
} from '@/src/lib/crm-newsletter/feed-fetch'
import { err, ok, type Result } from '@/src/lib/result'
import { BLOG_BASE } from '@/src/lib/sites/blog/routes'
import { publicSiteUrl } from '@/src/lib/sites/public-url'
import {
  assertPublicHttpsUrl,
  OutboundUrlError,
} from '@/src/lib/whatsapp/outbound-url'
import { toCrmNewsletterDigestDTO } from '@/src/mappers/crm-newsletter-digest.mapper'
import { CrmEmailTemplateRepository } from '@/src/repositories/crm-email-template.repository'
import {
  CrmNewsletterDigestRepository,
  type DigestWithSite,
} from '@/src/repositories/crm-newsletter-digest.repository'
import {
  CrmNewsletterIssueRepository,
  type NewsletterWithWorkspace,
} from '@/src/repositories/crm-newsletter-issue.repository'
import type {
  CrmNewsletterDigestItemDTO,
  CrmNewsletterDigestOutcome,
  CrmNewsletterDigestPreviewDTO,
  CrmNewsletterDigestRunDTO,
  CrmNewsletterDigestSettingsDTO,
  PreviewCrmNewsletterDigestDTO,
  UpsertCrmNewsletterDigestDTO,
} from '@/src/schemas/crm-newsletter-digest.schema'
import {
  notifyDigestReady,
  notifyDigestSkipped,
} from './crm-newsletter-digest-notifications'
import { loadNewsletterScope } from './crm-newsletter-issue.service'
import { validateIssueDocument } from './crm-newsletter-render'
import { CrmNewsletterSendService } from './crm-newsletter-send.service'

/**
 * "Resumo automático" of a newsletter (newsletter2 nl2-digest-ai): the
 * settings (CRM `email` resource), the source preview, "Gerar rascunho
 * agora" and the worker run. Sources: the live posts of a Site blog of the
 * workspace and/or an external RSS/Atom feed (fetched server-side behind
 * the outbound URL guard). Only items newer than the last digest go in.
 */

const DAY_MS = 86_400_000
/** Digests started per worker tick. */
export const DIGEST_TICK_LIMIT = 25

export type DigestSources = {
  workspaceId: string
  siteId: string | null
  rssUrl: string | null
  maxItems: number
  since: Date
  now: Date
}

type CollectedItem = CrmNewsletterDigestItemDTO & { date: Date }

/**
 * Items newer than `since` from the site blog and the feed, newest first,
 * at most `maxItems`. A source that fails becomes a pt-BR warning; the
 * other source still counts.
 */
export async function collectDigestItems(
  input: DigestSources,
): Promise<Result<{ items: CollectedItem[]; warnings: string[] }>> {
  const warnings: string[] = []
  const items: CollectedItem[] = []

  if (input.siteId) {
    const site = await CrmNewsletterDigestRepository.findSite(
      input.workspaceId,
      input.siteId,
    )
    if (!site.ok) return site
    if (!site.value) {
      warnings.push('O site escolhido não existe mais.')
    } else if (!site.value.publishedAt) {
      warnings.push(
        `O site "${site.value.name}" ainda não foi publicado — os links dos posts não abririam.`,
      )
    } else {
      const posts = await CrmNewsletterDigestRepository.listLivePosts(
        site.value.id,
        input.since,
        input.now,
        input.maxItems,
      )
      if (!posts.ok) return posts
      const base = publicSiteUrl(site.value.slug)
      for (const post of posts.value) {
        if (!post.publishedAt) continue
        items.push({
          source: 'SITE',
          title: post.title,
          excerpt: (post.excerpt || post.autoExcerpt || '').slice(0, 400),
          url: `${base}/${BLOG_BASE}/${post.slug}`,
          imageUrl: post.coverImageUrl,
          publishedAt: post.publishedAt.toISOString(),
          date: post.publishedAt,
        })
      }
    }
  }

  if (input.rssUrl) {
    const feed = await fetchFeed(input.rssUrl)
    if (!feed.ok) {
      warnings.push(FEED_FAILURE_MESSAGES[feed.reason])
    } else {
      for (const entry of feed.feed.items) {
        // Undated entries are skipped: "new since the last digest" needs a date.
        if (!entry.publishedAt) continue
        if (entry.publishedAt <= input.since || entry.publishedAt > input.now) {
          continue
        }
        items.push({
          source: 'RSS',
          title: entry.title,
          excerpt: entry.excerpt,
          url: entry.url,
          imageUrl: entry.imageUrl,
          publishedAt: entry.publishedAt.toISOString(),
          date: entry.publishedAt,
        })
      }
    }
  }

  items.sort((a, b) => b.date.getTime() - a.date.getTime())
  return ok({ items: items.slice(0, input.maxItems), warnings })
}

/** Lower bound of a digest: the last item used, else the look-back. */
export function digestSince(
  digest: Pick<CrmNewsletterDigest, 'lastItemAt' | 'cadence'> | null,
  now: Date,
): Date {
  if (digest?.lastItemAt) return digest.lastItemAt
  return new Date(
    now.getTime() -
      firstDigestLookbackDays(digest?.cadence ?? 'WEEKLY') * DAY_MS,
  )
}

/** pt-BR refusal of an RSS URL (`null` = allowed). */
async function rssUrlProblem(url: string): Promise<string | null> {
  try {
    await assertPublicHttpsUrl(url)
    return null
  } catch (cause) {
    const reason =
      cause instanceof OutboundUrlError &&
      cause.message in FEED_FAILURE_MESSAGES
        ? (cause.message as keyof typeof FEED_FAILURE_MESSAGES)
        : 'invalid_url'
    return FEED_FAILURE_MESSAGES[reason]
  }
}

/** A free issue slug for the newsletter: `base`, `base-2`… */
async function freeIssueSlug(
  newsletterId: string,
  base: string,
): Promise<Result<string>> {
  for (let attempt = 1; attempt <= 20; attempt++) {
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

/** Preheader of a digest: the first titles, up to 150 characters. */
export function digestPreheader(items: { title: string }[]): string {
  const joined = items.map((item) => item.title.trim()).join(' · ')
  return joined.length <= 150 ? joined : `${joined.slice(0, 149).trimEnd()}…`
}

/** Builds and stores the digest draft. */
async function createDigestIssue(
  digest: CrmNewsletterDigest,
  newsletter: NewsletterWithWorkspace,
  items: CollectedItem[],
  now: Date,
): Promise<Result<{ id: string; subject: string }>> {
  let template: unknown = null
  if (newsletter.templateId) {
    const found = await CrmEmailTemplateRepository.findById(
      newsletter.templateId,
      digest.workspaceId,
    )
    if (found.ok) template = found.value.builderDocument
  }
  const subject = digestSubject(digest.subject, now) || newsletter.name
  const preheader = digestPreheader(items)
  const posts: DigestPost[] = items.map((item) => ({
    title: item.title,
    excerpt: item.excerpt,
    url: item.url,
    imageUrl: item.imageUrl,
  }))
  const doc = validateIssueDocument(
    buildDigestDocument({
      title: subject,
      intro: digest.intro,
      posts,
      preheader,
      template,
    }),
  )
  if (!doc.ok) return doc
  const slug = await freeIssueSlug(newsletter.id, slugifyIssueSubject(subject))
  if (!slug.ok) return slug
  const created = await CrmNewsletterDigestRepository.createIssue({
    workspaceId: digest.workspaceId,
    newsletterId: newsletter.id,
    digestId: digest.id,
    subject,
    preheader,
    slug: slug.value,
    builderDocument: doc.value as unknown as Prisma.InputJsonValue,
    createdById: digest.createdById,
  })
  if (!created.ok) return created
  return ok({ id: created.value.id, subject })
}

export type DigestRunOutcome = {
  outcome: CrmNewsletterDigestOutcome
  issueId: string | null
  items: number
  message: string
}

/**
 * One digest run. `manual` ("Gerar rascunho agora") always creates a
 * draft and does not move the "new since" mark; a scheduled run moves it
 * to the newest item used and follows the mode (draft or send).
 */
export async function runDigest(
  digest: CrmNewsletterDigest,
  now: Date,
  options: { manual?: boolean } = {},
): Promise<Result<DigestRunOutcome>> {
  const base = {
    component: 'CrmNewsletterDigestService',
    workspaceId: digest.workspaceId,
    newsletterId: digest.newsletterId,
    digestId: digest.id,
    manual: Boolean(options.manual),
  }
  const record = async (outcome: DigestRunOutcome, lastItemAt?: Date) => {
    if (options.manual) return
    const saved = await CrmNewsletterDigestRepository.recordRun(digest.id, {
      lastOutcome: outcome.outcome,
      lastMessage: outcome.message,
      lastIssueId: outcome.issueId ?? digest.lastIssueId,
      ...(lastItemAt ? { lastItemAt } : {}),
    })
    if (!saved.ok) {
      logger.error('crm.newsletter.digest_record_failed', {
        ...base,
        reason: saved.error.code,
      })
    }
  }
  let newsletterName = 'Newsletter'
  const skip = async (message: string) => {
    const outcome: DigestRunOutcome = {
      outcome: 'SKIPPED',
      issueId: null,
      items: 0,
      message,
    }
    await record(outcome)
    logger.info('crm.newsletter.digest_skipped', { ...base, message })
    if (!options.manual) {
      await notifyDigestSkipped({
        workspaceId: digest.workspaceId,
        newsletterId: digest.newsletterId,
        newsletterName,
        recipientId: digest.createdById,
        reason: message,
        issueId: null,
        runKey: `${digest.id}:${now.getTime()}`,
      })
    }
    return ok(outcome)
  }

  const newsletter = await CrmNewsletterIssueRepository.findNewsletter(
    digest.workspaceId,
    digest.newsletterId,
  )
  if (!newsletter.ok) return newsletter
  if (!newsletter.value) return err(notFound('CrmNewsletter'))
  newsletterName = newsletter.value.name
  if (newsletter.value.status !== 'ACTIVE') {
    return skip(crmNewsletterArchived().message)
  }

  const collected = await collectDigestItems({
    workspaceId: digest.workspaceId,
    siteId: digest.siteId,
    rssUrl: digest.rssUrl,
    maxItems: digest.maxItems,
    since: digestSince(digest, now),
    now,
  })
  if (!collected.ok) return collected
  const { items, warnings } = collected.value
  if (items.length === 0) {
    return skip(
      warnings[0] ??
        'Nenhum post novo desde o último resumo — nada foi criado nem enviado.',
    )
  }

  const issue = await createDigestIssue(digest, newsletter.value, items, now)
  if (!issue.ok) {
    if (issue.error.code === 'DATABASE_ERROR') return issue
    return skip(issue.error.message)
  }
  const newest = items[0].date
  logger.info('crm.newsletter.digest_issue_created', {
    ...base,
    issueId: issue.value.id,
    items: items.length,
    mode: digest.mode,
  })

  if (options.manual || digest.mode === 'DRAFT') {
    const outcome: DigestRunOutcome = {
      outcome: 'DRAFT_CREATED',
      issueId: issue.value.id,
      items: items.length,
      message: `Rascunho criado com ${items.length} ${items.length === 1 ? 'post' : 'posts'}.`,
    }
    await record(outcome, newest)
    if (!options.manual) {
      await notifyDigestReady({
        workspaceId: digest.workspaceId,
        newsletterId: digest.newsletterId,
        newsletterName: newsletter.value.name,
        issueId: issue.value.id,
        recipientId: digest.createdById,
        items: items.length,
      })
    }
    return ok(outcome)
  }

  const sent = await CrmNewsletterSendService.sendNowAsSystem(
    issue.value.id,
    now,
  )
  if (!sent.ok) return sent
  if (!sent.value.started) {
    // The draft keeps these items: the next digest does not repeat them.
    await CrmNewsletterDigestRepository.recordRun(digest.id, {
      lastItemAt: newest,
      lastOutcome: 'FAILED',
      lastMessage: sent.value.refused,
      lastIssueId: issue.value.id,
    })
    logger.warn('crm.newsletter.digest_send_refused', {
      ...base,
      issueId: issue.value.id,
      reason: sent.value.refused,
    })
    await notifyDigestSkipped({
      workspaceId: digest.workspaceId,
      newsletterId: digest.newsletterId,
      newsletterName: newsletter.value.name,
      recipientId: digest.createdById,
      reason: sent.value.refused,
      issueId: issue.value.id,
      runKey: `${digest.id}:${now.getTime()}`,
    })
    return ok({
      outcome: 'FAILED',
      issueId: issue.value.id,
      items: items.length,
      message: sent.value.refused,
    })
  }
  const outcome: DigestRunOutcome = {
    outcome: 'SENT',
    issueId: issue.value.id,
    items: items.length,
    message: `Resumo enviado com ${items.length} ${items.length === 1 ? 'post' : 'posts'}.`,
  }
  await record(outcome, newest)
  return ok(outcome)
}

async function settingsOf(
  workspaceId: string,
  digest: DigestWithSite | null,
): Promise<Result<CrmNewsletterDigestSettingsDTO>> {
  const sites = await CrmNewsletterDigestRepository.listSites(workspaceId)
  if (!sites.ok) return sites
  return ok({
    digest: digest ? toCrmNewsletterDigestDTO(digest) : null,
    sites: sites.value.map((site) => ({
      id: site.id,
      name: site.name,
      published: site.publishedAt !== null,
    })),
  })
}

export const CrmNewsletterDigestService = {
  async get(
    actorId: string,
    workspaceId: string,
    newsletterId: string,
  ): Promise<Result<CrmNewsletterDigestSettingsDTO>> {
    const scope = await loadNewsletterScope(
      actorId,
      workspaceId,
      newsletterId,
      'VIEW',
    )
    if (!scope.ok) return scope
    const digest = await CrmNewsletterDigestRepository.findByNewsletter(
      workspaceId,
      newsletterId,
    )
    if (!digest.ok) return digest
    return settingsOf(workspaceId, digest.value)
  },

  /** Creates or replaces the settings; recomputes the next run. */
  async save(
    actorId: string,
    workspaceId: string,
    newsletterId: string,
    dto: UpsertCrmNewsletterDigestDTO,
    now: Date,
  ): Promise<Result<CrmNewsletterDigestSettingsDTO>> {
    const scope = await loadNewsletterScope(
      actorId,
      workspaceId,
      newsletterId,
      'EDIT',
    )
    if (!scope.ok) return scope
    if (dto.siteId) {
      const site = await CrmNewsletterDigestRepository.findSite(
        workspaceId,
        dto.siteId,
      )
      if (!site.ok) return site
      if (!site.value) {
        return err(
          crmNewsletterDigestSourceInvalid('Site não encontrado no workspace'),
        )
      }
    }
    if (dto.rssUrl) {
      const problem = await rssUrlProblem(dto.rssUrl)
      if (problem) return err(crmNewsletterDigestSourceInvalid(problem))
    }
    const saved = await CrmNewsletterDigestRepository.upsert({
      workspaceId,
      newsletterId,
      actorId,
      data: dto,
      nextRunAt: dto.enabled ? nextDigestRun(dto, now) : null,
    })
    if (!saved.ok) return saved
    auditMutation({
      entity: 'crm_newsletter_digest',
      action: 'update',
      actorId,
      targetId: saved.value.id,
      meta: {
        workspaceId,
        newsletterId,
        enabled: dto.enabled,
        mode: dto.mode,
        cadence: dto.cadence,
        site: Boolean(dto.siteId),
        rss: Boolean(dto.rssUrl),
      },
    })
    return settingsOf(workspaceId, saved.value)
  },

  async remove(
    actorId: string,
    workspaceId: string,
    newsletterId: string,
  ): Promise<Result<void>> {
    const scope = await loadNewsletterScope(
      actorId,
      workspaceId,
      newsletterId,
      'DELETE',
    )
    if (!scope.ok) return scope
    const removed = await CrmNewsletterDigestRepository.remove(
      workspaceId,
      newsletterId,
    )
    if (!removed.ok) return removed
    if (!removed.value) return err(notFound('CrmNewsletterDigest'))
    auditMutation({
      entity: 'crm_newsletter_digest',
      action: 'delete',
      actorId,
      targetId: newsletterId,
      meta: { workspaceId, newsletterId },
    })
    return ok(undefined)
  },

  /** What the next digest would carry with these sources (nothing saved). */
  async preview(
    actorId: string,
    workspaceId: string,
    newsletterId: string,
    dto: PreviewCrmNewsletterDigestDTO,
    now: Date,
  ): Promise<Result<CrmNewsletterDigestPreviewDTO>> {
    const scope = await loadNewsletterScope(
      actorId,
      workspaceId,
      newsletterId,
      'EDIT',
    )
    if (!scope.ok) return scope
    if (dto.rssUrl) {
      const problem = await rssUrlProblem(dto.rssUrl)
      if (problem) return err(crmNewsletterDigestSourceInvalid(problem))
    }
    const digest = await CrmNewsletterDigestRepository.findByNewsletter(
      workspaceId,
      newsletterId,
    )
    if (!digest.ok) return digest
    const since = digestSince(digest.value, now)
    const collected = await collectDigestItems({
      workspaceId,
      siteId: dto.siteId,
      rssUrl: dto.rssUrl,
      maxItems: dto.maxItems,
      since,
      now,
    })
    if (!collected.ok) return collected
    return ok({
      items: collected.value.items.map(({ date: _date, ...item }) => item),
      warnings: collected.value.warnings,
      since: since.toISOString(),
    })
  },

  /** "Gerar rascunho agora": a draft from the saved settings. */
  async runNow(
    actorId: string,
    workspaceId: string,
    newsletterId: string,
    now: Date,
  ): Promise<Result<CrmNewsletterDigestRunDTO>> {
    const scope = await loadNewsletterScope(
      actorId,
      workspaceId,
      newsletterId,
      'CREATE',
    )
    if (!scope.ok) return scope
    if (scope.value.newsletter.status !== 'ACTIVE') {
      return err(crmNewsletterArchived())
    }
    const digest = await CrmNewsletterDigestRepository.findByNewsletter(
      workspaceId,
      newsletterId,
    )
    if (!digest.ok) return digest
    if (!digest.value) return err(notFound('CrmNewsletterDigest'))
    const result = await runDigest(digest.value, now, { manual: true })
    if (!result.ok) return result
    auditMutation({
      entity: 'crm_newsletter_digest',
      action: 'create',
      actorId,
      targetId: digest.value.id,
      meta: {
        workspaceId,
        newsletterId,
        issueId: result.value.issueId,
        items: result.value.items,
        manual: true,
      },
    })
    return ok({
      issueId: result.value.issueId,
      items: result.value.items,
      message: result.value.message,
    })
  },

  /** Worker tick: claims and runs the due digests. */
  async tick(
    now: Date,
  ): Promise<Result<{ due: number; ran: number; failed: number }>> {
    const due = await CrmNewsletterDigestRepository.listDue(
      now,
      DIGEST_TICK_LIMIT,
    )
    if (!due.ok) return due
    let ran = 0
    let failed = 0
    for (const digest of due.value) {
      if (!digest.nextRunAt) continue
      const claimed = await CrmNewsletterDigestRepository.claimRun(
        digest.id,
        digest.nextRunAt,
        nextDigestRun(digest, now),
        now,
      )
      if (!claimed.ok) return claimed
      if (!claimed.value) continue
      const result = await runDigest(digest, now)
      if (!result.ok) {
        failed++
        logger.error('crm.newsletter.digest_run_failed', {
          component: 'CrmNewsletterDigestService',
          digestId: digest.id,
          reason: result.error.code,
        })
        await CrmNewsletterDigestRepository.recordRun(digest.id, {
          lastOutcome: 'FAILED',
          lastMessage:
            'Falha interna ao montar o resumo. Tentaremos no próximo ciclo.',
        })
        continue
      }
      ran++
    }
    return ok({ due: due.value.length, ran, failed })
  },
}
