import {
  Prisma,
  type SdAutomationRule,
  type SdBusinessCalendar,
  type SdCategory,
  type SdClassification,
  type SdCustomFieldDefinition,
  type SdEscalationRule,
  type SdPart,
  type SdPhase,
  type SdPhaseTransition,
  type SdPriorityMatrix,
  type SdSettings,
  type SdTicketTemplate,
} from '@prisma/client'
import { describe, expect, it } from 'vitest'
import type { SdCannedResponseWithAuthor } from '@/src/repositories/sd-canned-response.repository'
import type { SdDepartmentWithMembers } from '@/src/repositories/sd-department.repository'
import type { SdSlaPolicyWithTargets } from '@/src/repositories/sd-sla-policy.repository'
import type { SdCategoryDTO, SdDepartmentDTO } from '@/types/sd-config'
import { toSdAutomationRuleDTO } from '../sd-automation-rule.mapper'
import {
  toSdCalendarDTO,
  toSdHolidays,
  toSdWeeklySchedule,
} from '../sd-calendar.mapper'
import { toSdCannedResponseDTO } from '../sd-canned-response.mapper'
import {
  pruneSdCategoryOrphans,
  toSdCategoryDTO,
  toSdCategoryTree,
} from '../sd-category.mapper'
import { toSdClassificationDTO } from '../sd-classification.mapper'
import {
  toSdCustomFieldDTO,
  toSdCustomFieldOptions,
} from '../sd-custom-field.mapper'
import { toSdDepartmentDTO, toSdDepartmentTree } from '../sd-department.mapper'
import {
  toSdEscalationActions,
  toSdEscalationRuleDTO,
} from '../sd-escalation-rule.mapper'
import { toSdPartDTO } from '../sd-part.mapper'
import {
  toSdPhaseDTO,
  toSdPhaseFlows,
  toSdPhaseTransitionDTO,
} from '../sd-phase.mapper'
import {
  toSdPriorityMatrixCellDTO,
  toSdScaleItemDTO,
} from '../sd-priority.mapper'
import {
  toSdPublicSettingsDTO,
  toSdSettingsDTO,
  toSdTicketPrefixes,
} from '../sd-settings.mapper'
import {
  toSdConditions,
  toSdSlaPolicyDTO,
  toSdSlaPolicySummaryDTO,
} from '../sd-sla-policy.mapper'
import {
  toSdTemplateDefaults,
  toSdTemplateTasks,
  toSdTicketTemplateDTO,
} from '../sd-ticket-template.mapper'

const now = new Date('2026-09-21T12:00:00.000Z')
const iso = now.toISOString()
const stamps = { createdAt: now, updatedAt: now }

describe('sd-settings mapper', () => {
  const settings: SdSettings = {
    id: 's1',
    workspaceId: 'ws',
    nextTicketNumber: 7,
    ticketPrefixes: { INCIDENT: 'INC2', CHANGE: '', PROBLEM: 3 },
    defaultDepartmentId: 'd1',
    defaultSlaPolicyId: null,
    whatsappConnectionId: null,
    whatsappSendAcknowledgement: true,
    portalEnabled: true,
    portalTicketTypes: ['INCIDENT'],
    portalCompanyScope: true,
    requireSignatureOnClose: false,
    requireSolutionOnResolve: true,
    autoCloseResolvedAfterHours: 72,
    slaAtRiskPercent: 80,
    reopenOnRequesterReply: true,
    autoAssignRoundRobin: false,
    kbReviewIntervalDays: 180,
    aiEnabled: true,
    aiPreServiceEnabled: false,
    aiAutoTriageEnabled: false,
    aiWhatsappAutoReply: false,
    aiPersona: null,
    aiInstructions: 'x',
    aiHandoffKeywords: ['humano'],
    updatedById: null,
    ...stamps,
  }

  it('falls back to default prefixes for missing/invalid entries', () => {
    expect(toSdTicketPrefixes(settings.ticketPrefixes)).toEqual({
      INCIDENT: 'INC2',
      SERVICE_REQUEST: 'REQ',
      CHANGE: 'CHG',
      PROBLEM: 'PRB',
    })
    expect(toSdTicketPrefixes(null)).toEqual({
      INCIDENT: 'INC',
      SERVICE_REQUEST: 'REQ',
      CHANGE: 'CHG',
      PROBLEM: 'PRB',
    })
    expect(toSdTicketPrefixes(['x']).INCIDENT).toBe('INC')
  })

  it('maps the full and public DTOs', () => {
    const dto = toSdSettingsDTO(settings)
    expect(dto).toMatchObject({
      nextTicketNumber: 7,
      aiInstructions: 'x',
      createdAt: iso,
      updatedAt: iso,
    })
    const pub = toSdPublicSettingsDTO(dto)
    expect(pub).toEqual({
      ticketPrefixes: dto.ticketPrefixes,
      portalEnabled: true,
      portalTicketTypes: ['INCIDENT'],
      portalCompanyScope: true,
      requireSignatureOnClose: false,
      requireSolutionOnResolve: true,
      reopenOnRequesterReply: true,
      slaAtRiskPercent: 80,
      defaultDepartmentId: 'd1',
      aiEnabled: true,
      aiPreServiceEnabled: false,
    })
  })
})

describe('sd-calendar mapper', () => {
  it('parses schedule/holidays with fallbacks', () => {
    expect(toSdWeeklySchedule('bad')).toEqual({
      mon: [],
      tue: [],
      wed: [],
      thu: [],
      fri: [],
      sat: [],
      sun: [],
    })
    expect(toSdHolidays('bad')).toEqual([])
    expect(
      toSdHolidays([{ date: '2026-12-25', name: 'Natal' }, { date: 'x' }]),
    ).toEqual([{ date: '2026-12-25', name: 'Natal', recurring: false }])
  })

  it('maps a calendar', () => {
    const calendar: SdBusinessCalendar = {
      id: 'c1',
      workspaceId: 'ws',
      name: '8x5',
      timezone: 'America/Sao_Paulo',
      schedule: { mon: [['08:00', '18:00']] },
      holidays: [],
      is24x7: false,
      isDefault: true,
      ...stamps,
    }
    const dto = toSdCalendarDTO(calendar)
    expect(dto.schedule.mon).toEqual([['08:00', '18:00']])
    expect(dto.schedule.sun).toEqual([])
    expect(dto).toMatchObject({ id: 'c1', isDefault: true, createdAt: iso })
  })
})

describe('sd-department mapper', () => {
  const department = (
    id: string,
    parentId: string | null,
  ): SdDepartmentWithMembers => ({
    id,
    workspaceId: 'ws',
    parentId,
    name: id,
    description: null,
    email: null,
    color: null,
    calendarId: null,
    active: true,
    position: 0,
    deletedAt: null,
    members: [
      {
        id: 'm1',
        departmentId: id,
        userId: 'u1',
        isLead: true,
        lastAssignedAt: now,
        createdAt: now,
        user: { id: 'u1', name: 'Ana', email: 'a@x.com', image: null },
      },
      {
        id: 'm2',
        departmentId: id,
        userId: 'u2',
        isLead: false,
        lastAssignedAt: null,
        createdAt: now,
        user: { id: 'u2', name: 'Bia', email: 'b@x.com', image: 'img' },
      },
    ],
    ...stamps,
  })

  it('maps members', () => {
    const dto = toSdDepartmentDTO(department('d1', null))
    expect(dto.members).toEqual([
      {
        userId: 'u1',
        name: 'Ana',
        email: 'a@x.com',
        image: null,
        isLead: true,
        lastAssignedAt: iso,
      },
      {
        userId: 'u2',
        name: 'Bia',
        email: 'b@x.com',
        image: 'img',
        isLead: false,
        lastAssignedAt: null,
      },
    ])
  })

  it('builds a two-level tree, orphans become roots', () => {
    const list: SdDepartmentDTO[] = [
      toSdDepartmentDTO(department('root', null)),
      toSdDepartmentDTO(department('child', 'root')),
      toSdDepartmentDTO(department('orphan', 'gone')),
    ]
    const tree = toSdDepartmentTree(list)
    expect(tree.map((d) => d.id)).toEqual(['root', 'orphan'])
    expect(tree[0].children.map((d) => d.id)).toEqual(['child'])
    expect(tree[1].children).toEqual([])
  })
})

describe('sd-category mapper', () => {
  const category = (id: string, parentId: string | null): SdCategory => ({
    id,
    workspaceId: 'ws',
    parentId,
    level: parentId ? 'SUBCATEGORY' : 'CATEGORY',
    name: id,
    description: null,
    icon: null,
    ticketTypes: [],
    departmentId: null,
    slaPolicyId: null,
    portalVisible: true,
    active: true,
    position: 0,
    ...stamps,
  })

  it('maps, builds the tree and prunes orphans', () => {
    const list: SdCategoryDTO[] = [
      category('a', null),
      category('a1', 'a'),
      category('x1', 'x'),
      category('x2', 'x1'),
    ].map(toSdCategoryDTO)
    expect(list[0]).toMatchObject({
      id: 'a',
      level: 'CATEGORY',
      createdAt: iso,
    })
    const tree = toSdCategoryTree(list)
    expect(tree).toHaveLength(1)
    expect(tree[0].children[0].id).toBe('a1')
    expect(pruneSdCategoryOrphans(list).map((c) => c.id)).toEqual(['a', 'a1'])
  })
})

describe('sd-classification and priority mappers', () => {
  it('maps a classification', () => {
    const row: SdClassification = {
      id: 'c',
      workspaceId: 'ws',
      kind: 'TICKET',
      name: 'Falha',
      description: null,
      color: '#ff0000',
      ticketTypes: ['INCIDENT'],
      active: true,
      position: 1,
      ...stamps,
    }
    expect(toSdClassificationDTO(row)).toMatchObject({
      id: 'c',
      kind: 'TICKET',
      position: 1,
      updatedAt: iso,
    })
  })

  it('maps scale items with missing columns as null/false', () => {
    expect(
      toSdScaleItemDTO('impact', {
        id: 'i',
        workspaceId: 'ws',
        name: 'Alto',
        level: 3,
        ...stamps,
      }),
    ).toEqual({
      id: 'i',
      kind: 'impact',
      name: 'Alto',
      description: null,
      color: null,
      level: 3,
      isDefault: false,
      createdAt: iso,
      updatedAt: iso,
    })
    expect(
      toSdScaleItemDTO('priority', {
        id: 'p',
        workspaceId: 'ws',
        name: 'P1',
        level: 4,
        color: '#f00000',
        description: 'd',
        isDefault: true,
        ...stamps,
      }),
    ).toMatchObject({ color: '#f00000', description: 'd', isDefault: true })
    const cell: SdPriorityMatrix = {
      id: 'm',
      workspaceId: 'ws',
      impactId: 'i',
      urgencyId: 'u',
      priorityId: 'p',
    }
    expect(toSdPriorityMatrixCellDTO(cell)).toEqual({
      impactId: 'i',
      urgencyId: 'u',
      priorityId: 'p',
    })
  })
})

describe('sd-phase mapper', () => {
  const phase = (id: string, ticketType: SdPhase['ticketType']): SdPhase => ({
    id,
    workspaceId: 'ws',
    ticketType,
    name: id,
    description: null,
    color: null,
    category: 'NEW',
    completionPercent: 0,
    position: 0,
    isInitial: true,
    pausesSla: false,
    requiresApproval: false,
    requiredFields: [],
    wipLimit: 0,
    active: true,
    ...stamps,
  })

  it('groups phases and transitions per ticket type', () => {
    const transition: SdPhaseTransition = {
      id: 't',
      workspaceId: 'ws',
      fromPhaseId: 'i1',
      toPhaseId: 'i2',
      allowedDepartmentIds: ['d'],
      createdAt: now,
    }
    const phases = [
      phase('i1', 'INCIDENT'),
      phase('i2', 'INCIDENT'),
      phase('c1', 'CHANGE'),
    ].map(toSdPhaseDTO)
    const flows = toSdPhaseFlows(phases, [toSdPhaseTransitionDTO(transition)])
    expect(flows.map((f) => f.ticketType)).toEqual([
      'INCIDENT',
      'SERVICE_REQUEST',
      'CHANGE',
      'PROBLEM',
    ])
    expect(flows[0].phases).toHaveLength(2)
    expect(flows[0].transitions).toEqual([
      {
        id: 't',
        fromPhaseId: 'i1',
        toPhaseId: 'i2',
        allowedDepartmentIds: ['d'],
      },
    ])
    expect(flows[2].transitions).toEqual([])
    expect(flows[1].phases).toEqual([])
  })
})

describe('sd-sla-policy mapper', () => {
  it('parses conditions with fallback and maps targets', () => {
    expect(toSdConditions('bad')).toEqual([])
    const policy: SdSlaPolicyWithTargets = {
      id: 'p',
      workspaceId: 'ws',
      kind: 'SLA',
      name: 'Padrão',
      description: null,
      calendarId: 'c',
      conditions: [{ field: 'type', operator: 'equals', value: 'INCIDENT' }],
      isDefault: true,
      active: true,
      position: 0,
      targets: [
        {
          id: 't',
          policyId: 'p',
          priorityId: 'pr',
          firstResponseMinutes: 30,
          resolutionMinutes: 240,
        },
      ],
      ...stamps,
    }
    const dto = toSdSlaPolicyDTO(policy)
    expect(dto.conditions).toHaveLength(1)
    expect(dto.targets).toEqual([
      { priorityId: 'pr', firstResponseMinutes: 30, resolutionMinutes: 240 },
    ])
    expect(toSdSlaPolicySummaryDTO(dto)).toEqual({
      id: 'p',
      kind: 'SLA',
      name: 'Padrão',
      isDefault: true,
      active: true,
      calendarId: 'c',
    })
  })
})

describe('rule mappers', () => {
  it('maps escalation rules, defaulting invalid actions', () => {
    expect(toSdEscalationActions('bad').kind).toBe('HIERARCHICAL')
    const rule: SdEscalationRule = {
      id: 'e',
      workspaceId: 'ws',
      name: 'Risco',
      trigger: 'NO_UPDATE',
      thresholdMinutes: 60,
      conditions: [],
      actions: { kind: 'HIERARCHICAL', notifyUserIds: ['u'] },
      active: true,
      position: 0,
      ...stamps,
    }
    expect(toSdEscalationRuleDTO(rule)).toMatchObject({
      thresholdMinutes: 60,
      actions: { notifyUserIds: ['u'] },
      createdAt: iso,
    })
  })

  it('maps automation rules, dropping invalid actions', () => {
    const rule: SdAutomationRule = {
      id: 'a',
      workspaceId: 'ws',
      name: 'Regra',
      description: null,
      event: 'TICKET_CREATED',
      conditions: 'bad',
      actions: [{ type: 'add_tag', params: { tag: 'x' } }, { type: 'nope' }],
      stopProcessing: false,
      active: true,
      position: 0,
      runCount: 2,
      lastRunAt: now,
      ...stamps,
    }
    const dto = toSdAutomationRuleDTO(rule)
    expect(dto.actions).toEqual([{ type: 'add_tag', params: { tag: 'x' } }])
    expect(dto.conditions).toEqual([])
    expect(dto.lastRunAt).toBe(iso)
    expect(
      toSdAutomationRuleDTO({ ...rule, actions: {}, lastRunAt: null }),
    ).toMatchObject({ actions: [], lastRunAt: null })
  })
})

describe('sd-custom-field mapper', () => {
  it('parses options and maps the definition', () => {
    expect(toSdCustomFieldOptions('bad')).toEqual([])
    const field: SdCustomFieldDefinition = {
      id: 'f',
      workspaceId: 'ws',
      entity: 'TICKET',
      key: 'serial',
      label: 'Série',
      description: null,
      type: 'SELECT',
      options: [{ value: 'a', label: 'A' }, { value: '' }],
      ticketTypes: [],
      categoryIds: [],
      required: false,
      visibleInPortal: true,
      defaultValue: null,
      active: true,
      position: 0,
      ...stamps,
    }
    const dto = toSdCustomFieldDTO(field)
    expect(dto.options).toEqual([{ value: 'a', label: 'A' }])
    expect(dto.defaultValue).toBeNull()
    expect(
      toSdCustomFieldDTO({ ...field, defaultValue: 'a' }).defaultValue,
    ).toBe('a')
  })
})

describe('sd-ticket-template mapper', () => {
  it('parses defaults/tasks with fallbacks', () => {
    expect(toSdTemplateDefaults({ foo: 1 })).toEqual({})
    expect(toSdTemplateTasks('bad')).toEqual([])
    const template: SdTicketTemplate = {
      id: 't',
      workspaceId: 'ws',
      ticketType: 'SERVICE_REQUEST',
      name: 'Reset',
      description: null,
      defaults: { title: 'Reset' },
      tasks: [{ title: 'A' }, { nope: 1 }],
      portalVisible: true,
      active: true,
      position: 0,
      ...stamps,
    }
    expect(toSdTicketTemplateDTO(template)).toMatchObject({
      defaults: { title: 'Reset' },
      tasks: [{ title: 'A' }],
      createdAt: iso,
    })
  })
})

describe('sd-canned-response and part mappers', () => {
  it('maps canned responses with or without author', () => {
    const response: SdCannedResponseWithAuthor = {
      id: 'r',
      workspaceId: 'ws',
      title: 'Oi',
      shortcut: null,
      body: 'Olá',
      departmentId: null,
      createdById: 'u',
      createdBy: { name: 'Ana' },
      ...stamps,
    }
    expect(toSdCannedResponseDTO(response).createdByName).toBe('Ana')
    expect(
      toSdCannedResponseDTO({ ...response, createdBy: null }).createdByName,
    ).toBeNull()
  })

  it('serializes the part unit cost', () => {
    const part: SdPart = {
      id: 'p',
      workspaceId: 'ws',
      name: 'Cabo',
      sku: null,
      description: null,
      unitCost: new Prisma.Decimal('129.9'),
      stock: null,
      active: true,
      ...stamps,
    }
    expect(toSdPartDTO(part)).toMatchObject({
      unitCost: '129.90',
      createdAt: iso,
    })
  })
})
