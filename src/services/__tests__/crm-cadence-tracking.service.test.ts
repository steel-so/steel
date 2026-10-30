import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeCrmCadenceRun } from '@/src/__tests__/factories/nov-cadence-followups.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import {
  createCadenceClickToken,
  createCadenceOpenToken,
} from '@/src/lib/crm-cadence/tracking'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/crm-cadence.repository')
vi.mock('@/lib/axiom/logger')

import {
  CrmCadenceEnrollmentRepository,
  CrmCadenceRunRepository,
} from '@/src/repositories/crm-cadence.repository'
import {
  CADENCE_SCANNER_WINDOW_MS,
  CrmCadenceTrackingService,
} from '../crm-cadence-tracking.service'

const runs = vi.mocked(CrmCadenceRunRepository)
const enrollments = vi.mocked(CrmCadenceEnrollmentRepository)

const sentAt = new Date('2026-10-29T15:00:00Z')
const later = new Date(sentAt.getTime() + 60 * 60_000)
const URL = 'https://exemplo.com/proposta'

function tracked(
  overrides: { stopOnClick?: boolean; status?: string; createdAt?: Date } = {},
) {
  return {
    ...createFakeCrmCadenceRun({
      id: 'run1',
      enrollmentId: 'enr1',
      createdAt: overrides.createdAt ?? sentAt,
    }),
    cadence: { stopOnClick: overrides.stopOnClick ?? false },
    enrollment: { status: (overrides.status ?? 'ACTIVE') as 'ACTIVE' },
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  runs.findForTracking.mockResolvedValue(ok(tracked()))
  runs.recordOpen.mockResolvedValue(ok(undefined))
  runs.recordClick.mockResolvedValue(ok(undefined))
  enrollments.finish.mockResolvedValue(ok(1))
})

describe('recordOpen()', () => {
  it('should count the open of a known run', async () => {
    const token = createCadenceOpenToken('run1')
    expect(
      expectOk(await CrmCadenceTrackingService.recordOpen(token, later)),
    ).toBe(true)
    expect(runs.recordOpen).toHaveBeenCalledWith('run1', later)
  })

  it('should ignore a bad token and an unknown run', async () => {
    expect(
      expectOk(await CrmCadenceTrackingService.recordOpen('bad.token', later)),
    ).toBe(false)
    expect(runs.findForTracking).not.toHaveBeenCalled()

    runs.findForTracking.mockResolvedValue(ok(null))
    expect(
      expectOk(
        await CrmCadenceTrackingService.recordOpen(
          createCadenceOpenToken('run1'),
          later,
        ),
      ),
    ).toBe(false)
    expect(runs.recordOpen).not.toHaveBeenCalled()
  })

  it('should propagate database errors', async () => {
    const token = createCadenceOpenToken('run1')
    runs.findForTracking.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmCadenceTrackingService.recordOpen(token, later),
      'DATABASE_ERROR',
    )
    runs.findForTracking.mockResolvedValue(ok(tracked()))
    runs.recordOpen.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmCadenceTrackingService.recordOpen(token, later),
      'DATABASE_ERROR',
    )
  })
})

describe('resolveClick()', () => {
  const token = () => createCadenceClickToken('run1', URL)

  it('should record the click and send the visitor on', async () => {
    expect(
      expectOk(
        await CrmCadenceTrackingService.resolveClick(token(), URL, later),
      ),
    ).toBe(URL)
    expect(runs.recordClick).toHaveBeenCalledWith('run1', later)
    expect(enrollments.finish).not.toHaveBeenCalled()
  })

  it('should refuse a destination the token does not cover', async () => {
    expectErr(
      await CrmCadenceTrackingService.resolveClick(
        token(),
        'https://evil.com',
        later,
      ),
      'CRM_CAMPAIGN_LINK_INVALID',
    )
    expectErr(
      await CrmCadenceTrackingService.resolveClick(
        'x.y',
        'javascript:1',
        later,
      ),
      'CRM_CAMPAIGN_LINK_INVALID',
    )
    expect(runs.recordClick).not.toHaveBeenCalled()
  })

  it('should stop the enrollment on click when the cadence asks for it', async () => {
    runs.findForTracking.mockResolvedValue(ok(tracked({ stopOnClick: true })))
    await CrmCadenceTrackingService.resolveClick(token(), URL, later)
    expect(enrollments.finish).toHaveBeenCalledWith(
      ['enr1'],
      'STOPPED',
      'CLICKED',
      null,
      later,
    )
  })

  it('should also stop a paused enrollment but not a finished one', async () => {
    runs.findForTracking.mockResolvedValue(
      ok(tracked({ stopOnClick: true, status: 'PAUSED' })),
    )
    await CrmCadenceTrackingService.resolveClick(token(), URL, later)
    expect(enrollments.finish).toHaveBeenCalledTimes(1)

    runs.findForTracking.mockResolvedValue(
      ok(tracked({ stopOnClick: true, status: 'REPLIED' })),
    )
    await CrmCadenceTrackingService.resolveClick(token(), URL, later)
    expect(enrollments.finish).toHaveBeenCalledTimes(1)
  })

  it('should count but not act on clicks that look like a security scanner', async () => {
    runs.findForTracking.mockResolvedValue(ok(tracked({ stopOnClick: true })))
    const soon = new Date(sentAt.getTime() + CADENCE_SCANNER_WINDOW_MS - 1)
    await CrmCadenceTrackingService.resolveClick(token(), URL, soon)
    expect(runs.recordClick).toHaveBeenCalled()
    expect(enrollments.finish).not.toHaveBeenCalled()
  })

  it('should keep redirecting when tracking itself fails', async () => {
    runs.findForTracking.mockResolvedValue(err(databaseError()))
    expect(
      expectOk(
        await CrmCadenceTrackingService.resolveClick(token(), URL, later),
      ),
    ).toBe(URL)

    runs.findForTracking.mockResolvedValue(ok(null))
    expect(
      expectOk(
        await CrmCadenceTrackingService.resolveClick(token(), URL, later),
      ),
    ).toBe(URL)

    runs.findForTracking.mockResolvedValue(ok(tracked({ stopOnClick: true })))
    runs.recordClick.mockResolvedValue(err(databaseError()))
    enrollments.finish.mockResolvedValue(err(databaseError()))
    expect(
      expectOk(
        await CrmCadenceTrackingService.resolveClick(token(), URL, later),
      ),
    ).toBe(URL)
  })
})
