import { createId } from '@paralleldrive/cuid2'
import type { Prisma, SdNotificationPreference } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import type { SdNotifyOutcome } from '@/src/services/sd-notification.service'

/** Desfecho do motor de notificações (para dublar `notifySdEvent`). */
export function createFakeSdNotifyOutcome(
  overrides?: Partial<SdNotifyOutcome>,
): SdNotifyOutcome {
  return {
    event: 'ticket.assigned',
    recipients: 1,
    inApp: 1,
    email: 0,
    whatsapp: 0,
    whatsappSkippedOptOut: 0,
    skipped: null,
    ...overrides,
  }
}

export function createFakeSdNotificationPreference(
  overrides?: Partial<SdNotificationPreference>,
): SdNotificationPreference {
  const at = new Date('2026-10-01T12:00:00.000Z')
  return {
    id: createId(),
    workspaceId: 'ws1',
    userId: 'u1',
    event: 'ticket.message',
    channel: 'EMAIL',
    enabled: false,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  }
}

export async function seedSdNotificationPreference(
  workspaceId: string,
  userId: string,
  overrides?: Partial<
    Omit<
      Prisma.SdNotificationPreferenceUncheckedCreateInput,
      'workspaceId' | 'userId'
    >
  >,
) {
  return prisma.sdNotificationPreference.create({
    data: {
      workspaceId,
      userId,
      event: 'ticket.message',
      channel: 'EMAIL',
      enabled: false,
      ...overrides,
    },
  })
}

export async function seedSdTicketFollower(ticketId: string, userId: string) {
  return prisma.sdTicketFollower.create({ data: { ticketId, userId } })
}
