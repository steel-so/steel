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
    ...overrides,
  }
}
