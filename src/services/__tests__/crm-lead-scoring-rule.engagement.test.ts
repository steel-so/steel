import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeCrmLeadScoringRule } from '@/src/__tests__/factories/crm-lead.factory'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/lib/axiom/logger')
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/crm-lead-scoring-rule.repository')
vi.mock('@/src/repositories/crm-newsletter-bridge.repository')

import { logger } from '@/lib/axiom/logger'
import { CrmLeadScoringRuleRepository } from '@/src/repositories/crm-lead-scoring-rule.repository'
import { CrmNewsletterBridgeRepository } from '@/src/repositories/crm-newsletter-bridge.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { CrmLeadScoringRuleService as Service } from '../crm-lead-scoring-rule.service'

const rules = vi.mocked(CrmLeadScoringRuleRepository)
const bridge = vi.mocked(CrmNewsletterBridgeRepository)
const membershipRepo = vi.mocked(MembershipRepository)

const rule = (overrides: Parameters<typeof createFakeCrmLeadScoringRule>[0]) =>
  createFakeCrmLeadScoringRule({ workspaceId: 'ws1', ...overrides })

const event = {
  workspaceId: 'ws1',
  personId: 'p1',
  email: 'ana@x.com',
  field: 'newsletter_clicked' as const,
  eventKey: 'issue:is1',
  url: 'https://acme.com/precos?utm=nl',
}

beforeEach(() => {
  vi.clearAllMocks()
  membershipRepo.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role: 'MEMBER' })),
  )
  rules.create.mockImplementation(async (data) => ok(rule({ ...data })))
  rules.update.mockImplementation(async (id, data) => ok(rule({ id, ...data })))
  rules.findById.mockResolvedValue(ok(rule({ id: 'r1' })))
  bridge.findLinkedLeadIds.mockResolvedValue(ok(['l1', 'l2']))
  bridge.awardScoreEvent.mockResolvedValue(ok(true))
})

describe('event rules — create/update normalization', () => {
  it('stores event rules as "contains", keeping the URL filter only on clicks', async () => {
    expectOk(
      await Service.create('u1', 'ws1', {
        field: 'newsletter_opened',
        operator: 'equals',
        value: 'ignored',
        points: 5,
        active: true,
      }),
    )
    expect(rules.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        field: 'newsletter_opened',
        operator: 'contains',
        value: '',
      }),
    )

    expectOk(
      await Service.create('u1', 'ws1', {
        field: 'newsletter_clicked',
        operator: 'is_empty',
        points: 10,
        active: true,
      }),
    )
    expect(rules.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ operator: 'contains', value: '' }),
    )

    expectOk(
      await Service.update('u1', 'ws1', 'r1', {
        field: 'newsletter_clicked',
        value: '/precos',
      }),
    )
    expect(rules.update).toHaveBeenLastCalledWith('r1', {
      field: 'newsletter_clicked',
      operator: 'contains',
      value: '/precos',
    })
  })

  it('passes "include welcome e-mails" through only when given', async () => {
    expectOk(
      await Service.create('u1', 'ws1', {
        field: 'newsletter_opened',
        operator: 'contains',
        points: 5,
        active: true,
        includeWelcome: false,
      }),
    )
    expect(rules.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ includeWelcome: false }),
    )
    expectOk(
      await Service.create('u1', 'ws1', {
        field: 'newsletter_opened',
        operator: 'contains',
        points: 5,
        active: true,
      }),
    )
    expect(rules.create.mock.lastCall?.[0]).not.toHaveProperty('includeWelcome')
    expectOk(await Service.update('u1', 'ws1', 'r1', { includeWelcome: true }))
    expect(rules.update).toHaveBeenLastCalledWith('r1', {
      includeWelcome: true,
    })
  })

  it('leaves field rules untouched', async () => {
    expectOk(await Service.update('u1', 'ws1', 'r1', { points: 3 }))
    expect(rules.update).toHaveBeenLastCalledWith('r1', { points: 3 })
  })
})

describe('applyEngagementEvent', () => {
  it('awards each matching rule to each linked lead, once', async () => {
    rules.listActiveByWorkspace.mockResolvedValue(
      ok([
        rule({ id: 'any', field: 'newsletter_clicked', value: '', points: 5 }),
        rule({
          id: 'pricing',
          field: 'newsletter_clicked',
          value: '/PRECOS',
          points: 20,
        }),
        rule({
          id: 'blog',
          field: 'newsletter_clicked',
          value: '/blog',
          points: 7,
        }),
        rule({ id: 'open', field: 'newsletter_opened', points: 1 }),
        rule({ id: 'city', field: 'city', operator: 'equals', value: 'x' }),
      ]),
    )
    bridge.awardScoreEvent.mockResolvedValueOnce(ok(false))

    expect(expectOk(await Service.applyEngagementEvent(event))).toBe(3)
    expect(bridge.findLinkedLeadIds).toHaveBeenCalledWith(
      'ws1',
      'p1',
      'ana@x.com',
    )
    expect(
      bridge.awardScoreEvent.mock.calls.map((c) => [
        c[0].leadId,
        c[0].ruleId,
        c[0].points,
        c[0].eventKey,
      ]),
    ).toEqual([
      ['l1', 'any', 5, 'issue:is1'],
      ['l1', 'pricing', 20, 'issue:is1'],
      ['l2', 'any', 5, 'issue:is1'],
      ['l2', 'pricing', 20, 'issue:is1'],
    ])
    expect(logger.info).toHaveBeenCalledWith(
      'crm.lead.engagement_scored',
      expect.objectContaining({ awarded: 3 }),
    )
  })

  it('skips rules that leave the welcome e-mails out', async () => {
    rules.listActiveByWorkspace.mockResolvedValue(
      ok([
        rule({ id: 'all', field: 'newsletter_clicked', value: '' }),
        rule({
          id: 'issues',
          field: 'newsletter_clicked',
          value: '',
          includeWelcome: false,
        }),
      ]),
    )
    bridge.findLinkedLeadIds.mockResolvedValue(ok(['l1']))
    const welcome = {
      ...event,
      eventKey: 'welcome:st1:s1',
      source: 'welcome' as const,
    }
    expect(expectOk(await Service.applyEngagementEvent(welcome))).toBe(1)
    expect(bridge.awardScoreEvent).toHaveBeenCalledTimes(1)
    expect(bridge.awardScoreEvent).toHaveBeenCalledWith(
      expect.objectContaining({ ruleId: 'all', eventKey: 'welcome:st1:s1' }),
    )
  })

  it('does not look up leads when no rule matches', async () => {
    rules.listActiveByWorkspace.mockResolvedValue(
      ok([rule({ field: 'newsletter_opened' })]),
    )
    expect(expectOk(await Service.applyEngagementEvent(event))).toBe(0)
    expect(bridge.findLinkedLeadIds).not.toHaveBeenCalled()
  })

  it('logs nothing when every award was already given', async () => {
    rules.listActiveByWorkspace.mockResolvedValue(
      ok([rule({ field: 'newsletter_clicked' })]),
    )
    bridge.awardScoreEvent.mockResolvedValue(ok(false))
    expect(expectOk(await Service.applyEngagementEvent(event))).toBe(0)
    expect(logger.info).not.toHaveBeenCalled()
  })

  it('propagates database errors', async () => {
    rules.listActiveByWorkspace.mockResolvedValueOnce(err(databaseError()))
    expectErr(await Service.applyEngagementEvent(event), 'DATABASE_ERROR')

    rules.listActiveByWorkspace.mockResolvedValue(
      ok([rule({ field: 'newsletter_clicked' })]),
    )
    bridge.findLinkedLeadIds.mockResolvedValueOnce(err(databaseError()))
    expectErr(await Service.applyEngagementEvent(event), 'DATABASE_ERROR')

    bridge.awardScoreEvent.mockResolvedValueOnce(err(databaseError()))
    expectErr(await Service.applyEngagementEvent(event), 'DATABASE_ERROR')
  })
})
