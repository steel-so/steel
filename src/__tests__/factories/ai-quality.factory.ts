import { createId } from '@paralleldrive/cuid2'
import {
  type AiEvalCase,
  type AiEvalResult,
  type AiEvalRun,
  type AiEvalSet,
  type AiFeedback,
  Prisma,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import type {
  AiEvalClaimedRun,
  AiEvalRunWithResults,
  AiEvalRunWithUser,
  AiEvalSetSummary,
  AiEvalSetWithCases,
} from '@/src/repositories/ai-eval.repository'

const NOW = new Date('2026-10-18T12:00:00.000Z')

export function createFakeAiFeedback(
  overrides?: Partial<AiFeedback>,
): AiFeedback {
  return {
    id: createId(),
    workspaceId: createId(),
    userId: createId(),
    surface: 'STEEL_AI_MESSAGE',
    targetId: createId(),
    variant: '',
    rating: 'UP',
    reason: null,
    comment: null,
    modelKey: 'openai:gpt-4o-mini',
    module: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

export function createFakeAiEvalSet(overrides?: Partial<AiEvalSet>): AiEvalSet {
  return {
    id: createId(),
    workspaceId: createId(),
    name: 'Perguntas do suporte',
    description: null,
    target: 'STEEL_ASSISTANT',
    skillId: null,
    createdById: createId(),
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

export function createFakeAiEvalCase(
  overrides?: Partial<AiEvalCase>,
): AiEvalCase {
  return {
    id: createId(),
    setId: createId(),
    input: 'Qual o prazo de SLA de um incidente crítico?',
    expected: 'Quatro horas.',
    criteria: null,
    mustContain: [],
    mustNotContain: [],
    sourceMessageId: null,
    position: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

export function createFakeAiEvalRun(overrides?: Partial<AiEvalRun>): AiEvalRun {
  return {
    id: createId(),
    workspaceId: createId(),
    setId: createId(),
    status: 'QUEUED',
    modelKey: null,
    judgeModelKey: null,
    skillId: null,
    promptOverride: null,
    reason: 'manual',
    startedById: createId(),
    caseCount: 1,
    passedCount: 0,
    failedCount: 0,
    avgScore: null,
    costUsd: new Prisma.Decimal(0),
    error: null,
    startedAt: null,
    finishedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

export function createFakeAiEvalRunWithUser(
  overrides?: Partial<AiEvalRunWithUser>,
): AiEvalRunWithUser {
  return {
    ...createFakeAiEvalRun(overrides),
    startedBy: { id: 'user_1', name: 'Ana' },
    ...overrides,
  }
}

export function createFakeAiEvalResult(
  overrides?: Partial<AiEvalResult>,
): AiEvalResult {
  return {
    id: createId(),
    runId: createId(),
    caseId: createId(),
    input: 'Pergunta',
    output: 'Resposta',
    passed: true,
    checksPassed: true,
    failedChecks: [],
    judgeScore: 0.9,
    judgePassed: true,
    judgeRationale: 'Correta.',
    inputTokens: 10,
    outputTokens: 5,
    costUsd: new Prisma.Decimal(0.001),
    error: null,
    createdAt: NOW,
    ...overrides,
  }
}

export function createFakeAiEvalRunWithResults(
  overrides?: Partial<AiEvalRunWithResults>,
): AiEvalRunWithResults {
  return {
    ...createFakeAiEvalRunWithUser(overrides),
    results: [createFakeAiEvalResult()],
    ...overrides,
  }
}

export function createFakeAiEvalSetSummary(
  overrides?: Partial<AiEvalSetSummary>,
): AiEvalSetSummary {
  return {
    ...createFakeAiEvalSet(overrides),
    caseCount: 1,
    lastRun: null,
    ...overrides,
  }
}

export function createFakeAiEvalSetWithCases(
  overrides?: Partial<AiEvalSetWithCases>,
): AiEvalSetWithCases {
  return {
    ...createFakeAiEvalSetSummary(overrides),
    cases: [createFakeAiEvalCase()],
    ...overrides,
  }
}

export function createFakeAiEvalClaimedRun(
  overrides?: Partial<AiEvalRun>,
  set?: Partial<AiEvalSet>,
  cases: AiEvalCase[] = [createFakeAiEvalCase()],
): AiEvalClaimedRun {
  const run = createFakeAiEvalRun({ status: 'RUNNING', ...overrides })
  return {
    ...run,
    caseCount: overrides?.caseCount ?? cases.length,
    set: {
      ...createFakeAiEvalSet({
        id: run.setId,
        workspaceId: run.workspaceId,
        ...set,
      }),
      cases,
    },
  }
}

// ─── Seeds (integration) ─────────────────────────────────────────────────────

export async function seedAiFeedback(
  data: Pick<
    Prisma.AiFeedbackUncheckedCreateInput,
    'workspaceId' | 'userId' | 'targetId'
  > &
    Partial<Prisma.AiFeedbackUncheckedCreateInput>,
) {
  return prisma.aiFeedback.create({
    data: { surface: 'STEEL_AI_MESSAGE', rating: 'UP', ...data },
  })
}

export async function seedAiEvalSet(
  workspaceId: string,
  overrides?: Partial<
    Omit<Prisma.AiEvalSetUncheckedCreateInput, 'workspaceId'>
  >,
) {
  return prisma.aiEvalSet.create({
    data: {
      workspaceId,
      name: 'Conjunto',
      target: 'STEEL_ASSISTANT',
      ...overrides,
    },
  })
}

export async function seedAiEvalCase(
  setId: string,
  overrides?: Partial<Omit<Prisma.AiEvalCaseUncheckedCreateInput, 'setId'>>,
) {
  return prisma.aiEvalCase.create({
    data: { setId, input: 'Pergunta', expected: 'Resposta', ...overrides },
  })
}

export async function seedAiEvalRun(
  workspaceId: string,
  setId: string,
  overrides?: Partial<
    Omit<Prisma.AiEvalRunUncheckedCreateInput, 'workspaceId' | 'setId'>
  >,
) {
  return prisma.aiEvalRun.create({
    data: { workspaceId, setId, ...overrides },
  })
}

/** A WhatsApp conversation with its connection and contact. */
export async function seedWhatsAppThread(
  workspaceId: string,
  userId: string,
  overrides?: Partial<Prisma.WhatsAppConversationUncheckedCreateInput>,
) {
  const connection = await prisma.whatsAppConnection.create({
    data: {
      workspaceId,
      provider: 'ZAPI',
      label: 'Suporte',
      phoneNumber: `55119${Math.floor(Math.random() * 1e8)}`,
      zapiInstanceId: `instance-${createId()}`,
      encryptedZapiToken: 'enc:token',
      createdById: userId,
    },
  })
  const contact = await prisma.whatsAppContact.create({
    data: {
      workspaceId,
      waId: `55119${Math.floor(Math.random() * 1e8)}`,
      name: 'Cliente',
    },
  })
  return prisma.whatsAppConversation.create({
    data: {
      workspaceId,
      connectionId: connection.id,
      contactId: contact.id,
      ...overrides,
    },
  })
}

export async function seedWhatsAppMessage(
  workspaceId: string,
  conversationId: string,
  overrides?: Partial<Prisma.WhatsAppMessageUncheckedCreateInput>,
) {
  return prisma.whatsAppMessage.create({
    data: {
      workspaceId,
      conversationId,
      direction: 'OUT',
      type: 'TEXT',
      text: 'Olá!',
      ...overrides,
    },
  })
}
