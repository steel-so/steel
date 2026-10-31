import type { QaCriterion, QaReview, QaReviewConfig } from '@prisma/client'
import { Prisma } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'

let counter = 0
const NOW = new Date('2026-11-03T12:00:00.000Z')

export function createFakeQaConfig(
  overrides: Partial<QaReviewConfig> = {},
): QaReviewConfig {
  return {
    id: 'qa-cfg-1',
    workspaceId: 'ws-1',
    enabled: true,
    reviewConversations: true,
    reviewTickets: true,
    includeBots: true,
    minMessages: 4,
    lowScoreThreshold: 60,
    alertLowScore: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

export function createFakeQaCriterion(
  overrides: Partial<QaCriterion> = {},
): QaCriterion {
  counter += 1
  return {
    id: `qa-crit-${counter}`,
    workspaceId: 'ws-1',
    key: `crit-${counter}`,
    name: `Critério ${counter}`,
    description: 'Descrição do critério de teste',
    weight: 1,
    appliesTo: 'BOTH',
    active: true,
    position: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

export function createFakeQaReview(
  overrides: Partial<QaReview> = {},
): QaReview {
  counter += 1
  return {
    id: `qa-review-${counter}`,
    workspaceId: 'ws-1',
    subjectType: 'CONVERSATION',
    conversationId: `conv-${counter}`,
    ticketId: null,
    subjectLabel: null,
    status: 'COMPLETED',
    handlerKind: 'HUMAN',
    agentUserId: 'u1',
    agentName: 'Carlos',
    customerName: 'Ana',
    score: 80,
    summary: 'Bom atendimento.',
    criteriaResults: [
      { key: 'tone', name: 'Tom', weight: 2, score: 90, evidence: 'Olá!' },
      {
        key: 'resolution',
        name: 'Resolução',
        weight: 4,
        score: 70,
        evidence: 'Resolvido.',
      },
    ],
    coachingTips: ['Confirme o protocolo antes de encerrar'],
    lowScore: false,
    skipReason: null,
    provider: 'openai',
    model: 'gpt-test',
    inputTokens: 100,
    outputTokens: 50,
    costUsd: new Prisma.Decimal(0.001),
    subjectEndedAt: NOW,
    reviewedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

export async function seedQaReview(
  workspaceId: string,
  overrides: Partial<QaReview> = {},
): Promise<QaReview> {
  const {
    id: _id,
    createdAt: _c,
    updatedAt: _u,
    criteriaResults,
    coachingTips,
    ...rest
  } = createFakeQaReview({
    workspaceId,
    ticketId: null,
    ...overrides,
  })
  return prisma.qaReview.create({
    data: {
      ...rest,
      conversationId:
        overrides.conversationId === undefined && overrides.ticketId
          ? null
          : rest.conversationId,
      criteriaResults: criteriaResults as Prisma.InputJsonValue,
      coachingTips: coachingTips as Prisma.InputJsonValue,
    },
  })
}
