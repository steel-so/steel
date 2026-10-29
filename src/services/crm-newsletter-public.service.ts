import type {
  CrmNewsletterSubscriber,
  CrmNewsletterSubscriberSource,
} from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { BETTER_AUTH_URL } from '@/lib/env/server'
import { crmNewsletterNotFound, crmNewsletterTokenInvalid } from '@/src/errors'
import {
  createPreferencesToken,
  readConfirmTokenSubject,
  verifyConfirmToken,
  verifyPreferencesToken,
  verifyUnsubscribeToken,
} from '@/src/lib/newsletter/tokens'
import {
  newsletterArchiveUrl,
  newsletterPreferencesUrl,
} from '@/src/lib/newsletter/urls'
import { err, ok, type Result } from '@/src/lib/result'
import { CrmEmailOptOutRepository } from '@/src/repositories/crm-email-opt-out.repository'
import { CrmNewsletterRepository } from '@/src/repositories/crm-newsletter.repository'
import {
  CrmNewsletterSubscriberRepository,
  type CrmNewsletterSubscriberWithNewsletter,
} from '@/src/repositories/crm-newsletter-subscriber.repository'
import { WorkspaceRepository } from '@/src/repositories/workspace.repository'
import {
  CRM_NEWSLETTER_DEFAULT_CONSENT_TEXT,
  type NewsletterPreferencesDTO,
  type NewsletterUnsubscribeResultDTO,
  type PublicNewsletterSubscribeDTO,
  type PublicNewsletterSubscribeResultDTO,
  type UpdateNewsletterPreferencesDTO,
} from '@/src/schemas/crm-newsletter.schema'
import { assertModuleEnabled } from './authz'
import { CrmNewsletterBridge } from './crm-newsletter-bridge.service'
import {
  type ConfirmationNewsletter,
  confirmResendWaitSeconds,
  sendNewsletterConfirmation,
} from './crm-newsletter-confirmation'

/** Who asked, for the consent evidence (LGPD). */
export type PublicRequestContext = {
  ip: string | null
  userAgent: string | null
  now: Date
}

export const PREFERENCES_CONSENT_TEXT =
  'Escolheu receber esta newsletter na central de preferências.'

type SubscribeInput = {
  newsletter: ConfirmationNewsletter & { id: string; doubleOptIn: boolean }
  publisherName: string
  email: string
  name: string | null
  source: CrmNewsletterSubscriberSource
  sourceRef: string | null
  consentText: string
  context: PublicRequestContext
}

const isSubscribed = (status: CrmNewsletterSubscriber['status']) =>
  status === 'ACTIVE' || status === 'PENDING'

/**
 * The one subscribe path of the visitor (public page, Sites, API, CRM
 * form). Every outcome is `ok`: an opted-out, bounced, complained or
 * already-active address changes nothing and the caller answers the same.
 */
async function subscribeCore(input: SubscribeInput): Promise<Result<void>> {
  const { newsletter, context } = input
  const email = input.email.trim().toLowerCase()

  const optedOut = await CrmNewsletterSubscriberRepository.isOptedOut(
    newsletter.workspaceId,
    email,
  )
  if (!optedOut.ok) return optedOut
  if (optedOut.value) return ok(undefined)

  const existing = await CrmNewsletterSubscriberRepository.findByEmail(
    newsletter.id,
    email,
  )
  if (!existing.ok) return existing
  const current = existing.value

  if (current?.status === 'PENDING' && newsletter.doubleOptIn) {
    // Repeated subscribe: resend, at most once per 10 minutes.
    if (confirmResendWaitSeconds(current, context.now) > 0) return ok(undefined)
    const sent = await sendNewsletterConfirmation({
      subscriber: current,
      newsletter,
      publisherName: input.publisherName,
      now: context.now,
    })
    return sent.ok ? ok(undefined) : sent
  }
  if (
    current &&
    current.status !== 'UNSUBSCRIBED' &&
    current.status !== 'PENDING'
  ) {
    return ok(undefined)
  }

  const people = await CrmNewsletterSubscriberRepository.personIdsByEmails(
    newsletter.workspaceId,
    [email],
  )
  if (!people.ok) return people

  const pending = newsletter.doubleOptIn
  const data = {
    name: input.name ?? current?.name ?? null,
    personId: people.value.get(email) ?? current?.personId ?? null,
    status: pending ? ('PENDING' as const) : ('ACTIVE' as const),
    source: input.source,
    sourceRef: input.sourceRef,
    consentAt: context.now,
    consentIp: context.ip,
    consentUserAgent: context.userAgent?.slice(0, 500) ?? null,
    consentText: input.consentText,
    confirmedAt: pending ? null : context.now,
    unsubscribedAt: null,
    unsubscribeReason: null,
  }
  const saved = current
    ? await CrmNewsletterSubscriberRepository.update(current.id, data)
    : await CrmNewsletterSubscriberRepository.create({
        ...data,
        newsletterId: newsletter.id,
        workspaceId: newsletter.workspaceId,
        email,
      })
  if (!saved.ok) {
    // Two requests raced on the same address: the other one won.
    return saved.error.code === 'CRM_NEWSLETTER_SUBSCRIBER_EXISTS'
      ? ok(undefined)
      : saved
  }

  auditMutation({
    entity: 'crm_newsletter_subscriber',
    action: 'opt_in',
    actorId: null,
    targetId: saved.value.id,
    meta: {
      workspaceId: newsletter.workspaceId,
      newsletterId: newsletter.id,
      source: input.source,
      status: saved.value.status,
    },
  })
  await CrmNewsletterBridge.emit({
    type: 'subscribed',
    subscriberId: saved.value.id,
  })

  if (!pending) return ok(undefined)
  const sent = await sendNewsletterConfirmation({
    subscriber: saved.value,
    newsletter,
    publisherName: input.publisherName,
    now: context.now,
  })
  return sent.ok ? ok(undefined) : sent
}

async function subscriberOfUnsubscribeToken(token: string): Promise<
  Result<{
    subscriber: CrmNewsletterSubscriberWithNewsletter
    recipientId?: string
  }>
> {
  const verified = verifyUnsubscribeToken(token)
  if (!verified.ok) return err(crmNewsletterTokenInvalid())
  const subscriber = await CrmNewsletterSubscriberRepository.findWithNewsletter(
    verified.value.subscriberId,
  )
  if (!subscriber.ok) return subscriber
  if (!subscriber.value) return err(crmNewsletterTokenInvalid())
  return ok({
    subscriber: subscriber.value,
    recipientId: verified.value.recipientId,
  })
}

function preferencesUrlOf(workspaceId: string, email: string): string {
  return newsletterPreferencesUrl(
    BETTER_AUTH_URL,
    createPreferencesToken({ workspaceId, email }),
  )
}

async function preferencesOf(
  workspaceId: string,
  email: string,
): Promise<Result<NewsletterPreferencesDTO>> {
  const workspace = await WorkspaceRepository.findById(workspaceId)
  if (!workspace.ok) {
    return workspace.error.code === 'RESOURCE_NOT_FOUND'
      ? err(crmNewsletterTokenInvalid())
      : workspace
  }
  const [newsletters, subscriptions, optedOut] = await Promise.all([
    CrmNewsletterRepository.listActiveByWorkspace(workspaceId),
    CrmNewsletterSubscriberRepository.listByWorkspaceEmail(workspaceId, email),
    CrmNewsletterSubscriberRepository.isOptedOut(workspaceId, email),
  ])
  if (!newsletters.ok) return newsletters
  if (!subscriptions.ok) return subscriptions
  if (!optedOut.ok) return optedOut

  const statusOf = new Map(
    subscriptions.value.map((s) => [s.newsletterId, s.status]),
  )
  return ok({
    workspaceName: workspace.value.name,
    email,
    optedOutOfAll: optedOut.value,
    newsletters: newsletters.value.map((n) => {
      const status = statusOf.get(n.id)
      return {
        id: n.id,
        name: n.name,
        description: n.description,
        cadenceLabel: n.cadenceLabel,
        subscribed:
          !optedOut.value && status !== undefined && isSubscribed(status),
      }
    }),
  })
}

export type NewsletterConfirmOutcome =
  | {
      state: 'confirmed'
      newsletterName: string
      publisherName: string
      archiveUrl: string | null
      preferencesUrl: string
    }
  | { state: 'expired'; newsletterName: string; publisherName: string }

export type NewsletterUnsubscribePreviewDTO = {
  email: string
  newsletterName: string
  publisherName: string
  alreadyUnsubscribed: boolean
  preferencesUrl: string
}

/**
 * Public side of the newsletter (ADR 0054): no session, the signed token
 * (or the public slugs) is the authorization. The LGPD right to leave works
 * even when the newsletter was archived/deleted or the CRM switched off.
 */
export const CrmNewsletterPublicService = {
  async subscribe(
    dto: PublicNewsletterSubscribeDTO,
    context: PublicRequestContext,
  ): Promise<Result<PublicNewsletterSubscribeResultDTO>> {
    const newsletter = await CrmNewsletterRepository.findBySlugs(
      dto.workspaceSlug,
      dto.newsletterSlug,
    )
    if (!newsletter.ok) return newsletter
    if (newsletter.value?.status !== 'ACTIVE') {
      return err(crmNewsletterNotFound())
    }
    const enabled = await assertModuleEnabled(
      newsletter.value.workspaceId,
      'CRM',
    )
    if (!enabled.ok) return enabled

    const done = await subscribeCore({
      newsletter: newsletter.value,
      publisherName: newsletter.value.workspace.name,
      email: dto.email,
      name: dto.name ?? null,
      source: dto.source,
      sourceRef: dto.sourceRef ?? null,
      consentText: CRM_NEWSLETTER_DEFAULT_CONSENT_TEXT,
      context,
    })
    if (!done.ok) return done
    const { doubleOptIn } = newsletter.value
    return ok({
      requiresConfirmation: doubleOptIn,
      status: doubleOptIn ? 'PENDING' : 'ACTIVE',
    })
  },

  /**
   * CRM form with "Inscrever na newsletter" whose visitor ticked the
   * consent box. Best-effort for the caller: a newsletter that is gone,
   * archived or from another workspace subscribes nobody.
   */
  async subscribeFromForm(input: {
    workspaceId: string
    newsletterId: string
    formId: string
    email: string
    name: string | null
    consentText: string
    context: PublicRequestContext
  }): Promise<Result<boolean>> {
    const newsletter = await CrmNewsletterRepository.findWithWorkspace(
      input.newsletterId,
    )
    if (!newsletter.ok) return newsletter
    if (
      !newsletter.value ||
      newsletter.value.workspaceId !== input.workspaceId ||
      newsletter.value.status !== 'ACTIVE'
    ) {
      return ok(false)
    }
    const done = await subscribeCore({
      newsletter: newsletter.value,
      publisherName: newsletter.value.workspace.name,
      email: input.email,
      name: input.name,
      source: 'FORM',
      sourceRef: input.formId,
      consentText: input.consentText,
      context: input.context,
    })
    if (!done.ok) return done
    return ok(true)
  },

  /** Double opt-in link. Confirms on open (the token is single-purpose). */
  async confirm(
    token: string,
    now: Date,
  ): Promise<Result<NewsletterConfirmOutcome>> {
    const verified = verifyConfirmToken(token, now)
    const subject = verified.ok
      ? ok({ subscriberId: verified.value.subscriberId })
      : verified.error === 'expired'
        ? readConfirmTokenSubject(token)
        : verified
    if (!subject.ok) return err(crmNewsletterTokenInvalid())

    const found = await CrmNewsletterSubscriberRepository.findWithNewsletter(
      subject.value.subscriberId,
    )
    if (!found.ok) return found
    const subscriber = found.value
    if (!subscriber || subscriber.newsletter.deletedAt) {
      return err(crmNewsletterTokenInvalid())
    }
    const { newsletter } = subscriber
    const names = {
      newsletterName: newsletter.name,
      publisherName: newsletter.workspace.name,
    }

    if (subscriber.status === 'PENDING') {
      if (!verified.ok) return ok({ state: 'expired', ...names })
      const updated = await CrmNewsletterSubscriberRepository.update(
        subscriber.id,
        { status: 'ACTIVE', confirmedAt: now },
      )
      if (!updated.ok) return updated
      auditMutation({
        entity: 'crm_newsletter_subscriber',
        action: 'confirm',
        actorId: null,
        targetId: subscriber.id,
        meta: {
          workspaceId: subscriber.workspaceId,
          newsletterId: subscriber.newsletterId,
        },
      })
      await CrmNewsletterBridge.emit({
        type: 'confirmed',
        subscriberId: subscriber.id,
      })
    } else if (subscriber.status !== 'ACTIVE') {
      // Left (or bounced) after asking: an old link never brings them back.
      return err(crmNewsletterTokenInvalid())
    }

    return ok({
      state: 'confirmed',
      ...names,
      archiveUrl:
        newsletter.status === 'ACTIVE'
          ? newsletterArchiveUrl(
              BETTER_AUTH_URL,
              newsletter.workspace.slug,
              newsletter.slug,
            )
          : null,
      preferencesUrl: preferencesUrlOf(
        subscriber.workspaceId,
        subscriber.email,
      ),
    })
  },

  /** "Link expired" page: sends a fresh confirmation (10-minute throttle). */
  async resendConfirmation(
    token: string,
    now: Date,
  ): Promise<Result<{ sent: boolean }>> {
    const subject = readConfirmTokenSubject(token)
    if (!subject.ok) return err(crmNewsletterTokenInvalid())
    const found = await CrmNewsletterSubscriberRepository.findWithNewsletter(
      subject.value.subscriberId,
    )
    if (!found.ok) return found
    const subscriber = found.value
    if (
      subscriber?.status !== 'PENDING' ||
      subscriber.newsletter.deletedAt ||
      subscriber.newsletter.status !== 'ACTIVE'
    ) {
      return err(crmNewsletterTokenInvalid())
    }
    // Sent a moment ago: that e-mail is still on its way.
    if (confirmResendWaitSeconds(subscriber, now) > 0) return ok({ sent: true })

    const sent = await sendNewsletterConfirmation({
      subscriber,
      newsletter: {
        ...subscriber.newsletter,
        workspaceId: subscriber.workspaceId,
      },
      publisherName: subscriber.newsletter.workspace.name,
      now,
    })
    if (!sent.ok) return sent
    return ok({ sent: sent.value })
  },

  /** Unsubscribe page data. Writes nothing (link scanners open GETs). */
  async unsubscribePreview(
    token: string,
  ): Promise<Result<NewsletterUnsubscribePreviewDTO>> {
    const found = await subscriberOfUnsubscribeToken(token)
    if (!found.ok) return found
    const { subscriber } = found.value
    return ok({
      email: subscriber.email,
      newsletterName: subscriber.newsletter.name,
      publisherName: subscriber.newsletter.workspace.name,
      alreadyUnsubscribed: !isSubscribed(subscriber.status),
      preferencesUrl: preferencesUrlOf(
        subscriber.workspaceId,
        subscriber.email,
      ),
    })
  },

  /** Leaves this newsletter only (footer link or RFC 8058 one-click). */
  async unsubscribe(
    token: string,
    input: { reason?: string; oneClick: boolean },
    now: Date,
  ): Promise<Result<NewsletterUnsubscribeResultDTO>> {
    const found = await subscriberOfUnsubscribeToken(token)
    if (!found.ok) return found
    const { subscriber, recipientId } = found.value

    const wasSubscribed = isSubscribed(subscriber.status)
    if (wasSubscribed) {
      const updated = await CrmNewsletterSubscriberRepository.update(
        subscriber.id,
        {
          status: 'UNSUBSCRIBED',
          unsubscribedAt: now,
          unsubscribeReason: input.reason || null,
        },
      )
      if (!updated.ok) return updated
      auditMutation({
        entity: 'crm_newsletter_subscriber',
        action: 'opt_out',
        actorId: null,
        targetId: subscriber.id,
        meta: {
          workspaceId: subscriber.workspaceId,
          newsletterId: subscriber.newsletterId,
          recipientId: recipientId ?? null,
          source: input.oneClick ? 'ONE_CLICK' : 'LINK',
        },
      })
      await CrmNewsletterBridge.emit({
        type: 'unsubscribed',
        subscriberId: subscriber.id,
      })
    }
    if (recipientId) {
      const marked =
        await CrmNewsletterSubscriberRepository.markRecipientUnsubscribed(
          recipientId,
          subscriber.id,
          now,
        )
      if (!marked.ok) return marked
    }

    return ok({
      email: subscriber.email,
      newsletterName: subscriber.newsletter.name,
      alreadyUnsubscribed: !wasSubscribed,
    })
  },

  async getPreferences(
    token: string,
  ): Promise<Result<NewsletterPreferencesDTO>> {
    const verified = verifyPreferencesToken(token)
    if (!verified.ok) return err(crmNewsletterTokenInvalid())
    return preferencesOf(verified.value.workspaceId, verified.value.email)
  },

  /**
   * Saves the preference center. The token proves the address, so a
   * newsletter switched on becomes ACTIVE right away; switching any on lifts
   * a previous "sair de tudo". Bounced/complained rows never come back.
   */
  async updatePreferences(
    token: string,
    dto: UpdateNewsletterPreferencesDTO,
    context: PublicRequestContext,
  ): Promise<Result<NewsletterPreferencesDTO>> {
    const verified = verifyPreferencesToken(token)
    if (!verified.ok) return err(crmNewsletterTokenInvalid())
    const { workspaceId, email } = verified.value
    const current = await preferencesOf(workspaceId, email)
    if (!current.ok) return current

    const subscriptions =
      await CrmNewsletterSubscriberRepository.listByWorkspaceEmail(
        workspaceId,
        email,
      )
    if (!subscriptions.ok) return subscriptions
    const rowOf = new Map(subscriptions.value.map((s) => [s.newsletterId, s]))

    const wanted = dto.unsubscribeAll
      ? new Set<string>()
      : new Set(dto.subscribedNewsletterIds)
    // Archived newsletters are not on the page: only "sair de tudo"
    // touches them.
    const shown = new Set(current.value.newsletters.map((n) => n.id))
    const leave = subscriptions.value.filter(
      (s) =>
        isSubscribed(s.status) &&
        (dto.unsubscribeAll ||
          (shown.has(s.newsletterId) && !wanted.has(s.newsletterId))),
    )
    const join = current.value.newsletters.filter((n) => wanted.has(n.id))

    if (leave.length > 0) {
      const left = await CrmNewsletterSubscriberRepository.updateMany(
        leave.map((s) => s.id),
        {
          status: 'UNSUBSCRIBED',
          unsubscribedAt: context.now,
          unsubscribeReason: dto.reason || null,
        },
      )
      if (!left.ok) return left
    }

    if (join.length > 0 && current.value.optedOutOfAll) {
      const lifted =
        await CrmNewsletterSubscriberRepository.deleteWorkspaceOptOut(
          workspaceId,
          email,
        )
      if (!lifted.ok) return lifted
    }

    const joinedIds: string[] = []
    if (join.length > 0) {
      const people = await CrmNewsletterSubscriberRepository.personIdsByEmails(
        workspaceId,
        [email],
      )
      if (!people.ok) return people
      for (const newsletter of join) {
        const row = rowOf.get(newsletter.id)
        if (row && row.status === 'ACTIVE') continue
        if (row && (row.status === 'BOUNCED' || row.status === 'COMPLAINED'))
          continue
        const data = {
          status: 'ACTIVE' as const,
          personId: row?.personId ?? people.value.get(email) ?? null,
          consentAt: context.now,
          consentIp: context.ip,
          consentUserAgent: context.userAgent?.slice(0, 500) ?? null,
          consentText: PREFERENCES_CONSENT_TEXT,
          confirmedAt: context.now,
          unsubscribedAt: null,
          unsubscribeReason: null,
        }
        const saved = row
          ? await CrmNewsletterSubscriberRepository.update(row.id, data)
          : await CrmNewsletterSubscriberRepository.create({
              ...data,
              newsletterId: newsletter.id,
              workspaceId,
              email,
              source: 'PUBLIC_PAGE',
              sourceRef: 'preferences',
            })
        if (!saved.ok) return saved
        joinedIds.push(saved.value.id)
      }
    }
    const joined = joinedIds.length

    if (dto.unsubscribeAll) {
      const optOut = await CrmEmailOptOutRepository.upsert({
        workspaceId,
        email,
        source: 'PREFERENCES',
      })
      if (!optOut.ok) return optOut
    }

    if (leave.length > 0 || joined > 0 || dto.unsubscribeAll) {
      auditMutation({
        entity: 'crm_newsletter_subscriber',
        action: dto.unsubscribeAll || joined === 0 ? 'opt_out' : 'update',
        actorId: null,
        meta: {
          workspaceId,
          source: 'PREFERENCES',
          left: leave.length,
          joined,
          unsubscribeAll: dto.unsubscribeAll,
        },
      })
    }
    await CrmNewsletterBridge.emitMany(
      'unsubscribed',
      leave.map((s) => s.id),
    )
    await CrmNewsletterBridge.emitMany('subscribed', joinedIds)

    return preferencesOf(workspaceId, email)
  },
}
