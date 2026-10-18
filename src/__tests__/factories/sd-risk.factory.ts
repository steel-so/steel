import { createId } from '@paralleldrive/cuid2'
import type {
  Prisma,
  SdIncidentCluster,
  SdTicketRiskPrediction,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import type { SdRiskFactorResult } from '@/src/lib/servicedesk/risk'
import type {
  SdRiskTicketInput,
  SdRiskWorkspaceStats,
} from '@/src/lib/servicedesk/risk-compute'
import { sdRiskEmptyStats } from '@/src/lib/servicedesk/risk-compute'
import type { SdIncidentClusterWithActor } from '@/src/repositories/sd-risk.repository'

/**
 * Fixtures do risco preditivo: o recorte do chamado que a heurística recebe,
 * as estatísticas do workspace, a previsão gravada e os agrupamentos de
 * incidentes.
 */

const fixed = () => new Date('2026-10-02T12:00:00.000Z')

/**
 * Chamado "limpo": aberto agora, com responsável, sem prazo, sem prioridade
 * e com interação recente — **nenhum fator pega**. Cada teste liga um fator
 * por vez com `overrides`.
 */
export function createFakeSdRiskTicket(
  overrides?: Partial<SdRiskTicketInput>,
): SdRiskTicketInput {
  const now = fixed()
  return {
    createdAt: now,
    firstResponseDueAt: null,
    resolutionDueAt: null,
    firstRespondedAt: null,
    resolvedAt: null,
    slaPausedAt: null,
    slaPausedMinutes: 0,
    firstResponseBreached: false,
    resolutionBreached: false,
    assigneeId: 'u1',
    departmentId: null,
    customerId: null,
    companyId: null,
    serviceId: null,
    reopenCount: 0,
    lastTeamActivityAt: now,
    priority: null,
    severity: null,
    phase: { name: 'Em andamento', category: 'IN_PROGRESS', pausesSla: false },
    ...overrides,
  }
}

export function createFakeSdRiskStats(
  overrides?: Partial<SdRiskWorkspaceStats>,
): SdRiskWorkspaceStats {
  return { ...sdRiskEmptyStats(), ...overrides }
}

export function createFakeSdRiskFactor(
  overrides?: Partial<SdRiskFactorResult>,
): SdRiskFactorResult {
  return {
    key: 'sla_consumed',
    label: 'Prazo já consumido',
    weight: 30,
    detail: '82% do prazo de resolução consumido (em horário útil)',
    ...overrides,
  }
}

export function createFakeSdRiskPrediction(
  overrides?: Partial<SdTicketRiskPrediction>,
): SdTicketRiskPrediction {
  return {
    id: createId(),
    workspaceId: 'ws1',
    ticketId: 't1',
    level: 'HIGH',
    score: 74,
    factors: [createFakeSdRiskFactor()] as unknown as Prisma.JsonValue,
    breachEtaAt: new Date('2026-10-02T18:00:00.000Z'),
    computedAt: fixed(),
    ...overrides,
  }
}

export function createFakeSdIncidentCluster(
  overrides?: Partial<SdIncidentClusterWithActor>,
): SdIncidentClusterWithActor {
  return {
    id: createId(),
    workspaceId: 'ws1',
    signature: '-:-:-:email-fora-servidor',
    title: 'Servidor de e-mail fora do ar',
    ticketIds: ['t1', 't2', 't3'],
    ticketCount: 3,
    firstSeenAt: new Date('2026-09-30T12:00:00.000Z'),
    lastSeenAt: fixed(),
    problemTicketId: null,
    dismissedAt: null,
    dismissedById: null,
    createdAt: fixed(),
    updatedAt: fixed(),
    dismissedBy: null,
    ...overrides,
  }
}

export async function seedSdRiskPrediction(
  workspaceId: string,
  ticketId: string,
  overrides?: Partial<Prisma.SdTicketRiskPredictionUncheckedCreateInput>,
): Promise<SdTicketRiskPrediction> {
  return prisma.sdTicketRiskPrediction.create({
    data: {
      workspaceId,
      ticketId,
      level: 'HIGH',
      score: 74,
      factors: [createFakeSdRiskFactor()] as unknown as Prisma.InputJsonValue,
      ...overrides,
    },
  })
}

export async function seedSdIncidentCluster(
  workspaceId: string,
  overrides?: Partial<Prisma.SdIncidentClusterUncheckedCreateInput>,
): Promise<SdIncidentCluster> {
  return prisma.sdIncidentCluster.create({
    data: {
      workspaceId,
      signature: `-:-:-:sig-${createId()}`,
      title: 'Servidor de e-mail fora do ar',
      ticketIds: [],
      ticketCount: 0,
      firstSeenAt: fixed(),
      lastSeenAt: fixed(),
      ...overrides,
    },
  })
}
