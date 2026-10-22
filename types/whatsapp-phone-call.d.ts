export type WhatsAppPhoneCallStatusDTO =
  | 'QUEUED'
  | 'DIALING'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'BUSY'
  | 'NO_ANSWER'
  | 'CANCELED'
  | 'EXTENSION_NO_ANSWER'
  | 'FAILED'

export interface WhatsAppPhoneCallDTO {
  id: string
  conversationId: string
  userId: string | null
  extension: string
  destination: string
  status: WhatsAppPhoneCallStatusDTO
  answeredAt: string | null
  endedAt: string | null
  durationSeconds: number | null
  createdAt: string
  /** Notice the agent reads to the contact; set only on recorded calls. */
  recordingNotice: string | null
  hasRecording: boolean
  aiStatus: WhatsAppPhoneCallAiStatusDTO
  /** Answered by the IVR voice attendant (ADR 0046). */
  voiceAgent: boolean
}

/** Transcription + summary of a call recording (ADR 0043). */
export type WhatsAppPhoneCallAiStatusDTO =
  | 'NONE'
  | 'PENDING'
  | 'PROCESSING'
  | 'DONE'
  | 'SKIPPED'
  | 'FAILED'

/**
 * A call as the timelines show it (conversation, ticket, CRM record): the
 * live fields plus the recording, transcript, summary and record links.
 */
export interface PhoneCallRecordDTO extends WhatsAppPhoneCallDTO {
  userName: string | null
  contactName: string | null
  recording: {
    mimeType: string
    sizeBytes: number
    /** The retention job deletes the audio after this. */
    expiresAt: string | null
  } | null
  transcript: string | null
  summary: string | null
  sentiment: 'NEGATIVE' | 'NEUTRAL' | 'POSITIVE' | null
  sentimentScore: number | null
  nextSteps: string[]
  aiModel: string | null
  /** Machine code of why the AI step was skipped or failed. */
  aiSkipReason: string | null
  aiProcessedAt: string | null
  sdTicketId: string | null
  crmPersonId: string | null
  crmOpportunityId: string | null
  /** Voice attendant calls: why it ended (machine code). */
  voiceEndReason: string | null
  /** Extension/queue the call was handed to, when it was. */
  voiceTransferTarget: string | null
  /** Context the person who took the call received (summary + ticket). */
  voiceHandoff: string | null
}
