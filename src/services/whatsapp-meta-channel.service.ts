import type { WhatsAppChannel } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { NEXT_PUBLIC_META_APP_ID } from '@/lib/env/env'
import {
  WHATSAPP_META_APP_ID,
  WHATSAPP_META_APP_SECRET,
} from '@/lib/env/server'
import {
  featureNotEnabled,
  metaChannelCommentNotFound,
  metaChannelPageNotFound,
  whatsappConnectionNotFound,
} from '@/src/errors'
import {
  decryptConnectionSecret,
  encryptConnectionSecret,
} from '@/src/lib/crypto'
import { err, ok, type Result } from '@/src/lib/result'
import {
  exchangeLongLivedToken,
  listManagedPages,
  type MetaManagedPage,
  type MetaSocialChannel,
  PAGE_SUBSCRIBED_FIELDS,
  replyToComment,
  sendPrivateReply,
  socialWaId,
  subscribePage,
} from '@/src/lib/whatsapp/meta-social'
import {
  toMetaChannelConnectionDTO,
  toMetaChannelSettingsDTO,
  toSocialCommentDTO,
} from '@/src/mappers/whatsapp-meta-channel.mapper'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppMetaChannelRepository } from '@/src/repositories/whatsapp-meta-channel.repository'
import type {
  ConnectMetaChannelDTO,
  ListMetaChannelPagesDTO,
  ReplySocialCommentDTO,
  UpdateMetaChannelSettingsDTO,
} from '@/src/schemas/whatsapp-meta-channel.schema'
import type { WhatsAppMessageDTO } from '@/types/whatsapp-message'
import type {
  MetaChannelConnectionDTO,
  MetaChannelPageDTO,
  WhatsAppMetaChannelSettingsDTO,
  WhatsAppSocialCommentDTO,
} from '@/types/whatsapp-meta-channel'
import { assertModuleMember, assertModulePrivileged } from './authz'
import { loadConversationForViewer } from './whatsapp-conversation-scope.service'
import { finalizeOutboundMessage } from './whatsapp-message.service'

const COMMUNICATION = 'COMMUNICATION' as const

type SocialChannel = Exclude<WhatsAppChannel, 'WHATSAPP'>

function metaApp(): { appId: string; appSecret: string } | null {
  const appId = WHATSAPP_META_APP_ID ?? NEXT_PUBLIC_META_APP_ID
  if (!appId || !WHATSAPP_META_APP_SECRET) return null
  return { appId, appSecret: WHATSAPP_META_APP_SECRET }
}

/** A channel only works when an admin turned it on for the workspace. */
function channelEnabled(
  settings: WhatsAppMetaChannelSettingsDTO,
  channel: SocialChannel,
): boolean {
  return channel === 'INSTAGRAM'
    ? settings.instagramEnabled
    : settings.messengerEnabled
}

async function loadSettings(
  workspaceId: string,
): Promise<Result<WhatsAppMetaChannelSettingsDTO>> {
  const row = await WhatsAppMetaChannelRepository.findSettings(workspaceId)
  if (!row.ok) return row
  return ok(toMetaChannelSettingsDTO(workspaceId, row.value))
}

/** Long-lived user token and the Page picked by the admin. */
async function resolvePage(
  accessToken: string,
  pageId?: string,
): Promise<Result<{ pages: MetaManagedPage[]; page?: MetaManagedPage }>> {
  const app = metaApp()
  if (!app) {
    return err(
      featureNotEnabled(
        'A conexão pela Meta não está configurada neste ambiente',
      ),
    )
  }
  const longLived = await exchangeLongLivedToken(app, accessToken)
  if (!longLived.ok) return longLived
  const pages = await listManagedPages(longLived.value)
  if (!pages.ok) return pages
  if (!pageId) return ok({ pages: pages.value })
  const page = pages.value.find((p) => p.id === pageId)
  if (!page) return err(metaChannelPageNotFound())
  return ok({ pages: pages.value, page })
}

export const WhatsAppMetaChannelService = {
  async getSettings(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppMetaChannelSettingsDTO>> {
    const member = await assertModuleMember(actorId, workspaceId, COMMUNICATION)
    if (!member.ok) return member
    return loadSettings(workspaceId)
  },

  async updateSettings(
    actorId: string,
    workspaceId: string,
    dto: UpdateMetaChannelSettingsDTO,
  ): Promise<Result<WhatsAppMetaChannelSettingsDTO>> {
    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      COMMUNICATION,
    )
    if (!privileged.ok) return privileged

    const saved = await WhatsAppMetaChannelRepository.upsertSettings(
      workspaceId,
      dto,
    )
    if (!saved.ok) return saved

    auditMutation({
      entity: 'whatsapp_settings',
      action: 'update',
      actorId,
      targetId: workspaceId,
      meta: { scope: 'meta_channels', changed: Object.keys(dto) },
    })
    return ok(toMetaChannelSettingsDTO(workspaceId, saved.value))
  },

  /** Instagram / Messenger connections of the workspace. */
  async listConnections(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<MetaChannelConnectionDTO[]>> {
    const member = await assertModuleMember(actorId, workspaceId, COMMUNICATION)
    if (!member.ok) return member
    const rows =
      await WhatsAppMetaChannelRepository.listSocialConnections(workspaceId)
    if (!rows.ok) return rows
    return ok(rows.value.map(toMetaChannelConnectionDTO))
  },

  /** Pages the logged-in Meta user manages (step 1 of the connect dialog). */
  async listPages(
    actorId: string,
    workspaceId: string,
    dto: ListMetaChannelPagesDTO,
  ): Promise<Result<MetaChannelPageDTO[]>> {
    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      COMMUNICATION,
    )
    if (!privileged.ok) return privileged

    const settings = await loadSettings(workspaceId)
    if (!settings.ok) return settings
    if (!settings.value.instagramEnabled && !settings.value.messengerEnabled) {
      return err(featureNotEnabled('Ative o Instagram ou o Messenger antes'))
    }

    const resolved = await resolvePage(dto.accessToken)
    if (!resolved.ok) return resolved

    const existing =
      await WhatsAppMetaChannelRepository.listSocialConnections(workspaceId)
    if (!existing.ok) return existing

    return ok(
      resolved.value.pages.map((page) => ({
        pageId: page.id,
        name: page.name,
        instagramAccountId: page.instagram?.id ?? null,
        instagramUsername: page.instagram?.username ?? null,
        connectedChannels: existing.value
          .filter((c) => c.metaPageId === page.id)
          .map((c) => c.channel),
      })),
    )
  },

  /**
   * Connects the chosen Page as Messenger and/or Instagram Direct: swaps the
   * login for a long-lived Page token, subscribes the Page webhooks and
   * creates one connection per channel. Re-connecting refreshes the token.
   */
  async connect(
    actorId: string,
    workspaceId: string,
    dto: ConnectMetaChannelDTO,
  ): Promise<Result<MetaChannelConnectionDTO[]>> {
    const privileged = await assertModulePrivileged(
      actorId,
      workspaceId,
      COMMUNICATION,
    )
    if (!privileged.ok) return privileged

    const settings = await loadSettings(workspaceId)
    if (!settings.ok) return settings
    for (const channel of dto.channels) {
      if (!channelEnabled(settings.value, channel)) {
        return err(
          featureNotEnabled(
            channel === 'INSTAGRAM'
              ? 'O Instagram Direct não está ativo neste workspace'
              : 'O Messenger não está ativo neste workspace',
          ),
        )
      }
    }

    const resolved = await resolvePage(dto.accessToken, dto.pageId)
    if (!resolved.ok) return resolved
    const page = resolved.value.page
    if (!page) return err(metaChannelPageNotFound())
    if (dto.channels.includes('INSTAGRAM') && !page.instagram) {
      return err(
        featureNotEnabled(
          'Esta Página não tem uma conta profissional do Instagram vinculada',
        ),
      )
    }

    const subscribed = await subscribePage(
      page.accessToken,
      page.id,
      PAGE_SUBSCRIBED_FIELDS,
    )
    if (!subscribed.ok) return subscribed

    const encryptedToken = await encryptConnectionSecret(page.accessToken)
    const connections: MetaChannelConnectionDTO[] = []

    for (const channel of dto.channels) {
      const isInstagram = channel === 'INSTAGRAM'
      const handle = isInstagram
        ? (page.instagram?.username ?? page.instagram?.id ?? page.id)
        : page.name
      const existing = await WhatsAppMetaChannelRepository.findByPage(
        workspaceId,
        channel,
        page.id,
      )
      if (!existing.ok) return existing

      const saved = existing.value
        ? await WhatsAppConnectionRepository.update(existing.value.id, {
            encryptedMetaAccessToken: encryptedToken,
            status: 'CONNECTED',
            statusError: null,
          })
        : await WhatsAppConnectionRepository.create({
            workspaceId,
            provider: 'META',
            channel,
            label: isInstagram ? `Instagram ${handle}` : `Messenger ${handle}`,
            phoneNumber: socialWaId(channel, page.id),
            status: 'CONNECTED',
            metaPageId: page.id,
            metaInstagramAccountId: isInstagram ? page.instagram?.id : null,
            encryptedMetaAccessToken: encryptedToken,
            createdById: actorId,
          })
      if (!saved.ok) return saved

      logger.info('whatsapp.meta_channel.connected', {
        workspaceId,
        connectionId: saved.value.id,
        channel,
      })
      auditMutation({
        entity: 'whatsapp_connection',
        action: existing.value ? 'update' : 'create',
        actorId,
        targetId: saved.value.id,
        meta: { provider: 'META', channel, via: 'meta_channels' },
      })
      connections.push(toMetaChannelConnectionDTO(saved.value))
    }
    return ok(connections)
  },

  /** Comment references of the messages of a social conversation. */
  async listComments(
    actorId: string,
    workspaceId: string,
    conversationId: string,
  ): Promise<Result<WhatsAppSocialCommentDTO[]>> {
    const member = await assertModuleMember(
      actorId,
      workspaceId,
      COMMUNICATION,
      { resource: 'conversations', action: 'VIEW' },
    )
    if (!member.ok) return member
    const conversation = await loadConversationForViewer(
      { userId: actorId, role: member.value.role },
      workspaceId,
      conversationId,
    )
    if (!conversation.ok) return conversation

    const comments =
      await WhatsAppMetaChannelRepository.listCommentsByConversation(
        workspaceId,
        conversationId,
      )
    if (!comments.ok) return comments
    return ok(comments.value.map(toSocialCommentDTO))
  },

  /**
   * Answers a comment: PUBLIC replies under it, PRIVATE sends a DM to its
   * author (Meta allows one private reply per comment, within 7 days). The
   * answer becomes an outbound message of the conversation, so the SLA clock
   * and the timeline treat it like any agent message.
   */
  async replyToComment(
    actorId: string,
    workspaceId: string,
    conversationId: string,
    messageId: string,
    dto: ReplySocialCommentDTO,
  ): Promise<Result<WhatsAppMessageDTO>> {
    const member = await assertModuleMember(
      actorId,
      workspaceId,
      COMMUNICATION,
      { resource: 'conversations', action: 'CREATE' },
    )
    if (!member.ok) return member
    const loaded = await loadConversationForViewer(
      { userId: actorId, role: member.value.role },
      workspaceId,
      conversationId,
    )
    if (!loaded.ok) return loaded

    const comment = await WhatsAppMetaChannelRepository.findCommentByMessageId(
      workspaceId,
      messageId,
    )
    if (!comment.ok) return comment
    if (!comment.value) return err(metaChannelCommentNotFound())

    const connection = await WhatsAppConnectionRepository.findById(
      loaded.value.conversation.connectionId,
      workspaceId,
    )
    if (!connection.ok) return connection
    const social = connection.value
    if (
      !social ||
      (social.channel !== 'INSTAGRAM' && social.channel !== 'MESSENGER') ||
      social.id !== comment.value.connectionId ||
      !social.metaPageId ||
      !social.encryptedMetaAccessToken
    ) {
      return err(whatsappConnectionNotFound())
    }

    const token = await decryptConnectionSecret(social.encryptedMetaAccessToken)
    const channel: MetaSocialChannel = social.channel
    const sent =
      dto.mode === 'PRIVATE'
        ? await sendPrivateReply({
            pageId: social.metaPageId,
            commentId: comment.value.commentId,
            token,
            text: dto.text,
          })
        : await replyToComment({
            channel,
            commentId: comment.value.commentId,
            token,
            text: dto.text,
          })
    if (!sent.ok) return sent

    await WhatsAppMetaChannelRepository.markCommentReplied(comment.value.id)
    await WhatsAppConversationRepository.update(conversationId, {
      aiActive: false,
      aiHandoff: true,
    })

    return finalizeOutboundMessage({
      workspaceId,
      conversationId,
      actorId,
      type: 'TEXT',
      text:
        dto.mode === 'PRIVATE'
          ? `[Resposta privada] ${dto.text}`
          : `[Resposta pública] ${dto.text}`,
      providerMessageId: sent.value,
      replyToMessageId: messageId,
    })
  },
}
