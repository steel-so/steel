import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeWhatsAppConversationWithPreview } from '@/src/__tests__/factories/whatsapp-conversation.factory'
import { createFakeWhatsAppSettings } from '@/src/__tests__/factories/whatsapp-settings.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import { toWhatsAppSettingsDTO } from '@/src/mappers/whatsapp-settings.mapper'

vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/lib/env/env', () => ({ NEXT_PUBLIC_URL: 'https://steel.test' }))
vi.mock(
  '@/src/lib/mail/workspace/send-whatsapp-unassigned-conversation',
  () => ({
    sendWhatsAppUnassignedConversationEmail: vi.fn(async () => ({ ok: true })),
  }),
)
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/whatsapp-conversation.repository')
vi.mock('@/src/repositories/whatsapp-settings.repository')
vi.mock('@/src/repositories/workspace.repository')
vi.mock('@/src/repositories/workspace-module-access.repository')
vi.mock('@/src/services/whatsapp-conversation-scope.service', () => ({
  loadWhatsAppTeamSnapshot: vi.fn(),
}))
vi.mock('@/src/services/whatsapp-notify', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../whatsapp-notify')>()),
  notifyWhatsAppUsers: vi.fn(async () => 2),
}))

import { logger } from '@/lib/axiom/logger'
import { sendWhatsAppUnassignedConversationEmail } from '@/src/lib/mail/workspace/send-whatsapp-unassigned-conversation'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppSettingsRepository } from '@/src/repositories/whatsapp-settings.repository'
import { WorkspaceRepository } from '@/src/repositories/workspace.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { loadWhatsAppTeamSnapshot } from '../whatsapp-conversation-scope.service'
import { notifyWhatsAppUsers } from '../whatsapp-notify'
import {
  formatWaitingTime,
  WhatsAppUnassignedAlertService,
} from '../whatsapp-unassigned-alert.service'

const memberships = vi.mocked(MembershipRepository)
const conversations = vi.mocked(WhatsAppConversationRepository)
const settingsRepo = vi.mocked(WhatsAppSettingsRepository)
const workspaces = vi.mocked(WorkspaceRepository)
const moduleAccess = vi.mocked(WorkspaceModuleAccessRepository)
const snapshot = vi.mocked(loadWhatsAppTeamSnapshot)
const notify = vi.mocked(notifyWhatsAppUsers)
const sendEmail = vi.mocked(sendWhatsAppUnassignedConversationEmail)

const NOW = new Date('2026-10-22T15:00:00Z')

function settingsDto(
  overrides: Parameters<typeof createFakeWhatsAppSettings>[0] = {},
) {
  return toWhatsAppSettingsDTO(
    'ws1',
    createFakeWhatsAppSettings({ workspaceId: 'ws1', ...overrides }),
  )
}

function waiting(
  overrides: Parameters<
    typeof createFakeWhatsAppConversationWithPreview
  >[0] = {},
) {
  return createFakeWhatsAppConversationWithPreview({
    id: 'conv1',
    workspaceId: 'ws1',
    teamId: null,
    assignedUserId: null,
    ...overrides,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  memberships.listWithUserByWorkspace.mockResolvedValue(
    ok(
      (
        [
          ['owner', 'OWNER'],
          ['admin', 'ADMIN'],
          ['lia', 'MEMBER'],
          ['ana', 'MEMBER'],
        ] as const
      ).map(([userId, role]) => ({
        ...createFakeMembership({ userId, workspaceId: 'ws1', role }),
        user: {
          id: userId,
          name: `Nome ${userId}`,
          email: `${userId}@x`,
          image: null,
        },
      })),
    ),
  )
  snapshot.mockResolvedValue(
    ok([
      {
        id: 'team1',
        members: [
          { userId: 'lia', role: 'LEADER' },
          { userId: 'ana', role: 'AGENT' },
        ],
      },
    ]),
  )
  workspaces.findById.mockResolvedValue(
    ok({ id: 'ws1', slug: 'acme', name: 'Acme' } as never),
  )
  moduleAccess.isEnabled.mockResolvedValue(ok(true))
  settingsRepo.listAll.mockResolvedValue(ok([]))
  conversations.listUnattendedForReminder.mockResolvedValue(ok([]))
  conversations.claimUnassignedReminder.mockResolvedValue(ok(true))
})

describe('formatWaitingTime()', () => {
  it.each([
    [0, '1 minuto'],
    [1, '1 minuto'],
    [10, '10 minutos'],
    [59.6, '1 hora'],
    [60, '1 hora'],
    [65, '1 hora e 5 min'],
    [120, '2 horas'],
    [185, '3 horas e 5 min'],
  ])('%s min -> %s', (minutes, expected) => {
    expect(formatWaitingTime(minutes)).toBe(expected)
  })
})

describe('WhatsAppUnassignedAlertService.notifySupervisors()', () => {
  it('tells the admins about a conversation with no team', async () => {
    const result = await WhatsAppUnassignedAlertService.notifySupervisors({
      workspaceId: 'ws1',
      conversation: waiting(),
      settings: settingsDto(),
      notice: { kind: 'queued', reason: 'no_team' },
    })

    expect(result).toEqual({ recipients: 2, inApp: 2, email: 0 })
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'WHATSAPP_CONVERSATION_UNATTENDED',
        userIds: ['owner', 'admin'],
        title: 'Conversa aguardando atendente',
        path: '/zap?conversa=conv1',
      }),
    )
    expect(notify.mock.calls[0][0].body).toContain('sem equipe nem atendente')
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('uses the recipients configured for the sentiment alert', async () => {
    await WhatsAppUnassignedAlertService.notifySupervisors({
      workspaceId: 'ws1',
      conversation: waiting(),
      settings: settingsDto({ sentimentAlertRecipientIds: ['owner'] }),
      notice: { kind: 'queued', reason: 'no_team' },
    })
    expect(notify.mock.calls[0][0].userIds).toEqual(['owner'])
  })

  it('adds the leaders of the conversation team and says why nobody took it', async () => {
    await WhatsAppUnassignedAlertService.notifySupervisors({
      workspaceId: 'ws1',
      conversation: waiting({
        teamId: 'team1',
        team: { id: 'team1', name: 'Vendas' },
      }),
      settings: settingsDto(),
      notice: { kind: 'queued', reason: 'no_agent_available' },
    })
    const call = notify.mock.calls[0][0]
    expect(call.userIds).toEqual(['owner', 'admin', 'lia'])
    expect(call.body).toContain('nenhum atendente pode recebê-la agora')
  })

  it('writes the reminder with the waiting time and the team', async () => {
    await WhatsAppUnassignedAlertService.notifySupervisors({
      workspaceId: 'ws1',
      conversation: waiting({
        teamId: 'team1',
        team: { id: 'team1', name: 'Vendas' },
      }),
      settings: settingsDto(),
      notice: { kind: 'reminder', waitingMinutes: 12 },
    })
    const call = notify.mock.calls[0][0]
    expect(call.title).toBe('Conversa sem atendente há 12 minutos')
    expect(call.body).toContain('na equipe Vendas')
  })

  it('writes the reminder without a team', async () => {
    await WhatsAppUnassignedAlertService.notifySupervisors({
      workspaceId: 'ws1',
      conversation: waiting(),
      settings: settingsDto(),
      notice: { kind: 'reminder', waitingMinutes: 12 },
    })
    expect(notify.mock.calls[0][0].body).not.toContain('equipe')
  })

  it('sends e-mails when the workspace asks for them, and not in-app when it is off', async () => {
    const result = await WhatsAppUnassignedAlertService.notifySupervisors({
      workspaceId: 'ws1',
      conversation: waiting({
        teamId: 'team1',
        team: { id: 'team1', name: 'Vendas' },
      }),
      settings: settingsDto({
        unassignedAlertNotifyInApp: false,
        unassignedAlertNotifyEmail: true,
      }),
      notice: { kind: 'reminder', waitingMinutes: 10 },
    })

    expect(result).toEqual({ recipients: 3, inApp: 0, email: 3 })
    expect(notify).not.toHaveBeenCalled()
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'owner@x',
        workspaceName: 'Acme',
        contactLabel: expect.any(String),
        waitingFor: '10 minutos',
        teamName: 'Vendas',
        redirectUrl: 'https://steel.test/acme/zap?conversa=conv1',
      }),
    )
  })

  it('uses a neutral wait for the e-mail of an immediate notice and survives failures', async () => {
    sendEmail.mockRejectedValueOnce(new Error('mail down'))
    const result = await WhatsAppUnassignedAlertService.notifySupervisors({
      workspaceId: 'ws1',
      conversation: waiting(),
      settings: settingsDto({ unassignedAlertNotifyEmail: true }),
      notice: { kind: 'queued', reason: 'no_team' },
    })
    expect(result.email).toBe(1)
    expect(sendEmail.mock.calls[0][0].waitingFor).toBe('alguns instantes')
    expect(logger.warn).toHaveBeenCalledWith(
      'whatsapp.unassigned_alert.email_failed',
      expect.objectContaining({ failed: 1 }),
    )
  })

  it('skips the e-mail when the workspace cannot be read', async () => {
    workspaces.findById.mockResolvedValue(err(databaseError()))
    const result = await WhatsAppUnassignedAlertService.notifySupervisors({
      workspaceId: 'ws1',
      conversation: waiting(),
      settings: settingsDto({ unassignedAlertNotifyEmail: true }),
      notice: { kind: 'queued', reason: 'no_team' },
    })
    expect(result.email).toBe(0)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('does nothing when both channels are off', async () => {
    const result = await WhatsAppUnassignedAlertService.notifySupervisors({
      workspaceId: 'ws1',
      conversation: waiting(),
      settings: settingsDto({
        unassignedAlertNotifyInApp: false,
        unassignedAlertNotifyEmail: false,
      }),
      notice: { kind: 'queued', reason: 'no_team' },
    })
    expect(result).toEqual({ recipients: 0, inApp: 0, email: 0 })
    expect(memberships.listWithUserByWorkspace).not.toHaveBeenCalled()
  })

  it('does nothing when there is nobody to tell', async () => {
    const result = await WhatsAppUnassignedAlertService.notifySupervisors({
      workspaceId: 'ws1',
      conversation: waiting(),
      settings: settingsDto({ sentimentAlertRecipientIds: ['ghost'] }),
      notice: { kind: 'queued', reason: 'no_team' },
    })
    expect(result.recipients).toBe(0)
    expect(notify).not.toHaveBeenCalled()
  })

  it('logs and gives up when the recipients cannot be loaded', async () => {
    memberships.listWithUserByWorkspace.mockResolvedValue(err(databaseError()))
    const result = await WhatsAppUnassignedAlertService.notifySupervisors({
      workspaceId: 'ws1',
      conversation: waiting(),
      settings: settingsDto(),
      notice: { kind: 'queued', reason: 'no_team' },
    })
    expect(result.recipients).toBe(0)
    expect(logger.warn).toHaveBeenCalledWith(
      'whatsapp.unassigned_alert.recipients_failed',
      expect.any(Object),
    )

    memberships.listWithUserByWorkspace.mockResolvedValue(ok([]))
    snapshot.mockResolvedValue(err(databaseError()))
    await WhatsAppUnassignedAlertService.notifySupervisors({
      workspaceId: 'ws1',
      conversation: waiting(),
      settings: settingsDto(),
      notice: { kind: 'queued', reason: 'no_team' },
    })
    expect(notify).not.toHaveBeenCalled()
  })
})

describe('WhatsAppUnassignedAlertService.remindUnattended()', () => {
  const since = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000)

  it('queries the default window for workspaces that never saved settings', async () => {
    settingsRepo.listAll.mockResolvedValue(
      ok([createFakeWhatsAppSettings({ workspaceId: 'wsX' })]),
    )
    await WhatsAppUnassignedAlertService.remindUnattended(NOW)

    const [query] = conversations.listUnattendedForReminder.mock.calls[0]
    expect(query.workspaceIds).toEqual({ notIn: ['wsX'] })
    expect(query.cutoff).toEqual(since(10))
    expect(query.notBefore).toEqual(since(48 * 60))
  })

  it('groups the saved workspaces by their own reminder time and skips the ones turned off', async () => {
    settingsRepo.listAll.mockResolvedValue(
      ok([
        createFakeWhatsAppSettings({
          workspaceId: 'wsA',
          unassignedReminderMinutes: 5,
        }),
        createFakeWhatsAppSettings({
          workspaceId: 'wsB',
          unassignedReminderMinutes: 5,
        }),
        createFakeWhatsAppSettings({
          workspaceId: 'wsC',
          unassignedReminderMinutes: 30,
        }),
        createFakeWhatsAppSettings({
          workspaceId: 'wsOff',
          unassignedReminderMinutes: 0,
        }),
      ]),
    )
    await WhatsAppUnassignedAlertService.remindUnattended(NOW)

    const queries = conversations.listUnattendedForReminder.mock.calls.map(
      ([query]) => query,
    )
    expect(queries.map((query) => query.workspaceIds)).toEqual([
      { notIn: ['wsA', 'wsB', 'wsC', 'wsOff'] },
      { in: ['wsA', 'wsB'] },
      { in: ['wsC'] },
    ])
    expect(queries.map((query) => query.cutoff)).toEqual([
      since(10),
      since(5),
      since(30),
    ])
  })

  it('sends one reminder per conversation with the time since it entered the queue', async () => {
    conversations.listUnattendedForReminder.mockResolvedValueOnce(
      ok([
        waiting({ id: 'c1', queuedAt: since(25) }),
        waiting({ id: 'c2', queuedAt: null, createdAt: since(14) }),
      ]),
    )
    const result = expectOk(
      await WhatsAppUnassignedAlertService.remindUnattended(NOW),
    )

    expect(result).toEqual({ reminded: 2 })
    expect(conversations.claimUnassignedReminder).toHaveBeenCalledWith(
      'c1',
      NOW,
    )
    expect(notify.mock.calls.map(([call]) => call.title)).toEqual([
      'Conversa sem atendente há 25 minutos',
      'Conversa sem atendente há 14 minutos',
    ])
  })

  it('never reminds twice: a conversation already claimed is skipped', async () => {
    conversations.listUnattendedForReminder.mockResolvedValueOnce(
      ok([waiting({ id: 'c1', queuedAt: since(25) })]),
    )
    conversations.claimUnassignedReminder.mockResolvedValue(ok(false))
    expect(
      expectOk(await WhatsAppUnassignedAlertService.remindUnattended(NOW)),
    ).toEqual({ reminded: 0 })
    expect(notify).not.toHaveBeenCalled()

    conversations.listUnattendedForReminder.mockResolvedValueOnce(
      ok([waiting({ id: 'c1', queuedAt: since(25) })]),
    )
    conversations.claimUnassignedReminder.mockResolvedValue(
      err(databaseError()),
    )
    expect(
      expectOk(await WhatsAppUnassignedAlertService.remindUnattended(NOW)),
    ).toEqual({ reminded: 0 })
  })

  it('leaves alone a workspace without the module (checked once per workspace)', async () => {
    moduleAccess.isEnabled.mockResolvedValue(ok(false))
    conversations.listUnattendedForReminder.mockResolvedValueOnce(
      ok([
        waiting({ id: 'c1', queuedAt: since(25) }),
        waiting({ id: 'c2', queuedAt: since(25) }),
      ]),
    )
    expect(
      expectOk(await WhatsAppUnassignedAlertService.remindUnattended(NOW)),
    ).toEqual({ reminded: 0 })
    expect(moduleAccess.isEnabled).toHaveBeenCalledTimes(1)
    expect(conversations.claimUnassignedReminder).not.toHaveBeenCalled()
  })

  it('uses the settings saved by the workspace for the notice channels', async () => {
    settingsRepo.listAll.mockResolvedValue(
      ok([
        createFakeWhatsAppSettings({
          workspaceId: 'ws1',
          unassignedReminderMinutes: 5,
          unassignedAlertNotifyInApp: false,
        }),
      ]),
    )
    conversations.listUnattendedForReminder
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValueOnce(ok([waiting({ id: 'c1', queuedAt: since(25) })]))
    expect(
      expectOk(await WhatsAppUnassignedAlertService.remindUnattended(NOW)),
    ).toEqual({ reminded: 1 })
    expect(notify).not.toHaveBeenCalled()
  })

  it('keeps going when one group cannot be listed', async () => {
    conversations.listUnattendedForReminder.mockResolvedValueOnce(
      err(databaseError()),
    )
    expectOk(await WhatsAppUnassignedAlertService.remindUnattended(NOW))
    expect(logger.error).toHaveBeenCalledWith(
      'whatsapp.unassigned_alert.list_failed',
      expect.any(Object),
    )
  })

  it('propagates a failure reading the settings', async () => {
    settingsRepo.listAll.mockResolvedValue(err(databaseError()))
    expectErr(await WhatsAppUnassignedAlertService.remindUnattended(NOW))
  })

  it('treats a failed module check as "disabled"', async () => {
    moduleAccess.isEnabled.mockResolvedValue(err(databaseError()))
    conversations.listUnattendedForReminder.mockResolvedValueOnce(
      ok([waiting({ id: 'c1', queuedAt: since(25) })]),
    )
    expect(
      expectOk(await WhatsAppUnassignedAlertService.remindUnattended(NOW)),
    ).toEqual({ reminded: 0 })
  })

  it('defaults to the current time', async () => {
    expectOk(await WhatsAppUnassignedAlertService.remindUnattended())
    expect(conversations.listUnattendedForReminder).toHaveBeenCalled()
  })
})
