import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import {
  whatsappBroadcastLocked,
  whatsappBroadcastMediaInvalid,
  whatsappBroadcastNoRecipients,
  whatsappBroadcastNotFound,
  whatsappConnectionNotFound,
} from '@/src/errors'
import { WhatsappBroadcastJob } from '@/src/lib/queue/jobs'
import { getWhatsappBroadcastQueue } from '@/src/lib/queue/queues'
import { err, ok, type Result } from '@/src/lib/result'
import {
  type BroadcastMediaKind,
  resolveBroadcastMediaKind,
} from '@/src/lib/whatsapp/broadcast-media'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { applyTemplateSendExtras } from '@/src/lib/whatsapp/template-send'
import {
  buildMetaSendComponents,
  extractTemplateFillableFields,
  parseMetaTemplateComponents,
} from '@/src/lib/whatsapp/template-variables'
import type {
  WhatsAppCostContext,
  WhatsAppOutboundMediaType,
  WhatsAppSendResult,
} from '@/src/lib/whatsapp/types'
import {
  toWhatsAppBroadcastListDetailDTO,
  toWhatsAppBroadcastListDTO,
} from '@/src/mappers/whatsapp-broadcast.mapper'
import { WhatsAppBroadcastRepository } from '@/src/repositories/whatsapp-broadcast.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WhatsAppTemplateRepository } from '@/src/repositories/whatsapp-template.repository'
import type { CreateWhatsAppBroadcastDTO } from '@/src/schemas/whatsapp-broadcast.schema'
import type {
  WhatsAppBroadcastListDetailDTO,
  WhatsAppBroadcastListDTO,
} from '@/types/whatsapp-broadcast'
import { assertModuleMember } from './authz'
import { assertFeature } from './feature-flag.service'
import { notifyWhatsAppUsers } from './whatsapp-notify'

const STAGGER_DELAY_MS = 4000

interface TemplateVariableValues {
  header?: Record<number, string>
  body?: Record<number, string>
  buttons?: Record<number, string>
}

/**
 * Resultado do envio a um destinatário (job em background). `skipped` =
 * nada enviado de propósito (destinatário sumiu, já processado ou
 * descadastrado — LGPD); `failed` = o destinatário ficou FAILED.
 */
export type WhatsAppBroadcastSendOutcome =
  | {
      status: 'skipped'
      reason: 'recipient_missing' | 'not_pending' | 'opted_out'
    }
  | { status: 'failed'; reason: string }
  | { status: 'sent'; providerMessageId: string }

const OUTBOUND_MEDIA_TYPE: Record<
  BroadcastMediaKind,
  WhatsAppOutboundMediaType
> = {
  IMAGE: 'image',
  VIDEO: 'video',
  AUDIO: 'audio',
  DOCUMENT: 'document',
}

/**
 * Envia a mídia da lista com o tipo certo (imagem/vídeo/áudio/documento).
 * Listas antigas sem tipo salvo deduzem pela extensão; sem pista, seguem
 * como imagem (comportamento anterior). Áudio não tem legenda em nenhum
 * provedor: a mensagem vai logo depois, como texto.
 */
async function sendBroadcastMedia(
  connection: Parameters<typeof WhatsAppSend.media>[0],
  to: string,
  list: {
    mediaUrl: string
    mediaType: BroadcastMediaKind | null
    mediaMimeType: string | null
    mediaFileName: string | null
    messageBody: string
  },
  cost?: WhatsAppCostContext,
): Promise<Result<WhatsAppSendResult>> {
  const kind =
    list.mediaType ??
    resolveBroadcastMediaKind({
      mimeType: list.mediaMimeType,
      fileName: list.mediaFileName,
      url: list.mediaUrl,
    }) ??
    'IMAGE'
  const type = OUTBOUND_MEDIA_TYPE[kind]

  const sent = await WhatsAppSend.media(
    connection,
    {
      to,
      mediaUrl: list.mediaUrl,
      type,
      ...(type === 'audio' ? {} : { caption: list.messageBody }),
      ...(type === 'document' && list.mediaFileName
        ? { fileName: list.mediaFileName }
        : {}),
    },
    { cost },
  )
  if (!sent.ok || type !== 'audio' || !list.messageBody.trim()) return sent

  const text = await WhatsAppSend.text(
    connection,
    { to, text: list.messageBody },
    { cost },
  )
  if (!text.ok) {
    // O áudio já foi entregue: não marca o destinatário como falha.
    logger.warn('whatsapp.broadcast.audio_caption_failed', {
      component: 'WhatsAppBroadcastService',
      reason: text.error.code,
    })
  }
  return sent
}

/**
 * Fecha a lista quando não sobra destinatário PENDING: FAILED se nada foi
 * enviado e houve falha, DONE nos demais casos. A troca de status é
 * condicional (só a partir de QUEUED/RUNNING), então só um dos jobs que
 * terminam juntos fecha a lista — e só ele avisa quem a criou.
 */
async function completeIfDrained(broadcastListId: string): Promise<void> {
  const pending =
    await WhatsAppBroadcastRepository.countPendingRecipients(broadcastListId)
  if (!pending.ok || pending.value > 0) return

  const counts =
    await WhatsAppBroadcastRepository.countRecipientsByStatus(broadcastListId)
  if (!counts.ok) return
  const sent = counts.value.SENT
  const failed = counts.value.FAILED
  const status = sent === 0 && failed > 0 ? 'FAILED' : 'DONE'

  const closed = await WhatsAppBroadcastRepository.closeIfRunning(
    broadcastListId,
    status,
  )
  if (!closed.ok || !closed.value) return
  auditMutation({
    entity: 'whatsapp_broadcast_list',
    action: 'update',
    actorId: null,
    targetId: broadcastListId,
    meta: { status, actor: 'system', via: 'whatsapp_broadcast_job' },
  })

  const list = closed.value
  await notifyWhatsAppUsers({
    workspaceId: list.workspaceId,
    kind: 'WHATSAPP_BROADCAST_FINISHED',
    userIds: [list.createdById],
    title:
      status === 'FAILED'
        ? `Transmissão "${list.name}" falhou`
        : `Transmissão "${list.name}" concluída`,
    body: `${sent} enviada(s), ${failed} com falha.`,
    path: '/zap/transmissoes',
    meta: { broadcastListId, status },
  })
}

export const WhatsAppBroadcastService = {
  async list(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppBroadcastListDTO[]>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'broadcasts', action: 'VIEW' },
    )
    if (!membership.ok) return membership

    const result =
      await WhatsAppBroadcastRepository.listByWorkspace(workspaceId)
    if (!result.ok) return result

    return ok(result.value.map(toWhatsAppBroadcastListDTO))
  },

  async get(
    actorId: string,
    workspaceId: string,
    id: string,
  ): Promise<Result<WhatsAppBroadcastListDetailDTO>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'broadcasts', action: 'VIEW' },
    )
    if (!membership.ok) return membership

    const result = await WhatsAppBroadcastRepository.findById(id, workspaceId)
    if (!result.ok) return result
    if (!result.value) return err(whatsappBroadcastNotFound())

    return ok(toWhatsAppBroadcastListDetailDTO(result.value))
  },

  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateWhatsAppBroadcastDTO,
  ): Promise<Result<WhatsAppBroadcastListDetailDTO>> {
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

    const requestedIds = Array.from(new Set(dto.contactIds))
    // Opt-out LGPD: descadastrados (e contatos de outro workspace) saem na
    // própria query — a UI só reflete, não é a barreira.
    const eligible = await WhatsAppContactRepository.listBroadcastEligibleIds(
      workspaceId,
      requestedIds,
    )
    if (!eligible.ok) return eligible
    const uniqueContactIds = eligible.value
    if (uniqueContactIds.length === 0) {
      return err(whatsappBroadcastNoRecipients())
    }

    const mediaType = dto.mediaUrl
      ? resolveBroadcastMediaKind({
          mimeType: dto.mediaMimeType,
          fileName: dto.mediaFileName,
          url: dto.mediaUrl,
        })
      : null
    if (dto.mediaUrl && !mediaType) {
      return err(
        whatsappBroadcastMediaInvalid(
          'Não foi possível identificar o tipo da mídia. Envie imagem, vídeo, áudio ou documento.',
        ),
      )
    }

    const result = await WhatsAppBroadcastRepository.create(
      {
        workspaceId,
        connectionId: dto.connectionId,
        name: dto.name,
        messageBody: dto.messageBody,
        mediaUrl: dto.mediaUrl,
        mediaType,
        mediaMimeType: dto.mediaUrl ? (dto.mediaMimeType ?? null) : null,
        mediaFileName: dto.mediaUrl ? (dto.mediaFileName ?? null) : null,
        createdById: actorId,
      },
      uniqueContactIds,
    )
    if (!result.ok) return result

    auditMutation({
      entity: 'whatsapp_broadcast_list',
      action: 'create',
      actorId,
      targetId: result.value.id,
      meta: {
        recipients: uniqueContactIds.length,
        excluded: requestedIds.length - uniqueContactIds.length,
        mediaType,
      },
    })

    return ok(toWhatsAppBroadcastListDetailDTO(result.value))
  },

  async start(
    actorId: string,
    workspaceId: string,
    id: string,
  ): Promise<Result<WhatsAppBroadcastListDetailDTO>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'broadcasts', action: 'CREATE' },
    )
    if (!membership.ok) return membership
    const feature = await assertFeature(workspaceId, 'communication.broadcasts')
    if (!feature.ok) return feature

    const existing = await WhatsAppBroadcastRepository.findById(id, workspaceId)
    if (!existing.ok) return existing
    if (!existing.value) return err(whatsappBroadcastNotFound())
    if (existing.value.status !== 'DRAFT') return err(whatsappBroadcastLocked())

    // Quem se descadastrou entre a criação da lista e o disparo não recebe.
    const optedOut = existing.value.recipients.filter(
      (recipient) => recipient.contact.broadcastOptedOutAt !== null,
    )
    const sendable = existing.value.recipients.filter(
      (recipient) => recipient.contact.broadcastOptedOutAt === null,
    )
    if (optedOut.length > 0) {
      const skipped = await WhatsAppBroadcastRepository.markRecipientsSkipped(
        optedOut.map((recipient) => recipient.id),
      )
      if (!skipped.ok) return skipped
    }

    const queue = getWhatsappBroadcastQueue()
    await queue.addBulk(
      sendable.map((recipient, index) => ({
        name: WhatsappBroadcastJob.SendBroadcastMessage,
        data: { broadcastListId: id, recipientId: recipient.id },
        opts: { delay: index * STAGGER_DELAY_MS },
      })),
    )

    const updated = await WhatsAppBroadcastRepository.updateStatus(
      id,
      sendable.length > 0 ? 'RUNNING' : 'DONE',
    )
    if (!updated.ok) return updated

    auditMutation({
      entity: 'whatsapp_broadcast_list',
      action: 'start',
      actorId,
      targetId: id,
      meta: { recipients: sendable.length, skipped: optedOut.length },
    })

    const fresh = await WhatsAppBroadcastRepository.findById(id, workspaceId)
    if (!fresh.ok) return fresh
    if (!fresh.value) return err(whatsappBroadcastNotFound())

    return ok(toWhatsAppBroadcastListDetailDTO(fresh.value))
  },
  /**
   * Envia a mensagem da lista a um destinatário. Fluxo de sistema (job em
   * background, sem usuário): revalida o opt-out LGPD no momento do envio
   * (quem respondeu SAIR depois de enfileirado vira SKIPPED) e fecha a lista
   * quando não resta ninguém pendente.
   */
  async sendToRecipient(
    broadcastListId: string,
    recipientId: string,
  ): Promise<Result<WhatsAppBroadcastSendOutcome>> {
    const found =
      await WhatsAppBroadcastRepository.findRecipientById(recipientId)
    if (!found.ok) return found
    const recipient = found.value
    if (!recipient) {
      return ok({ status: 'skipped', reason: 'recipient_missing' })
    }
    if (recipient.status !== 'PENDING') {
      return ok({ status: 'skipped', reason: 'not_pending' })
    }

    // Opt-out LGPD: o contato pode ter respondido SAIR depois que o job foi
    // enfileirado (inclusive nos agendados por planilha) — nunca envia.
    if (recipient.contact.broadcastOptedOutAt) {
      const skipped = await WhatsAppBroadcastRepository.markRecipientsSkipped([
        recipientId,
      ])
      if (!skipped.ok) return skipped
      await completeIfDrained(broadcastListId)
      return ok({ status: 'skipped', reason: 'opted_out' })
    }

    const list = recipient.broadcastList
    const connection = await WhatsAppConnectionRepository.findById(
      list.connectionId,
      list.workspaceId,
    )
    if (!connection.ok) return connection
    if (!connection.value) {
      const failed = await WhatsAppBroadcastRepository.updateRecipientStatus(
        recipientId,
        { status: 'FAILED', errorMessage: 'Conexão não encontrada' },
      )
      if (!failed.ok) return failed
      return ok({ status: 'failed', reason: 'connection_missing' })
    }

    let sendResult: Result<WhatsAppSendResult>
    if (list.templateId) {
      const template = await WhatsAppTemplateRepository.findById(
        list.templateId,
        list.workspaceId,
      )
      if (!template.ok) return template
      if (!template.value) {
        const failed = await WhatsAppBroadcastRepository.updateRecipientStatus(
          recipientId,
          { status: 'FAILED', errorMessage: 'Template não encontrado' },
        )
        if (!failed.ok) return failed
        return ok({ status: 'failed', reason: 'template_missing' })
      }

      const fields = extractTemplateFillableFields(
        parseMetaTemplateComponents(template.value.components as unknown[]),
      )
      const values = (recipient.variableValues ?? {}) as TemplateVariableValues
      const components = buildMetaSendComponents(fields, {
        header: values.header ?? {},
        body: values.body ?? {},
        buttons: values.buttons ?? {},
      })

      sendResult = await WhatsAppSend.template(
        connection.value,
        {
          to: recipient.contact.waId,
          templateName: template.value.name,
          language: template.value.language,
          components: applyTemplateSendExtras(template.value, components)
            .components,
        },
        {
          cost: {
            source: 'BROADCAST',
            broadcastId: list.id,
            templateCategory: template.value.category,
          },
        },
      )
    } else {
      const cost: WhatsAppCostContext = {
        source: 'BROADCAST',
        broadcastId: list.id,
      }
      sendResult = list.mediaUrl
        ? await sendBroadcastMedia(
            connection.value,
            recipient.contact.waId,
            {
              mediaUrl: list.mediaUrl,
              mediaType: list.mediaType,
              mediaMimeType: list.mediaMimeType,
              mediaFileName: list.mediaFileName,
              messageBody: list.messageBody,
            },
            cost,
          )
        : await WhatsAppSend.text(
            connection.value,
            { to: recipient.contact.waId, text: list.messageBody },
            { cost },
          )
    }

    const recorded = sendResult.ok
      ? await WhatsAppBroadcastRepository.updateRecipientStatus(recipientId, {
          status: 'SENT',
          providerMessageId: sendResult.value.providerMessageId,
          sentAt: new Date(),
        })
      : await WhatsAppBroadcastRepository.updateRecipientStatus(recipientId, {
          status: 'FAILED',
          errorMessage: sendResult.error.message,
        })
    // Já enviado: não devolve erro (o job tentaria de novo e duplicaria o
    // envio) — só registra para investigação.
    if (!recorded.ok) {
      logger.error('whatsapp.broadcast.recipient_status_update_failed', {
        component: 'WhatsAppBroadcastService',
        recipientId,
        reason: recorded.error.code,
      })
    }

    await completeIfDrained(broadcastListId)

    return ok(
      sendResult.ok
        ? {
            status: 'sent',
            providerMessageId: sendResult.value.providerMessageId,
          }
        : { status: 'failed', reason: sendResult.error.code },
    )
  },

  /**
   * Tick das transmissões agendadas (importadas por planilha): enfileira os
   * destinatários vencidos. Fluxo de sistema.
   */
  async enqueueDueScheduledRecipients(
    now: Date,
  ): Promise<Result<{ due: number }>> {
    const due =
      await WhatsAppBroadcastRepository.listDueScheduledRecipients(now)
    if (!due.ok) return due

    await getWhatsappBroadcastQueue().addBulk(
      due.value.map((recipient) => ({
        name: WhatsappBroadcastJob.SendBroadcastMessage,
        data: {
          broadcastListId: recipient.broadcastListId,
          recipientId: recipient.id,
        },
        // jobId determinístico: evita reenfileirar o mesmo destinatário se o
        // tick rodar de novo antes do job anterior sair de PENDING (BullMQ
        // recusa duplicar um jobId ainda ativo/esperando na fila).
        opts: { jobId: `broadcast-recipient-${recipient.id}` },
      })),
    )

    return ok({ due: due.value.length })
  },
}
