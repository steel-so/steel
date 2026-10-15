import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { BETTER_AUTH_URL } from '@/lib/env/server'
import {
  crmEmailCampaignAlreadySent,
  crmEmailCampaignNoRecipients,
} from '@/src/errors'
import {
  applyEmailConditionsToHtml,
  type EmailRecipientFacts,
  hasEmailConditions,
  needsListMembership,
} from '@/src/lib/canvas-email/conditions'
import {
  emailHtmlToText,
  personalizeEmail,
} from '@/src/lib/crm-email-builder/render'
import {
  contactToVariables,
  UNSUBSCRIBE_URL,
} from '@/src/lib/crm-email-builder/variables'
import {
  buildCrmUnsubscribeHeaders,
  buildCrmUnsubscribeUrls,
  createCrmUnsubscribeToken,
  withCrmUnsubscribeFooter,
} from '@/src/lib/crm-email-unsubscribe'
import { sendEmail } from '@/src/lib/mail/send'
import { err, ok, type Result } from '@/src/lib/result'
import {
  toCrmEmailCampaignDTO,
  toCrmEmailCampaignRecipientDTO,
} from '@/src/mappers/crm-email-marketing.mapper'
import {
  CrmEmailBuilderRepository,
  type PersonalizationContact,
} from '@/src/repositories/crm-email-builder.repository'
import {
  CrmEmailCampaignRecipientRepository,
  CrmEmailCampaignRepository,
} from '@/src/repositories/crm-email-campaign.repository'
import { CrmEmailConditionRepository } from '@/src/repositories/crm-email-condition.repository'
import {
  type CrmEmailOptOutIndex,
  CrmEmailOptOutRepository,
} from '@/src/repositories/crm-email-opt-out.repository'
import { CrmMailingListMemberRepository } from '@/src/repositories/crm-mailing-list.repository'
import { CrmPersonRepository } from '@/src/repositories/crm-person.repository'
import type {
  CreateCrmEmailCampaignDTO,
  UpdateCrmEmailCampaignDTO,
} from '@/src/schemas/crm-email-campaign.schema'
import type {
  CrmEmailCampaignDTO,
  CrmEmailCampaignRecipientDTO,
} from '@/types/crm-email-marketing'
import { assertModuleMember } from './authz'
import { renderTemplateForCampaign } from './crm-email-builder.service'
import { snapshotTemplateVersion } from './crm-email-template-history'
import { notifyCrmCampaignFinished } from './crm-notifications'

export const CrmEmailCampaignService = {
  async list(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<CrmEmailCampaignDTO[]>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'email',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const result = await CrmEmailCampaignRepository.listByWorkspace(workspaceId)
    if (!result.ok) return result

    return ok(result.value.map(toCrmEmailCampaignDTO))
  },

  async getById(
    actorId: string,
    workspaceId: string,
    campaignId: string,
  ): Promise<Result<CrmEmailCampaignDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'email',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const result = await CrmEmailCampaignRepository.findById(
      campaignId,
      workspaceId,
    )
    if (!result.ok) return result

    return ok(toCrmEmailCampaignDTO(result.value))
  },

  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateCrmEmailCampaignDTO,
  ): Promise<Result<CrmEmailCampaignDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'email',
      action: 'CREATE',
    })
    if (!membership.ok) return membership

    // Resolve antes de criar: uma campanha sem destinatário elegível não
    // deve nem existir (e jamais cair no fallback de "todos").
    const recipients = await resolveRecipients(
      workspaceId,
      dto.recipientScope,
      {
        mailingListIds: dto.mailingListIds,
        personIds: dto.personIds,
        extraEmails: dto.extraEmails,
      },
    )
    if (!recipients.ok) return recipients
    if (recipients.value.length === 0) {
      auditMutation({
        entity: 'crm_email_campaign',
        action: 'create',
        actorId,
        outcome: 'failure',
        reason: 'CRM_EMAIL_CAMPAIGN_NO_RECIPIENTS',
        meta: { recipientScope: dto.recipientScope },
      })
      return err(
        crmEmailCampaignNoRecipients(
          'Nenhum destinatário elegível: a seleção está vazia ou todos se descadastraram',
        ),
      )
    }

    // A visual-builder template is rendered once here (variables intact)
    // and cached on the campaign; each recipient is personalized at send.
    let content = {
      html: dto.contentHtml ?? '',
      text: undefined as string | undefined,
    }
    if (dto.templateId) {
      const rendered = await renderTemplateForCampaign(
        dto.templateId,
        workspaceId,
      )
      if (!rendered.ok) return rendered
      content = { html: rendered.value.html, text: rendered.value.text }
    }

    const result = await CrmEmailCampaignRepository.create({
      workspaceId,
      createdById: actorId,
      subject: dto.subject,
      contentHtml: content.html,
      contentText: content.text,
      templateId: dto.templateId,
      campaignLink: dto.campaignLink,
      contentJson: dto.contentJson,
      fromAddress: dto.fromAddress,
      recipientScope: dto.recipientScope,
      scheduledAt: dto.scheduledAt,
    })

    if (!result.ok) {
      auditMutation({
        entity: 'crm_email_campaign',
        action: 'create',
        actorId,
        outcome: 'failure',
        reason: result.error.code,
      })
      return result
    }

    const created = await CrmEmailCampaignRecipientRepository.createMany(
      result.value.id,
      recipients.value,
    )
    if (!created.ok) return created

    auditMutation({
      entity: 'crm_email_campaign',
      action: 'create',
      actorId,
      targetId: result.value.id,
      meta: { recipientCount: recipients.value.length },
    })
    // Version history (v2): the template as this campaign used it.
    if (dto.templateId) {
      await snapshotTemplateVersion(
        dto.templateId,
        workspaceId,
        actorId,
        'CAMPAIGN',
      )
    }

    return ok(toCrmEmailCampaignDTO(result.value))
  },

  async update(
    actorId: string,
    workspaceId: string,
    campaignId: string,
    dto: UpdateCrmEmailCampaignDTO,
  ): Promise<Result<CrmEmailCampaignDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'email',
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    const existing = await CrmEmailCampaignRepository.findById(
      campaignId,
      workspaceId,
    )
    if (!existing.ok) return existing
    if (
      existing.value.status !== 'DRAFT' &&
      existing.value.status !== 'SCHEDULED'
    ) {
      return err(crmEmailCampaignAlreadySent())
    }

    const result = await CrmEmailCampaignRepository.update(campaignId, {
      subject: dto.subject,
      contentHtml: dto.contentHtml,
      contentJson: dto.contentJson,
      fromAddress: dto.fromAddress,
      scheduledAt: dto.scheduledAt,
    })
    if (!result.ok) return result

    auditMutation({
      entity: 'crm_email_campaign',
      action: 'update',
      actorId,
      targetId: campaignId,
      meta: { fields: Object.keys(dto) },
    })

    return ok(toCrmEmailCampaignDTO(result.value))
  },

  async listRecipients(
    actorId: string,
    workspaceId: string,
    campaignId: string,
  ): Promise<Result<CrmEmailCampaignRecipientDTO[]>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'email',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const campaign = await CrmEmailCampaignRepository.findById(
      campaignId,
      workspaceId,
    )
    if (!campaign.ok) return campaign

    const result =
      await CrmEmailCampaignRecipientRepository.listByCampaign(campaignId)
    if (!result.ok) return result

    return ok(result.value.map(toCrmEmailCampaignRecipientDTO))
  },

  async send(
    actorId: string,
    workspaceId: string,
    campaignId: string,
  ): Promise<Result<CrmEmailCampaignDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'email',
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    const campaign = await CrmEmailCampaignRepository.findById(
      campaignId,
      workspaceId,
    )
    if (!campaign.ok) return campaign
    if (
      campaign.value.status !== 'DRAFT' &&
      campaign.value.status !== 'SCHEDULED'
    ) {
      return err(crmEmailCampaignAlreadySent())
    }

    const recipients =
      await CrmEmailCampaignRecipientRepository.listByCampaign(campaignId)
    if (!recipients.ok) return recipients
    // Envio usa só as linhas gravadas na criação — nunca recalcula "todos".
    if (recipients.value.length === 0) {
      return err(crmEmailCampaignNoRecipients())
    }

    // Revalida o opt-out no envio: alguém pode ter se descadastrado entre a
    // criação (ou o agendamento) e o disparo.
    const optOuts = await CrmEmailOptOutRepository.indexByWorkspace(workspaceId)
    if (!optOuts.ok) return optOuts

    await CrmEmailCampaignRepository.setStatus(campaignId, 'SENDING')

    const contacts = await loadPersonalizationContacts(
      workspaceId,
      campaign.value,
      recipients.value,
    )
    const memberships = await loadListMemberships(
      workspaceId,
      campaign.value,
      recipients.value,
    )

    let failures = 0
    let skipped = 0
    for (const recipient of recipients.value) {
      if (isOptedOut(optOuts.value, recipient)) {
        skipped += 1
        await CrmEmailCampaignRecipientRepository.markSkipped(recipient.id)
        continue
      }
      try {
        // Todo e-mail de campanha leva link de descadastro + cabeçalhos
        // RFC 8058 (one-click). Transacionais não passam por aqui.
        const urls = buildCrmUnsubscribeUrls(
          BETTER_AUTH_URL,
          createCrmUnsubscribeToken(recipient.id),
        )
        const email = buildRecipientEmail(
          campaign.value,
          recipient,
          contacts,
          urls.pageUrl,
          memberships,
        )
        const response = await sendEmail({
          from: campaign.value.fromAddress,
          to: recipient.email,
          subject: email.subject,
          html: email.html,
          text: email.text,
          headers: buildCrmUnsubscribeHeaders(urls),
        })
        await CrmEmailCampaignRecipientRepository.markSent(
          recipient.id,
          response.id,
        )
      } catch (error) {
        failures += 1
        await CrmEmailCampaignRecipientRepository.markFailed(
          recipient.id,
          error instanceof Error ? error.message : 'Falha ao enviar',
        )
      }
    }

    const attempted = recipients.value.length - skipped
    const finalStatus =
      attempted > 0 && failures === attempted ? 'FAILED' : 'SENT'
    const result = await CrmEmailCampaignRepository.setStatus(
      campaignId,
      finalStatus,
      new Date(),
    )
    if (!result.ok) return result

    // Awaited (never throws): the scheduler tick runs this in the worker.
    await notifyCrmCampaignFinished({
      workspaceId,
      campaign: campaign.value,
      status: finalStatus,
      sent: attempted - failures,
      failed: failures,
      // A SCHEDULED campaign is sent by the scheduler on the creator's
      // behalf: the creator still wants to hear about it.
      actorId: campaign.value.status === 'SCHEDULED' ? null : actorId,
    })

    auditMutation({
      entity: 'crm_email_campaign',
      action: 'update',
      actorId,
      targetId: campaignId,
      meta: { sent: attempted - failures, failed: failures, skipped },
    })

    return ok(toCrmEmailCampaignDTO(result.value))
  },
}

type CampaignContent = {
  subject: string
  contentHtml: string
  contentText: string | null
  campaignLink: string | null
}

function usesVariables(campaign: CampaignContent): boolean {
  return (
    hasEmailConditions(campaign.contentHtml) ||
    [campaign.subject, campaign.contentHtml, campaign.contentText ?? ''].some(
      (part) => part.includes('{{'),
    )
  )
}

/** Mailing lists of each recipient (by lower-cased e-mail), only when the
 * content has "Mostrar se: está na lista". A failed lookup degrades to no
 * lists (logged) — never blocks the send. */
async function loadListMemberships(
  workspaceId: string,
  campaign: CampaignContent,
  recipients: { email: string; personId: string | null }[],
): Promise<Map<string, string[]>> {
  if (!needsListMembership(campaign.contentHtml)) return new Map()
  const memberships = await CrmEmailConditionRepository.findListMemberships(
    workspaceId,
    recipients,
  )
  if (memberships.ok) return memberships.value
  logger.warn('crm_email_campaign.list_memberships_failed', {
    component: 'CrmEmailCampaignService',
    workspaceId,
    code: memberships.error.code,
  })
  return new Map()
}

/** "Mostrar se" for one recipient: drops what does not apply and, when the
 * campaign keeps a plain-text version, derives it again from the result. */
function conditionContent(
  campaign: CampaignContent,
  html: string,
  facts: EmailRecipientFacts,
): { html: string; text: string } {
  if (!hasEmailConditions(html)) {
    return { html, text: campaign.contentText ?? '' }
  }
  const conditioned = applyEmailConditionsToHtml(html, facts)
  return {
    html: conditioned,
    text: campaign.contentText ? emailHtmlToText(conditioned) : '',
  }
}

/** CRM people behind the recipients, only when the content has variables.
 * A failed lookup degrades to name/e-mail only — never blocks the send. */
async function loadPersonalizationContacts(
  workspaceId: string,
  campaign: CampaignContent,
  recipients: { personId: string | null }[],
): Promise<Map<string, PersonalizationContact>> {
  if (!usesVariables(campaign)) return new Map()
  const ids = [
    ...new Set(recipients.flatMap((r) => (r.personId ? [r.personId] : []))),
  ]
  const people = await CrmEmailBuilderRepository.findContacts(workspaceId, ids)
  if (!people.ok) return new Map()
  return new Map(people.value.map((person) => [person.id, person]))
}

/** Subject/html/text for one recipient: variables resolved and the
 * unsubscribe link inline (builder footer) or appended (legacy HTML). */
function buildRecipientEmail(
  campaign: CampaignContent,
  recipient: { email: string; name: string | null; personId: string | null },
  contacts: Map<string, PersonalizationContact>,
  unsubscribeUrl: string,
  memberships: Map<string, string[]> = new Map(),
): { subject: string; html: string; text?: string } {
  const html = campaign.contentHtml.includes(UNSUBSCRIBE_URL)
    ? campaign.contentHtml
    : withCrmUnsubscribeFooter(campaign.contentHtml, unsubscribeUrl)
  if (!usesVariables(campaign)) {
    return {
      subject: campaign.subject,
      html,
      text: campaign.contentText ?? undefined,
    }
  }
  const person = recipient.personId
    ? contacts.get(recipient.personId)
    : undefined
  const values = contactToVariables(
    {
      email: recipient.email,
      name: recipient.name ?? person?.name ?? undefined,
      company: person?.companyName ?? undefined,
      jobTitle: person?.jobTitle ?? undefined,
      phone: person?.phones[0],
      city: person?.city ?? undefined,
    },
    {
      campaignLink: campaign.campaignLink ?? undefined,
      unsubscribeUrl,
    },
  )
  const content = conditionContent(campaign, html, {
    values,
    listIds: memberships.get(recipient.email.trim().toLowerCase()) ?? [],
  })
  const email = personalizeEmail(
    { subject: campaign.subject, html: content.html, text: content.text },
    values,
  )
  return { ...email, text: campaign.contentText ? email.text : undefined }
}

type Recipient = { email: string; name?: string; personId?: string }

/** Opt-out LGPD: vale tanto o endereço quanto a pessoa vinculada (quem saiu
 * por um e-mail não volta a receber por outro endereço cadastrado). */
function isOptedOut(
  index: CrmEmailOptOutIndex,
  recipient: { email: string; personId?: string | null },
) {
  return (
    index.emails.has(recipient.email.trim().toLowerCase()) ||
    (recipient.personId ? index.personIds.has(recipient.personId) : false)
  )
}

/** Une candidatos por e-mail (case-insensitive), mantendo o primeiro
 * personId/nome encontrado para cada endereço. */
function dedupeByEmail(candidates: Recipient[]): Recipient[] {
  const byEmail = new Map<string, Recipient>()
  for (const candidate of candidates) {
    const key = candidate.email.trim().toLowerCase()
    if (!key || byEmail.has(key)) continue
    byEmail.set(key, candidate)
  }
  return Array.from(byEmail.values())
}

async function resolveRecipients(
  workspaceId: string,
  scope: 'ALL' | 'SELECTED',
  input: {
    mailingListIds?: string[]
    personIds?: string[]
    extraEmails?: string[]
  },
): Promise<Result<Recipient[]>> {
  const candidates = await collectCandidates(workspaceId, scope, input)
  if (!candidates.ok) return candidates

  const optOuts = await CrmEmailOptOutRepository.indexByWorkspace(workspaceId)
  if (!optOuts.ok) return optOuts

  return ok(
    candidates.value.filter(
      (recipient) => !isOptedOut(optOuts.value, recipient),
    ),
  )
}

async function collectCandidates(
  workspaceId: string,
  scope: 'ALL' | 'SELECTED',
  input: {
    mailingListIds?: string[]
    personIds?: string[]
    extraEmails?: string[]
  },
): Promise<Result<Recipient[]>> {
  const hasSelection =
    (input.mailingListIds?.length ?? 0) > 0 ||
    (input.personIds?.length ?? 0) > 0 ||
    (input.extraEmails?.length ?? 0) > 0

  // Seleção vazia em "Selecionados" é erro — antes caía no ramo de "todos"
  // e a campanha ia para o workspace inteiro.
  if (scope === 'SELECTED' && !hasSelection) {
    return err(crmEmailCampaignNoRecipients())
  }

  if (scope === 'ALL') {
    const people = await CrmPersonRepository.listByWorkspace(workspaceId)
    if (!people.ok) return people
    return ok(
      people.value
        .filter((person) => person.emails.length > 0)
        .map((person) => ({
          email: person.emails[0],
          name: person.name,
          personId: person.id,
        })),
    )
  }

  // Ordem importa pro dedupe: personIds primeiro (vínculo mais preciso),
  // depois listas, depois avulsos — o primeiro candidato por e-mail vence.
  const candidates: Recipient[] = []

  const people = await Promise.all(
    (input.personIds ?? []).map((id) =>
      CrmPersonRepository.findById(id, workspaceId),
    ),
  )
  for (const result of people) {
    if (result.ok && result.value.emails.length > 0) {
      candidates.push({
        email: result.value.emails[0],
        name: result.value.name,
        personId: result.value.id,
      })
    }
  }

  for (const mailingListId of input.mailingListIds ?? []) {
    const members =
      await CrmMailingListMemberRepository.listByList(mailingListId)
    if (!members.ok) return members
    for (const member of members.value) {
      candidates.push({
        email: member.email,
        name: member.name ?? undefined,
        personId: member.personId ?? undefined,
      })
    }
  }

  for (const email of input.extraEmails ?? []) {
    candidates.push({ email })
  }

  return ok(dedupeByEmail(candidates))
}
