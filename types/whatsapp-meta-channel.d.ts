export type WhatsAppChannelDTO = 'WHATSAPP' | 'INSTAGRAM' | 'MESSENGER'

export interface WhatsAppMetaChannelSettingsDTO {
  workspaceId: string
  instagramEnabled: boolean
  messengerEnabled: boolean
  commentsEnabled: boolean
  coexistenceEnabled: boolean
}

/** A Facebook Page the user manages, as offered in the connect dialog. */
export interface MetaChannelPageDTO {
  pageId: string
  name: string
  instagramAccountId: string | null
  instagramUsername: string | null
  /** Channels already connected for this Page in the workspace. */
  connectedChannels: WhatsAppChannelDTO[]
}

/** A Meta channel connection: Instagram Direct, Messenger or Coexistence. */
export interface MetaChannelConnectionDTO {
  id: string
  channel: WhatsAppChannelDTO
  label: string
  pageId: string | null
  instagramAccountId: string | null
  /** WhatsApp number connected through Coexistence (channel WHATSAPP). */
  coexistence: boolean
  status: 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR'
  statusError: string | null
  createdAt: string
}

export type WhatsAppCoexistenceStatusDTO =
  | 'PENDING'
  | 'SYNCING'
  | 'COMPLETED'
  | 'DECLINED'
  | 'FAILED'

export interface WhatsAppCoexistenceSyncDTO {
  connectionId: string
  status: WhatsAppCoexistenceStatusDTO
  progress: number
  contactsImported: number
  messagesImported: number
  conversationsTouched: number
  error: string | null
  startedAt: string
  finishedAt: string | null
}

/** Comment reference of a message of a social conversation. */
export interface WhatsAppSocialCommentDTO {
  messageId: string
  commentId: string
  postId: string | null
  permalink: string | null
  repliedAt: string | null
}
