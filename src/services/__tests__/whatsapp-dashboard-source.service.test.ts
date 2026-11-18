import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeWaDashboardRecipient } from '@/src/__tests__/factories/whatsapp-dashboard.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/whatsapp-dashboard-source.repository')
vi.mock('@/lib/axiom/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

import { logger } from '@/lib/axiom/logger'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppDashboardSourceRepository } from '@/src/repositories/whatsapp-dashboard-source.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { WA_DASHBOARD_ROW_LIMITS } from '@/src/schemas/whatsapp-dashboard.schema'
import { WhatsAppDashboardSourceService } from '../whatsapp-dashboard-source.service'

const repo = vi.mocked(WhatsAppDashboardSourceRepository)
const membership = vi.mocked(MembershipRepository)
const moduleAccess = vi.mocked(WorkspaceModuleAccessRepository)
const WS = 'ws1'
const SOURCE = 'whatsapp-ai-campaign-recipients'
const NOW = new Date('2026-11-18T12:00:00.000Z')

function dataWith(count: number) {
  const recipient = createFakeWaDashboardRecipient()
  return {
    recipients: Array.from({ length: count }, () => ({ ...recipient })),
    conversations: [],
    buttonReplies: [],
    humanReplies: [],
    deliveries: [],
  }
}

beforeEach(() => {
  membership.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role: 'VIEWER' })),
  )
  moduleAccess.isEnabled.mockResolvedValue(ok(true))
})

describe('WhatsAppDashboardSourceService.rows', () => {
  it('should refuse who is not a member of the workspace', async () => {
    membership.findByUserAndWorkspace.mockResolvedValue(ok(null))

    expectErr(await WhatsAppDashboardSourceService.rows('u1', WS, SOURCE))
    expect(repo.aiCampaignRecipientData).not.toHaveBeenCalled()
  })

  it('should refuse when the module is disabled', async () => {
    moduleAccess.isEnabled.mockResolvedValue(ok(false))

    expectErr(
      await WhatsAppDashboardSourceService.rows('u1', WS, SOURCE),
      'MODULE_DISABLED',
    )
    expect(repo.aiCampaignRecipientData).not.toHaveBeenCalled()
  })

  it('should map the recipients over the history window', async () => {
    repo.aiCampaignRecipientData.mockResolvedValue(ok(dataWith(1)))

    const rows = expectOk(
      await WhatsAppDashboardSourceService.rows('u1', WS, SOURCE, NOW),
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      campaign: 'Santander',
      response: 'Sem retorno',
    })
    const [workspaceId, since, limit] =
      repo.aiCampaignRecipientData.mock.calls[0]
    expect(workspaceId).toBe(WS)
    expect(limit).toBe(WA_DASHBOARD_ROW_LIMITS[SOURCE])
    expect(since.getTime()).toBe(NOW.getTime() - 400 * 86_400_000)
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('should log when the source hits the row limit', async () => {
    repo.aiCampaignRecipientData.mockResolvedValue(
      ok(dataWith(WA_DASHBOARD_ROW_LIMITS[SOURCE])),
    )

    expectOk(await WhatsAppDashboardSourceService.rows('u1', WS, SOURCE))

    expect(logger.warn).toHaveBeenCalledWith(
      'whatsapp.dashboard.source_truncated',
      expect.objectContaining({ workspaceId: WS, source: SOURCE }),
    )
  })

  it('should propagate a repository failure', async () => {
    repo.aiCampaignRecipientData.mockResolvedValue(err(databaseError('boom')))

    expectErr(
      await WhatsAppDashboardSourceService.rows('u1', WS, SOURCE),
      'DATABASE_ERROR',
    )
  })
})
