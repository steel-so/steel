import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeWorkspaceAiGuardrails } from '@/src/__tests__/factories/ai-guardrails.factory'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/ai-guardrails.repository')

import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { WorkspaceAiGuardrailsRepository } from '@/src/repositories/ai-guardrails.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import {
  AiGuardrailsService,
  checkAutoReplyGuardrails,
  reportAutoReplyGuardrailHit,
  shouldMaskPii,
} from '../ai-guardrails.service'

const repo = vi.mocked(WorkspaceAiGuardrailsRepository)
const memberships = vi.mocked(MembershipRepository)
const audit = vi.mocked(auditMutation)

function asRole(role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER' | null) {
  memberships.findByUserAndWorkspace.mockResolvedValue(
    ok(role ? createFakeMembership({ role }) : null),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  repo.findByWorkspace.mockResolvedValue(ok(null))
  repo.upsert.mockImplementation(async (workspaceId, data) =>
    ok(
      createFakeWorkspaceAiGuardrails({
        workspaceId,
        piiMaskingPolicy: data.piiMaskingPolicy,
        injectionClassifierEnabled: data.injectionClassifierEnabled,
        forbiddenTopics: data.forbiddenTopics as string[],
        maxDiscountPercent: data.maxDiscountPercent ?? null,
        maxRefundAmount:
          data.maxRefundAmount === null || data.maxRefundAmount === undefined
            ? null
            : new Prisma.Decimal(data.maxRefundAmount as number),
        maxDeadlineDays: data.maxDeadlineDays ?? null,
      }),
    ),
  )
})

describe('shouldMaskPii()', () => {
  it('should follow the policy', () => {
    expect(shouldMaskPii('OFF', 'WHATSAPP_REPLY')).toBe(false)
    expect(shouldMaskPii('AUTO_REPLIES', 'WHATSAPP_REPLY')).toBe(true)
    expect(shouldMaskPii('AUTO_REPLIES', 'SERVICEDESK_PRE_SERVICE')).toBe(true)
    expect(shouldMaskPii('AUTO_REPLIES', 'STEEL_ASSISTANT')).toBe(false)
    expect(shouldMaskPii('EVERYWHERE', 'STEEL_AGENT')).toBe(true)
  })
})

describe('AiGuardrailsService.get()', () => {
  it('should refuse a non-member', async () => {
    asRole(null)
    expectErr(await AiGuardrailsService.get('u1', 'ws1'), 'FORBIDDEN')
  })

  it('should let a member read the defaults without manage rights', async () => {
    asRole('MEMBER')
    const dto = expectOk(await AiGuardrailsService.get('u1', 'ws1'))
    expect(dto).toMatchObject({
      workspaceId: 'ws1',
      piiMaskingPolicy: 'AUTO_REPLIES',
      canManage: false,
    })
  })

  it('should flag admins as able to manage and propagate DB errors', async () => {
    asRole('ADMIN')
    expect(expectOk(await AiGuardrailsService.get('u1', 'ws1')).canManage).toBe(
      true,
    )
    repo.findByWorkspace.mockResolvedValue(err(databaseError()))
    expectErr(await AiGuardrailsService.get('u1', 'ws1'), 'DATABASE_ERROR')
  })
})

describe('AiGuardrailsService.update()', () => {
  it.each(['MEMBER', 'VIEWER'] as const)('should refuse a %s', async (role) => {
    asRole(role)
    expectErr(
      await AiGuardrailsService.update('u1', 'ws1', {
        piiMaskingPolicy: 'OFF',
      }),
      'FORBIDDEN',
    )
    expect(repo.upsert).not.toHaveBeenCalled()
  })

  it('should save, audit counts only and return the DTO', async () => {
    asRole('OWNER')
    const dto = expectOk(
      await AiGuardrailsService.update('u1', 'ws1', {
        piiMaskingPolicy: 'EVERYWHERE',
        injectionClassifierEnabled: true,
        forbiddenTopics: ['processo judicial', 'portabilidade'],
        maxDiscountPercent: 10,
        maxRefundAmount: 200,
        maxDeadlineDays: 15,
      }),
    )
    expect(dto).toMatchObject({
      piiMaskingPolicy: 'EVERYWHERE',
      forbiddenTopics: ['processo judicial', 'portabilidade'],
      maxRefundAmount: 200,
      canManage: true,
    })
    expect(repo.upsert).toHaveBeenCalledWith(
      'ws1',
      expect.objectContaining({ updatedById: 'u1' }),
    )
    const meta = audit.mock.calls[0][0].meta
    expect(meta).toMatchObject({
      piiMaskingPolicy: 'EVERYWHERE',
      previousPiiMaskingPolicy: 'AUTO_REPLIES',
      forbiddenTopics: 2,
    })
    expect(JSON.stringify(meta)).not.toContain('portabilidade')
  })

  it('should keep what the patch leaves out and clear limits with null', async () => {
    asRole('ADMIN')
    repo.findByWorkspace.mockResolvedValue(
      ok(
        createFakeWorkspaceAiGuardrails({
          piiMaskingPolicy: 'OFF',
          forbiddenTopics: ['jurídico'],
          maxDiscountPercent: 5,
          maxRefundAmount: new Prisma.Decimal(50),
          maxDeadlineDays: 3,
        }),
      ),
    )
    const dto = expectOk(
      await AiGuardrailsService.update('u1', 'ws1', {
        maxDiscountPercent: null,
      }),
    )
    expect(dto).toMatchObject({
      piiMaskingPolicy: 'OFF',
      forbiddenTopics: ['jurídico'],
      maxDiscountPercent: null,
      maxRefundAmount: 50,
      maxDeadlineDays: 3,
    })
    expectOk(
      await AiGuardrailsService.update('u1', 'ws1', {
        maxRefundAmount: null,
        maxDeadlineDays: null,
      }),
    )
    expect(repo.upsert).toHaveBeenLastCalledWith(
      'ws1',
      expect.objectContaining({
        maxDiscountPercent: 5,
        maxRefundAmount: null,
        maxDeadlineDays: null,
      }),
    )
  })

  it('should propagate read and write failures', async () => {
    asRole('ADMIN')
    repo.findByWorkspace.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await AiGuardrailsService.update('u1', 'ws1', {}),
      'DATABASE_ERROR',
    )
    repo.upsert.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await AiGuardrailsService.update('u1', 'ws1', {}),
      'DATABASE_ERROR',
    )
    expect(audit).not.toHaveBeenCalled()
  })
})

describe('AiGuardrailsService.loadEffective()', () => {
  it('should return the guardrails in force or the error', async () => {
    expect(
      expectOk(await AiGuardrailsService.loadEffective('ws1')).piiMaskingPolicy,
    ).toBe('AUTO_REPLIES')
    repo.findByWorkspace.mockResolvedValue(err(databaseError()))
    expectErr(await AiGuardrailsService.loadEffective('ws1'), 'DATABASE_ERROR')
  })
})

describe('checkAutoReplyGuardrails()', () => {
  const guardrails = {
    piiMaskingPolicy: 'AUTO_REPLIES' as const,
    injectionClassifierEnabled: false,
    limits: {
      forbiddenTopics: ['cancelamento'],
      maxDiscountPercent: null,
      maxRefundAmount: null,
      maxDeadlineDays: null,
    },
  }
  const guard = (tainted: boolean) => ({
    report: {
      piiCounts: { EMAIL: 0, CNPJ: 0, CPF: 0, CARD: 0, PHONE: 0 },
      injection: { detected: tainted, signals: [], sources: [] },
      failovers: [],
    },
    tainted: () => tainted,
  })

  it('should hand off on a prompt injection first', () => {
    expect(
      checkAutoReplyGuardrails(
        { guard: guard(true), guardrails },
        { inbound: 'oi', reply: 'oi' },
      ),
    ).toMatchObject({ kind: 'prompt_injection' })
  })

  it('should apply the limits, and pass without guardrails', () => {
    expect(
      checkAutoReplyGuardrails(
        { guard: guard(false), guardrails },
        { inbound: 'quero o cancelamento', reply: 'ok' },
      ),
    ).toMatchObject({ kind: 'forbidden_topic' })
    expect(
      checkAutoReplyGuardrails({}, { inbound: 'cancelamento', reply: 'ok' }),
    ).toBeNull()
  })
})

describe('reportAutoReplyGuardrailHit()', () => {
  it('should log and audit the kind, never the texts', () => {
    reportAutoReplyGuardrailHit({
      workspaceId: 'ws1',
      feature: 'WHATSAPP_REPLY',
      kind: 'discount',
      targetType: 'whatsapp_conversation',
      targetId: 'c1',
    })
    expect(logger.warn).toHaveBeenCalledWith(
      'ai.auto_reply_guardrail_hit',
      expect.objectContaining({ kind: 'discount', targetId: 'c1' }),
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'ai_guardrail',
        action: 'escalate',
        targetId: 'c1',
        meta: expect.objectContaining({ kind: 'discount' }),
      }),
    )
  })
})
