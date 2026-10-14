import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../notification-emitter', () => ({
  emitNotification: vi.fn(),
  workspaceAdminIds: vi.fn(),
  workspaceMemberIds: vi.fn(),
  workspaceOwnerIds: vi.fn(),
}))

import {
  emitNotification,
  workspaceAdminIds,
  workspaceMemberIds,
  workspaceOwnerIds,
} from '../notification-emitter'
import {
  notifyAiQuota,
  notifyBillingPaymentFailed,
  notifyBillingSubscriptionCanceled,
  notifyDataExportReady,
  notifyMemberJoined,
  notifyTrialEnded,
  notifyWhatsAppUsage,
} from '../platform-notifications'

const mockedEmit = vi.mocked(emitNotification)

function lastCall() {
  return mockedEmit.mock.calls.at(-1)?.[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedEmit.mockResolvedValue(1)
  vi.mocked(workspaceAdminIds).mockResolvedValue(['o1', 'a1'])
  vi.mocked(workspaceOwnerIds).mockResolvedValue(['o1'])
  vi.mocked(workspaceMemberIds).mockResolvedValue(['o1', 'a1', 'm1'])
})

describe('platform notifications', () => {
  it('member joined: tells the inviter, the new member is the actor', async () => {
    await notifyMemberJoined({
      workspaceId: 'ws1',
      inviterId: 'inviter',
      memberId: 'new',
      memberEmail: 'new@acme.com',
    })
    expect(lastCall()).toEqual({
      workspaceId: 'ws1',
      recipients: ['inviter'],
      actorId: 'new',
      kind: 'MEMBER_JOINED',
      title: 'Convite aceito',
      body: 'new@acme.com aceitou o seu convite e entrou no workspace.',
      path: '/settings/members',
    })
  })

  it('data export ready: one notice per workspace, keyed by export and workspace', async () => {
    expect(
      await notifyDataExportReady({
        userId: 'u1',
        workspaceIds: ['ws1', 'ws2'],
        exportId: 'job-1',
      }),
    ).toBe(2)
    expect(mockedEmit).toHaveBeenCalledTimes(2)
    expect(mockedEmit.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        workspaceId: 'ws2',
        recipients: ['u1'],
        kind: 'DATA_EXPORT_READY',
        dedupeKey: 'data-export:job-1:ws2',
      }),
    )
    // No actor: the requester asked for it and wants the async result.
    expect(lastCall()?.actorId).toBeUndefined()
  })

  it('trial ended: owners and admins, once per day', async () => {
    await notifyTrialEnded({ workspaceId: 'ws1', day: '2026-10-06' })
    expect(lastCall()).toEqual(
      expect.objectContaining({
        recipients: ['o1', 'a1'],
        kind: 'TRIAL_ENDED',
        path: '/settings/billing',
        dedupeKey: 'trial-ended:ws1:2026-10-06',
      }),
    )
  })

  it('billing: payment failed and canceled/expired go to the owners', async () => {
    await notifyBillingPaymentFailed({
      workspaceId: 'ws1',
      billId: 'b1',
      event: 'billing.failed',
    })
    expect(lastCall()).toEqual(
      expect.objectContaining({
        recipients: ['o1'],
        kind: 'BILLING_PAYMENT_FAILED',
        dedupeKey: 'billing:billing.failed:b1',
      }),
    )

    await notifyBillingSubscriptionCanceled({
      workspaceId: 'ws1',
      billId: 'b1',
      expired: false,
    })
    expect(lastCall()).toEqual(
      expect.objectContaining({
        kind: 'BILLING_SUBSCRIPTION_CANCELED',
        title: 'Assinatura cancelada',
        dedupeKey: 'billing:cancelled:b1',
      }),
    )

    await notifyBillingSubscriptionCanceled({
      workspaceId: 'ws1',
      billId: 'b1',
      expired: true,
    })
    expect(lastCall()).toEqual(
      expect.objectContaining({
        title: 'Assinatura expirada',
        dedupeKey: 'billing:expired:b1',
      }),
    )
  })

  it('AI quota: warning and exceeded, once per month per threshold', async () => {
    await notifyAiQuota({
      workspaceId: 'ws1',
      threshold: 'warning',
      period: '2026-10',
    })
    expect(lastCall()).toEqual(
      expect.objectContaining({
        recipients: ['o1', 'a1'],
        kind: 'AI_QUOTA_WARNING',
        path: '/settings/steel-intelligence',
        dedupeKey: 'ai-quota:ws1:2026-10:warning',
      }),
    )

    await notifyAiQuota({
      workspaceId: 'ws1',
      threshold: 'exceeded',
      period: '2026-10',
    })
    expect(lastCall()).toEqual(
      expect.objectContaining({
        kind: 'AI_QUOTA_EXCEEDED',
        title: 'A cota mensal de IA acabou',
        dedupeKey: 'ai-quota:ws1:2026-10:exceeded',
      }),
    )
  })

  it('WhatsApp usage: every member, once per month per metric and threshold', async () => {
    await notifyWhatsAppUsage({
      workspaceId: 'ws1',
      metric: 'messages',
      threshold: 50,
      period: '2026-10',
      used: 5000,
      limit: 10000,
    })
    expect(lastCall()).toEqual({
      workspaceId: 'ws1',
      recipients: ['o1', 'a1', 'm1'],
      kind: 'WHATSAPP_USAGE_WARNING',
      title: 'Mensagens do WhatsApp: 50% do limite mensal',
      body: '5.000 de 10.000 mensagens enviadas neste mês.',
      path: '/settings/communication',
      dedupeKey: 'whatsapp-usage:ws1:2026-10:messages:50',
    })

    await notifyWhatsAppUsage({
      workspaceId: 'ws1',
      metric: 'conversations',
      threshold: 80,
      period: '2026-10',
      used: 800,
      limit: 1000,
    })
    expect(lastCall()).toEqual(
      expect.objectContaining({
        kind: 'WHATSAPP_USAGE_WARNING',
        title: 'Conversas do WhatsApp: 80% do limite mensal',
        body: '800 de 1.000 conversas abertas neste mês.',
        dedupeKey: 'whatsapp-usage:ws1:2026-10:conversations:80',
      }),
    )

    await notifyWhatsAppUsage({
      workspaceId: 'ws1',
      metric: 'messages',
      threshold: 100,
      period: '2026-10',
      used: 10000,
      limit: 10000,
    })
    expect(lastCall()).toEqual(
      expect.objectContaining({
        kind: 'WHATSAPP_USAGE_LIMIT_REACHED',
        title: 'Mensagens do WhatsApp: limite mensal atingido',
        body: 'Os envios ficam bloqueados até o próximo mês ou até um administrador aumentar o limite. Mensagens recebidas continuam chegando.',
        dedupeKey: 'whatsapp-usage:ws1:2026-10:messages:100',
      }),
    )
  })
})
