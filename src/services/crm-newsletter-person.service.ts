import { auditMutation } from '@/lib/axiom/audit'
import {
  crmNewsletterSubscriberNotFound,
  notFound,
  validationError,
} from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import { toCrmPersonNewsletterSubscriptionDTO } from '@/src/mappers/crm-newsletter-bridge.mapper'
import { CrmNewsletterBridgeRepository } from '@/src/repositories/crm-newsletter-bridge.repository'
import type {
  CrmPersonNewslettersDTO,
  SubscribeCrmPersonNewsletterDTO,
} from '@/src/schemas/crm-newsletter-bridge.schema'
import { assertModuleMember } from './authz'
import { CrmNewsletterBridge } from './crm-newsletter-bridge.service'
import { CrmNewsletterSubscriberService } from './crm-newsletter-subscriber.service'

/** Recorded on the subscriber when a member takes the person out. */
export const MEMBER_UNSUBSCRIBE_REASON =
  'Descadastrado por um membro do workspace.'

type Person = { id: string; name: string; emails: string[] }

const normalize = (emails: string[]) => [
  ...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean)),
]

async function loadPerson(
  actorId: string,
  workspaceId: string,
  personId: string,
  action: 'VIEW' | 'CREATE' | 'EDIT',
): Promise<Result<Person>> {
  const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
    resource: 'email',
    action,
  })
  if (!membership.ok) return membership
  const person = await CrmNewsletterBridgeRepository.findPerson(
    workspaceId,
    personId,
  )
  if (!person.ok) return person
  if (!person.value) return err(notFound('CrmPerson'))
  return ok({ ...person.value, emails: normalize(person.value.emails) })
}

async function overview(
  workspaceId: string,
  person: Person,
): Promise<Result<CrmPersonNewslettersDTO>> {
  const [rows, newsletters] = await Promise.all([
    CrmNewsletterBridgeRepository.listPersonSubscriptions(
      workspaceId,
      person.id,
      person.emails,
    ),
    CrmNewsletterBridgeRepository.listActiveNewsletters(workspaceId),
  ])
  if (!rows.ok) return rows
  if (!newsletters.ok) return newsletters
  const welcome = await CrmNewsletterBridgeRepository.welcomeStatsBySubscriber(
    rows.value.map((row) => row.id),
  )
  if (!welcome.ok) return welcome

  const subscriptions = rows.value.map((row) =>
    toCrmPersonNewsletterSubscriptionDTO(row, welcome.value.get(row.id)),
  )
  // Joined (or blocked: bounced/complained) newsletters are not offered.
  const taken = new Set(
    subscriptions
      .filter((s) => s.status !== 'UNSUBSCRIBED')
      .map((s) => s.newsletterId),
  )
  return ok({
    personId: person.id,
    emails: person.emails,
    subscriptions,
    available: newsletters.value.filter((n) => !taken.has(n.id)),
  })
}

/**
 * "Newsletters" card of the CRM person page (ADR 0054 phase 2): the
 * person's subscriptions and the member's quick subscribe/unsubscribe.
 * Same permissions as the newsletter subscribers (resource `email`).
 */
export const CrmNewsletterPersonService = {
  async get(
    actorId: string,
    workspaceId: string,
    personId: string,
  ): Promise<Result<CrmPersonNewslettersDTO>> {
    const person = await loadPerson(actorId, workspaceId, personId, 'VIEW')
    if (!person.ok) return person
    return overview(workspaceId, person.value)
  },

  /** Delegates to the manual add (consent, opt-out, audit, bridge). */
  async subscribe(
    actorId: string,
    workspaceId: string,
    personId: string,
    dto: SubscribeCrmPersonNewsletterDTO,
    now: Date = new Date(),
  ): Promise<Result<CrmPersonNewslettersDTO>> {
    const person = await loadPerson(actorId, workspaceId, personId, 'CREATE')
    if (!person.ok) return person

    const email = dto.email?.trim().toLowerCase() ?? person.value.emails[0]
    if (!email) {
      return err(validationError('Esta pessoa não tem e-mail cadastrado.'))
    }
    if (!person.value.emails.includes(email)) {
      return err(validationError('Use um dos e-mails desta pessoa.'))
    }

    const added = await CrmNewsletterSubscriberService.add(
      actorId,
      workspaceId,
      dto.newsletterId,
      {
        email,
        name: person.value.name,
        sendConfirmation: dto.sendConfirmation,
        consentNote: 'Inscrito pela página da pessoa no CRM.',
      },
      now,
    )
    if (!added.ok) return added
    return overview(workspaceId, person.value)
  },

  async unsubscribe(
    actorId: string,
    workspaceId: string,
    personId: string,
    subscriberId: string,
    now: Date = new Date(),
  ): Promise<Result<CrmPersonNewslettersDTO>> {
    const person = await loadPerson(actorId, workspaceId, personId, 'EDIT')
    if (!person.ok) return person

    const found = await CrmNewsletterBridgeRepository.findSubscription(
      workspaceId,
      subscriberId,
    )
    if (!found.ok) return found
    const row = found.value
    if (
      !row ||
      (row.personId !== personId && !person.value.emails.includes(row.email))
    ) {
      return err(crmNewsletterSubscriberNotFound())
    }

    const changed = await CrmNewsletterBridgeRepository.unsubscribe(
      row.id,
      MEMBER_UNSUBSCRIBE_REASON,
      now,
    )
    if (!changed.ok) return changed
    if (!changed.value) {
      return err(validationError('Esta inscrição já não está ativa.'))
    }

    auditMutation({
      entity: 'crm_newsletter_subscriber',
      action: 'opt_out',
      actorId,
      targetId: row.id,
      meta: {
        workspaceId,
        newsletterId: row.newsletterId,
        personId,
        source: 'CRM_PERSON',
      },
    })
    await CrmNewsletterBridge.emit({
      type: 'unsubscribed',
      subscriberId: row.id,
    })
    return overview(workspaceId, person.value)
  },
}
