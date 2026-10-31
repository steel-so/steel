import type { WhatsAppConnection } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { NEXT_PUBLIC_META_APP_ID } from '@/lib/env/env'
import {
  WHATSAPP_META_APP_ID,
  WHATSAPP_META_APP_SECRET,
} from '@/lib/env/server'
import { featureNotEnabled, whatsappConnectionNotFound } from '@/src/errors'
import { encryptConnectionSecret } from '@/src/lib/crypto'
import { err, ok, type Result } from '@/src/lib/result'
import {
  type CoexistenceHistoryChunk,
  parseContactSync,
  parseHistoryWebhook,
  parseMessageEchoes,
  requestCoexistenceSync,
} from '@/src/lib/whatsapp/meta-coexistence'
import {
  exchangeSignupCode,
  fetchPhoneInfo,
  subscribeAppToWaba,
} from '@/src/lib/whatsapp/meta-signup'
import { toWhatsAppConnectionDTO } from '@/src/mappers/whatsapp-connection.mapper'
import { toCoexistenceSyncDTO } from '@/src/mappers/whatsapp-meta-channel.mapper'
import { WhatsAppCoexistenceRepository } from '@/src/repositories/whatsapp-coexistence.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppMetaChannelRepository } from '@/src/repositories/whatsapp-meta-channel.repository'
import type { MetaEmbeddedSignupDTO } from '@/src/schemas/whatsapp-connection.schema'
import type { WhatsAppConnectionDTO } from '@/types/whatsapp-connection'
import type { WhatsAppCoexistenceSyncDTO } from '@/types/whatsapp-meta-channel'
import { assertModuleMember, assertModulePrivileged } from './authz'
import { WhatsAppWebhookService } from './whatsapp-webhook.service'

const COMMUNICATION = 'COMMUNICATION' as const

export type CoexistenceWebhookField =
  | 'history'
  | 'smb_app_state_sync'
  | 'smb_message_echoes'

export const COEXISTENCE_WEBHOOK_FIELDS: string[] = [
  'history',
  'smb_app_state_sync',
  'smb_message_echoes',
]

export type CoexistenceWebhookValue = {
  metadata?: { phone_number_id?: string }
} & Parameters<typeof parseHistoryWebhook>[0] &
  Parameters<typeof parseContactSync>[0] &
  Parameters<typeof parseMessageEchoes>[0]

interface ImportTotals {
  messages: number
  conversations: number
}

/**
 * Writes the messages of one history chunk straight to the database: no AI,
 * no SLA, no unread badge, no realtime event, no monthly usage — it is the
 * customer's past, not new traffic. Threads of contacts we never talked to
 * get a closed conversation so the history is searchable.
 */
async function importChunk(
  connection: WhatsAppConnection,
  chunk: CoexistenceHistoryChunk,
): Promise<Result<ImportTotals>> {
  const totals: ImportTotals = { messages: 0, conversations: 0 }
  const byContact = new Map<string, CoexistenceHistoryChunk['messages']>()
  for (const message of chunk.messages) {
    const list = byContact.get(message.waId) ?? []
    list.push(message)
    byContact.set(message.waId, list)
  }

  for (const [waId, messages] of byContact) {
    const contact = await WhatsAppContactRepository.upsertByWaId({
      workspaceId: connection.workspaceId,
      waId,
    })
    if (!contact.ok) return contact

    const newest = new Date(Math.max(...messages.map((m) => m.at.getTime())))
    const open = await WhatsAppConversationRepository.findActiveByContact(
      connection.workspaceId,
      contact.value.id,
    )
    if (!open.ok) return open
    const closed = open.value
      ? open
      : await WhatsAppConversationRepository.findLatestClosedByContact(
          connection.workspaceId,
          contact.value.id,
        )
    if (!closed.ok) return closed

    let conversationId: string
    if (closed.value) {
      conversationId = closed.value.id
      if (!closed.value.lastMessageAt || closed.value.lastMessageAt < newest) {
        const touched = await WhatsAppConversationRepository.update(
          conversationId,
          { lastMessageAt: newest },
        )
        if (!touched.ok) return touched
      }
    } else {
      const created = await WhatsAppConversationRepository.create({
        workspaceId: connection.workspaceId,
        connectionId: connection.id,
        contactId: contact.value.id,
        status: 'CLOSED',
        closedAt: newest,
        unreadCount: 0,
        lastMessageAt: newest,
      })
      if (!created.ok) return created
      conversationId = created.value.id
    }
    totals.conversations++

    const inserted = await WhatsAppCoexistenceRepository.createHistoryMessages(
      messages.map((message) => ({
        workspaceId: connection.workspaceId,
        conversationId,
        direction: message.direction,
        type: message.type,
        text: message.text,
        providerMessageId: message.providerMessageId,
        status: message.direction === 'IN' ? 'DELIVERED' : message.status,
        createdAt: message.at,
      })),
    )
    if (!inserted.ok) return inserted
    totals.messages += inserted.value
  }
  return ok(totals)
}

export const WhatsAppCoexistenceService = {
  /**
   * Coexistence onboarding: the number stays in the WhatsApp Business app and
   * also runs on the Cloud API. Same Embedded Signup result as a regular
   * connection, but the number is NOT registered (it already is, by the app).
   * Right after, asks Meta for the contacts and the history; both arrive as
   * webhooks and are imported by `applyWebhook`.
   */
  async connect(
    actorId: string,
    workspaceId: string,
    dto: MetaEmbeddedSignupDTO,
  ): Promise<
    Result<{
      connection: WhatsAppConnectionDTO
      sync: WhatsAppCoexistenceSyncDTO
    }>
  > {
    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      COMMUNICATION,
    )
    if (!privileged.ok) return privileged

    const settings =
      await WhatsAppMetaChannelRepository.findSettings(workspaceId)
    if (!settings.ok) return settings
    if (!settings.value?.coexistenceEnabled) {
      return err(
        featureNotEnabled('A Coexistência não está ativa neste workspace'),
      )
    }

    const appId = WHATSAPP_META_APP_ID ?? NEXT_PUBLIC_META_APP_ID
    if (!appId || !WHATSAPP_META_APP_SECRET) {
      return err(
        featureNotEnabled(
          'A conexão pela Meta não está configurada neste ambiente',
        ),
      )
    }

    const token = await exchangeSignupCode(
      { appId, appSecret: WHATSAPP_META_APP_SECRET },
      dto.code,
    )
    if (!token.ok) return token

    const subscribed = await subscribeAppToWaba(token.value, dto.wabaId)
    if (!subscribed.ok) return subscribed

    const info = await fetchPhoneInfo(token.value, dto.phoneNumberId)
    if (!info.ok) return info

    const created = await WhatsAppConnectionRepository.create({
      workspaceId,
      provider: 'META',
      label:
        dto.label ?? info.value.verifiedName ?? info.value.displayPhoneNumber,
      phoneNumber: info.value.displayPhoneNumber,
      status: 'CONNECTED',
      metaPhoneNumberId: dto.phoneNumberId,
      metaWabaId: dto.wabaId,
      encryptedMetaAccessToken: await encryptConnectionSecret(token.value),
      coexistence: true,
      createdById: actorId,
    })
    if (!created.ok) return created

    const sync = await WhatsAppCoexistenceRepository.create({
      workspaceId,
      connectionId: created.value.id,
    })
    if (!sync.ok) return sync

    // Contacts first, then the history (Meta asks for this order). A refusal
    // does not undo the connection: the number works, only the import fails.
    const contacts = await requestCoexistenceSync(
      token.value,
      dto.phoneNumberId,
      'smb_app_state_sync',
    )
    const history = contacts.ok
      ? await requestCoexistenceSync(token.value, dto.phoneNumberId, 'history')
      : contacts
    let current = sync.value
    if (!history.ok) {
      const failed = await WhatsAppCoexistenceRepository.update(
        created.value.id,
        { status: 'FAILED', error: history.error.message },
      )
      if (failed.ok && failed.value) current = failed.value
    }

    logger.info('whatsapp.coexistence.connected', {
      workspaceId,
      connectionId: created.value.id,
    })
    auditMutation({
      entity: 'whatsapp_connection',
      action: 'create',
      actorId,
      targetId: created.value.id,
      meta: { provider: 'META', via: 'coexistence' },
    })
    return ok({
      connection: toWhatsAppConnectionDTO(created.value),
      sync: toCoexistenceSyncDTO(current),
    })
  },

  async getSync(
    actorId: string,
    workspaceId: string,
    connectionId: string,
  ): Promise<Result<WhatsAppCoexistenceSyncDTO>> {
    const member = await assertModuleMember(actorId, workspaceId, COMMUNICATION)
    if (!member.ok) return member
    const sync = await WhatsAppCoexistenceRepository.findByConnection(
      workspaceId,
      connectionId,
    )
    if (!sync.ok) return sync
    if (!sync.value) return err(whatsappConnectionNotFound())
    return ok(toCoexistenceSyncDTO(sync.value))
  },

  /**
   * Handles the three coexistence webhook fields of a signed Meta event. A
   * number that is not a coexistence connection is ignored (200 for Meta).
   */
  async applyWebhook(input: {
    field: CoexistenceWebhookField
    value: CoexistenceWebhookValue
  }): Promise<Result<void>> {
    const phoneNumberId = input.value.metadata?.phone_number_id
    if (!phoneNumberId) return ok(undefined)
    const found =
      await WhatsAppConnectionRepository.findByMetaPhoneNumberId(phoneNumberId)
    if (!found.ok) return found
    const connection = found.value
    if (!connection?.coexistence) return ok(undefined)

    if (input.field === 'smb_app_state_sync') {
      const contacts = parseContactSync(input.value)
      let imported = 0
      for (const contact of contacts) {
        const saved = await WhatsAppContactRepository.upsertByWaId({
          workspaceId: connection.workspaceId,
          waId: contact.waId,
          name: contact.name ?? undefined,
        })
        if (!saved.ok) return saved
        imported++
      }
      const updated = await WhatsAppCoexistenceRepository.update(
        connection.id,
        {
          status: 'SYNCING',
          contactsImported: { increment: imported },
        },
      )
      if (!updated.ok) return updated
      return ok(undefined)
    }

    if (input.field === 'smb_message_echoes') {
      for (const echo of parseMessageEchoes(input.value)) {
        const message = {
          connection,
          waId: echo.waId,
          providerMessageId: echo.providerMessageId,
          type: echo.type,
          text: echo.text ?? undefined,
        }
        const result =
          await WhatsAppWebhookService.ingestOutboundDeviceMessage(message)
        if (!result.ok) return result
      }
      return ok(undefined)
    }

    const parsed = parseHistoryWebhook(input.value)
    if (parsed.declined) {
      const declined = await WhatsAppCoexistenceRepository.update(
        connection.id,
        { status: 'DECLINED', finishedAt: new Date() },
      )
      if (!declined.ok) return declined
      return ok(undefined)
    }

    for (const chunk of parsed.chunks) {
      const totals = await importChunk(connection, chunk)
      if (!totals.ok) return totals
      const done = (chunk.progress ?? 0) >= 100
      const updated = await WhatsAppCoexistenceRepository.update(
        connection.id,
        {
          status: done ? 'COMPLETED' : 'SYNCING',
          ...(chunk.progress === null ? {} : { progress: chunk.progress }),
          messagesImported: { increment: totals.value.messages },
          conversationsTouched: { increment: totals.value.conversations },
          ...(done ? { finishedAt: new Date() } : {}),
        },
      )
      if (!updated.ok) return updated
    }
    return ok(undefined)
  },
}
