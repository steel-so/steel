import { createId } from '@paralleldrive/cuid2'
import type {
  Prisma,
  SdAutomationRule,
  SdCustomFieldDefinition,
  SdEscalationRule,
  SdPhase,
  SdSettings,
  SdTicketTemplate,
  SdTicketType,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { DEFAULT_SD_TICKET_PREFIXES } from '@/src/lib/servicedesk/ticket-code'
import type { SdSlaPolicyWithTargets } from '@/src/repositories/sd-ticket-context.repository'

/**
 * Fábricas da configuração do ServiceDesk lida pelo motor de chamados
 * (fases, SLA, catálogo, departamentos, regras…). As tabelas pertencem à
 * fatia de configuração; estas fábricas existem só para os testes da fatia
 * de chamados.
 */

const now = () => new Date('2026-09-21T12:00:00.000Z')

export const WEEK_8x5 = {
  mon: [
    ['08:00', '12:00'],
    ['13:00', '18:00'],
  ],
  tue: [
    ['08:00', '12:00'],
    ['13:00', '18:00'],
  ],
  wed: [
    ['08:00', '12:00'],
    ['13:00', '18:00'],
  ],
  thu: [
    ['08:00', '12:00'],
    ['13:00', '18:00'],
  ],
  fri: [
    ['08:00', '12:00'],
    ['13:00', '18:00'],
  ],
  sat: [],
  sun: [],
}

/* ------------------------------ fakes (unit) ------------------------------ */

export function createFakeSdSettings(
  overrides?: Partial<SdSettings>,
): SdSettings {
  return {
    id: createId(),
    workspaceId: 'ws1',
    nextTicketNumber: 1,
    ticketPrefixes: DEFAULT_SD_TICKET_PREFIXES,
    defaultDepartmentId: null,
    defaultSlaPolicyId: null,
    whatsappConnectionId: null,
    whatsappSendAcknowledgement: true,
    portalEnabled: true,
    portalTicketTypes: ['INCIDENT', 'SERVICE_REQUEST'],
    portalCompanyScope: true,
    requireSignatureOnClose: false,
    requireSolutionOnResolve: true,
    autoCloseResolvedAfterHours: 72,
    slaAtRiskPercent: 80,
    reopenOnRequesterReply: true,
    autoAssignRoundRobin: false,
    kbReviewIntervalDays: 180,
    aiEnabled: false,
    aiPreServiceEnabled: false,
    aiAutoTriageEnabled: false,
    aiWhatsappAutoReply: false,
    aiPersona: null,
    aiInstructions: null,
    aiHandoffKeywords: [],
    updatedById: null,
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  }
}

export function createFakeSdPhase(overrides?: Partial<SdPhase>): SdPhase {
  return {
    id: createId(),
    workspaceId: 'ws1',
    ticketType: 'INCIDENT',
    name: 'Novo',
    description: null,
    color: '#2893cc',
    category: 'NEW',
    completionPercent: 0,
    position: 0,
    isInitial: false,
    pausesSla: false,
    requiresApproval: false,
    requiredFields: [],
    wipLimit: 0,
    active: true,
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  }
}

export function createFakeSdSlaPolicy(
  overrides?: Partial<SdSlaPolicyWithTargets>,
): SdSlaPolicyWithTargets {
  return {
    id: createId(),
    workspaceId: 'ws1',
    kind: 'SLA',
    name: 'SLA padrão',
    description: null,
    calendarId: null,
    conditions: [],
    isDefault: false,
    active: true,
    position: 0,
    createdAt: now(),
    updatedAt: now(),
    targets: [],
    calendar: null,
    ...overrides,
  }
}

export function createFakeSdTemplate(
  overrides?: Partial<SdTicketTemplate>,
): SdTicketTemplate {
  return {
    id: createId(),
    workspaceId: 'ws1',
    ticketType: 'INCIDENT',
    name: 'Modelo',
    description: null,
    defaults: {},
    tasks: [],
    portalVisible: false,
    active: true,
    position: 0,
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  }
}

export function createFakeSdCustomField(
  overrides?: Partial<SdCustomFieldDefinition>,
): SdCustomFieldDefinition {
  return {
    id: createId(),
    workspaceId: 'ws1',
    entity: 'TICKET',
    key: 'contrato',
    label: 'Contrato',
    description: null,
    type: 'TEXT',
    options: [],
    ticketTypes: [],
    categoryIds: [],
    required: false,
    visibleInPortal: false,
    defaultValue: null,
    active: true,
    position: 0,
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  }
}

export function createFakeSdEscalationRule(
  overrides?: Partial<SdEscalationRule>,
): SdEscalationRule {
  return {
    id: createId(),
    workspaceId: 'ws1',
    name: 'Escalar violação',
    trigger: 'RESOLUTION_BREACHED',
    thresholdMinutes: null,
    conditions: [],
    actions: { kind: 'HIERARCHICAL' },
    active: true,
    position: 0,
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  }
}

export function createFakeSdAutomationRule(
  overrides?: Partial<SdAutomationRule>,
): SdAutomationRule {
  return {
    id: createId(),
    workspaceId: 'ws1',
    name: 'Regra',
    description: null,
    event: 'TICKET_CREATED',
    conditions: [],
    actions: [{ type: 'add_tag', params: { tag: 'auto' } }],
    stopProcessing: false,
    active: true,
    position: 0,
    runCount: 0,
    lastRunAt: null,
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  }
}

/* ------------------------------ seeds (integração) ------------------------------ */

export async function seedSdSettings(
  workspaceId: string,
  overrides?: Partial<Prisma.SdSettingsUncheckedCreateInput>,
) {
  return prisma.sdSettings.create({
    data: {
      workspaceId,
      ticketPrefixes: DEFAULT_SD_TICKET_PREFIXES,
      ...overrides,
    },
  })
}

export async function seedSdPhase(
  workspaceId: string,
  overrides?: Partial<Prisma.SdPhaseUncheckedCreateInput>,
) {
  return prisma.sdPhase.create({
    data: {
      workspaceId,
      ticketType: 'INCIDENT',
      name: 'Novo',
      category: 'NEW',
      ...overrides,
    },
  })
}

/** Fluxo ITIL mínimo de um tipo: Novo → Em andamento → Aguardando → Resolvido → Fechado → Cancelado. */
export async function seedSdPhaseFlow(
  workspaceId: string,
  ticketType: SdTicketType = 'INCIDENT',
) {
  const specs = [
    { name: 'Novo', category: 'NEW', completionPercent: 0, isInitial: true },
    { name: 'Em andamento', category: 'IN_PROGRESS', completionPercent: 40 },
    {
      name: 'Aguardando',
      category: 'WAITING',
      completionPercent: 50,
      pausesSla: true,
    },
    { name: 'Resolvido', category: 'RESOLVED', completionPercent: 90 },
    { name: 'Fechado', category: 'CLOSED', completionPercent: 100 },
    { name: 'Cancelado', category: 'CANCELED', completionPercent: 100 },
  ] as const
  const phases: SdPhase[] = []
  for (const [position, spec] of specs.entries()) {
    phases.push(
      await seedSdPhase(workspaceId, { ...spec, ticketType, position }),
    )
  }
  const [initial, inProgress, waiting, resolved, closed, canceled] = phases
  return { initial, inProgress, waiting, resolved, closed, canceled, phases }
}

export async function seedSdPriority(
  workspaceId: string,
  overrides?: Partial<Prisma.SdPriorityUncheckedCreateInput>,
) {
  return prisma.sdPriority.create({
    data: {
      workspaceId,
      name: `P${overrides?.level ?? 1}`,
      level: 1,
      ...overrides,
    },
  })
}

export async function seedSdImpact(workspaceId: string, level = 1) {
  return prisma.sdImpact.create({
    data: { workspaceId, name: `Impacto ${level}`, level },
  })
}

export async function seedSdUrgency(workspaceId: string, level = 1) {
  return prisma.sdUrgency.create({
    data: { workspaceId, name: `Urgência ${level}`, level },
  })
}

export async function seedSdSeverity(workspaceId: string, level = 1) {
  return prisma.sdSeverity.create({
    data: { workspaceId, name: `Severidade ${level}`, level },
  })
}

export async function seedSdMatrix(
  workspaceId: string,
  impactId: string,
  urgencyId: string,
  priorityId: string,
) {
  return prisma.sdPriorityMatrix.create({
    data: { workspaceId, impactId, urgencyId, priorityId },
  })
}

export async function seedSdCalendar(
  workspaceId: string,
  overrides?: Partial<Prisma.SdBusinessCalendarUncheckedCreateInput>,
) {
  return prisma.sdBusinessCalendar.create({
    data: {
      workspaceId,
      name: 'Comercial',
      schedule: WEEK_8x5,
      ...overrides,
    },
  })
}

export async function seedSdSlaPolicy(
  workspaceId: string,
  overrides?: Partial<Prisma.SdSlaPolicyUncheckedCreateInput>,
  targets: {
    priorityId: string
    firstResponseMinutes: number
    resolutionMinutes: number
  }[] = [],
) {
  return prisma.sdSlaPolicy.create({
    data: {
      workspaceId,
      name: 'SLA',
      ...overrides,
      targets: { create: targets },
    },
    include: { targets: true, calendar: true },
  })
}

export async function seedSdCategory(
  workspaceId: string,
  overrides?: Partial<Prisma.SdCategoryUncheckedCreateInput>,
) {
  return prisma.sdCategory.create({
    data: {
      workspaceId,
      level: 'CATEGORY',
      name: 'Infraestrutura',
      ...overrides,
    },
  })
}

export async function seedSdClassification(
  workspaceId: string,
  overrides?: Partial<Prisma.SdClassificationUncheckedCreateInput>,
) {
  return prisma.sdClassification.create({
    data: { workspaceId, kind: 'TICKET', name: 'Falha', ...overrides },
  })
}

export async function seedSdDepartment(
  workspaceId: string,
  overrides?: Partial<Prisma.SdDepartmentUncheckedCreateInput>,
) {
  return prisma.sdDepartment.create({
    data: { workspaceId, name: 'Suporte N1', ...overrides },
  })
}

export async function seedSdDepartmentMember(
  departmentId: string,
  userId: string,
  overrides?: Partial<Prisma.SdDepartmentMemberUncheckedCreateInput>,
) {
  return prisma.sdDepartmentMember.create({
    data: { departmentId, userId, ...overrides },
  })
}

export async function seedSdTemplate(
  workspaceId: string,
  overrides?: Partial<Prisma.SdTicketTemplateUncheckedCreateInput>,
) {
  return prisma.sdTicketTemplate.create({
    data: {
      workspaceId,
      ticketType: 'INCIDENT',
      name: 'Modelo',
      ...overrides,
    },
  })
}

export async function seedSdCustomField(
  workspaceId: string,
  overrides?: Partial<Prisma.SdCustomFieldDefinitionUncheckedCreateInput>,
) {
  return prisma.sdCustomFieldDefinition.create({
    data: {
      workspaceId,
      entity: 'TICKET',
      key: 'contrato',
      label: 'Contrato',
      type: 'TEXT',
      ...overrides,
    },
  })
}

export async function seedSdEscalationRule(
  workspaceId: string,
  overrides?: Partial<Prisma.SdEscalationRuleUncheckedCreateInput>,
) {
  return prisma.sdEscalationRule.create({
    data: {
      workspaceId,
      name: 'Escalar',
      trigger: 'RESOLUTION_BREACHED',
      actions: { kind: 'HIERARCHICAL' },
      ...overrides,
    },
  })
}

export async function seedSdAutomationRule(
  workspaceId: string,
  overrides?: Partial<Prisma.SdAutomationRuleUncheckedCreateInput>,
) {
  return prisma.sdAutomationRule.create({
    data: {
      workspaceId,
      name: 'Regra',
      event: 'TICKET_CREATED',
      actions: [{ type: 'add_tag', params: { tag: 'auto' } }],
      ...overrides,
    },
  })
}

export async function seedSdCustomer(
  workspaceId: string,
  createdById: string,
  overrides?: Partial<Prisma.SdCustomerUncheckedCreateInput>,
) {
  return prisma.sdCustomer.create({
    data: { workspaceId, createdById, name: 'ACME Ltda', ...overrides },
  })
}

export async function seedSdContact(
  workspaceId: string,
  createdById: string,
  overrides?: Partial<Prisma.SdContactUncheckedCreateInput>,
) {
  return prisma.sdContact.create({
    data: { workspaceId, createdById, name: 'Maria Contato', ...overrides },
  })
}

export async function seedSdConfigItem(
  workspaceId: string,
  createdById: string,
  overrides?: Partial<Prisma.SdConfigItemUncheckedCreateInput>,
) {
  return prisma.sdConfigItem.create({
    data: { workspaceId, createdById, name: 'SRV-01', ...overrides },
  })
}
