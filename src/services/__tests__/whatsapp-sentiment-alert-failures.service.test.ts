import type { Role } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeWhatsAppContact } from '@/src/__tests__/factories/whatsapp-contact.factory'
import {
  createFakeWhatsAppConversation,
  createFakeWhatsAppConversationWithPreview,
} from '@/src/__tests__/factories/whatsapp-conversation.factory'
import { createFakeWhatsAppSettings } from '@/src/__tests__/factories/whatsapp-settings.factory'
import { createFakeWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import type { AppError } from '@/src/errors/app-error'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/notification.repository')
vi.mock('@/src/repositories/notification-preference.repository', async () => {
  const { ok } = await import('@/src/lib/result')
  return {
    NotificationPreferenceRepository: {
      listMutedUserIds: vi.fn(async () => ok([])),
    },
  }
})
vi.mock('@/src/repositories/whatsapp-conversation.repository')
vi.mock('@/src/repositories/whatsapp-conversation-event.repository')
vi.mock('@/src/repositories/whatsapp-settings.repository')
vi.mock('@/src/repositories/workspace.repository')
vi.mock('@/src/lib/mail/workspace/send-whatsapp-sentiment-alert', () => ({
  sendWhatsAppSentimentAlertEmail: vi.fn(async () => ({ id: 'mail' })),
}))
vi.mock('@/src/lib/whatsapp/realtime', () => ({
  publishWhatsAppEvent: vi.fn(async () => undefined),
}))
vi.mock('@/src/lib/notifications/realtime', () => ({
  publishNotificationEvent: vi.fn(async () => undefined),
}))
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { sendWhatsAppSentimentAlertEmail } from '@/src/lib/mail/workspace/send-whatsapp-sentiment-alert'
import { publishWhatsAppEvent } from '@/src/lib/whatsapp/realtime'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { NotificationRepository } from '@/src/repositories/notification.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppConversationEventRepository } from '@/src/repositories/whatsapp-conversation-event.repository'
import { WhatsAppSettingsRepository } from '@/src/repositories/whatsapp-settings.repository'
import { WorkspaceRepository } from '@/src/repositories/workspace.repository'
import { WhatsAppSentimentAlertService } from '../whatsapp-sentiment-alert.service'

const mockedMembershipRepo = vi.mocked(MembershipRepository)
const mockedNotificationRepo = vi.mocked(NotificationRepository)
const mockedConversationRepo = vi.mocked(WhatsAppConversationRepository)
const mockedEventRepo = vi.mocked(WhatsAppConversationEventRepository)
const mockedSettingsRepo = vi.mocked(WhatsAppSettingsRepository)
const mockedWorkspaceRepo = vi.mocked(WorkspaceRepository)
const mockedSendEmail = vi.mocked(sendWhatsAppSentimentAlertEmail)

const NOW = new Date('2026-09-18T12:00:00Z')

function member(userId: string, role: Role) {
  return {
    ...createFakeMembership({ userId, workspaceId: 'ws1', role }),
    user: {
      id: userId,
      name: `User ${userId}`,
      email: `${userId}@example.com`,
      image: null,
    },
  }
}

function arrange(options?: {
  settings?: Parameters<typeof createFakeWhatsAppSettings>[0] | null
  assignedUserId?: string | null
}) {
  mockedSettingsRepo.findByWorkspace.mockResolvedValue(
    ok(
      options?.settings === null
        ? null
        : createFakeWhatsAppSettings({
            workspaceId: 'ws1',
            ...options?.settings,
          }),
    ),
  )
  mockedConversationRepo.findById.mockResolvedValue(
    ok(
      createFakeWhatsAppConversationWithPreview({
        id: 'conv1',
        workspaceId: 'ws1',
        assignedUserId: options?.assignedUserId ?? null,
        contact: createFakeWhatsAppContact({ name: 'Maria', waId: '55119' }),
      }),
    ),
  )
  mockedMembershipRepo.listWithUserByWorkspace.mockResolvedValue(
    ok([
      member('owner1', 'OWNER'),
      member('admin1', 'ADMIN'),
      member('agent1', 'MEMBER'),
    ]),
  )
  mockedConversationRepo.claimSentimentAlert.mockResolvedValue(ok(true))
  mockedConversationRepo.update.mockResolvedValue(
    ok(createFakeWhatsAppConversation({ id: 'conv1' })),
  )
  mockedWorkspaceRepo.findById.mockResolvedValue(
    ok(createFakeWorkspace({ id: 'ws1', slug: 'clinica', name: 'Clínica' })),
  )
  mockedNotificationRepo.createMany.mockResolvedValue(ok(2))
  mockedEventRepo.create.mockResolvedValue(
    ok({
      id: 'ev1',
      workspaceId: 'ws1',
      conversationId: 'conv1',
      kind: 'SENTIMENT_ALERT',
      source: 'SENTIMENT',
      actorUserId: null,
      reason: null,
      closeOutcome: null,
      closeStatusLabels: [],
      createdAt: NOW,
    }),
  )
}

function evaluate(avgSentimentScore: number | null) {
  return WhatsAppSentimentAlertService.evaluate({
    workspaceId: 'ws1',
    conversationId: 'conv1',
    avgSentimentScore,
    now: NOW,
  })
}

const DB_ERROR: AppError = { code: 'DATABASE_ERROR', message: 'db down' }

describe('WhatsAppSentimentAlertService.evaluate() — failures and edge cases', () => {
  it('should propagate a settings lookup failure', async () => {
    arrange()
    mockedSettingsRepo.findByWorkspace.mockResolvedValue(err(DB_ERROR))

    expectErr(await evaluate(-0.5), 'DATABASE_ERROR')
  })

  it('should not alert a conversation without a score yet', async () => {
    arrange()

    expect(expectOk(await evaluate(null))).toEqual({
      alerted: false,
      reason: 'no_score',
    })
    expect(mockedConversationRepo.findById).not.toHaveBeenCalled()
  })

  it('should propagate a conversation lookup failure', async () => {
    arrange()
    mockedConversationRepo.findById.mockResolvedValue(err(DB_ERROR))

    expectErr(await evaluate(-0.5), 'DATABASE_ERROR')
  })

  it.each([
    ['missing', null],
    [
      'deleted',
      createFakeWhatsAppConversationWithPreview({
        id: 'conv1',
        deletedAt: new Date(),
      }),
    ],
  ])('should skip a %s conversation', async (_label, value) => {
    arrange()
    mockedConversationRepo.findById.mockResolvedValue(ok(value))

    expect(expectOk(await evaluate(-0.5))).toEqual({
      alerted: false,
      reason: 'conversation_missing',
    })
  })

  it('should propagate a member listing failure', async () => {
    arrange()
    mockedMembershipRepo.listWithUserByWorkspace.mockResolvedValue(
      err(DB_ERROR),
    )

    expectErr(await evaluate(-0.5), 'DATABASE_ERROR')
  })

  it('should skip when nobody would be alerted or assigned', async () => {
    arrange()
    mockedMembershipRepo.listWithUserByWorkspace.mockResolvedValue(
      ok([member('agent1', 'MEMBER')]),
    )

    expect(expectOk(await evaluate(-0.5))).toEqual({
      alerted: false,
      reason: 'no_recipients',
    })
    expect(mockedConversationRepo.claimSentimentAlert).not.toHaveBeenCalled()
  })

  it('should still assign the supervisor when no one else is notified', async () => {
    arrange({
      settings: {
        sentimentAlertRecipientIds: ['ghost'],
        sentimentAlertAssignToId: 'agent1',
      },
    })

    const outcome = expectOk(await evaluate(-0.5))

    expect(outcome).toEqual(
      expect.objectContaining({
        alerted: true,
        recipients: 0,
        inApp: false,
        assignedToId: 'agent1',
      }),
    )
    expect(mockedNotificationRepo.createMany).not.toHaveBeenCalled()
  })

  it('should propagate a failure reserving the alert', async () => {
    arrange()
    mockedConversationRepo.claimSentimentAlert.mockResolvedValue(err(DB_ERROR))

    expectErr(await evaluate(-0.5), 'DATABASE_ERROR')
  })

  it('should propagate a workspace lookup failure', async () => {
    arrange()
    mockedWorkspaceRepo.findById.mockResolvedValue(err(DB_ERROR))

    expectErr(await evaluate(-0.5), 'DATABASE_ERROR')
  })

  it('should label the contact by phone when it has no name', async () => {
    arrange()
    mockedConversationRepo.findById.mockResolvedValue(
      ok(
        createFakeWhatsAppConversationWithPreview({
          id: 'conv1',
          contact: createFakeWhatsAppContact({ name: null, waId: '5511999' }),
        }),
      ),
    )

    expectOk(await evaluate(-0.5))

    expect(mockedNotificationRepo.createMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ title: 'Sentimento negativo: 5511999' }),
      ]),
    )
  })

  it('should propagate a failure assigning the supervisor', async () => {
    arrange({ settings: { sentimentAlertAssignToId: 'admin1' } })
    mockedConversationRepo.update.mockResolvedValue(err(DB_ERROR))

    expectErr(await evaluate(-0.5), 'DATABASE_ERROR')
  })

  it('should log and carry on when the in-app notification fails', async () => {
    arrange()
    mockedNotificationRepo.createMany.mockResolvedValue(err(DB_ERROR))

    const outcome = expectOk(await evaluate(-0.5))

    expect(outcome).toEqual(expect.objectContaining({ inApp: false }))
    expect(logger.error).toHaveBeenCalledWith(
      'whatsapp.sentiment_alert.notification_failed',
      expect.objectContaining({ reason: 'DATABASE_ERROR' }),
    )
  })

  it('should count only delivered e-mails and log the failures', async () => {
    arrange({ settings: { sentimentAlertNotifyEmail: true } })
    mockedSendEmail
      .mockResolvedValueOnce({ id: 'mail' } as never)
      .mockRejectedValueOnce(new Error('resend down'))

    const outcome = expectOk(await evaluate(-0.5))

    expect(outcome).toEqual(expect.objectContaining({ email: 1 }))
    expect(logger.warn).toHaveBeenCalledWith(
      'whatsapp.sentiment_alert.email_failed',
      expect.objectContaining({ failed: 1 }),
    )
  })

  it('should propagate a timeline event failure', async () => {
    arrange()
    mockedEventRepo.create.mockResolvedValue(err(DB_ERROR))

    expectErr(await evaluate(-0.5), 'DATABASE_ERROR')
    expect(auditMutation).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'alert' }),
    )
  })

  it('should measure the cooldown from the current time by default', async () => {
    arrange({ settings: { sentimentAlertCooldownHours: 6 } })
    vi.useFakeTimers({ now: NOW })

    try {
      expectOk(
        await WhatsAppSentimentAlertService.evaluate({
          workspaceId: 'ws1',
          conversationId: 'conv1',
          avgSentimentScore: -0.5,
        }),
      )
    } finally {
      vi.useRealTimers()
    }

    expect(mockedConversationRepo.claimSentimentAlert).toHaveBeenCalledWith(
      'conv1',
      new Date('2026-09-18T06:00:00Z'),
      NOW,
    )
  })

  it('should skip the realtime update when the refreshed conversation is gone', async () => {
    arrange()
    mockedConversationRepo.findById
      .mockResolvedValueOnce(
        ok(createFakeWhatsAppConversationWithPreview({ id: 'conv1' })),
      )
      .mockResolvedValueOnce(ok(null))

    expectOk(await evaluate(-0.5))

    expect(publishWhatsAppEvent).not.toHaveBeenCalled()
  })
})
