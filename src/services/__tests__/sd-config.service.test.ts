import type {
  SdCategory,
  SdClassification,
  SdCustomFieldDefinition,
  SdPhase,
  SdSettings,
  SdTicketTemplate,
} from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeProfile } from '@/src/__tests__/factories/profile.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { actAs } from '@/src/__tests__/helpers/sd-config.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import type { SdCannedResponseWithAuthor } from '@/src/repositories/sd-canned-response.repository'
import type { SdWorkspaceMemberRow } from '@/src/repositories/sd-config.repository'
import type { SdDepartmentWithMembers } from '@/src/repositories/sd-department.repository'
import type { SdSlaPolicyWithTargets } from '@/src/repositories/sd-sla-policy.repository'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/sd-access.repository')
vi.mock('@/src/repositories/sd-config.repository')
vi.mock('@/src/repositories/sd-settings.repository')
vi.mock('@/src/repositories/sd-department.repository')
vi.mock('@/src/repositories/sd-category.repository')
vi.mock('@/src/repositories/sd-classification.repository')
vi.mock('@/src/repositories/sd-priority.repository')
vi.mock('@/src/repositories/sd-phase.repository')
vi.mock('@/src/repositories/sd-custom-field.repository')
vi.mock('@/src/repositories/sd-ticket-template.repository')
vi.mock('@/src/repositories/sd-canned-response.repository')
vi.mock('@/src/repositories/sd-sla-policy.repository')

import { SdCannedResponseRepository } from '@/src/repositories/sd-canned-response.repository'
import { SdCategoryRepository } from '@/src/repositories/sd-category.repository'
import { SdClassificationRepository } from '@/src/repositories/sd-classification.repository'
import { SdConfigRepository } from '@/src/repositories/sd-config.repository'
import { SdCustomFieldRepository } from '@/src/repositories/sd-custom-field.repository'
import { SdDepartmentRepository } from '@/src/repositories/sd-department.repository'
import { SdPhaseRepository } from '@/src/repositories/sd-phase.repository'
import { SdPriorityRepository } from '@/src/repositories/sd-priority.repository'
import { SdSettingsRepository } from '@/src/repositories/sd-settings.repository'
import { SdSlaPolicyRepository } from '@/src/repositories/sd-sla-policy.repository'
import { SdTicketTemplateRepository } from '@/src/repositories/sd-ticket-template.repository'
import { SdConfigService } from '../sd-config.service'

const WS = 'ws1'
const now = new Date('2026-01-01T00:00:00Z')

const settings: SdSettings = {
  id: 's1',
  workspaceId: WS,
  nextTicketNumber: 1,
  ticketPrefixes: { INCIDENT: 'INC' },
  defaultDepartmentId: null,
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
  aiEnabled: false,
  aiPreServiceEnabled: false,
  aiAutoTriageEnabled: false,
  aiWhatsappAutoReply: false,
  aiPersona: 'segredo',
  aiInstructions: null,
  aiHandoffKeywords: [],
  updatedById: null,
  createdAt: now,
  updatedAt: now,
}

const department: SdDepartmentWithMembers = {
  id: 'd1',
  workspaceId: WS,
  parentId: null,
  name: 'Service Desk',
  description: null,
  email: null,
  color: null,
  calendarId: null,
  active: true,
  position: 0,
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
  members: [
    {
      id: 'm1',
      departmentId: 'd1',
      userId: 'u1',
      isLead: true,
      lastAssignedAt: null,
      createdAt: now,
      user: { id: 'u1', name: 'Ana', email: 'ana@x.com', image: null },
    },
  ],
}

function category(overrides: Partial<SdCategory>): SdCategory {
  return {
    id: 'c1',
    workspaceId: WS,
    parentId: null,
    level: 'CATEGORY',
    name: 'Infra',
    description: null,
    icon: null,
    ticketTypes: [],
    departmentId: null,
    slaPolicyId: null,
    portalVisible: true,
    active: true,
    position: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

const classification: SdClassification = {
  id: 'cl1',
  workspaceId: WS,
  kind: 'TICKET',
  name: 'Falha',
  description: null,
  color: null,
  ticketTypes: [],
  active: true,
  position: 0,
  createdAt: now,
  updatedAt: now,
}

const scale = (id: string, level: number) => ({
  id,
  workspaceId: WS,
  name: id,
  level,
  createdAt: now,
  updatedAt: now,
})

const phase: SdPhase = {
  id: 'ph1',
  workspaceId: WS,
  ticketType: 'INCIDENT',
  name: 'Novo',
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
  createdAt: now,
  updatedAt: now,
}

function customField(
  overrides: Partial<SdCustomFieldDefinition>,
): SdCustomFieldDefinition {
  return {
    id: 'f1',
    workspaceId: WS,
    entity: 'TICKET',
    key: 'k',
    label: 'K',
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
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function template(overrides: Partial<SdTicketTemplate>): SdTicketTemplate {
  return {
    id: 't1',
    workspaceId: WS,
    ticketType: 'INCIDENT',
    name: 'T',
    description: null,
    defaults: {},
    tasks: [],
    portalVisible: false,
    active: true,
    position: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

const canned: SdCannedResponseWithAuthor = {
  id: 'cr1',
  workspaceId: WS,
  title: 'Oi',
  shortcut: null,
  body: 'Olá',
  departmentId: null,
  createdById: 'u1',
  createdAt: now,
  updatedAt: now,
  createdBy: { name: 'Ana' },
}

const policy: SdSlaPolicyWithTargets = {
  id: 'sla1',
  workspaceId: WS,
  kind: 'SLA',
  name: 'Padrão',
  description: null,
  calendarId: null,
  conditions: [],
  isDefault: true,
  active: true,
  position: 0,
  createdAt: now,
  updatedAt: now,
  targets: [],
}

beforeEach(() => {
  actAs('agent', 'd1')
  vi.mocked(SdSettingsRepository.getOrCreate).mockResolvedValue(ok(settings))
  vi.mocked(SdDepartmentRepository.list).mockResolvedValue(ok([department]))
  vi.mocked(SdCategoryRepository.list).mockResolvedValue(
    ok([
      category({ id: 'c1' }),
      category({ id: 'c2', portalVisible: false, name: 'Oculta' }),
      category({ id: 'c3', parentId: 'c2', level: 'SUBCATEGORY' }),
      category({ id: 'c4', parentId: 'c1', level: 'SUBCATEGORY' }),
    ]),
  )
  vi.mocked(SdClassificationRepository.list).mockResolvedValue(
    ok([classification]),
  )
  vi.mocked(SdPriorityRepository.list).mockImplementation(async (kind) =>
    ok([scale(`${kind}-1`, 1)]),
  )
  vi.mocked(SdPriorityRepository.listMatrix).mockResolvedValue(
    ok([
      {
        id: 'mx1',
        workspaceId: WS,
        impactId: 'impact-1',
        urgencyId: 'urgency-1',
        priorityId: 'priority-1',
      },
    ]),
  )
  vi.mocked(SdPhaseRepository.list).mockResolvedValue(ok([phase]))
  vi.mocked(SdPhaseRepository.listTransitions).mockResolvedValue(ok([]))
  vi.mocked(SdCustomFieldRepository.list).mockResolvedValue(
    ok([customField({}), customField({ id: 'f2', visibleInPortal: true })]),
  )
  vi.mocked(SdTicketTemplateRepository.list).mockResolvedValue(
    ok([template({}), template({ id: 't2', portalVisible: true })]),
  )
  vi.mocked(SdCannedResponseRepository.list).mockResolvedValue(ok([canned]))
  vi.mocked(SdSlaPolicyRepository.list).mockResolvedValue(ok([policy]))
})

describe('SdConfigService.bootstrap', () => {
  it('returns the full payload to agents', async () => {
    const data = expectOk(await SdConfigService.bootstrap('u1', WS))
    expect(data.me).toMatchObject({
      isAgent: true,
      isAdmin: false,
      departmentIds: ['d1'],
    })
    expect(data.settings).not.toHaveProperty('aiPersona')
    expect(data.settings.ticketPrefixes.INCIDENT).toBe('INC')
    expect(data.departments[0].members).toHaveLength(1)
    expect(data.categories.map((c) => c.id)).toEqual(['c1', 'c2'])
    expect(data.categories[0].children.map((c) => c.id)).toEqual(['c4'])
    expect(data.impacts[0]).toMatchObject({ id: 'impact-1', kind: 'impact' })
    expect(data.priorities[0].kind).toBe('priority')
    expect(data.severities[0].kind).toBe('severity')
    expect(data.urgencies[0].kind).toBe('urgency')
    expect(data.priorityMatrix).toEqual([
      {
        impactId: 'impact-1',
        urgencyId: 'urgency-1',
        priorityId: 'priority-1',
      },
    ])
    expect(data.phases).toHaveLength(4)
    expect(data.phases[0].phases[0].id).toBe('ph1')
    expect(data.customFields).toHaveLength(2)
    expect(data.templates).toHaveLength(2)
    expect(data.cannedResponses).toHaveLength(1)
    expect(data.slaPolicies).toEqual([
      {
        id: 'sla1',
        kind: 'SLA',
        name: 'Padrão',
        isDefault: true,
        active: true,
        calendarId: null,
      },
    ])
    expect(SdDepartmentRepository.list).toHaveBeenCalledWith(WS, {
      includeInactive: true,
    })
  })

  it('returns only portal-visible data to requesters', async () => {
    actAs('requester')
    const data = expectOk(await SdConfigService.bootstrap('u1', WS))
    expect(data.me.isAgent).toBe(false)
    expect(data.departments[0].members).toEqual([])
    expect(data.categories.map((c) => c.id)).toEqual(['c1'])
    expect(data.categories[0].children.map((c) => c.id)).toEqual(['c4'])
    expect(data.customFields.map((f) => f.id)).toEqual(['f2'])
    expect(data.templates.map((t) => t.id)).toEqual(['t2'])
    expect(data.cannedResponses).toEqual([])
    expect(data.slaPolicies).toEqual([])
    expect(SdCannedResponseRepository.list).not.toHaveBeenCalled()
    expect(SdSlaPolicyRepository.list).not.toHaveBeenCalled()
    expect(SdCategoryRepository.list).toHaveBeenCalledWith(WS, {
      includeInactive: false,
    })
  })

  it('propagates the first failing read', async () => {
    vi.mocked(SdPhaseRepository.listTransitions).mockResolvedValue(
      err(databaseError('transitions')),
    )
    const e = expectErr(
      await SdConfigService.bootstrap('u1', WS),
      'DATABASE_ERROR',
    )
    expect(e.message).toBe('transitions')
  })

  it('denies strangers and disabled module', async () => {
    actAs('stranger')
    expectErr(await SdConfigService.bootstrap('u1', WS), 'FORBIDDEN')
    actAs('disabled')
    expectErr(await SdConfigService.bootstrap('u1', WS), 'MODULE_DISABLED')
  })
})

describe('SdConfigService.me', () => {
  it('returns the access context', async () => {
    actAs('lead', 'd7')
    const me = expectOk(await SdConfigService.me('u1', WS))
    expect(me).toEqual({
      userId: 'u1',
      isAgent: true,
      isAdmin: false,
      departmentIds: ['d7'],
      leadDepartmentIds: ['d7'],
    })
  })

  it('reports requesters and admins', async () => {
    actAs('requester')
    expect(expectOk(await SdConfigService.me('u1', WS)).isAgent).toBe(false)
    actAs('owner')
    expect(expectOk(await SdConfigService.me('u1', WS))).toMatchObject({
      isAgent: true,
      isAdmin: true,
    })
    actAs('stranger')
    expectErr(await SdConfigService.me('u1', WS), 'FORBIDDEN')
  })
})

describe('SdConfigService.agents', () => {
  const user = (id: string) => ({
    id,
    name: id,
    email: `${id}@x.com`,
    image: null,
  })
  const members: SdWorkspaceMemberRow[] = [
    { role: 'OWNER', profile: null, user: user('owner'), departments: [] },
    {
      role: 'MEMBER',
      profile: createFakeProfile({
        permissions: { 'sd-settings': ['VIEW', 'EDIT'] },
      }),
      user: user('custom-admin'),
      departments: [],
    },
    {
      role: 'MEMBER',
      profile: null,
      user: user('agent'),
      departments: [{ departmentId: 'd1', isLead: false }],
    },
    {
      role: 'MEMBER',
      profile: createFakeProfile({ permissions: null }),
      user: user('no-perms'),
      departments: [],
    },
    { role: 'VIEWER', profile: null, user: user('requester'), departments: [] },
  ]

  it('lists admins and department members', async () => {
    vi.mocked(SdConfigRepository.listWorkspaceMembers).mockResolvedValue(
      ok(members),
    )
    const agents = expectOk(await SdConfigService.agents('u1', WS))
    expect(agents.map((a) => [a.id, a.isAdmin, a.isAgent])).toEqual([
      ['owner', true, true],
      ['custom-admin', true, true],
      ['agent', false, true],
    ])
    expect(agents[2].departments).toEqual([
      { departmentId: 'd1', isLead: false },
    ])
  })

  it('includes requesters on demand', async () => {
    vi.mocked(SdConfigRepository.listWorkspaceMembers).mockResolvedValue(
      ok(members),
    )
    const all = expectOk(
      await SdConfigService.agents('u1', WS, { includeRequesters: true }),
    )
    expect(all).toHaveLength(5)
    expect(all.find((a) => a.id === 'requester')?.isAgent).toBe(false)
  })

  it('refuses requesters and propagates errors', async () => {
    actAs('requester')
    expectErr(await SdConfigService.agents('u1', WS), 'SD_NOT_AGENT')
    actAs('agent')
    vi.mocked(SdConfigRepository.listWorkspaceMembers).mockResolvedValue(
      err(databaseError()),
    )
    expectErr(await SdConfigService.agents('u1', WS), 'DATABASE_ERROR')
  })
})
