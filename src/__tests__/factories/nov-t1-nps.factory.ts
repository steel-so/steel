import type {
  SatisfactionSurvey,
  SatisfactionSurveyConfig,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'

let counter = 0

export function createFakeSurvey(
  overrides: Partial<SatisfactionSurvey> = {},
): SatisfactionSurvey {
  counter += 1
  const now = new Date('2026-11-03T12:00:00.000Z')
  return {
    id: `survey-${counter}`,
    workspaceId: 'ws-1',
    configId: null,
    kind: 'CSAT',
    trigger: 'CONVERSATION_CLOSED',
    channel: 'WHATSAPP',
    status: 'SENT',
    token: `token${counter}`.padEnd(32, 'x'),
    conversationId: null,
    ticketId: null,
    connectionId: 'conn-1',
    recipientPhone: '5511999990000',
    recipientEmail: null,
    recipientName: 'Ana',
    customerKey: 'contact:c1',
    customerName: 'Ana',
    assigneeUserId: 'u1',
    assigneeName: 'Carlos',
    teamId: null,
    teamName: null,
    score: null,
    comment: null,
    providerMessageId: null,
    failureReason: null,
    scheduledFor: now,
    sentAt: now,
    answeredAt: null,
    expiresAt: new Date(Date.now() + 3_600_000),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export function createFakeSurveyConfig(
  overrides: Partial<SatisfactionSurveyConfig> = {},
): SatisfactionSurveyConfig {
  const now = new Date('2026-11-03T12:00:00.000Z')
  return {
    id: 'cfg-1',
    workspaceId: 'ws-1',
    trigger: 'CONVERSATION_CLOSED',
    kind: 'CSAT',
    enabled: true,
    delayMinutes: 5,
    expiresInHours: 72,
    cooldownDays: 30,
    emailFallback: true,
    alertDetractors: true,
    detractorMaxScore: null,
    questionText: null,
    thankYouText: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export async function seedSurvey(
  workspaceId: string,
  overrides: Partial<SatisfactionSurvey> = {},
): Promise<SatisfactionSurvey> {
  counter += 1
  const {
    id: _id,
    createdAt: _c,
    updatedAt: _u,
    ...rest
  } = createFakeSurvey({
    workspaceId,
    token:
      `seed-token-${counter}-${Math.random().toString(36).slice(2)}`.padEnd(
        24,
        'x',
      ),
    ...overrides,
  })
  return prisma.satisfactionSurvey.create({ data: rest })
}
