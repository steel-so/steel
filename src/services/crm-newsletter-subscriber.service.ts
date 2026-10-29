import { createId } from '@paralleldrive/cuid2'
import type {
  CrmNewsletter,
  CrmNewsletterSubscriber,
  CrmNewsletterSubscriberStatus,
} from '@prisma/client'
import { z } from 'zod'
import { auditMutation } from '@/lib/axiom/audit'
import {
  crmNewsletterArchived,
  crmNewsletterImportInvalid,
  crmNewsletterSubscriberExists,
  rateLimited,
  validationError,
} from '@/src/errors'
import { csvDocument } from '@/src/lib/csv-writer'
import { err, ok, type Result } from '@/src/lib/result'
import { toCrmNewsletterSubscriberDTO } from '@/src/mappers/crm-newsletter.mapper'
import { CrmEmailOptOutRepository } from '@/src/repositories/crm-email-opt-out.repository'
import { CrmNewsletterRepository } from '@/src/repositories/crm-newsletter.repository'
import {
  type CrmNewsletterSubscriberCreate,
  CrmNewsletterSubscriberRepository,
} from '@/src/repositories/crm-newsletter-subscriber.repository'
import { WorkspaceRepository } from '@/src/repositories/workspace.repository'
import type {
  AddCrmNewsletterSubscriberDTO,
  CrmNewsletterImportResultDTO,
  CrmNewsletterSubscriberDTO,
  CrmNewsletterSubscriberPageDTO,
  ImportCrmNewsletterSubscribersDTO,
  ListCrmNewsletterSubscribersQuery,
} from '@/src/schemas/crm-newsletter.schema'
import { assertModuleMember } from './authz'
import {
  confirmResendWaitSeconds,
  sendNewsletterConfirmation,
} from './crm-newsletter-confirmation'

type Action = 'VIEW' | 'CREATE' | 'EDIT' | 'DELETE'

/** With the confirmation e-mail, an import sends one e-mail per row from
 * the request: kept small on purpose. */
export const CRM_NEWSLETTER_IMPORT_CONFIRM_MAX_ROWS = 1_000

export const MANUAL_CONSENT_TEXT =
  'Adicionado por um membro do workspace, que declarou ter o consentimento da pessoa.'
export const IMPORT_CONSENT_TEXT =
  'Importado por CSV por um membro do workspace, que declarou ter o consentimento das pessoas.'

const EmailSchema = z.email().max(254)

const STATUS_LABEL: Record<CrmNewsletterSubscriberStatus, string> = {
  PENDING: 'Aguardando confirmação',
  ACTIVE: 'Ativo',
  UNSUBSCRIBED: 'Descadastrado',
  BOUNCED: 'E-mail inválido (retorno)',
  COMPLAINED: 'Marcou como spam',
}

const SOURCE_LABEL: Record<CrmNewsletterSubscriber['source'], string> = {
  FORM: 'Formulário',
  SITE: 'Site',
  PUBLIC_PAGE: 'Página pública',
  API: 'API',
  IMPORT: 'Importação',
  MANUAL: 'Manual',
}

const spDateTime = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  dateStyle: 'short',
  timeStyle: 'short',
})
const sp = (value: Date | null) =>
  value ? spDateTime.format(value).replace(',', '') : ''

/** Membership + permission, then the newsletter of the workspace. */
async function load(
  actorId: string,
  workspaceId: string,
  newsletterId: string,
  action: Action,
): Promise<Result<CrmNewsletter>> {
  const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
    resource: 'email',
    action,
  })
  if (!membership.ok) return membership
  return CrmNewsletterRepository.findById(newsletterId, workspaceId)
}

async function loadActive(
  actorId: string,
  workspaceId: string,
  newsletterId: string,
  action: Action,
): Promise<Result<CrmNewsletter>> {
  const newsletter = await load(actorId, workspaceId, newsletterId, action)
  if (!newsletter.ok) return newsletter
  if (newsletter.value.status !== 'ACTIVE') return err(crmNewsletterArchived())
  return newsletter
}

async function publisherName(workspaceId: string): Promise<Result<string>> {
  const workspace = await WorkspaceRepository.findById(workspaceId)
  if (!workspace.ok) return workspace
  return ok(workspace.value.name)
}

/** Confirmation e-mails of an import, sent after the response. */
function sendConfirmationsInBackground(
  subscribers: Pick<CrmNewsletterSubscriber, 'id' | 'email' | 'name'>[],
  newsletter: CrmNewsletter,
  publisher: string,
  now: Date,
): Promise<void> {
  return (async () => {
    for (const subscriber of subscribers) {
      await sendNewsletterConfirmation({
        subscriber,
        newsletter,
        publisherName: publisher,
        now,
      })
    }
  })()
}

/**
 * Subscribers of a CRM newsletter (ADR 0054): list, manual add, CSV import
 * and export, removal and the confirmation resend. A member vouches for the
 * consent of whoever they add; someone who unsubscribed only comes back by
 * confirming again (double opt-in), never straight to ACTIVE.
 */
export const CrmNewsletterSubscriberService = {
  async list(
    actorId: string,
    workspaceId: string,
    newsletterId: string,
    query: ListCrmNewsletterSubscribersQuery,
  ): Promise<Result<CrmNewsletterSubscriberPageDTO>> {
    const newsletter = await load(actorId, workspaceId, newsletterId, 'VIEW')
    if (!newsletter.ok) return newsletter

    const page = await CrmNewsletterSubscriberRepository.list(
      newsletterId,
      query,
    )
    if (!page.ok) return page
    return ok({
      items: page.value.items.map(toCrmNewsletterSubscriberDTO),
      total: page.value.total,
      page: query.page,
      pageSize: query.pageSize,
    })
  },

  async add(
    actorId: string,
    workspaceId: string,
    newsletterId: string,
    dto: AddCrmNewsletterSubscriberDTO,
    now: Date = new Date(),
  ): Promise<Result<CrmNewsletterSubscriberDTO>> {
    const newsletter = await loadActive(
      actorId,
      workspaceId,
      newsletterId,
      'CREATE',
    )
    if (!newsletter.ok) return newsletter

    const email = dto.email.trim().toLowerCase()
    const optedOut = await CrmNewsletterSubscriberRepository.isOptedOut(
      workspaceId,
      email,
    )
    if (!optedOut.ok) return optedOut
    if (optedOut.value) {
      return err(
        validationError(
          'Este e-mail pediu para não receber e-mails deste workspace.',
        ),
      )
    }

    const existing = await CrmNewsletterSubscriberRepository.findByEmail(
      newsletterId,
      email,
    )
    if (!existing.ok) return existing
    const current = existing.value
    if (
      current &&
      (current.status === 'ACTIVE' || current.status === 'PENDING')
    )
      return err(crmNewsletterSubscriberExists())
    if (current && current.status !== 'UNSUBSCRIBED') {
      return err(
        validationError(
          'Este e-mail não recebe mais a newsletter (retorno permanente ou denúncia de spam).',
        ),
      )
    }

    const people = await CrmNewsletterSubscriberRepository.personIdsByEmails(
      workspaceId,
      [email],
    )
    if (!people.ok) return people

    // Unsubscribed before: only their own confirmation brings them back.
    const confirm = dto.sendConfirmation || current !== null
    const consent = {
      name: dto.name ?? current?.name ?? null,
      personId: people.value.get(email) ?? null,
      status: (confirm ? 'PENDING' : 'ACTIVE') as CrmNewsletterSubscriberStatus,
      source: 'MANUAL' as const,
      sourceRef: actorId,
      consentAt: now,
      consentIp: null,
      consentUserAgent: null,
      consentText: dto.consentNote
        ? `${MANUAL_CONSENT_TEXT} Observação: ${dto.consentNote}`
        : MANUAL_CONSENT_TEXT,
      confirmedAt: confirm ? null : now,
      unsubscribedAt: null,
      unsubscribeReason: null,
    }
    const saved = current
      ? await CrmNewsletterSubscriberRepository.update(current.id, consent)
      : await CrmNewsletterSubscriberRepository.create({
          ...consent,
          newsletterId,
          workspaceId,
          email,
        })
    if (!saved.ok) return saved

    auditMutation({
      entity: 'crm_newsletter_subscriber',
      action: 'create',
      actorId,
      targetId: saved.value.id,
      meta: {
        workspaceId,
        newsletterId,
        status: saved.value.status,
        reactivated: current !== null,
      },
    })

    if (confirm) {
      const publisher = await publisherName(workspaceId)
      if (!publisher.ok) return publisher
      const sent = await sendNewsletterConfirmation({
        subscriber: saved.value,
        newsletter: newsletter.value,
        publisherName: publisher.value,
        now,
      })
      if (!sent.ok) return sent
    }
    return ok(toCrmNewsletterSubscriberDTO(saved.value))
  },

  async import(
    actorId: string,
    workspaceId: string,
    newsletterId: string,
    dto: ImportCrmNewsletterSubscribersDTO,
    now: Date = new Date(),
  ): Promise<
    Result<CrmNewsletterImportResultDTO & { background?: Promise<void> }>
  > {
    const newsletter = await loadActive(
      actorId,
      workspaceId,
      newsletterId,
      'CREATE',
    )
    if (!newsletter.ok) return newsletter

    const rejected: CrmNewsletterImportResultDTO['rejected'] = []
    const seen = new Set<string>()
    const valid: { row: number; email: string; name: string | null }[] = []
    dto.rows.forEach((raw, index) => {
      const row = index + 1
      const email = raw.email.trim().toLowerCase()
      if (!EmailSchema.safeParse(email).success) {
        rejected.push({ row, email: raw.email, reason: 'E-mail inválido' })
      } else if (seen.has(email)) {
        rejected.push({ row, email, reason: 'Repetido no arquivo' })
      } else {
        seen.add(email)
        valid.push({ row, email, name: raw.name?.trim() || null })
      }
    })

    if (
      dto.sendConfirmation &&
      valid.length > CRM_NEWSLETTER_IMPORT_CONFIRM_MAX_ROWS
    ) {
      return err(
        crmNewsletterImportInvalid(
          `Com o e-mail de confirmação, importe até ${CRM_NEWSLETTER_IMPORT_CONFIRM_MAX_ROWS.toLocaleString('pt-BR')} contatos por vez.`,
        ),
      )
    }

    const emails = valid.map((v) => v.email)
    const [optOuts, existing, people] = await Promise.all([
      CrmEmailOptOutRepository.indexByWorkspace(workspaceId),
      CrmNewsletterSubscriberRepository.findByEmails(newsletterId, emails),
      CrmNewsletterSubscriberRepository.personIdsByEmails(workspaceId, emails),
    ])
    if (!optOuts.ok) return optOuts
    if (!existing.ok) return existing
    if (!people.ok) return people
    const byEmail = new Map(existing.value.map((s) => [s.email, s]))

    const importId = createId()
    const toCreate: CrmNewsletterSubscriberCreate[] = []
    const toReactivate: CrmNewsletterSubscriber[] = []
    let unchanged = 0
    for (const item of valid) {
      const current = byEmail.get(item.email)
      if (optOuts.value.emails.has(item.email)) {
        rejected.push({
          row: item.row,
          email: item.email,
          reason: 'Pediu para não receber e-mails deste workspace',
        })
      } else if (!current) {
        toCreate.push({
          newsletterId,
          workspaceId,
          email: item.email,
          name: item.name,
          personId: people.value.get(item.email) ?? null,
          status: dto.sendConfirmation ? 'PENDING' : 'ACTIVE',
          source: 'IMPORT',
          sourceRef: importId,
          consentAt: now,
          consentText: IMPORT_CONSENT_TEXT,
          confirmedAt: dto.sendConfirmation ? null : now,
        })
      } else if (current.status === 'ACTIVE' || current.status === 'PENDING') {
        unchanged++
      } else if (current.status === 'UNSUBSCRIBED') {
        toReactivate.push(current)
      } else {
        rejected.push({
          row: item.row,
          email: item.email,
          reason:
            current.status === 'BOUNCED'
              ? 'E-mail com retorno permanente'
              : 'Marcou a newsletter como spam',
        })
      }
    }

    const created = await CrmNewsletterSubscriberRepository.createMany(toCreate)
    if (!created.ok) return created

    if (toReactivate.length > 0) {
      const reactivated = await CrmNewsletterSubscriberRepository.updateMany(
        toReactivate.map((s) => s.id),
        {
          status: 'PENDING',
          source: 'IMPORT',
          sourceRef: importId,
          consentAt: now,
          consentText: IMPORT_CONSENT_TEXT,
          confirmedAt: null,
          unsubscribedAt: null,
          unsubscribeReason: null,
        },
      )
      if (!reactivated.ok) return reactivated
    }

    rejected.sort((a, b) => a.row - b.row)
    const result: CrmNewsletterImportResultDTO = {
      created: created.value,
      reactivated: toReactivate.length,
      unchanged: unchanged + (toCreate.length - created.value),
      rejected,
    }

    auditMutation({
      entity: 'crm_newsletter_subscriber',
      action: 'import',
      actorId,
      targetId: newsletterId,
      meta: {
        workspaceId,
        importId,
        rows: dto.rows.length,
        created: result.created,
        reactivated: result.reactivated,
        unchanged: result.unchanged,
        rejected: rejected.length,
        sendConfirmation: dto.sendConfirmation,
      },
    })

    // Confirmation e-mails: the reactivated always (their own consent
    // again), the new ones when asked.
    const pending = [
      ...toReactivate,
      ...(dto.sendConfirmation ? toCreate : []),
    ].map((s) => s.email)
    if (pending.length === 0) return ok(result)

    const publisher = await publisherName(workspaceId)
    if (!publisher.ok) return ok(result)
    const rows = await CrmNewsletterSubscriberRepository.findByEmails(
      newsletterId,
      pending,
    )
    if (!rows.ok) return ok(result)
    const background = sendConfirmationsInBackground(
      rows.value.filter((s) => s.status === 'PENDING'),
      newsletter.value,
      publisher.value,
      now,
    )
    return ok({ ...result, background })
  },

  async exportCsv(
    actorId: string,
    workspaceId: string,
    newsletterId: string,
  ): Promise<Result<{ filename: string; csv: string }>> {
    const newsletter = await load(actorId, workspaceId, newsletterId, 'VIEW')
    if (!newsletter.ok) return newsletter

    const rows = await CrmNewsletterSubscriberRepository.listAll(newsletterId)
    if (!rows.ok) return rows

    const csv = csvDocument(
      [
        'E-mail',
        'Nome',
        'Status',
        'Origem',
        'Consentimento em (São Paulo)',
        'Texto do consentimento',
        'Confirmado em (São Paulo)',
        'Descadastrado em (São Paulo)',
        'Motivo do descadastro',
        'Último envio (São Paulo)',
        'Cadastrado em (São Paulo)',
      ],
      rows.value.map((s) => [
        s.email,
        s.name,
        STATUS_LABEL[s.status],
        SOURCE_LABEL[s.source],
        sp(s.consentAt),
        s.consentText,
        sp(s.confirmedAt),
        sp(s.unsubscribedAt),
        s.unsubscribeReason,
        sp(s.lastSentAt),
        sp(s.createdAt),
      ]),
    )

    auditMutation({
      entity: 'crm_newsletter_subscriber',
      action: 'export_completed',
      actorId,
      targetId: newsletterId,
      meta: { workspaceId, rows: rows.value.length },
    })
    return ok({ filename: `assinantes-${newsletter.value.slug}.csv`, csv })
  },

  async remove(
    actorId: string,
    workspaceId: string,
    newsletterId: string,
    subscriberId: string,
  ): Promise<Result<void>> {
    const newsletter = await load(actorId, workspaceId, newsletterId, 'DELETE')
    if (!newsletter.ok) return newsletter

    const subscriber = await CrmNewsletterSubscriberRepository.findById(
      subscriberId,
      newsletterId,
    )
    if (!subscriber.ok) return subscriber

    const deleted = await CrmNewsletterSubscriberRepository.delete(subscriberId)
    if (!deleted.ok) return deleted

    auditMutation({
      entity: 'crm_newsletter_subscriber',
      action: 'delete',
      actorId,
      targetId: subscriberId,
      meta: { workspaceId, newsletterId, status: subscriber.value.status },
    })
    return ok(undefined)
  },

  async resendConfirmation(
    actorId: string,
    workspaceId: string,
    newsletterId: string,
    subscriberId: string,
    now: Date = new Date(),
  ): Promise<Result<{ sent: boolean }>> {
    const newsletter = await loadActive(
      actorId,
      workspaceId,
      newsletterId,
      'EDIT',
    )
    if (!newsletter.ok) return newsletter

    const subscriber = await CrmNewsletterSubscriberRepository.findById(
      subscriberId,
      newsletterId,
    )
    if (!subscriber.ok) return subscriber
    if (subscriber.value.status !== 'PENDING') {
      return err(
        validationError('Só quem ainda não confirmou recebe a confirmação.'),
      )
    }
    const wait = confirmResendWaitSeconds(subscriber.value, now)
    if (wait > 0) {
      return err(
        rateLimited(
          wait,
          `Já enviamos a confirmação há pouco. Tente de novo em ${Math.ceil(wait / 60)} min.`,
        ),
      )
    }

    const publisher = await publisherName(workspaceId)
    if (!publisher.ok) return publisher
    const sent = await sendNewsletterConfirmation({
      subscriber: subscriber.value,
      newsletter: newsletter.value,
      publisherName: publisher.value,
      now,
    })
    if (!sent.ok) return sent

    auditMutation({
      entity: 'crm_newsletter_subscriber',
      action: 'send',
      actorId,
      targetId: subscriberId,
      meta: {
        workspaceId,
        newsletterId,
        kind: 'confirmation',
        sent: sent.value,
      },
    })
    return ok({ sent: sent.value })
  },
}
