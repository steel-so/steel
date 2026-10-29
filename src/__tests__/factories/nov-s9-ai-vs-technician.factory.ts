import { createId } from '@paralleldrive/cuid2'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import type {
  SdAiComparisonTicketRow,
  SdAiSuggestionRow,
} from '@/src/repositories/sd-ai-comparison.repository'
import type { SdAiClassificationDTO, SdAiTriageRecordDTO } from '@/types/sd-ai'

const FIXED = new Date('2026-10-20T12:00:00.000Z')

export function createFakeSdAiClassification(
  overrides?: Partial<SdAiClassificationDTO>,
): SdAiClassificationDTO {
  return {
    category: { id: 'cat1', name: 'Rede' },
    subcategory: null,
    service: null,
    impact: null,
    urgency: null,
    priority: null,
    department: null,
    tags: [],
    confidence: 0.9,
    reasoning: 'VPN fora do ar',
    ...overrides,
  }
}

export function createFakeSdAiTriageRecord(
  overrides?: Partial<SdAiTriageRecordDTO>,
): SdAiTriageRecordDTO {
  return {
    suggestions: createFakeSdAiClassification(),
    applied: ['categoryId'],
    model: 'openai:gpt-4o-mini',
    at: FIXED.toISOString(),
    ...overrides,
  }
}

/** Chamado como o repositório do painel o devolve (fase já resolvida). */
export function createFakeSdAiComparisonTicket(
  overrides?: Partial<SdAiComparisonTicketRow>,
): SdAiComparisonTicketRow {
  return {
    id: createId(),
    number: 1,
    type: 'INCIDENT',
    title: 'VPN fora do ar',
    solution: null,
    tags: [],
    createdAt: FIXED,
    aiTriage: createFakeSdAiTriageRecord() as unknown as Prisma.JsonValue,
    phaseCategory: 'RESOLVED',
    category: { id: 'cat1', name: 'Rede' },
    subcategory: null,
    service: null,
    impact: null,
    urgency: null,
    priority: null,
    department: null,
    ...overrides,
  }
}

export function createFakeSdAiSuggestion(
  overrides?: Partial<SdAiSuggestionRow>,
): SdAiSuggestionRow {
  return {
    id: createId(),
    ticketId: 't1',
    userId: 'u1',
    kind: 'REPLY',
    text: 'Reinicie o cliente VPN e tente novamente',
    payload: null,
    createdAt: FIXED,
    ...overrides,
  }
}

export async function seedSdAiSuggestion(
  workspaceId: string,
  ticketId: string,
  overrides?: Partial<
    Omit<Prisma.SdAiSuggestionUncheckedCreateInput, 'workspaceId' | 'ticketId'>
  >,
) {
  return prisma.sdAiSuggestion.create({
    data: {
      workspaceId,
      ticketId,
      kind: 'REPLY',
      text: 'Reinicie o cliente VPN e tente novamente',
      ...overrides,
    },
  })
}
