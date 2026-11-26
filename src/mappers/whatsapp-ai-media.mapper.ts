import type { WhatsAppAiMedia } from '@prisma/client'
import type { WhatsAppAiMediaDTO } from '@/types/whatsapp-ai-media'

export function toWhatsAppAiMediaDTO(row: WhatsAppAiMedia): WhatsAppAiMediaDTO {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    key: row.key,
    name: row.name,
    whenToSend: row.whenToSend,
    mediaUrl: row.mediaUrl,
    mediaType: row.mediaType === 'VIDEO' ? 'VIDEO' : 'IMAGE',
    mimeType: row.mimeType,
    fileName: row.fileName,
    sizeBytes: row.sizeBytes,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}
