import type { SdNotificationChannel, WhatsAppConnection } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { NEXT_PUBLIC_URL } from '@/lib/env/env'
import {
  type SdNotificationEventSpec,
  sdNotificationEvent,
} from '@/src/config/servicedesk-notifications'
import {
  sdNotAgent,
  sdNotificationEventUnknown,
  validationError,
} from '@/src/errors'
import { sendSdTicketNotificationEmail } from '@/src/lib/mail/servicedesk/send-sd-ticket-notification'
import { err, ok, type Result } from '@/src/lib/result'
import {
  type SdNotifyTicket,
  sdTicketNotificationHref,
} from '@/src/lib/servicedesk/notify'
import { normalizeSdWhatsappNumber } from '@/src/lib/servicedesk/whatsapp'
import {
  sdNotificationWebhookData,
  sdNotificationWebhookType,
} from '@/src/lib/webhooks/payloads'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import {
  sdChannelEnabled,
  toSdNotificationPreferencesDTO,
} from '@/src/mappers/sd-notification.mapper'
import { SdNotificationRepository } from '@/src/repositories/sd-notification.repository'
import { SdTicketContextRepository } from '@/src/repositories/sd-ticket-context.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import type { UpdateSdNotificationPreferencesDTO } from '@/src/schemas/sd-notification.schema'
import type { SdNotificationPreferencesDTO } from '@/types/sd-notification'
import { NotificationService } from './notification.service'
import { SdAccess } from './sd-access'
import { SdIntegrationDispatcher } from './sd-integration-dispatcher'
import { emitWebhookEvent } from './webhook-emitter'

/**
 * Motor de notificações do ServiceDesk. Um único ponto de entrada
 * (`notifySdEvent`) resolve o público do evento pelo catálogo
 * (`src/config/servicedesk-notifications.ts`), respeita as preferências do
 * usuário (`SdNotificationPreference`) e a visibilidade (evento `agentOnly`
 * nunca chega a solicitante/contato) e entrega por IN_APP, EMAIL e
 * WHATSAPP.
 *
 * Nunca lança: cada canal é isolado — falha vira log e o resto segue.
 */

export interface SdNotifyPayload {
  /** Frase principal (título in-app e assunto do e-mail). */
  title: string
  /** Corpo em texto puro. */
  body: string
  /** Destinatários específicos do disparo (citados, aprovador, …). */
  userIds?: (string | null | undefined)[]
  /** Nunca notifica estes (além do próprio autor). */
  excludeUserIds?: (string | null | undefined)[]
  /** Contexto extra para o log. */
  meta?: Record<string, unknown>
}

export interface SdNotifyInput {
  workspaceId: string
  /** Chave do catálogo (`ticket.assigned`, `sla.breached`…). */
  event: string
  ticket: SdNotifyTicket
  /** Quem causou o evento — nunca é notificado. */
  actorId?: string | null
  /**
   * `catalog` (padrão) resolve o público do evento; `payload` usa só
   * `payload.userIds` — é o caso da ação "notificar" das automações, em que
   * o admin já escolheu quem avisar.
   */
  audience?: 'catalog' | 'payload'
  payload: SdNotifyPayload
}

export interface SdNotifyOutcome {
  event: string
  /** Usuários da plataforma que passaram por público + visibilidade. */
  recipients: number
  inApp: number
  email: number
  whatsapp: number
  /** Motivo de não ter avisado ninguém. */
  skipped: 'no_recipients' | null
}

const EMPTY_PREFS = new Map<string, boolean>()

const EMPTY: Omit<SdNotifyOutcome, 'event'> = {
  recipients: 0,
  inApp: 0,
  email: 0,
  whatsapp: 0,
  skipped: 'no_recipients',
}

function clean(ids: (string | null | undefined)[]): string[] {
  return ids.filter((id): id is string => typeof id === 'string' && id !== '')
}

/** Ids do público do evento (sem deduplicar — o chamador cuida disso). */
async function resolveAudience(
  spec: SdNotificationEventSpec,
  input: SdNotifyInput,
): Promise<string[]> {
  const { ticket } = input
  const ids: string[] = []
  for (const audience of spec.audience) {
    switch (audience) {
      case 'assignee':
        ids.push(...clean([ticket.assigneeId]))
        break
      case 'participants':
        ids.push(...clean(ticket.participantIds))
        break
      case 'requester':
        ids.push(...clean([ticket.requesterId]))
        break
      case 'contact':
        ids.push(...clean([ticket.contact?.userId]))
        break
      case 'followers': {
        const followers = await SdNotificationRepository.listFollowerIds(
          ticket.id,
        )
        if (followers.ok) ids.push(...followers.value)
        else {
          logger.warn('servicedesk.notify.followers_failed', {
            workspaceId: input.workspaceId,
            ticketId: ticket.id,
            reason: followers.error.code,
          })
        }
        break
      }
      case 'departmentLeads': {
        if (!ticket.departmentId) break
        const leads = await SdTicketContextRepository.listDepartmentLeadIds(
          ticket.departmentId,
        )
        if (leads.ok) ids.push(...leads.value)
        else {
          logger.warn('servicedesk.notify.leads_failed', {
            workspaceId: input.workspaceId,
            ticketId: ticket.id,
            reason: leads.error.code,
          })
        }
        break
      }
      case 'mentioned':
        // Quem foi citado vem no disparo (`payload.userIds`).
        break
    }
  }
  return ids
}

/** Conexão de WhatsApp do ServiceDesk ativa, se houver. */
async function activeWhatsappConnection(
  workspaceId: string,
): Promise<WhatsAppConnection | null> {
  const settings = await SdTicketContextRepository.ensureSettings(workspaceId)
  if (!settings.ok || !settings.value.whatsappConnectionId) return null
  const connection = await WhatsAppConnectionRepository.findById(
    settings.value.whatsappConnectionId,
    workspaceId,
    'SERVICE_DESK',
  )
  if (!connection.ok || !connection.value) return null
  return connection.value.status === 'CONNECTED' ? connection.value : null
}

interface Delivery {
  inApp: string[]
  email: { userId: string | null; name: string; email: string }[]
  whatsapp: { label: string; number: string }[]
}

async function deliverInApp(
  input: SdNotifyInput,
  spec: SdNotificationEventSpec,
  userIds: string[],
  href: string,
): Promise<number> {
  if (userIds.length === 0) return 0
  const created = await NotificationService.notifyUsers({
    workspaceId: input.workspaceId,
    userIds,
    kind: spec.kind,
    title: input.payload.title,
    body: input.payload.body,
    href,
  })
  if (created.ok) return created.value
  logger.error('servicedesk.notify.in_app_failed', {
    workspaceId: input.workspaceId,
    event: input.event,
    reason: created.error.code,
  })
  return 0
}

async function deliverEmail(
  input: SdNotifyInput,
  targets: Delivery['email'],
  workspaceName: string,
  href: string,
): Promise<number> {
  if (targets.length === 0) return 0
  const results = await Promise.allSettled(
    targets.map((target) =>
      sendSdTicketNotificationEmail({
        email: target.email,
        username: target.name,
        workspaceName,
        ticketCode: input.ticket.code,
        ticketTitle: input.ticket.title,
        headline: input.payload.title,
        message: input.payload.body,
        redirectUrl: `${NEXT_PUBLIC_URL}${href}`,
      }),
    ),
  )
  const sent = results.filter((r) => r.status === 'fulfilled').length
  if (sent < results.length) {
    logger.warn('servicedesk.notify.email_failed', {
      workspaceId: input.workspaceId,
      event: input.event,
      failed: results.length - sent,
    })
  }
  return sent
}

async function deliverWhatsapp(
  input: SdNotifyInput,
  targets: Delivery['whatsapp'],
): Promise<number> {
  if (targets.length === 0) return 0
  const connection = await activeWhatsappConnection(input.workspaceId)
  if (!connection) {
    // Workspace sem conexão do ServiceDesk: silencia, sem erro.
    logger.info('servicedesk.notify.whatsapp_unavailable', {
      workspaceId: input.workspaceId,
      event: input.event,
      targets: targets.length,
    })
    return 0
  }
  const text = `*${input.ticket.code}* — ${input.payload.title}\n${input.payload.body}`
  let sent = 0
  for (const target of targets) {
    const result = await WhatsAppSend.text(connection, {
      to: target.number,
      text,
    })
    if (result.ok) sent += 1
    else {
      logger.warn('servicedesk.notify.whatsapp_failed', {
        workspaceId: input.workspaceId,
        event: input.event,
        reason: result.error.code,
      })
    }
  }
  return sent
}

/**
 * Avisa quem o catálogo manda avisar sobre `event` no chamado.
 *
 * 1. público do evento + `payload.userIds`;
 * 2. tira o autor (`actorId`), os excluídos e os duplicados;
 * 3. evento `agentOnly` só chega a quem atende (nunca ao solicitante ou ao
 *    contato externo);
 * 4. cada canal respeita `SdNotificationPreference` (sem linha = padrão do
 *    catálogo);
 * 5. entrega IN_APP, EMAIL e WHATSAPP — este só com conexão do ServiceDesk
 *    ativa.
 */
export async function notifySdEvent(
  input: SdNotifyInput,
): Promise<Result<SdNotifyOutcome>> {
  const spec = sdNotificationEvent(input.event)
  if (!spec) {
    return err(
      sdNotificationEventUnknown(
        `Evento de notificação desconhecido: ${input.event}`,
      ),
    )
  }

  // Saída para o Slack (canal por time, fatia integrações): independe de ter
  // destinatário aqui — o canal recebe o evento mesmo quando ninguém da
  // plataforma precisa ser avisado. Só enfileira; quem fala com o Slack é o
  // worker.
  void SdIntegrationDispatcher.dispatch({
    workspaceId: input.workspaceId,
    event: input.event,
    ticket: {
      id: input.ticket.id,
      number: input.ticket.number,
      code: input.ticket.code,
      title: input.ticket.title,
      departmentId: input.ticket.departmentId,
    },
    payload: { title: input.payload.title, body: input.payload.body },
  })

  // Webhooks de saída (ADR 0036): os mesmos eventos de chamado, para os
  // endpoints do workspace. Só enfileira; quem faz o HTTP é o worker.
  const webhookType = sdNotificationWebhookType(input.event)
  if (webhookType) {
    void emitWebhookEvent(
      input.workspaceId,
      webhookType,
      sdNotificationWebhookData({
        ticket: input.ticket,
        actorId: input.actorId,
        title: input.payload.title,
        body: input.payload.body,
      }),
    )
  }

  const excluded = new Set(
    clean([...(input.payload.excludeUserIds ?? []), input.actorId]),
  )
  const fromCatalog =
    input.audience === 'payload' ? [] : await resolveAudience(spec, input)
  const candidates = Array.from(
    new Set([...fromCatalog, ...clean(input.payload.userIds ?? [])]),
  ).filter((id) => !excluded.has(id))

  // Contato externo (sem usuário): só eventos abertos ao cliente.
  const contact = input.ticket.contact
  const externalContact =
    input.audience !== 'payload' &&
    !spec.agentOnly &&
    spec.audience.includes('contact') &&
    contact !== null &&
    contact.userId === null
      ? contact
      : null

  let userIds = candidates
  if (spec.agentOnly && userIds.length > 0) {
    const agents = await SdNotificationRepository.filterAgentIds(
      input.workspaceId,
      userIds,
    )
    if (!agents.ok) return agents
    userIds = agents.value
  }

  if (userIds.length === 0 && !externalContact) {
    return ok({ event: input.event, ...EMPTY })
  }

  const [workspace, recipients, prefs] = await Promise.all([
    SdTicketContextRepository.findWorkspace(input.workspaceId),
    SdNotificationRepository.findRecipients(input.workspaceId, userIds),
    SdNotificationRepository.listPreferencesForEvent(
      input.workspaceId,
      userIds,
      spec.key,
    ),
  ])
  if (!workspace.ok) return workspace
  if (!workspace.value) {
    logger.warn('servicedesk.notify.workspace_missing', {
      workspaceId: input.workspaceId,
      event: input.event,
    })
    return ok({ event: input.event, ...EMPTY })
  }
  if (!recipients.ok) return recipients
  if (!prefs.ok) return prefs

  const perUser = new Map<string, Map<string, boolean>>()
  for (const row of prefs.value) {
    const current = perUser.get(row.userId) ?? new Map<string, boolean>()
    current.set(`${row.event}|${row.channel}`, row.enabled)
    perUser.set(row.userId, current)
  }

  const wants = (userId: string, channel: SdNotificationChannel): boolean =>
    sdChannelEnabled(spec, channel, perUser.get(userId) ?? EMPTY_PREFS)

  const delivery: Delivery = { inApp: [], email: [], whatsapp: [] }
  for (const user of recipients.value) {
    if (wants(user.id, 'IN_APP')) delivery.inApp.push(user.id)
    if (wants(user.id, 'EMAIL')) {
      delivery.email.push({
        userId: user.id,
        name: user.name,
        email: user.email,
      })
    }
  }

  if (spec.channels.includes('WHATSAPP')) {
    const wantsWhatsapp = recipients.value
      .filter((user) => wants(user.id, 'WHATSAPP'))
      .map((user) => user.id)
    if (wantsWhatsapp.length > 0) {
      const numbers = await SdNotificationRepository.findWhatsappNumbers(
        input.workspaceId,
        wantsWhatsapp,
      )
      if (numbers.ok) {
        for (const user of recipients.value) {
          const raw = numbers.value.get(user.id)
          const number = normalizeSdWhatsappNumber(raw)
          if (number) delivery.whatsapp.push({ label: user.name, number })
        }
      } else {
        logger.warn('servicedesk.notify.whatsapp_numbers_failed', {
          workspaceId: input.workspaceId,
          event: input.event,
          reason: numbers.error.code,
        })
      }
    }
  }

  if (externalContact) {
    // Contato externo não tem preferência salva: vale o padrão do catálogo.
    const channels = await SdNotificationRepository.findContactChannels(
      input.workspaceId,
      externalContact.id,
    )
    if (channels.ok && channels.value) {
      if (spec.defaultChannels.includes('EMAIL') && channels.value.email) {
        delivery.email.push({
          userId: null,
          name: externalContact.name,
          email: channels.value.email,
        })
      }
      if (spec.defaultChannels.includes('WHATSAPP')) {
        const number = normalizeSdWhatsappNumber(channels.value.whatsapp)
        if (number) {
          delivery.whatsapp.push({ label: externalContact.name, number })
        }
      }
    } else if (!channels.ok) {
      logger.warn('servicedesk.notify.contact_channels_failed', {
        workspaceId: input.workspaceId,
        event: input.event,
        reason: channels.error.code,
      })
    }
  }

  const href = sdTicketNotificationHref(
    workspace.value.slug,
    input.ticket.number,
  )
  const [inApp, email, whatsapp] = await Promise.all([
    deliverInApp(input, spec, delivery.inApp, href),
    deliverEmail(input, delivery.email, workspace.value.name, href),
    deliverWhatsapp(input, delivery.whatsapp),
  ])

  logger.info('servicedesk.notify.delivered', {
    workspaceId: input.workspaceId,
    ticketId: input.ticket.id,
    event: input.event,
    recipients: recipients.value.length,
    inApp,
    email,
    whatsapp,
    ...input.payload.meta,
  })

  return ok({
    event: input.event,
    recipients: recipients.value.length,
    inApp,
    email,
    whatsapp,
    skipped: null,
  })
}

/* ------------------------- eventos sem chamado ---------------------------- */

export interface SdNotifyUsersInput {
  workspaceId: string
  /** Chave do catálogo (`oncall.shift`, `kb.comment`…). */
  event: string
  /** Destinatários escolhidos por quem dispara. */
  userIds: (string | null | undefined)[]
  /** Quem causou o evento — nunca é notificado. */
  actorId?: string | null
  title: string
  body: string
  /** Caminho interno, montado com o slug do workspace. */
  hrefFor: (slug: string) => string
  /** Contexto extra para o log. */
  meta?: Record<string, unknown>
}

export interface SdNotifyUsersOutcome {
  recipients: number
  inApp: number
}

/**
 * Evento do ServiceDesk que **não** é de um chamado (plantão, contrato,
 * comentário na base): mesmo catálogo e mesma preferência por usuário de
 * `notifySdEvent`, mas só pelo canal IN_APP — o e-mail do módulo é o do
 * chamado, e estes eventos não têm um. Evento `agentOnly` só chega a quem
 * atende. Nunca lança.
 */
export async function notifySdUsers(
  input: SdNotifyUsersInput,
): Promise<Result<SdNotifyUsersOutcome>> {
  const spec = sdNotificationEvent(input.event)
  if (!spec) {
    return err(
      sdNotificationEventUnknown(
        `Evento de notificação desconhecido: ${input.event}`,
      ),
    )
  }

  const excluded = input.actorId ?? ''
  let userIds = Array.from(new Set(clean(input.userIds))).filter(
    (id) => id !== excluded,
  )
  if (spec.agentOnly && userIds.length > 0) {
    const agents = await SdNotificationRepository.filterAgentIds(
      input.workspaceId,
      userIds,
    )
    if (!agents.ok) return agents
    userIds = agents.value
  }
  if (userIds.length === 0) return ok({ recipients: 0, inApp: 0 })

  const [workspace, prefs] = await Promise.all([
    SdTicketContextRepository.findWorkspace(input.workspaceId),
    SdNotificationRepository.listPreferencesForEvent(
      input.workspaceId,
      userIds,
      spec.key,
    ),
  ])
  if (!workspace.ok) return workspace
  if (!prefs.ok) return prefs
  if (!workspace.value) return ok({ recipients: 0, inApp: 0 })

  const perUser = new Map<string, Map<string, boolean>>()
  for (const row of prefs.value) {
    const current = perUser.get(row.userId) ?? new Map<string, boolean>()
    current.set(`${row.event}|${row.channel}`, row.enabled)
    perUser.set(row.userId, current)
  }
  const wanted = userIds.filter((userId) =>
    sdChannelEnabled(spec, 'IN_APP', perUser.get(userId) ?? EMPTY_PREFS),
  )

  let inApp = 0
  if (wanted.length > 0) {
    const created = await NotificationService.notifyUsers({
      workspaceId: input.workspaceId,
      userIds: wanted,
      kind: spec.kind,
      title: input.title,
      body: input.body,
      href: input.hrefFor(workspace.value.slug),
    })
    if (created.ok) inApp = created.value
    else {
      logger.error('servicedesk.notify.in_app_failed', {
        workspaceId: input.workspaceId,
        event: input.event,
        reason: created.error.code,
      })
    }
  }

  logger.info('servicedesk.notify.users_delivered', {
    workspaceId: input.workspaceId,
    event: input.event,
    recipients: userIds.length,
    inApp,
    ...input.meta,
  })
  return ok({ recipients: userIds.length, inApp })
}

/* --------------------------- preferências (API) --------------------------- */

/**
 * Preferências de notificação **por usuário** dentro do workspace: a matriz
 * evento × canal da aba "Notificações" das configurações do ServiceDesk.
 * Cada um mexe só nas próprias — não existe visão de administrador aqui.
 */
export const SdNotificationService = {
  async get(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<SdNotificationPreferencesDTO>> {
    const ctx = await SdAccess.resolve(actorId, workspaceId)
    if (!ctx.ok) return ctx

    const rows = await SdNotificationRepository.listPreferences(
      workspaceId,
      actorId,
    )
    if (!rows.ok) return rows
    const connection = await activeWhatsappConnection(workspaceId)

    return ok(
      toSdNotificationPreferencesDTO({
        rows: rows.value,
        isAgent: ctx.value.isAgent,
        whatsappAvailable: connection !== null,
      }),
    )
  },

  /**
   * Salva as células enviadas. Recusa um canal que o evento não oferece e
   * um evento `agentOnly` para quem é solicitante.
   */
  async update(
    actorId: string,
    workspaceId: string,
    dto: UpdateSdNotificationPreferencesDTO,
  ): Promise<Result<SdNotificationPreferencesDTO>> {
    const ctx = await SdAccess.resolve(actorId, workspaceId)
    if (!ctx.ok) return ctx

    for (const item of dto.items) {
      const spec = sdNotificationEvent(item.event)
      if (!spec) {
        return err(
          sdNotificationEventUnknown(
            `Evento de notificação desconhecido: ${item.event}`,
          ),
        )
      }
      if (!spec.channels.includes(item.channel)) {
        return err(
          validationError(
            `O evento "${spec.label}" não oferece o canal ${item.channel}`,
          ),
        )
      }
      if (spec.agentOnly && !ctx.value.isAgent) return err(sdNotAgent())
    }

    const saved = await SdNotificationRepository.upsertPreferences(
      workspaceId,
      actorId,
      dto.items,
    )
    if (!saved.ok) return saved

    auditMutation({
      entity: 'sd_notification_preference',
      action: 'update',
      actorId,
      targetId: actorId,
      meta: { workspaceId, items: saved.value },
    })
    return SdNotificationService.get(actorId, workspaceId)
  },

  /** Volta tudo aos padrões do catálogo (apaga as linhas do usuário). */
  async restoreDefaults(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<SdNotificationPreferencesDTO>> {
    const ctx = await SdAccess.resolve(actorId, workspaceId)
    if (!ctx.ok) return ctx

    const removed = await SdNotificationRepository.deletePreferences(
      workspaceId,
      actorId,
    )
    if (!removed.ok) return removed

    auditMutation({
      entity: 'sd_notification_preference',
      action: 'delete',
      actorId,
      targetId: actorId,
      meta: { workspaceId, removed: removed.value },
    })
    return SdNotificationService.get(actorId, workspaceId)
  },
}
