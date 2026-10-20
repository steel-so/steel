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
import { databaseError } from '@/src/errors'
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

import { auditMutation } from '@/lib/axiom/audit'
import { sendWhatsAppSentimentAlertEmail } from '@/src/lib/mail/workspace/send-whatsapp-sentiment-alert'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { NotificationRepository } from '@/src/repositories/notification.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppConversationEventRepository } from '@/src/repositories/whatsapp-conversation-event.repository'
import { WhatsAppSettingsRepository } from '@/src/repositories/whatsapp-settings.repository'
import { WhatsAppTeamRepository } from '@/src/repositories/whatsapp-team.repository'
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

describe('WhatsAppSentimentAlertService.evaluate()', () => {
  it('should notify OWNER/ADMINs in-app by default (no saved settings)', async () => {
    arrange({ settings: null })

    const outcome = expectOk(await evaluate(-0.5))

    expect(outcome).toEqual({
      alerted: true,
      recipients: 2,
      inApp: true,
      email: 0,
      assignedToId: null,
    })
    expect(mockedNotificationRepo.createMany).toHaveBeenCalledWith([
      expect.objectContaining({
        userId: 'owner1',
        kind: 'WHATSAPP_NEGATIVE_SENTIMENT',
        href: '/clinica/zap?conversa=conv1',
      }),
      expect.objectContaining({ userId: 'admin1' }),
    ])
    expect(mockedSendEmail).not.toHaveBeenCalled()
    expect(mockedEventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'SENTIMENT_ALERT', source: 'SENTIMENT' }),
    )
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'alert', actorId: null }),
    )
  })

  it('should not alert while the average is above the threshold', async () => {
    arrange()
    expect(expectOk(await evaluate(-0.1))).toEqual({
      alerted: false,
      reason: 'above_threshold',
    })
    expect(mockedConversationRepo.claimSentimentAlert).not.toHaveBeenCalled()
  })

  it('should not alert when the rule is disabled', async () => {
    arrange({ settings: { sentimentAlertEnabled: false } })
    expect(expectOk(await evaluate(-0.9))).toEqual({
      alerted: false,
      reason: 'disabled',
    })
  })

  it('should respect the cooldown window (no spam)', async () => {
    arrange({ settings: { sentimentAlertCooldownHours: 6 } })
    mockedConversationRepo.claimSentimentAlert.mockResolvedValue(ok(false))

    expect(expectOk(await evaluate(-0.9))).toEqual({
      alerted: false,
      reason: 'cooldown',
    })
    expect(mockedConversationRepo.claimSentimentAlert).toHaveBeenCalledWith(
      'conv1',
      new Date('2026-09-18T06:00:00Z'),
      NOW,
    )
    expect(mockedNotificationRepo.createMany).not.toHaveBeenCalled()
  })

  it('should e-mail only the selected members when configured', async () => {
    arrange({
      settings: {
        sentimentAlertRecipientIds: ['agent1'],
        sentimentAlertNotifyInApp: false,
        sentimentAlertNotifyEmail: true,
      },
    })

    const outcome = expectOk(await evaluate(-0.6))

    expect(outcome).toEqual(
      expect.objectContaining({ recipients: 1, inApp: false, email: 1 }),
    )
    expect(mockedNotificationRepo.createMany).not.toHaveBeenCalled()
    expect(mockedSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'agent1@example.com',
        contactLabel: 'Maria',
        averageScore: '-0,60',
      }),
    )
  })

  it('should auto-assign an unassigned conversation to the supervisor', async () => {
    arrange({ settings: { sentimentAlertAssignToId: 'admin1' } })

    const outcome = expectOk(await evaluate(-0.7))

    expect(outcome).toEqual(
      expect.objectContaining({ alerted: true, assignedToId: 'admin1' }),
    )
    expect(mockedConversationRepo.update).toHaveBeenCalledWith('conv1', {
      assignedUserId: 'admin1',
      status: 'IN_PROGRESS',
    })
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'assign', actorId: null }),
    )
  })

  it('should keep the current agent when the conversation is already assigned', async () => {
    arrange({
      settings: { sentimentAlertAssignToId: 'admin1' },
      assignedUserId: 'agent1',
    })

    const outcome = expectOk(await evaluate(-0.7))

    expect(outcome).toEqual(expect.objectContaining({ assignedToId: null }))
    expect(mockedConversationRepo.update).not.toHaveBeenCalled()
  })
})

describe('WhatsAppSentimentAlertService.evaluate() · Equipes', () => {
  const teams = vi.mocked(WhatsAppTeamRepository)

  it('does not tell an admin who belongs to a team about a conversation they cannot see', async () => {
    arrange({ settings: null, assignedUserId: 'agent1' })
    teams.listMembershipSnapshot.mockResolvedValueOnce(
      ok([{ id: 'team1', members: [{ userId: 'admin1', role: 'AGENT' }] }]),
    )

    const outcome = expectOk(await evaluate(-0.5))

    expect(outcome).toMatchObject({ alerted: true, recipients: 1 })
    expect(mockedNotificationRepo.createMany).toHaveBeenCalledWith([
      expect.objectContaining({ userId: 'owner1' }),
    ])
  })

  it('propagates a team snapshot failure before alerting', async () => {
    arrange({ settings: null })
    teams.listMembershipSnapshot.mockResolvedValueOnce(err(databaseError()))

    expectErr(await evaluate(-0.5), 'DATABASE_ERROR')
    expect(mockedConversationRepo.claimSentimentAlert).not.toHaveBeenCalled()
  })
})
