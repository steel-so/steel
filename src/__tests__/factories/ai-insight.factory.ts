import { createId } from '@paralleldrive/cuid2'
import type { AiDigestSetting, AiInsight, Prisma } from '@prisma/client'
import type { AiInsightDraft } from '@/src/lib/ai/proactive/rules'
import { prisma } from '@/src/lib/prisma'

/** Proactive AI (ADR 0040) test data. */

export function createFakeAiInsightDraft(
  overrides?: Partial<AiInsightDraft>,
): AiInsightDraft {
  return {
    userId: 'u1',
    kind: 'CRM_STALE_OPPORTUNITIES',
    module: 'CRM',
    severity: 'INFO',
    dedupeKey: 'crm-stale:owner:u1',
    title: '2 oportunidades suas sem contato há 10 dias ou mais',
    body: 'Somam R$ 10.000,00. A mais parada, Acme, está sem atividade há 12 dias.',
    facts: [
      { label: 'Oportunidades', value: '2' },
      { label: 'Mais parada', value: '12 dias' },
    ],
    href: '/acme/crm/opportunities',
    prompt: 'Liste minhas oportunidades paradas.',
    ...overrides,
  }
}

export function createFakeAiInsight(overrides?: Partial<AiInsight>): AiInsight {
  const now = new Date('2026-10-18T12:00:00.000Z')
  return {
    id: createId(),
    workspaceId: 'ws1',
    userId: 'u1',
    kind: 'CRM_STALE_OPPORTUNITIES',
    module: 'CRM',
    severity: 'INFO',
    dedupeKey: 'crm-stale:owner:u1',
    title: '2 oportunidades suas sem contato há 10 dias ou mais',
    body: 'Somam R$ 10.000,00.',
    facts: [{ label: 'Oportunidades', value: '2' }],
    href: '/acme/crm/opportunities',
    prompt: 'Liste minhas oportunidades paradas.',
    status: 'ACTIVE',
    firstSeenAt: now,
    lastSeenAt: now,
    resolvedAt: null,
    dismissedAt: null,
    snoozedUntil: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export function createFakeAiDigestSetting(
  overrides?: Partial<AiDigestSetting>,
): AiDigestSetting {
  const now = new Date('2026-10-18T12:00:00.000Z')
  return {
    id: createId(),
    workspaceId: 'ws1',
    userId: 'u1',
    inApp: true,
    email: true,
    lastSentOn: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export async function seedAiInsight(
  workspaceId: string,
  userId: string,
  overrides?: Partial<
    Omit<Prisma.AiInsightUncheckedCreateInput, 'workspaceId' | 'userId'>
  >,
) {
  return prisma.aiInsight.create({
    data: {
      workspaceId,
      userId,
      kind: 'CRM_STALE_OPPORTUNITIES',
      module: 'CRM',
      severity: 'INFO',
      dedupeKey: `crm-stale:owner:${userId}`,
      title: 'Oportunidades paradas',
      body: 'Somam R$ 10.000,00.',
      facts: [{ label: 'Oportunidades', value: '2' }],
      ...overrides,
    },
  })
}
