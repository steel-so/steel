import type { WhatsAppPhoneCall } from '@prisma/client'
import type {
  PhoneCallRecordDTO,
  WhatsAppPhoneCallDTO,
} from '@/types/whatsapp-phone-call'

export function toWhatsAppPhoneCallDTO(
  call: WhatsAppPhoneCall,
): WhatsAppPhoneCallDTO {
  return {
    id: call.id,
    conversationId: call.conversationId,
    direction: call.direction,
    source: call.source,
    userId: call.userId,
    extension: call.extension,
    destination: call.destination,
    status: call.status,
    answeredAt: call.answeredAt?.toISOString() ?? null,
    endedAt: call.endedAt?.toISOString() ?? null,
    durationSeconds: call.durationSeconds,
    createdAt: call.createdAt.toISOString(),
    recordingNotice: call.recordingRequested ? call.recordingNotice : null,
    hasRecording: Boolean(call.recordingKey),
    aiStatus: call.aiStatus,
  }
}

/** Call row with the names the timeline card shows. */
export type PhoneCallWithNames = WhatsAppPhoneCall & {
  user: { name: string } | null
  conversation: { contact: { name: string | null } } | null
}

export function toPhoneCallRecordDTO(
  call: PhoneCallWithNames,
): PhoneCallRecordDTO {
  return {
    ...toWhatsAppPhoneCallDTO(call),
    userName: call.user?.name ?? null,
    contactName: call.conversation?.contact.name ?? call.remoteName,
    recording:
      call.recordingKey && call.recordingMimeType
        ? {
            mimeType: call.recordingMimeType,
            sizeBytes: call.recordingSizeBytes ?? 0,
            expiresAt: call.recordingExpiresAt?.toISOString() ?? null,
          }
        : null,
    transcript: call.transcript,
    summary: call.summary,
    sentiment: call.sentiment,
    sentimentScore: call.sentimentScore,
    nextSteps: call.nextSteps,
    aiModel: call.aiModel,
    aiSkipReason: call.aiSkipReason,
    aiProcessedAt: call.aiProcessedAt?.toISOString() ?? null,
    sdTicketId: call.sdTicketId,
    crmPersonId: call.crmPersonId,
    crmOpportunityId: call.crmOpportunityId,
  }
}
