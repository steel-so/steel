import { z } from 'zod'
import { SD_AUTOMATION_EVENTS } from '@/src/schemas/sd-automation-rule.schema'
import { SD_CATEGORY_LEVELS } from '@/src/schemas/sd-category.schema'
import { SD_PHASE_CATEGORIES } from '@/src/schemas/sd-config.schema'
import {
  SD_CUSTOM_FIELD_ENTITIES,
  SD_CUSTOM_FIELD_TYPES,
  SdCustomFieldOptionSchema,
} from '@/src/schemas/sd-custom-field.schema'
import { SD_ESCALATION_TRIGGERS } from '@/src/schemas/sd-escalation-rule.schema'
import { SD_SCALE_KINDS } from '@/src/schemas/sd-priority.schema'
import {
  SD_TICKET_TYPES,
  SdAutomationActionSchema,
  SdConditionSchema,
  SdEscalationActionsSchema,
} from '@/src/schemas/sd-rule.schema'
import {
  SdTicketTemplateDefaultsSchema,
  SdTicketTemplateTaskSchema,
} from '@/src/schemas/sd-ticket-template.schema'
import { dto } from '../common'

/** DTOs da configuração do ServiceDesk (`types/sd-config.d.ts`, `types/sd-settings.d.ts`). */

const id = z.string().meta({ example: 'ckv9x2p0h0000us7d3k1e5abc' })
const iso = z.iso.datetime()
const ticketType = z.enum(SD_TICKET_TYPES)
const timestamps = { createdAt: iso, updatedAt: iso }

export const SdTicketPrefixesDTO = dto(
  'SdTicketPrefixes',
  z.object({
    INCIDENT: z.string().meta({ example: 'INC' }),
    SERVICE_REQUEST: z.string().meta({ example: 'REQ' }),
    CHANGE: z.string().meta({ example: 'CHG' }),
    PROBLEM: z.string().meta({ example: 'PRB' }),
  }),
)

export const SdSettingsDTO = dto(
  'SdSettings',
  z.object({
    id,
    workspaceId: id,
    nextTicketNumber: z.number().int(),
    ticketPrefixes: SdTicketPrefixesDTO,
    defaultDepartmentId: id.nullable(),
    defaultSlaPolicyId: id.nullable(),
    whatsappConnectionId: id.nullable(),
    whatsappSendAcknowledgement: z.boolean().meta({
      description:
        'Chamado aberto pelo WhatsApp responde ao contato com o código. O equivalente do e-mail fica em cada caixa (`sendAcknowledgement`).',
    }),
    portalEnabled: z.boolean(),
    portalTicketTypes: z.array(ticketType),
    requireSignatureOnClose: z.boolean(),
    requireSolutionOnResolve: z.boolean(),
    autoCloseResolvedAfterHours: z.number().int(),
    slaAtRiskPercent: z.number().int(),
    reopenOnRequesterReply: z.boolean(),
    autoAssignRoundRobin: z.boolean(),
    kbReviewIntervalDays: z.number().int().meta({
      description:
        'KCS: validade padrão (em dias) da revisão dos artigos da base.',
      example: 180,
    }),
    aiEnabled: z.boolean(),
    aiPreServiceEnabled: z.boolean(),
    aiAutoTriageEnabled: z.boolean(),
    aiWhatsappAutoReply: z.boolean(),
    aiPersona: z.string().nullable(),
    aiInstructions: z.string().nullable(),
    aiHandoffKeywords: z.array(z.string()),
    updatedById: id.nullable(),
    ...timestamps,
  }),
)

export const SdDepartmentMemberDTO = dto(
  'SdDepartmentMember',
  z.object({
    userId: id,
    name: z.string(),
    email: z.string(),
    image: z.string().nullable(),
    isLead: z.boolean(),
    lastAssignedAt: iso.nullable(),
  }),
)

const departmentShape = {
  id,
  parentId: id.nullable(),
  name: z.string().meta({ example: 'N1 – Atendimento' }),
  description: z.string().nullable(),
  email: z.string().nullable(),
  color: z.string().nullable(),
  calendarId: id.nullable(),
  active: z.boolean(),
  position: z.number().int(),
  members: z.array(SdDepartmentMemberDTO),
  ...timestamps,
}

export const SdDepartmentDTO = dto('SdDepartment', z.object(departmentShape))

export const SdDepartmentTreeDTO = dto(
  'SdDepartmentTree',
  z.object({ ...departmentShape, children: z.array(SdDepartmentDTO) }),
)

const categoryShape = {
  id,
  parentId: id.nullable(),
  level: z.enum(SD_CATEGORY_LEVELS),
  name: z.string().meta({ example: 'Rede' }),
  description: z.string().nullable(),
  icon: z.string().nullable(),
  ticketTypes: z.array(ticketType),
  departmentId: id.nullable(),
  slaPolicyId: id.nullable(),
  portalVisible: z.boolean(),
  active: z.boolean(),
  position: z.number().int(),
  ...timestamps,
}

export const SdCategoryDTO = dto('SdCategory', z.object(categoryShape))

export const SdCategoryTreeDTO = dto(
  'SdCategoryTree',
  z.object({
    ...categoryShape,
    children: z
      .array(z.record(z.string(), z.unknown()))
      .meta({ description: 'Filhos (mesma forma, recursiva).' }),
  }),
)

export const SdClassificationDTO = dto(
  'SdClassification',
  z.object({
    id,
    kind: z.enum(['TICKET', 'SOLUTION']),
    name: z.string().meta({ example: 'Falha' }),
    description: z.string().nullable(),
    color: z.string().nullable(),
    ticketTypes: z.array(ticketType),
    active: z.boolean(),
    position: z.number().int(),
    ...timestamps,
  }),
)

export const SdScaleItemDTO = dto(
  'SdScaleItem',
  z.object({
    id,
    kind: z.enum(SD_SCALE_KINDS),
    name: z.string().meta({ example: 'P1 – Crítica' }),
    description: z.string().nullable(),
    color: z.string().nullable(),
    level: z.number().int().meta({ description: 'Maior = mais.' }),
    isDefault: z.boolean(),
    ...timestamps,
  }),
)

export const SdPriorityMatrixCellDTO = dto(
  'SdPriorityMatrixCell',
  z.object({ impactId: id, urgencyId: id, priorityId: id }),
)

export const SdPhaseDTO = dto(
  'SdPhase',
  z.object({
    id,
    ticketType,
    name: z.string().meta({ example: 'Em atendimento' }),
    description: z.string().nullable(),
    color: z.string().nullable(),
    category: z.enum(SD_PHASE_CATEGORIES),
    completionPercent: z.number().int().min(0).max(100),
    position: z.number().int(),
    isInitial: z.boolean(),
    pausesSla: z.boolean(),
    requiresApproval: z.boolean(),
    requiredFields: z.array(z.string()),
    wipLimit: z.number().int(),
    active: z.boolean(),
    ...timestamps,
  }),
)

export const SdPhaseTransitionDTO = dto(
  'SdPhaseTransition',
  z.object({
    id,
    fromPhaseId: id,
    toPhaseId: id,
    allowedDepartmentIds: z.array(id),
  }),
)

export const SdPhaseFlowDTO = dto(
  'SdPhaseFlow',
  z.object({
    ticketType,
    phases: z.array(SdPhaseDTO),
    transitions: z.array(SdPhaseTransitionDTO),
  }),
)

const interval = z.array(z.string()).meta({ example: ['08:00', '18:00'] })
const day = z.array(interval)

export const SdBusinessCalendarDTO = dto(
  'SdBusinessCalendar',
  z.object({
    id,
    name: z.string().meta({ example: 'Comercial (8×5)' }),
    timezone: z.string().meta({ example: 'America/Sao_Paulo' }),
    schedule: z.object({
      mon: day,
      tue: day,
      wed: day,
      thu: day,
      fri: day,
      sat: day,
      sun: day,
    }),
    holidays: z.array(
      z.object({
        date: z.iso.date(),
        name: z.string(),
        recurring: z.boolean(),
      }),
    ),
    is24x7: z.boolean(),
    isDefault: z.boolean(),
    ...timestamps,
  }),
)

export const SdSlaPolicyDTO = dto(
  'SdSlaPolicy',
  z.object({
    id,
    kind: z.enum(['SLA', 'OLA']),
    name: z.string().meta({ example: 'Padrão' }),
    description: z.string().nullable(),
    calendarId: id.nullable(),
    conditions: z.array(SdConditionSchema),
    isDefault: z.boolean(),
    active: z.boolean(),
    position: z.number().int(),
    targets: z.array(
      z.object({
        priorityId: id,
        firstResponseMinutes: z.number().int(),
        resolutionMinutes: z.number().int(),
      }),
    ),
    ...timestamps,
  }),
)

export const SdSlaPolicySummaryDTO = dto(
  'SdSlaPolicySummary',
  z.object({
    id,
    kind: z.enum(['SLA', 'OLA']),
    name: z.string(),
    isDefault: z.boolean(),
    active: z.boolean(),
    calendarId: id.nullable(),
  }),
)

export const SdEscalationRuleDTO = dto(
  'SdEscalationRule',
  z.object({
    id,
    name: z.string().meta({ example: 'Resolução em risco → líder' }),
    trigger: z.enum(SD_ESCALATION_TRIGGERS),
    thresholdMinutes: z.number().int().nullable(),
    conditions: z.array(SdConditionSchema),
    actions: SdEscalationActionsSchema,
    active: z.boolean(),
    position: z.number().int(),
    ...timestamps,
  }),
)

export const SdAutomationRuleDTO = dto(
  'SdAutomationRule',
  z.object({
    id,
    name: z.string().meta({ example: 'Incidente crítico → notificar líderes' }),
    description: z.string().nullable(),
    event: z.enum(SD_AUTOMATION_EVENTS),
    conditions: z.array(SdConditionSchema),
    actions: z.array(SdAutomationActionSchema),
    stopProcessing: z.boolean(),
    active: z.boolean(),
    position: z.number().int(),
    runCount: z.number().int(),
    lastRunAt: iso.nullable(),
    ...timestamps,
  }),
)

export const SdCustomFieldDefinitionDTO = dto(
  'SdCustomFieldDefinition',
  z.object({
    id,
    entity: z.enum(SD_CUSTOM_FIELD_ENTITIES),
    key: z.string().meta({ example: 'assetTag' }),
    label: z.string().meta({ example: 'Patrimônio' }),
    description: z.string().nullable(),
    type: z.enum(SD_CUSTOM_FIELD_TYPES),
    options: z.array(SdCustomFieldOptionSchema),
    ticketTypes: z.array(ticketType),
    categoryIds: z.array(id),
    required: z.boolean(),
    visibleInPortal: z.boolean(),
    defaultValue: z.unknown(),
    active: z.boolean(),
    position: z.number().int(),
    ...timestamps,
  }),
)

export const SdTicketTemplateDTO = dto(
  'SdTicketTemplate',
  z.object({
    id,
    ticketType,
    name: z.string().meta({ example: 'Reset de senha' }),
    description: z.string().nullable(),
    defaults: SdTicketTemplateDefaultsSchema,
    tasks: z.array(SdTicketTemplateTaskSchema),
    portalVisible: z.boolean(),
    active: z.boolean(),
    position: z.number().int(),
    ...timestamps,
  }),
)

export const SdCannedResponseDTO = dto(
  'SdCannedResponse',
  z.object({
    id,
    title: z.string().meta({ example: 'Saudação' }),
    shortcut: z.string().nullable(),
    body: z.string(),
    departmentId: id.nullable(),
    createdById: id,
    createdByName: z.string().nullable(),
    ...timestamps,
  }),
)

export const SdPartDTO = dto(
  'SdPart',
  z.object({
    id,
    name: z.string().meta({ example: 'Mouse USB' }),
    sku: z.string().nullable(),
    description: z.string().nullable(),
    unitCost: z.string().meta({ example: '49.90' }),
    stock: z.number().int().nullable(),
    active: z.boolean(),
    ...timestamps,
  }),
)

export const SdMeDTO = dto(
  'SdMe',
  z.object({
    userId: id,
    isAgent: z.boolean(),
    isAdmin: z.boolean(),
    departmentIds: z.array(id),
    leadDepartmentIds: z.array(id),
  }),
)

export const SdAgentDTO = dto(
  'SdAgent',
  z.object({
    id,
    name: z.string(),
    email: z.string(),
    image: z.string().nullable(),
    isAdmin: z.boolean(),
    isAgent: z.boolean(),
    departments: z.array(z.object({ departmentId: id, isLead: z.boolean() })),
  }),
)

export const SdPublicSettingsDTO = dto(
  'SdPublicSettings',
  z.object({
    ticketPrefixes: SdTicketPrefixesDTO,
    portalEnabled: z.boolean(),
    portalTicketTypes: z.array(ticketType),
    requireSignatureOnClose: z.boolean(),
    requireSolutionOnResolve: z.boolean(),
    reopenOnRequesterReply: z.boolean(),
    slaAtRiskPercent: z.number().int(),
    defaultDepartmentId: id.nullable(),
    aiEnabled: z.boolean(),
    aiPreServiceEnabled: z.boolean(),
  }),
)

export const SdConfigBootstrapDTO = dto(
  'SdConfigBootstrap',
  z.object({
    me: SdMeDTO,
    settings: SdPublicSettingsDTO,
    departments: z.array(SdDepartmentTreeDTO),
    categories: z.array(SdCategoryTreeDTO),
    classifications: z.array(SdClassificationDTO),
    impacts: z.array(SdScaleItemDTO),
    urgencies: z.array(SdScaleItemDTO),
    priorities: z.array(SdScaleItemDTO),
    severities: z.array(SdScaleItemDTO),
    priorityMatrix: z.array(SdPriorityMatrixCellDTO),
    phases: z.array(SdPhaseFlowDTO),
    customFields: z.array(SdCustomFieldDefinitionDTO),
    templates: z.array(SdTicketTemplateDTO),
    cannedResponses: z.array(SdCannedResponseDTO),
    slaPolicies: z.array(SdSlaPolicySummaryDTO),
  }),
)

export const SdSeedPhasesSummaryDTO = dto(
  'SdSeedPhasesSummary',
  z
    .object({
      created: z.number().int(),
      kept: z.number().int(),
    })
    .meta({
      description:
        'Quantas fases padrão foram criadas agora e quantas do admin foram preservadas.',
    }),
)

export const SdSeedSummaryDTO = dto(
  'SdSeedSummary',
  z
    .object({
      calendars: z.number().int(),
      impacts: z.number().int(),
      urgencies: z.number().int(),
      priorities: z.number().int(),
      severities: z.number().int(),
      matrixCells: z.number().int(),
      classifications: z.number().int(),
      phases: z.number().int(),
      slaPolicies: z.number().int(),
      configItemTypes: z.number().int(),
      departments: z.number().int(),
      categories: z.number().int(),
      templates: z.number().int(),
      escalationRules: z.number().int(),
      automationRules: z.number().int(),
    })
    .meta({ description: 'Quantos itens de cada padrão foram criados agora.' }),
)
