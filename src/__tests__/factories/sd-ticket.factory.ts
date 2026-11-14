import { createId } from '@paralleldrive/cuid2'
import type { Prisma, SdSavedView } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import type { SdTicketWithRelations } from '@/src/repositories/sd-ticket.repository'
import type { SdTicketEscalationWithActor } from '@/src/repositories/sd-ticket-escalation.repository'
import type { SdTicketEventWithActor } from '@/src/repositories/sd-ticket-event.repository'
import { seedSdSettings } from './sd-ticket-context.factory'

const fixed = () => new Date('2026-09-21T12:00:00.000Z')

export function createFakeSdUserSummary(
  overrides?: Partial<{
    id: string
    name: string
    email: string
    image: string | null
  }>,
) {
  const id = overrides?.id ?? createId()
  return {
    id,
    name: 'Ana Agente',
    email: `${id}@example.com`,
    image: null,
    ...overrides,
  }
}

/** Chamado com as relações de `SD_TICKET_INCLUDE` (para testes unitários). */
export function createFakeSdTicket(
  overrides?: Partial<SdTicketWithRelations>,
): SdTicketWithRelations {
  const phaseId = overrides?.phaseId ?? overrides?.phase?.id ?? createId()
  return {
    id: createId(),
    workspaceId: 'ws1',
    number: 1,
    type: 'INCIDENT',
    title: 'Servidor de e-mail fora do ar',
    description: '<p>Ninguém recebe e-mails</p>',
    channel: 'AGENT',
    phaseId,
    completionPercent: 0,
    impactId: null,
    urgencyId: null,
    priorityId: null,
    severityId: null,
    categoryId: null,
    subcategoryId: null,
    serviceId: null,
    classificationId: null,
    solutionClassificationId: null,
    solution: null,
    customerId: null,
    companyId: null,
    contactId: null,
    configItemId: null,
    departmentId: null,
    assigneeId: null,
    requesterId: null,
    templateId: null,
    parentId: null,
    whatsappConversationId: null,
    crmLeadId: null,
    crmPersonId: null,
    crmOpportunityId: null,
    escalationLevel: 0,
    tags: [],
    customFields: {},
    slaPolicyId: null,
    contractId: null,
    firstResponseDueAt: null,
    resolutionDueAt: null,
    firstRespondedAt: null,
    slaPausedAt: null,
    slaPausedMinutes: 0,
    firstResponseBreached: false,
    resolutionBreached: false,
    slaAtRiskNotifiedAt: null,
    resolvedAt: null,
    closedAt: null,
    reopenCount: 0,
    changeType: null,
    changeRisk: null,
    plannedStartAt: null,
    plannedEndAt: null,
    implementationPlan: null,
    rollbackPlan: null,
    testPlan: null,
    rootCause: null,
    workaround: null,
    knownError: false,
    aiSummary: null,
    aiTriage: null,
    csatScore: null,
    csatComment: null,
    lastActivityAt: fixed(),
    createdById: null,
    createdAt: fixed(),
    updatedAt: fixed(),
    deletedAt: null,
    phase: {
      id: phaseId,
      name: 'Novo',
      color: null,
      category: 'NEW',
      completionPercent: 0,
      position: 0,
      wipLimit: 0,
      pausesSla: false,
    },
    impact: null,
    urgency: null,
    priority: null,
    severity: null,
    category: null,
    subcategory: null,
    service: null,
    classification: null,
    solutionClassification: null,
    customer: null,
    company: null,
    contact: null,
    configItem: null,
    department: null,
    assignee: null,
    requester: null,
    createdBy: null,
    participants: [],
    parent: null,
    slaPolicy: null,
    riskPrediction: null,
    _count: { children: 0 },
    ...overrides,
  }
}

export function createFakeSdTicketEvent(
  overrides?: Partial<SdTicketEventWithActor>,
): SdTicketEventWithActor {
  return {
    id: createId(),
    workspaceId: 'ws1',
    ticketId: 't1',
    actorKind: 'AGENT',
    actorUserId: null,
    action: 'ticket.created',
    field: null,
    fromValue: null,
    toValue: null,
    meta: null,
    createdAt: fixed(),
    actor: null,
    ...overrides,
  }
}

export function createFakeSdEscalation(
  overrides?: Partial<SdTicketEscalationWithActor>,
): SdTicketEscalationWithActor {
  return {
    id: createId(),
    workspaceId: 'ws1',
    ticketId: 't1',
    kind: 'HIERARCHICAL',
    fromLevel: 0,
    toLevel: 1,
    fromDepartmentId: null,
    toDepartmentId: null,
    fromAssigneeId: null,
    toAssigneeId: null,
    reason: 'Sem resposta',
    automatic: false,
    ruleId: null,
    createdById: null,
    createdAt: fixed(),
    createdBy: null,
    ...overrides,
  }
}

export function createFakeSdSavedView(
  overrides?: Partial<SdSavedView>,
): SdSavedView {
  return {
    id: createId(),
    workspaceId: 'ws1',
    userId: 'u1',
    name: 'Minha fila',
    ticketType: null,
    mode: 'KANBAN',
    filters: {},
    sort: [],
    columns: [],
    shared: false,
    position: 0,
    createdAt: fixed(),
    updatedAt: fixed(),
    ...overrides,
  }
}

/**
 * Cria um chamado no banco com número sequencial (reserva em
 * `sd_settings`, criando a linha se faltar). `phaseId` é obrigatório.
 */
export async function seedSdTicket(
  workspaceId: string,
  phaseId: string,
  overrides?: Partial<
    Omit<Prisma.SdTicketUncheckedCreateInput, 'workspaceId' | 'phaseId'>
  >,
) {
  const settings =
    (await prisma.sdSettings.findUnique({ where: { workspaceId } })) ??
    (await seedSdSettings(workspaceId))
  const updated = await prisma.sdSettings.update({
    where: { id: settings.id },
    data: { nextTicketNumber: { increment: 1 } },
  })
  return prisma.sdTicket.create({
    data: {
      workspaceId,
      phaseId,
      number: updated.nextTicketNumber - 1,
      type: 'INCIDENT',
      title: 'Chamado de teste',
      ...overrides,
    },
  })
}

export async function seedSdSavedView(
  workspaceId: string,
  userId: string,
  overrides?: Partial<Prisma.SdSavedViewUncheckedCreateInput>,
) {
  return prisma.sdSavedView.create({
    data: { workspaceId, userId, name: 'Minha fila', ...overrides },
  })
}
