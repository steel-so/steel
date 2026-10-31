import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSdWfmSettings } from '@/src/__tests__/factories/nov-sd-wfm.factory'
import { createFakeSdOnCallSchedule } from '@/src/__tests__/factories/sd-oncall.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { actAs } from '@/src/__tests__/helpers/sd-config.helpers'
import { databaseError, sdConfigNotFound } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/sd-access.repository')
vi.mock('@/src/repositories/sd-wfm.repository')
vi.mock('@/src/repositories/sd-oncall.repository')
vi.mock('../sd-config-support', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sd-config-support')>()),
  assertSdRefs: vi.fn(),
}))

import { SdOnCallRepository } from '@/src/repositories/sd-oncall.repository'
import { SdWfmRepository } from '@/src/repositories/sd-wfm.repository'
import { assertSdRefs } from '../sd-config-support'
import { SdWfmService } from '../sd-wfm.service'

const wfm = vi.mocked(SdWfmRepository)
const oncall = vi.mocked(SdOnCallRepository)
const refs = vi.mocked(assertSdRefs)
const WS = 'ws1'
// Wednesday 2026-11-04, 12:30 in UTC
const NOW = new Date('2026-11-04T12:30:00Z')

function history(perHour: number) {
  const rows = []
  const base = Math.floor(NOW.getTime() / 3_600_000) * 3_600_000
  for (let i = 0; i < 4 * 168; i++) {
    rows.push({ bucket: new Date(base - i * 3_600_000), count: perHour })
  }
  return rows
}

beforeEach(() => {
  actAs('agent')
  refs.mockResolvedValue(ok(true))
  wfm.findSettings.mockResolvedValue(ok(createFakeSdWfmSettings()))
  wfm.upsertSettings.mockResolvedValue(
    ok(createFakeSdWfmSettings({ historyWeeks: 6 })),
  )
  wfm.findTimeZone.mockResolvedValue(ok('UTC'))
  wfm.hourlyCounts.mockResolvedValue(ok(history(2)))
  wfm.countTeam.mockResolvedValue(ok(3))
  oncall.findActiveForDepartment.mockResolvedValue(ok(null))
  oncall.listOverridesInRange.mockResolvedValue(ok([]))
})

describe('SdWfmService.getSettings', () => {
  it('lets agents read and returns the defaults when nothing is saved', async () => {
    wfm.findSettings.mockResolvedValue(ok(null))
    expect(
      expectOk(await SdWfmService.getSettings('u1', WS)).historyWeeks,
    ).toBe(8)
  })

  it('propagates database errors', async () => {
    wfm.findSettings.mockResolvedValue(err(databaseError()))
    expectErr(await SdWfmService.getSettings('u1', WS), 'DATABASE_ERROR')
  })

  it.each(['requester', 'stranger', 'disabled'] as const)(
    'refuses %s',
    async (actor) => {
      actAs(actor)
      expectErr(await SdWfmService.getSettings('u1', WS))
    },
  )
})

describe('SdWfmService.updateSettings', () => {
  it('saves for admins', async () => {
    actAs('admin')
    const dto = expectOk(
      await SdWfmService.updateSettings('u1', WS, { historyWeeks: 6 }),
    )
    expect(dto.historyWeeks).toBe(6)
    expect(wfm.upsertSettings).toHaveBeenCalledWith(WS, { historyWeeks: 6 })
  })

  it('refuses plain agents', async () => {
    expectErr(
      await SdWfmService.updateSettings('u1', WS, { historyWeeks: 6 }),
      'FORBIDDEN',
    )
    expect(wfm.upsertSettings).not.toHaveBeenCalled()
  })

  it('rejects an invalid shift even if the schema was skipped', async () => {
    actAs('admin')
    expectErr(
      await SdWfmService.updateSettings('u1', WS, {
        shifts: [{ name: 'x', startHour: 5, endHour: 5 }],
      }),
      'SD_WFM_SETTINGS_INVALID',
    )
  })

  it('propagates database errors', async () => {
    actAs('admin')
    wfm.upsertSettings.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdWfmService.updateSettings('u1', WS, { historyWeeks: 6 }),
      'DATABASE_ERROR',
    )
  })
})

describe('SdWfmService.forecast', () => {
  it('builds the heatmap, 7 days of hours, 14 days and the staffing', async () => {
    const dto = expectOk(await SdWfmService.forecast('u1', WS, {}, NOW))
    expect(dto).toMatchObject({
      timeZone: 'UTC',
      insufficientData: false,
      teamSize: 3,
      hasOnCallSchedule: false,
      departmentId: null,
    })
    expect(dto.heatmap).toHaveLength(7)
    expect(dto.hourly).toHaveLength(168)
    expect(dto.daily).toHaveLength(14)
    // shift 08-12 = 4h * 2/h = 8 tickets; capacity 2/h*4h = 8 -> 1 agent
    expect(dto.staffing).toHaveLength(14)
    expect(dto.staffing[0]).toMatchObject({
      shift: 'Dia',
      expected: 8,
      suggestedAgents: 1,
      onCallAgents: null,
      understaffed: false,
      exceedsTeam: false,
    })
  })

  it('flags shifts above the team size when the load is heavy', async () => {
    wfm.hourlyCounts.mockResolvedValue(ok(history(40)))
    const dto = expectOk(await SdWfmService.forecast('u1', WS, {}, NOW))
    expect(dto.staffing[0]).toMatchObject({
      understaffed: true,
      exceedsTeam: true,
    })
  })

  it('compares with the people on call and honours overrides', async () => {
    oncall.findActiveForDepartment.mockResolvedValue(
      ok(createFakeSdOnCallSchedule({ departmentId: null })),
    )
    wfm.hourlyCounts.mockResolvedValue(ok(history(10)))
    const dto = expectOk(await SdWfmService.forecast('u1', WS, {}, NOW))
    expect(dto.hasOnCallSchedule).toBe(true)
    // one layer, one person on call per period; the load needs more than 1
    expect(dto.staffing[0].onCallAgents).toBe(1)
    expect(dto.staffing[0].understaffed).toBe(true)
    expect(oncall.listOverridesInRange).toHaveBeenCalled()
  })

  it('filters by department after validating it', async () => {
    expectOk(
      await SdWfmService.forecast('u1', WS, { departmentId: 'dep-1' }, NOW),
    )
    expect(refs).toHaveBeenCalledWith(WS, { departmentIds: ['dep-1'] })
    expect(wfm.hourlyCounts).toHaveBeenCalledWith(
      WS,
      expect.any(Date),
      NOW,
      'dep-1',
    )
    expect(oncall.findActiveForDepartment).toHaveBeenCalledWith(WS, 'dep-1')

    refs.mockResolvedValue(err(sdConfigNotFound()))
    expectErr(
      await SdWfmService.forecast('u1', WS, { departmentId: 'x' }, NOW),
      'SD_CONFIG_NOT_FOUND',
    )
  })

  it('falls back to São Paulo when the calendar zone is missing or invalid', async () => {
    wfm.findTimeZone.mockResolvedValue(ok(null))
    expect(
      expectOk(await SdWfmService.forecast('u1', WS, {}, NOW)).timeZone,
    ).toBe('America/Sao_Paulo')
    wfm.findTimeZone.mockResolvedValue(ok('Nope/Zone'))
    expect(
      expectOk(await SdWfmService.forecast('u1', WS, {}, NOW)).timeZone,
    ).toBe('America/Sao_Paulo')
  })

  it('reports insufficient data and returns no staffing without shifts', async () => {
    wfm.hourlyCounts.mockResolvedValue(ok([]))
    wfm.findSettings.mockResolvedValue(
      ok(createFakeSdWfmSettings({ shifts: [] })),
    )
    const dto = expectOk(await SdWfmService.forecast('u1', WS, {}, NOW))
    expect(dto.insufficientData).toBe(true)
    expect(dto.staffing).toEqual([])
  })

  it('refuses requesters', async () => {
    actAs('requester')
    expectErr(await SdWfmService.forecast('u1', WS, {}, NOW), 'SD_NOT_AGENT')
  })

  it.each([
    ['findSettings'],
    ['findTimeZone'],
    ['hourlyCounts'],
    ['countTeam'],
  ] as const)('propagates %s failures', async (method) => {
    wfm[method].mockResolvedValue(err(databaseError()) as never)
    expectErr(await SdWfmService.forecast('u1', WS, {}, NOW), 'DATABASE_ERROR')
  })

  it('propagates on-call failures', async () => {
    oncall.findActiveForDepartment.mockResolvedValue(err(databaseError()))
    expectErr(await SdWfmService.forecast('u1', WS, {}, NOW), 'DATABASE_ERROR')
    oncall.findActiveForDepartment.mockResolvedValue(
      ok(createFakeSdOnCallSchedule()),
    )
    oncall.listOverridesInRange.mockResolvedValue(err(databaseError()))
    expectErr(await SdWfmService.forecast('u1', WS, {}, NOW), 'DATABASE_ERROR')
  })
})
