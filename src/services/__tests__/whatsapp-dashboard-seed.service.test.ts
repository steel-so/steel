import { describe, expect, it, vi } from 'vitest'
import { createFakeCrmDashboard } from '@/src/__tests__/factories/crm-dashboard.factory'
import { createFakeCrmReport } from '@/src/__tests__/factories/crm-report.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/crm-dashboard.repository')
vi.mock('@/src/repositories/crm-report.repository')

import {
  CrmDashboardRepository,
  CrmDashboardWidgetRepository,
} from '@/src/repositories/crm-dashboard.repository'
import { CrmReportRepository } from '@/src/repositories/crm-report.repository'
import { WhatsAppDashboardSeedService } from '../whatsapp-dashboard-seed.service'

const mockedDashboardRepo = vi.mocked(CrmDashboardRepository)
const mockedWidgetRepo = vi.mocked(CrmDashboardWidgetRepository)
const mockedReportRepo = vi.mocked(CrmReportRepository)

const WORKSPACE_ID = 'ws1'
const ACTOR_ID = 'admin1'

function stubEmptyState() {
  mockedDashboardRepo.listByWorkspace.mockResolvedValue(ok([]))
  mockedDashboardRepo.create.mockImplementation(async (data) =>
    ok(
      createFakeCrmDashboard({
        workspaceId: data.workspaceId,
        title: data.title,
      }),
    ),
  )
  mockedWidgetRepo.create.mockResolvedValue(
    ok({
      id: 'w1',
      dashboardId: 'd1',
      type: 'CHART',
      x: 0,
      y: 0,
      w: 4,
      h: 6,
      page: 0,
      config: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  )
  mockedReportRepo.listByWorkspace.mockResolvedValue(ok([]))
  mockedReportRepo.create.mockImplementation(async (data) =>
    ok(createFakeCrmReport({ workspaceId: data.workspaceId, name: data.name })),
  )
}

describe('WhatsAppDashboardSeedService.seedDefaults()', () => {
  it('creates both default dashboards (with their widgets) and both default reports', async () => {
    stubEmptyState()

    const result = await WhatsAppDashboardSeedService.seedDefaults(
      WORKSPACE_ID,
      ACTOR_ID,
    )
    expectOk(result)

    expect(mockedDashboardRepo.create).toHaveBeenCalledTimes(2)
    expect(mockedDashboardRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        createdById: ACTOR_ID,
        title: 'Atendimento',
        module: 'COMMUNICATION',
      }),
    )
    expect(mockedDashboardRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Campanhas', module: 'COMMUNICATION' }),
    )

    // 8 widgets no dashboard "Atendimento" + 7 em "Campanhas"
    expect(mockedWidgetRepo.create).toHaveBeenCalledTimes(15)

    expect(mockedReportRepo.create).toHaveBeenCalledTimes(2)
    expect(mockedReportRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Conversas do WhatsApp',
        source: 'whatsapp_conversation',
        module: 'COMMUNICATION',
      }),
    )
    expect(mockedReportRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Transmissões do WhatsApp',
        source: 'whatsapp_broadcast',
        module: 'COMMUNICATION',
      }),
    )
  })

  it('skips a dashboard/report that already exists (matched by title/name)', async () => {
    stubEmptyState()
    mockedDashboardRepo.listByWorkspace.mockResolvedValue(
      ok([
        createFakeCrmDashboard({
          title: 'Atendimento',
          module: 'COMMUNICATION',
        }),
      ]),
    )
    mockedReportRepo.listByWorkspace.mockResolvedValue(
      ok([
        createFakeCrmReport({
          name: 'Conversas do WhatsApp',
          module: 'COMMUNICATION',
        }),
      ]),
    )

    expectOk(
      await WhatsAppDashboardSeedService.seedDefaults(WORKSPACE_ID, ACTOR_ID),
    )

    expect(mockedDashboardRepo.create).toHaveBeenCalledTimes(1)
    expect(mockedDashboardRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Campanhas' }),
    )
    expect(mockedReportRepo.create).toHaveBeenCalledTimes(1)
    expect(mockedReportRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Transmissões do WhatsApp' }),
    )
  })

  it('does not fail the whole seed when a single widget fails to create', async () => {
    stubEmptyState()
    mockedWidgetRepo.create.mockResolvedValueOnce(
      err(databaseError('Failed to create CRM dashboard widget')),
    )

    const result = await WhatsAppDashboardSeedService.seedDefaults(
      WORKSPACE_ID,
      ACTOR_ID,
    )

    expectOk(result)
    expect(mockedWidgetRepo.create).toHaveBeenCalledTimes(15)
  })

  it('propagates a dashboard creation failure and does not seed reports', async () => {
    stubEmptyState()
    mockedDashboardRepo.create.mockResolvedValueOnce(
      err(databaseError('Failed to create CRM dashboard')),
    )

    const result = await WhatsAppDashboardSeedService.seedDefaults(
      WORKSPACE_ID,
      ACTOR_ID,
    )

    expectErr(result, 'DATABASE_ERROR')
    expect(mockedReportRepo.create).not.toHaveBeenCalled()
  })
})

describe('WhatsAppDashboardSeedService.seedDefaults() failure paths', () => {
  const seed = () =>
    WhatsAppDashboardSeedService.seedDefaults(WORKSPACE_ID, ACTOR_ID)

  it('propagates a failure listing existing dashboards', async () => {
    stubEmptyState()
    mockedDashboardRepo.listByWorkspace.mockResolvedValue(
      err(databaseError('down')),
    )

    expectErr(await seed(), 'DATABASE_ERROR')
    expect(mockedDashboardRepo.create).not.toHaveBeenCalled()
  })

  it('propagates a failure creating the second dashboard', async () => {
    stubEmptyState()
    mockedDashboardRepo.create
      .mockImplementationOnce(async (data) =>
        ok(createFakeCrmDashboard({ title: data.title })),
      )
      .mockResolvedValueOnce(err(databaseError('down')))

    expectErr(await seed(), 'DATABASE_ERROR')
    expect(mockedReportRepo.listByWorkspace).not.toHaveBeenCalled()
  })

  it('propagates a failure listing existing reports', async () => {
    stubEmptyState()
    mockedReportRepo.listByWorkspace.mockResolvedValue(
      err(databaseError('down')),
    )

    expectErr(await seed(), 'DATABASE_ERROR')
    expect(mockedReportRepo.create).not.toHaveBeenCalled()
  })

  it('propagates a failure creating the first report', async () => {
    stubEmptyState()
    mockedReportRepo.create.mockResolvedValueOnce(err(databaseError('down')))

    expectErr(await seed(), 'DATABASE_ERROR')
    expect(mockedReportRepo.create).toHaveBeenCalledTimes(1)
  })

  it('propagates a failure creating the second report', async () => {
    stubEmptyState()
    mockedReportRepo.create
      .mockImplementationOnce(async (data) =>
        ok(createFakeCrmReport({ name: data.name })),
      )
      .mockResolvedValueOnce(err(databaseError('down')))

    expectErr(await seed(), 'DATABASE_ERROR')
    expect(mockedReportRepo.create).toHaveBeenCalledTimes(2)
  })
})
