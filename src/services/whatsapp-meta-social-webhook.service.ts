import type { WhatsAppConnection } from '@prisma/client'
import { logger } from '@/lib/axiom/logger'
import { decryptConnectionSecret } from '@/src/lib/crypto'
import { consume, whatsappWebhookLimiter } from '@/src/lib/rate-limit'
import { ok, type Result } from '@/src/lib/result'
import {
  attachmentText,
  fetchSocialProfile,
  type SocialEvent,
  socialWaId,
} from '@/src/lib/whatsapp/meta-social'
import { toMetaChannelSettingsDTO } from '@/src/mappers/whatsapp-meta-channel.mapper'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WhatsAppMessageRepository } from '@/src/repositories/whatsapp-message.repository'
import { WhatsAppMetaChannelRepository } from '@/src/repositories/whatsapp-meta-channel.repository'
import { assertModuleEnabled } from './authz'
import { WhatsAppWebhookService } from './whatsapp-webhook.service'

export interface SocialIngestSummary {
  processed: number
  skipped: number
}

/** Text of an event: its own text, or the attachment link. */
function eventText(event: SocialEvent): string | undefined {
  if (event.kind === 'comment') return event.text
  if (event.text) return event.text
  if (event.attachmentUrl) {
    return attachmentText(event.attachmentType, event.attachmentUrl)
  }
  return undefined
}

/**
 * Name and photo of a customer the first time we see them (or while the name
 * is still unknown). Best effort: Meta hides profiles of some users.
 */
async function resolveProfile(
  connection: WhatsAppConnection,
  event: SocialEvent,
  waId: string,
): Promise<{ name?: string; avatarUrl?: string }> {
  if (event.kind === 'comment' && event.contactName) {
    return { name: event.contactName }
  }
  const known = await WhatsAppContactRepository.findByWaId(
    connection.workspaceId,
    waId,
  )
  if (known.ok && known.value?.name) return {}
  if (!connection.encryptedMetaAccessToken) return {}
  const token = await decryptConnectionSecret(
    connection.encryptedMetaAccessToken,
  )
  const profile = await fetchSocialProfile(
    event.channel,
    event.contactId,
    token,
  )
  return {
    name: profile.name ?? undefined,
    avatarUrl: profile.avatarUrl ?? undefined,
  }
}

async function ingestOne(
  connection: WhatsAppConnection,
  event: SocialEvent,
): Promise<Result<void>> {
  const text = eventText(event)
  if (!text) return ok(undefined)

  const waId = socialWaId(event.channel, event.contactId)
  const profile = await resolveProfile(connection, event, waId)

  if (event.kind === 'message' && event.echo) {
    // Answer typed in the Page / Instagram app: a human replied.
    return WhatsAppWebhookService.ingestOutboundDeviceMessage({
      connection,
      waId,
      contactName: profile.name,
      contactAvatarUrl: profile.avatarUrl,
      providerMessageId: event.mid,
      type: 'TEXT',
      text,
    })
  }

  const providerMessageId =
    event.kind === 'comment' ? `comment:${event.commentId}` : event.mid
  const ingested = await WhatsAppWebhookService.ingestInboundMessage({
    connection,
    waId,
    contactName: profile.name,
    contactAvatarUrl: profile.avatarUrl,
    providerMessageId,
    type: 'TEXT',
    text,
  })
  if (!ingested.ok || event.kind !== 'comment') return ingested

  // Keep the post reference so the agent can answer under the comment.
  const message =
    await WhatsAppMessageRepository.findByProviderMessageId(providerMessageId)
  if (!message.ok) return message
  if (!message.value) return ok(undefined)
  const saved = await WhatsAppMetaChannelRepository.createComment({
    workspaceId: connection.workspaceId,
    connectionId: connection.id,
    messageId: message.value.id,
    commentId: event.commentId,
    postId: event.postId,
    parentCommentId: event.parentCommentId,
    permalink: event.permalink,
  })
  if (!saved.ok) return saved
  return ok(undefined)
}

export const WhatsAppMetaSocialWebhookService = {
  /**
   * Feeds the parsed events of an Instagram / Page webhook into the zap
   * pipeline (contact, conversation, SLA, teams, AI). Events of a channel the
   * workspace has not enabled, or of an unknown account, are skipped: the
   * webhook still answers 200 so Meta does not retry them.
   */
  async ingest(events: SocialEvent[]): Promise<Result<SocialIngestSummary>> {
    const summary: SocialIngestSummary = { processed: 0, skipped: 0 }

    for (const event of events) {
      const connection = await WhatsAppMetaChannelRepository.findByAccountId(
        event.channel,
        event.accountId,
      )
      if (!connection.ok) return connection
      if (!connection.value) {
        summary.skipped++
        continue
      }
      const target = connection.value

      const enabled = await assertModuleEnabled(
        target.workspaceId,
        target.module,
      )
      if (!enabled.ok) {
        summary.skipped++
        continue
      }

      const settingsRow = await WhatsAppMetaChannelRepository.findSettings(
        target.workspaceId,
      )
      if (!settingsRow.ok) return settingsRow
      const settings = toMetaChannelSettingsDTO(
        target.workspaceId,
        settingsRow.value,
      )
      const channelOn =
        event.channel === 'INSTAGRAM'
          ? settings.instagramEnabled
          : settings.messengerEnabled
      if (
        !channelOn ||
        (event.kind === 'comment' && !settings.commentsEnabled)
      ) {
        summary.skipped++
        continue
      }

      const limit = await consume(whatsappWebhookLimiter, target.id)
      if (!limit.ok) return limit

      const result = await ingestOne(target, event)
      if (!result.ok) {
        logger.error('whatsapp.meta_social.ingest_failed', {
          connectionId: target.id,
          kind: event.kind,
          reason: result.error.code,
        })
        return result
      }
      summary.processed++
    }
    return ok(summary)
  },
}
