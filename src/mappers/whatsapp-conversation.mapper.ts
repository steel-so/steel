import type { WhatsAppConversationWithPreview } from '@/src/repositories/whatsapp-conversation.repository'
import type { WhatsAppConversationDTO } from '@/types/whatsapp-conversation'

function previewForType(type: string): string {
  switch (type) {
    case 'IMAGE':
      return '📷 Imagem'
    case 'AUDIO':
      return '🎤 Áudio'
    case 'VIDEO':
      return '🎥 Vídeo'
    case 'DOCUMENT':
      return '📄 Documento'
    case 'STICKER':
      return 'Figurinha'
    case 'LOCATION':
      return '📍 Localização'
    case 'TEMPLATE':
      return 'Template'
    case 'BUTTON':
      return 'Botão'
    default:
      return ''
  }
}

export function toWhatsAppConversationDTO(
  conversation: WhatsAppConversationWithPreview,
): WhatsAppConversationDTO {
  const lastMessage = conversation.messages[0]

  return {
    id: conversation.id,
    workspaceId: conversation.workspaceId,
    connectionId: conversation.connectionId,
    contactId: conversation.contactId,
    contactName: conversation.contact.name,
    contactWaId: conversation.contact.waId,
    contactAvatarUrl: conversation.contact.avatarUrl,
    status: conversation.status,
    assignedUserId: conversation.assignedUserId,
    teamId: conversation.teamId,
    team: conversation.team
      ? { id: conversation.team.id, name: conversation.team.name }
      : null,
    aiActive: conversation.aiActive,
    aiHandoff: conversation.aiHandoff,
    unreadCount: conversation.unreadCount,
    avgSentimentScore: conversation.avgSentimentScore,
    lastMessageAt: conversation.lastMessageAt
      ? conversation.lastMessageAt.toISOString()
      : null,
    lastMessagePreview: lastMessage
      ? (lastMessage.text ?? previewForType(lastMessage.type))
      : null,
    pinned: conversation.pinnedAt !== null,
    archived: conversation.archivedAt !== null,
    closedAt: conversation.closedAt
      ? conversation.closedAt.toISOString()
      : null,
    closeReason: conversation.closeReason,
    closeOutcome: conversation.closeOutcome,
    closeStatusIds: conversation.closeStatusIds,
    closeStatusLabels: conversation.closeStatusLabels,
    contactSince: conversation.contact.createdAt.toISOString(),
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
  }
}
