import type {
  WhatsAppCoexistenceSync,
  WhatsAppConnection,
  WhatsAppMetaChannelSettings,
} from '@prisma/client'
import type {
  MetaChannelConnectionDTO,
  WhatsAppCoexistenceSyncDTO,
  WhatsAppMetaChannelSettingsDTO,
} from '@/types/whatsapp-meta-channel'

/** Everything is off until an admin turns it on (Meta app review is separate). */
export function toMetaChannelSettingsDTO(
  workspaceId: string,
  row: WhatsAppMetaChannelSettings | null,
): WhatsAppMetaChannelSettingsDTO {
  return {
    workspaceId,
    coexistenceEnabled: row?.coexistenceEnabled ?? false,
  }
}

export function toMetaChannelConnectionDTO(
  connection: WhatsAppConnection,
): MetaChannelConnectionDTO {
  return {
    id: connection.id,
    label: connection.label,
    coexistence: connection.coexistence,
    status: connection.status,
    statusError: connection.statusError,
    createdAt: connection.createdAt.toISOString(),
  }
}

export function toCoexistenceSyncDTO(
  sync: WhatsAppCoexistenceSync,
): WhatsAppCoexistenceSyncDTO {
  return {
    connectionId: sync.connectionId,
    status: sync.status,
    progress: sync.progress,
    contactsImported: sync.contactsImported,
    messagesImported: sync.messagesImported,
    conversationsTouched: sync.conversationsTouched,
    error: sync.error,
    startedAt: sync.startedAt.toISOString(),
    finishedAt: sync.finishedAt?.toISOString() ?? null,
  }
}
