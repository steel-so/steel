import { createId } from '@paralleldrive/cuid2'
import type { WhatsAppPhoneCall } from '@prisma/client'

export function createFakeWhatsAppPhoneCall(
  overrides?: Partial<WhatsAppPhoneCall>,
): WhatsAppPhoneCall {
  const now = new Date()
  return {
    id: createId(),
    workspaceId: createId(),
    conversationId: createId(),
    userId: createId(),
    deviceId: '123',
    extension: '200',
    destination: '11999999999',
    job: 'steel_api_123_abc',
    callbackTokenHash: 'a'.repeat(64),
    status: 'QUEUED',
    dialStatus: null,
    answeredAt: null,
    endedAt: null,
    durationSeconds: null,
    createdAt: now,
    updatedAt: now,
    direction: 'OUTBOUND',
    source: 'CLICK_TO_CALL',
    pabxUniqueId: null,
    remoteName: null,
    recordingRequested: false,
    recordingNotice: null,
    recordingKey: null,
    recordingMimeType: null,
    recordingSizeBytes: null,
    recordedAt: null,
    recordingExpiresAt: null,
    aiStatus: 'NONE',
    aiSkipReason: null,
    transcript: null,
    summary: null,
    sentiment: null,
    sentimentScore: null,
    nextSteps: [],
    aiModel: null,
    aiProcessedAt: null,
    sdTicketId: null,
    crmPersonId: null,
    crmOpportunityId: null,
    ...overrides,
  }
}

/** A call with the names the timeline card shows (repository `WITH_NAMES`). */
export function createFakePhoneCallWithNames(
  overrides?: Partial<WhatsAppPhoneCall>,
  names: { userName?: string | null; contactName?: string | null } = {},
) {
  return {
    ...createFakeWhatsAppPhoneCall(overrides),
    user: names.userName === null ? null : { name: names.userName ?? 'Ana' },
    conversation: { contact: { name: names.contactName ?? 'Cliente' } },
  }
}
