import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeNewsletterIssue } from '@/src/__tests__/factories/newsletter-nl-issues.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, forbidden } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit')
vi.mock('@/src/services/crm-newsletter-issue.service', () => ({
  loadNewsletterScope: vi.fn(),
  loadIssue: vi.fn(),
}))
vi.mock('@/src/repositories/crm-newsletter-ab.repository')
const add = vi.hoisted(() => vi.fn())
vi.mock('@/src/lib/queue/queues', () => ({
  getCrmNewsletterQueue: () => ({ add }),
}))

import { auditMutation } from '@/lib/axiom/audit'
import { CrmNewsletterAbRepository } from '@/src/repositories/crm-newsletter-ab.repository'
import { CrmNewsletterAbService as Service } from '../crm-newsletter-ab.service'
import { loadIssue, loadNewsletterScope } from '../crm-newsletter-issue.service'

const repo = vi.mocked(CrmNewsletterAbRepository)
const scope = vi.mocked(loadNewsletterScope)
const issue = vi.mocked(loadIssue)

const NOW = new Date('2026-10-28T13:00:00.000Z')
const A = ['u1', 'ws1', 'nl1', 'is1'] as const
const SETTINGS = {
  subjectB: 'Assunto B',
  testPercent: 20,
  metric: 'OPENS' as const,
  waitHours: 4,
}
const withTest = (over = {}) =>
  createFakeNewsletterIssue({
    abSubjectB: 'Assunto B',
    abTestPercent: 20,
    abMetric: 'OPENS',
    abWaitHours: 4,
    ...over,
  })

beforeEach(() => {
  vi.clearAllMocks()
  scope.mockResolvedValue(
    ok({ membership: {} as never, newsletter: {} as never }),
  )
  issue.mockResolvedValue(ok(createFakeNewsletterIssue()))
  repo.setSettings.mockResolvedValue(ok(withTest()))
  repo.variantCounts.mockResolvedValue(
    ok([
      { variant: 'A', recipients: 10, sent: 10, opened: 2, clicked: 1 },
      { variant: 'B', recipients: 10, sent: 10, opened: 6, clicked: 0 },
    ]),
  )
  repo.countHeld.mockResolvedValue(ok(80))
})

describe('report()', () => {
  it('without a test or before sending: settings only', async () => {
    expect(expectOk(await Service.report(...A))).toEqual({
      subjectA: 'Novidades de outubro',
      abTest: null,
      variants: [],
      held: 0,
    })
    issue.mockResolvedValueOnce(ok(withTest()))
    const draft = expectOk(await Service.report(...A))
    expect(draft.abTest?.subjectB).toBe('Assunto B')
    expect(draft.variants).toEqual([])
    expect(repo.variantCounts).not.toHaveBeenCalled()
  })

  it('while sending: variants and the held count', async () => {
    issue.mockResolvedValueOnce(
      ok(withTest({ status: 'SENDING', sendingStartedAt: NOW })),
    )
    const report = expectOk(await Service.report(...A))
    expect(report.held).toBe(80)
    expect(report.variants.map((v) => [v.variant, v.openRate])).toEqual([
      ['A', 0.2],
      ['B', 0.6],
    ])
    expect(report.abTest?.decideAt).toBe('2026-10-28T17:00:00.000Z')
  })

  it('denials and errors', async () => {
    scope.mockResolvedValueOnce(err(forbidden()))
    expectErr(await Service.report(...A), 'FORBIDDEN')
    issue.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await Service.report(...A), 'DATABASE_ERROR')
    issue.mockResolvedValue(ok(withTest({ status: 'SENT' })))
    repo.variantCounts.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await Service.report(...A), 'DATABASE_ERROR')
    repo.countHeld.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await Service.report(...A), 'DATABASE_ERROR')
  })
})

describe('set() / clear()', () => {
  it('saves the test on an editable issue and audits', async () => {
    const dto = expectOk(await Service.set(...A, SETTINGS))
    expect(dto.subjectB).toBe('Assunto B')
    expect(repo.setSettings).toHaveBeenCalledWith('is1', {
      abSubjectB: 'Assunto B',
      abTestPercent: 20,
      abMetric: 'OPENS',
      abWaitHours: 4,
      updatedById: 'u1',
    })
    expect(scope).toHaveBeenCalledWith('u1', 'ws1', 'nl1', 'EDIT')
    expect(auditMutation).toHaveBeenCalled()
  })

  it('refuses B equal to A, locked issues and lost races', async () => {
    expectErr(
      await Service.set(...A, {
        ...SETTINGS,
        subjectB: 'Novidades de outubro',
      }),
      'VALIDATION_ERROR',
    )
    issue.mockResolvedValueOnce(
      ok(createFakeNewsletterIssue({ status: 'SENDING' })),
    )
    expectErr(await Service.set(...A, SETTINGS), 'CRM_NEWSLETTER_ISSUE_LOCKED')
    repo.setSettings.mockResolvedValueOnce(ok(null))
    expectErr(await Service.set(...A, SETTINGS), 'CRM_NEWSLETTER_ISSUE_LOCKED')
    repo.setSettings.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await Service.set(...A, SETTINGS), 'DATABASE_ERROR')
    scope.mockResolvedValueOnce(err(forbidden()))
    expectErr(await Service.set(...A, SETTINGS), 'FORBIDDEN')
    issue.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await Service.set(...A, SETTINGS), 'DATABASE_ERROR')
  })

  it('clears the test', async () => {
    expectOk(await Service.clear(...A))
    expect(repo.setSettings).toHaveBeenCalledWith('is1', {
      abSubjectB: null,
      abTestPercent: null,
      abMetric: null,
      abWaitHours: null,
      updatedById: 'u1',
    })
    issue.mockResolvedValueOnce(
      ok(createFakeNewsletterIssue({ status: 'SENT' })),
    )
    expectErr(await Service.clear(...A), 'CRM_NEWSLETTER_ISSUE_LOCKED')
    repo.setSettings.mockResolvedValueOnce(ok(null))
    expectErr(await Service.clear(...A), 'CRM_NEWSLETTER_ISSUE_LOCKED')
    repo.setSettings.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await Service.clear(...A), 'DATABASE_ERROR')
    scope.mockResolvedValueOnce(err(forbidden()))
    expectErr(await Service.clear(...A), 'FORBIDDEN')
    issue.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await Service.clear(...A), 'DATABASE_ERROR')
  })
})

describe('decideDue()', () => {
  it('picks the winner, releases the rest and queues the dispatch', async () => {
    repo.listDueDecisions.mockResolvedValueOnce(
      ok([
        withTest({ status: 'SENDING' }),
        withTest({ id: 'is2', abMetric: null }),
      ]),
    )
    repo.decide
      .mockResolvedValueOnce(ok({ released: 80 }))
      .mockResolvedValueOnce(ok(null))
    expect(expectOk(await Service.decideDue(NOW))).toEqual({
      decided: 1,
      released: 80,
    })
    expect(repo.decide).toHaveBeenCalledWith('is1', 'B', NOW)
    expect(add).toHaveBeenCalledTimes(1)
    expect(add).toHaveBeenCalledWith(
      'dispatch',
      { issueId: 'is1' },
      { jobId: `crm-newsletter-dispatch-is1-ab-${NOW.getTime()}` },
    )
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'apply_winner', actorId: null }),
    )
  })

  it('propagates database errors', async () => {
    repo.listDueDecisions.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await Service.decideDue(NOW), 'DATABASE_ERROR')
    repo.listDueDecisions.mockResolvedValue(ok([withTest()]))
    repo.variantCounts.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await Service.decideDue(NOW), 'DATABASE_ERROR')
    repo.decide.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await Service.decideDue(NOW), 'DATABASE_ERROR')
  })
})
