import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import {
  createFakeWaDashboardActionRun,
  createFakeWaDashboardBroadcastRecipient,
  createFakeWaDashboardCost,
  createFakeWaDashboardMessage,
  createFakeWaDashboardTemplate,
} from '@/src/__tests__/factories/whatsapp-dashboard-messaging.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/whatsapp-dashboard-source.repository')
vi.mock('@/src/repositories/whatsapp-dashboard-messaging.repository')
vi.mock('@/lib/axiom/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

import { logger } from '@/lib/axiom/logger'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppDashboardMessagingRepository } from '@/src/repositories/whatsapp-dashboard-messaging.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { WA_DASHBOARD_ROW_LIMITS } from '@/src/schemas/whatsapp-dashboard.schema'
import { WhatsAppDashboardSourceService } from '../whatsapp-dashboard-source.service'

const repo = vi.mocked(WhatsAppDashboardMessagingRepository)
const membership = vi.mocked(MembershipRepository)
const moduleAccess = vi.mocked(WorkspaceModuleAccessRepository)
const WS = 'ws1'
const NOW = new Date('2026-11-18T12:00:00.000Z')
const SINCE_MS = NOW.getTime() - 400 * 86_400_000

beforeEach(() => {
  membership.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role: 'VIEWER' })),
  )
  moduleAccess.isEnabled.mockResolvedValue(ok(true))
})

describe('WhatsAppDashboardSourceService.rows (messaging sources)', () => {
  it('should refuse who is not a member before reading any source', async () => {
    membership.findByUserAndWorkspace.mockResolvedValue(ok(null))

    expectErr(
      await WhatsAppDashboardSourceService.rows('u1', WS, 'whatsapp-messages'),
    )
    expect(repo.messages).not.toHaveBeenCalled()
  })

  it('should map the messages over the history window', async () => {
    repo.messages.mockResolvedValue(ok([createFakeWaDashboardMessage()]))

    const rows = expectOk(
      await WhatsAppDashboardSourceService.rows(
        'u1',
        WS,
        'whatsapp-messages',
        NOW,
      ),
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ direction: 'Enviada', author: 'Sistema' })
    const [workspaceId, since, limit] = repo.messages.mock.calls[0]
    expect(workspaceId).toBe(WS)
    expect(since.getTime()).toBe(SINCE_MS)
    expect(limit).toBe(WA_DASHBOARD_ROW_LIMITS['whatsapp-messages'])
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('should log when the messages hit the row limit', async () => {
    const message = createFakeWaDashboardMessage()
    repo.messages.mockResolvedValue(
      ok(
        Array.from(
          { length: WA_DASHBOARD_ROW_LIMITS['whatsapp-messages'] },
          () => message,
        ),
      ),
    )

    expectOk(
      await WhatsAppDashboardSourceService.rows('u1', WS, 'whatsapp-messages'),
    )

    expect(logger.warn).toHaveBeenCalledWith(
      'whatsapp.dashboard.source_truncated',
      expect.objectContaining({ workspaceId: WS, source: 'whatsapp-messages' }),
    )
  })

  it('should map the broadcast recipients with their deliveries', async () => {
    repo.broadcastRecipientData.mockResolvedValue(
      ok({
        recipients: [
          createFakeWaDashboardBroadcastRecipient({ providerMessageId: 'w1' }),
        ],
        deliveries: [{ providerMessageId: 'w1', status: 'READ' }],
      }),
    )

    const rows = expectOk(
      await WhatsAppDashboardSourceService.rows(
        'u1',
        WS,
        'whatsapp-broadcast-recipients',
        NOW,
      ),
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      broadcast: 'Black Friday',
      delivery: 'Lida',
    })
    const [workspaceId, since, limit] =
      repo.broadcastRecipientData.mock.calls[0]
    expect(workspaceId).toBe(WS)
    expect(since.getTime()).toBe(SINCE_MS)
    expect(limit).toBe(WA_DASHBOARD_ROW_LIMITS['whatsapp-broadcast-recipients'])
  })

  it('should map the templates without a history window', async () => {
    repo.templates.mockResolvedValue(ok([createFakeWaDashboardTemplate()]))

    const rows = expectOk(
      await WhatsAppDashboardSourceService.rows(
        'u1',
        WS,
        'whatsapp-templates',
        NOW,
      ),
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      name: 'oferta_black_friday',
      status: 'Aprovado',
    })
    expect(repo.templates).toHaveBeenCalledWith(
      WS,
      WA_DASHBOARD_ROW_LIMITS['whatsapp-templates'],
    )
  })

  it('should map the message costs over the history window', async () => {
    repo.costData.mockResolvedValue(
      ok({
        entries: [createFakeWaDashboardCost()],
        broadcasts: [],
        aiCampaigns: [],
      }),
    )

    const rows = expectOk(
      await WhatsAppDashboardSourceService.rows(
        'u1',
        WS,
        'whatsapp-costs',
        NOW,
      ),
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ category: 'Marketing', amount: 0.3625 })
    const [workspaceId, since, limit] = repo.costData.mock.calls[0]
    expect(workspaceId).toBe(WS)
    expect(since.getTime()).toBe(SINCE_MS)
    expect(limit).toBe(WA_DASHBOARD_ROW_LIMITS['whatsapp-costs'])
  })

  it('should map the AI campaign actions over the history window', async () => {
    repo.aiCampaignActionRuns.mockResolvedValue(
      ok([createFakeWaDashboardActionRun()]),
    )

    const rows = expectOk(
      await WhatsAppDashboardSourceService.rows(
        'u1',
        WS,
        'whatsapp-ai-campaign-actions',
        NOW,
      ),
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ campaign: 'Santander', status: 'Sucesso' })
    const [workspaceId, since, limit] = repo.aiCampaignActionRuns.mock.calls[0]
    expect(workspaceId).toBe(WS)
    expect(since.getTime()).toBe(SINCE_MS)
    expect(limit).toBe(WA_DASHBOARD_ROW_LIMITS['whatsapp-ai-campaign-actions'])
  })

  it('should propagate a repository failure of every source', async () => {
    const failure = err(databaseError('boom'))
    repo.messages.mockResolvedValue(failure)
    repo.broadcastRecipientData.mockResolvedValue(failure)
    repo.templates.mockResolvedValue(failure)
    repo.costData.mockResolvedValue(failure)
    repo.aiCampaignActionRuns.mockResolvedValue(failure)

    for (const source of [
      'whatsapp-messages',
      'whatsapp-broadcast-recipients',
      'whatsapp-templates',
      'whatsapp-costs',
      'whatsapp-ai-campaign-actions',
    ] as const) {
      expectErr(
        await WhatsAppDashboardSourceService.rows('u1', WS, source),
        'DATABASE_ERROR',
      )
    }
  })
})
