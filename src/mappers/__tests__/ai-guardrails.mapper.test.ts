import { Prisma } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { createFakeWorkspaceAiGuardrails } from '@/src/__tests__/factories/ai-guardrails.factory'
import {
  DEFAULT_AI_GUARDRAILS,
  toEffectiveAiGuardrails,
  toWorkspaceAiGuardrailsDTO,
} from '../ai-guardrails.mapper'

describe('ai guardrails mapper', () => {
  it('should fall back to the defaults without a row (a fresh copy)', () => {
    const effective = toEffectiveAiGuardrails(null)
    expect(effective).toEqual(DEFAULT_AI_GUARDRAILS)
    effective.limits.forbiddenTopics.push('x')
    expect(DEFAULT_AI_GUARDRAILS.limits.forbiddenTopics).toEqual([])
  })

  it('should read the saved row, converting the refund decimal', () => {
    const row = createFakeWorkspaceAiGuardrails({
      piiMaskingPolicy: 'EVERYWHERE',
      injectionClassifierEnabled: true,
      forbiddenTopics: ['jurídico'],
      maxDiscountPercent: 5,
      maxRefundAmount: new Prisma.Decimal('150.50'),
      maxDeadlineDays: 7,
    })
    expect(toEffectiveAiGuardrails(row)).toEqual({
      piiMaskingPolicy: 'EVERYWHERE',
      injectionClassifierEnabled: true,
      limits: {
        forbiddenTopics: ['jurídico'],
        maxDiscountPercent: 5,
        maxRefundAmount: 150.5,
        maxDeadlineDays: 7,
      },
    })
    expect(
      toWorkspaceAiGuardrailsDTO({ workspaceId: 'ws1', row, canManage: false }),
    ).toEqual({
      workspaceId: 'ws1',
      piiMaskingPolicy: 'EVERYWHERE',
      injectionClassifierEnabled: true,
      forbiddenTopics: ['jurídico'],
      maxDiscountPercent: 5,
      maxRefundAmount: 150.5,
      maxDeadlineDays: 7,
      updatedAt: '2026-10-18T12:00:00.000Z',
      canManage: false,
    })
  })

  it('should build the default DTO without a row', () => {
    expect(
      toWorkspaceAiGuardrailsDTO({
        workspaceId: 'ws1',
        row: null,
        canManage: true,
      }),
    ).toMatchObject({
      piiMaskingPolicy: 'AUTO_REPLIES',
      maxRefundAmount: null,
      updatedAt: null,
      canManage: true,
    })
  })
})
