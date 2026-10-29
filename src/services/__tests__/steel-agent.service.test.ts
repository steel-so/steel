import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import {
  createFakeSteelAgentRun,
  createFakeSteelAgentRunDetail,
  createFakeSteelAgentRunStep,
  createFakeSteelAgentTool,
  createFakeSteelAgentWithRelations,
} from '@/src/__tests__/factories/steel-agent.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, forbidden, notFound } from '@/src/errors'
import type { AnySteelAiTool } from '@/src/lib/ai/tools/types'
import { SYSTEM_PROFILE_PERMISSIONS } from '@/src/lib/permissions'
import { err, ok } from '@/src/lib/result'
import {
  CreateSteelAgentSchema,
  type UpdateSteelAgentDTO,
} from '@/src/schemas/steel-agent.schema'

const registry = vi.hoisted(() => ({ tools: [] as unknown[] }))

vi.mock('@/src/lib/ai/tools/index', () => ({
  get STEEL_AI_TOOLS() {
    return registry.tools
  },
}))
vi.mock('@/src/lib/ai/tools', () => ({
  get STEEL_AI_TOOLS() {
    return registry.tools
  },
}))
vi.mock('@/src/lib/ai/tools/registry', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/src/lib/ai/tools/registry')>()
  type Tools = Parameters<typeof actual.findTool>[1]
  return {
    ...actual,
    findTool: vi.fn((name: string) =>
      actual.findTool(name, registry.tools as Tools),
    ),
  }
})
vi.mock('@/src/services/authz', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/services/authz')>()),
  assertMember: vi.fn(),
}))
vi.mock('@/src/repositories/steel-agent.repository')
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/ai-settings.repository')
vi.mock('@/src/lib/steel-agents/enqueue')

import { enqueueSteelAgentRun } from '@/src/lib/steel-agents/enqueue'
import { WorkspaceAiSettingsRepository } from '@/src/repositories/ai-settings.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import {
  SteelAgentRepository,
  SteelAgentRunRepository,
} from '@/src/repositories/steel-agent.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { assertMember } from '@/src/services/authz'
import { SteelAgentService } from '../steel-agent.service'

const member = vi.mocked(assertMember)
const agents = vi.mocked(SteelAgentRepository)
const runs = vi.mocked(SteelAgentRunRepository)
const memberships = vi.mocked(MembershipRepository)
const settings = vi.mocked(WorkspaceAiSettingsRepository)
const modules = vi.mocked(WorkspaceModuleAccessRepository)
const enqueue = vi.mocked(enqueueSteelAgentRun)

const tool = (
  name: string,
  kind: AnySteelAiTool['kind'],
  module: AnySteelAiTool['module'],
): AnySteelAiTool => ({
  name,
  label: `Label ${name}`,
  module,
  kind,
  description: `Desc ${name}`,
  parameters: { type: 'object', properties: {} },
  parse: (args) => ok(args),
  ...(kind !== 'READ' && { preview: vi.fn() }),
  execute: vi.fn(),
})

const ADMIN = { role: 'ADMIN' as const, isPrivileged: true, permissions: null }
const MEMBER = {
  role: 'MEMBER' as const,
  isPrivileged: false,
  permissions: SYSTEM_PROFILE_PERMISSIONS.MEMBER,
}
const VIEWER = {
  role: 'VIEWER' as const,
  isPrivileged: false,
  permissions: SYSTEM_PROFILE_PERMISSIONS.VIEWER,
}

const AGENT = createFakeSteelAgentWithRelations({
  id: 'agent1',
  workspaceId: 'ws1',
  ownerId: 'owner1',
  tools: [
    createFakeSteelAgentTool({ toolName: 'crm_delete_task', mode: 'AUTO' }),
    createFakeSteelAgentTool({ toolName: 'gone_tool', mode: 'AUTO' }),
  ],
})

const baseCreate = () =>
  CreateSteelAgentSchema.parse({
    name: 'Triagem',
    instructions: 'Faça a triagem',
    triggerType: 'SCHEDULE',
    cron: '0 8 * * 1-5',
    ownerId: 'owner1',
    tools: [
      { toolName: 'sd_list_tickets', mode: 'AUTO' },
      { toolName: 'crm_delete_task', mode: 'AUTO' },
      { toolName: 'ws_overview' },
    ],
  })

beforeEach(() => {
  registry.tools = [
    tool('sd_list_tickets', 'READ', 'SERVICE_DESK'),
    tool('crm_delete_task', 'DELETE', 'CRM'),
    tool('zap_send', 'ACTION', 'COMMUNICATION'),
    tool('ws_overview', 'READ', null),
  ]
  member.mockResolvedValue(ok(ADMIN))
  modules.listByWorkspace.mockResolvedValue(
    ok([
      { module: 'SERVICE_DESK', enabled: true },
      { module: 'CRM', enabled: true },
      { module: 'COMMUNICATION', enabled: false },
    ] as never),
  )
  memberships.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership() as never),
  )
  agents.listByWorkspace.mockResolvedValue(ok([AGENT]))
  agents.findById.mockResolvedValue(ok(AGENT))
  agents.create.mockImplementation(async (data) =>
    ok(
      createFakeSteelAgentWithRelations({
        ...data,
        tools: data.tools.map((t) => createFakeSteelAgentTool(t)),
      }),
    ),
  )
  agents.update.mockImplementation(async (_id, data) =>
    ok({ ...AGENT, ...data } as never),
  )
  agents.delete.mockResolvedValue(ok(true))
  settings.findByWorkspace.mockResolvedValue(ok(null))
  runs.create.mockImplementation(async (data) =>
    ok(
      createFakeSteelAgentRun({
        id: 'run1',
        ...data,
        triggerPayload: (data.triggerPayload ?? null) as never,
      }),
    ),
  )
  runs.update.mockResolvedValue(ok(createFakeSteelAgentRun()))
  enqueue.mockResolvedValue(ok(true))
})

describe('SteelAgentService — read', () => {
  it('should list agents with effective tool modes (DELETE locked to approval)', async () => {
    const list = expectOk(await SteelAgentService.list('u1', 'ws1'))
    expect(member).toHaveBeenCalledWith('u1', 'ws1', {
      resource: 'steel-agents',
      action: 'VIEW',
    })
    expect(list[0].tools).toEqual([
      { toolName: 'crm_delete_task', mode: 'APPROVAL' },
      { toolName: 'gone_tool', mode: 'AUTO' },
    ])
  })

  it('should get one agent and propagate errors', async () => {
    expect(
      expectOk(await SteelAgentService.get('u1', 'ws1', 'agent1')).id,
    ).toBe('agent1')
    agents.findById.mockResolvedValue(err(databaseError('x')))
    expectErr(await SteelAgentService.get('u1', 'ws1', 'a'), 'DATABASE_ERROR')
    agents.listByWorkspace.mockResolvedValue(err(databaseError('x')))
    expectErr(await SteelAgentService.list('u1', 'ws1'), 'DATABASE_ERROR')
  })

  it('should deny non-members on every read', async () => {
    member.mockResolvedValue(err(forbidden()))
    expectErr(await SteelAgentService.list('x', 'ws1'), 'FORBIDDEN')
    expectErr(await SteelAgentService.get('x', 'ws1', 'a'), 'FORBIDDEN')
    expectErr(await SteelAgentService.catalog('x', 'ws1'), 'FORBIDDEN')
    expectErr(
      await SteelAgentService.listRuns('x', 'ws1', 'a', { limit: 20 }),
      'FORBIDDEN',
    )
    expectErr(await SteelAgentService.getRun('x', 'ws1', 'a', 'r'), 'FORBIDDEN')
  })

  it('should build the catalog for enabled modules only', async () => {
    const catalog = expectOk(await SteelAgentService.catalog('u1', 'ws1'))
    expect(catalog.tools.map((t) => t.name)).toEqual([
      'sd_list_tickets',
      'crm_delete_task',
      'ws_overview',
    ])
    expect(catalog.events.map((e) => e.key)).toEqual([
      'sd.ticket.created',
      'crm.lead.created',
      'sd.insight.detected',
      'crm.insight.detected',
    ])
    expect(catalog.agentModeEnabled).toBe(true)
    expect(catalog.canManage).toBe(true)

    member.mockResolvedValue(ok(MEMBER))
    settings.findByWorkspace.mockResolvedValue(
      ok({ agentModeEnabled: false } as never),
    )
    const asMember = expectOk(await SteelAgentService.catalog('u1', 'ws1'))
    expect(asMember.canManage).toBe(false)
    expect(asMember.agentModeEnabled).toBe(false)

    member.mockResolvedValue(ok({ ...MEMBER, permissions: null }))
    expect(
      expectOk(await SteelAgentService.catalog('u1', 'ws1')).canManage,
    ).toBe(false)
  })

  it('should propagate catalog lookups errors', async () => {
    modules.listByWorkspace.mockResolvedValue(err(databaseError('x')))
    expectErr(await SteelAgentService.catalog('u1', 'ws1'), 'DATABASE_ERROR')
    modules.listByWorkspace.mockResolvedValue(ok([]))
    settings.findByWorkspace.mockResolvedValue(err(databaseError('x')))
    expectErr(await SteelAgentService.catalog('u1', 'ws1'), 'DATABASE_ERROR')
  })
})

describe('SteelAgentService.create', () => {
  it('should create with normalized trigger and forced approval for DELETE', async () => {
    const dto = expectOk(
      await SteelAgentService.create('admin1', 'ws1', baseCreate()),
    )
    expect(member).toHaveBeenCalledWith('admin1', 'ws1', {
      resource: 'steel-agents',
      action: 'CREATE',
    })
    const data = agents.create.mock.calls[0][0]
    expect(data).toEqual(
      expect.objectContaining({
        workspaceId: 'ws1',
        createdById: 'admin1',
        cron: '0 8 * * 1-5',
        eventKey: null,
        nextRunAt: expect.any(Date),
        tools: [
          { toolName: 'sd_list_tickets', mode: 'AUTO' },
          { toolName: 'crm_delete_task', mode: 'APPROVAL' },
          { toolName: 'ws_overview', mode: 'APPROVAL' },
        ],
      }),
    )
    expect(dto.name).toBe('Triagem')
  })

  it('should forbid members and viewers', async () => {
    member.mockResolvedValue(err(forbidden()))
    expectErr(
      await SteelAgentService.create('m1', 'ws1', baseCreate()),
      'FORBIDDEN',
    )
  })

  it('should reject an owner outside the workspace', async () => {
    memberships.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(
      await SteelAgentService.create('admin1', 'ws1', baseCreate()),
      'STEEL_AGENT_INVALID_OWNER',
    )
    memberships.findByUserAndWorkspace.mockResolvedValue(
      err(databaseError('x')),
    )
    expectErr(
      await SteelAgentService.create('admin1', 'ws1', baseCreate()),
      'DATABASE_ERROR',
    )
  })

  it('should reject unknown tools and tools of disabled modules', async () => {
    const unknown = {
      ...baseCreate(),
      tools: [{ toolName: 'nope', mode: 'AUTO' as const }],
    }
    expectErr(
      await SteelAgentService.create('admin1', 'ws1', unknown),
      'STEEL_AGENT_INVALID_TOOL',
    )
    const disabled = {
      ...baseCreate(),
      tools: [{ toolName: 'zap_send', mode: 'AUTO' as const }],
    }
    expectErr(
      await SteelAgentService.create('admin1', 'ws1', disabled),
      'STEEL_AGENT_INVALID_TOOL',
    )
    modules.listByWorkspace.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await SteelAgentService.create('admin1', 'ws1', baseCreate()),
      'DATABASE_ERROR',
    )
  })

  it('should create an agent without tools and propagate a create error', async () => {
    const dto = { ...baseCreate(), tools: [], description: undefined }
    expectOk(await SteelAgentService.create('admin1', 'ws1', dto))
    expect(modules.listByWorkspace).not.toHaveBeenCalled()
    agents.create.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await SteelAgentService.create('admin1', 'ws1', dto),
      'DATABASE_ERROR',
    )
  })
})

describe('SteelAgentService.update', () => {
  const update = (dto: UpdateSteelAgentDTO) =>
    SteelAgentService.update('admin1', 'ws1', 'agent1', dto)

  it('should merge the trigger and replace tools', async () => {
    expectOk(
      await update({
        triggerType: 'EVENT',
        eventKey: 'sd.ticket.created',
        tools: [{ toolName: 'sd_list_tickets', mode: 'AUTO' }],
      }),
    )
    expect(agents.update).toHaveBeenCalledWith(
      'agent1',
      expect.objectContaining({
        triggerType: 'EVENT',
        eventKey: 'sd.ticket.created',
        cron: null,
        nextRunAt: null,
      }),
      [{ toolName: 'sd_list_tickets', mode: 'AUTO' }],
    )
  })

  it('should keep tools untouched when not sent and validate a new owner', async () => {
    expectOk(await update({ enabled: false, ownerId: 'owner2' }))
    expect(agents.update.mock.calls[0][2]).toBeUndefined()
    expect(memberships.findByUserAndWorkspace).toHaveBeenCalledWith(
      'owner2',
      'ws1',
    )

    memberships.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(await update({ ownerId: 'owner3' }), 'STEEL_AGENT_INVALID_OWNER')
    expectOk(await update({ ownerId: 'owner1' }))
  })

  it('should reject an invalid merged trigger', async () => {
    expectErr(
      await update({ triggerType: 'SCHEDULE' }),
      'STEEL_AGENT_INVALID_TRIGGER',
    )
    agents.findById.mockResolvedValue(
      ok({ ...AGENT, triggerType: 'SCHEDULE', cron: '0 8 * * *' }),
    )
    expectOk(await update({ timezone: 'America/Manaus' }))
    expectErr(
      await update({ cron: 'not a cron' }),
      'STEEL_AGENT_INVALID_TRIGGER',
    )
  })

  it('should propagate authz, lookup, tool and save errors', async () => {
    member.mockResolvedValue(err(forbidden()))
    expectErr(await update({ name: 'x' }), 'FORBIDDEN')
    member.mockResolvedValue(ok(ADMIN))

    agents.findById.mockResolvedValue(err(databaseError('x')))
    expectErr(await update({ name: 'x' }), 'DATABASE_ERROR')
    agents.findById.mockResolvedValue(ok(AGENT))

    expectErr(
      await update({ tools: [{ toolName: 'nope', mode: 'AUTO' }] }),
      'STEEL_AGENT_INVALID_TOOL',
    )
    agents.update.mockResolvedValue(err(databaseError('x')))
    expectErr(await update({ name: 'x' }), 'DATABASE_ERROR')
  })
})

describe('SteelAgentService.delete', () => {
  it('should delete with DELETE permission', async () => {
    const dto = expectOk(
      await SteelAgentService.delete('admin1', 'ws1', 'agent1'),
    )
    expect(dto.id).toBe('agent1')
    expect(member).toHaveBeenCalledWith('admin1', 'ws1', {
      resource: 'steel-agents',
      action: 'DELETE',
    })
  })

  it('should propagate errors', async () => {
    member.mockResolvedValue(err(forbidden()))
    expectErr(await SteelAgentService.delete('m', 'ws1', 'agent1'), 'FORBIDDEN')
    member.mockResolvedValue(ok(ADMIN))
    agents.findById.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await SteelAgentService.delete('a', 'ws1', 'agent1'),
      'DATABASE_ERROR',
    )
    agents.findById.mockResolvedValue(ok(AGENT))
    agents.delete.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await SteelAgentService.delete('a', 'ws1', 'agent1'),
      'DATABASE_ERROR',
    )
  })
})

describe('SteelAgentService.runNow', () => {
  it('should queue a MANUAL run for a manager', async () => {
    const run = expectOk(
      await SteelAgentService.runNow('admin1', 'ws1', 'agent1'),
    )
    expect(run.triggerType).toBe('MANUAL')
    expect(runs.create).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      agentId: 'agent1',
      triggerType: 'MANUAL',
      startedById: 'admin1',
    })
    expect(enqueue).toHaveBeenCalledWith('run1')
  })

  it('should let the owner run it but not other members', async () => {
    member.mockResolvedValue(ok(MEMBER))
    expectOk(await SteelAgentService.runNow('owner1', 'ws1', 'agent1'))
    member.mockResolvedValue(ok(VIEWER))
    expectErr(
      await SteelAgentService.runNow('v1', 'ws1', 'agent1'),
      'FORBIDDEN',
    )
  })

  it('should refuse a paused agent', async () => {
    agents.findById.mockResolvedValue(ok({ ...AGENT, enabled: false }))
    expectErr(
      await SteelAgentService.runNow('admin1', 'ws1', 'agent1'),
      'STEEL_AGENT_DISABLED',
    )
  })

  it('should mark the run failed when it cannot be enqueued', async () => {
    enqueue.mockResolvedValue(err(databaseError('redis')))
    expectErr(await SteelAgentService.runNow('admin1', 'ws1', 'agent1'))
    expect(runs.update).toHaveBeenCalledWith(
      'run1',
      expect.objectContaining({ status: 'FAILED' }),
    )
  })

  it('should propagate errors', async () => {
    member.mockResolvedValue(err(forbidden()))
    expectErr(await SteelAgentService.runNow('x', 'ws1', 'agent1'), 'FORBIDDEN')
    member.mockResolvedValue(ok(ADMIN))
    agents.findById.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await SteelAgentService.runNow('a', 'ws1', 'agent1'),
      'DATABASE_ERROR',
    )
    agents.findById.mockResolvedValue(ok(AGENT))
    runs.create.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await SteelAgentService.runNow('a', 'ws1', 'agent1'),
      'DATABASE_ERROR',
    )
  })
})

describe('SteelAgentService.testRun', () => {
  it('should queue a test run, even for a paused agent', async () => {
    agents.findById.mockResolvedValue(ok({ ...AGENT, enabled: false }))
    expectOk(await SteelAgentService.testRun('admin1', 'ws1', 'agent1'))
    expect(runs.create).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      agentId: 'agent1',
      triggerType: 'MANUAL',
      startedById: 'admin1',
      isTest: true,
    })
    expect(enqueue).toHaveBeenCalledWith('run1')
  })

  it('should keep the run-now gate: owner or manager only', async () => {
    member.mockResolvedValue(ok(MEMBER))
    expectOk(await SteelAgentService.testRun('owner1', 'ws1', 'agent1'))
    member.mockResolvedValue(ok(VIEWER))
    expectErr(
      await SteelAgentService.testRun('v1', 'ws1', 'agent1'),
      'FORBIDDEN',
    )
  })
})

describe('SteelAgentService.rerunAsTest', () => {
  const original = (over = {}) =>
    createFakeSteelAgentRunDetail({
      id: 'old1',
      agentId: 'agent1',
      triggerType: 'EVENT',
      triggerPayload: { ticketId: 't1' },
      ...over,
    })

  it('should replay the trigger and input of the original run as a test', async () => {
    runs.findDetail.mockResolvedValue(ok(original()))
    expectOk(
      await SteelAgentService.rerunAsTest('admin1', 'ws1', 'agent1', 'old1'),
    )
    expect(runs.findDetail).toHaveBeenCalledWith('old1', 'ws1')
    expect(runs.create).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      agentId: 'agent1',
      triggerType: 'EVENT',
      triggerPayload: { ticketId: 't1' },
      startedById: 'admin1',
      isTest: true,
      rerunOfId: 'old1',
    })
    expect(enqueue).toHaveBeenCalledWith('run1')
  })

  it('should omit the payload when the original had none, even for a paused agent', async () => {
    agents.findById.mockResolvedValue(ok({ ...AGENT, enabled: false }))
    runs.findDetail.mockResolvedValue(
      ok(original({ triggerType: 'SCHEDULE', triggerPayload: null })),
    )
    expectOk(
      await SteelAgentService.rerunAsTest('admin1', 'ws1', 'agent1', 'old1'),
    )
    expect(runs.create).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      agentId: 'agent1',
      triggerType: 'SCHEDULE',
      startedById: 'admin1',
      isTest: true,
      rerunOfId: 'old1',
    })
  })

  it('should keep the owner-or-manager gate', async () => {
    runs.findDetail.mockResolvedValue(ok(original()))
    member.mockResolvedValue(ok(VIEWER))
    expectErr(
      await SteelAgentService.rerunAsTest('v1', 'ws1', 'agent1', 'old1'),
      'FORBIDDEN',
    )
    expect(runs.create).not.toHaveBeenCalled()
  })

  it('should refuse a run of another agent or workspace', async () => {
    runs.findDetail.mockResolvedValue(ok(original({ agentId: 'other' })))
    expectErr(
      await SteelAgentService.rerunAsTest('admin1', 'ws1', 'agent1', 'old1'),
      'STEEL_AGENT_RUN_NOT_FOUND',
    )
    runs.findDetail.mockResolvedValue(err(notFound('Run')))
    expectErr(
      await SteelAgentService.rerunAsTest('admin1', 'ws1', 'agent1', 'old1'),
      'RESOURCE_NOT_FOUND',
    )
    expect(runs.create).not.toHaveBeenCalled()
  })
})

describe('SteelAgentService runs', () => {
  it('should list runs of an agent of the workspace', async () => {
    runs.listByAgent.mockResolvedValue(
      ok([createFakeSteelAgentRun({ agentId: 'agent1' })]),
    )
    const list = expectOk(
      await SteelAgentService.listRuns('u1', 'ws1', 'agent1', {
        limit: 10,
        status: 'FAILED',
      }),
    )
    expect(list).toHaveLength(1)
    expect(runs.listByAgent).toHaveBeenCalledWith('agent1', {
      limit: 10,
      status: 'FAILED',
    })
  })

  it('should propagate list errors', async () => {
    agents.findById.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await SteelAgentService.listRuns('u1', 'ws1', 'a', { limit: 10 }),
      'DATABASE_ERROR',
    )
    agents.findById.mockResolvedValue(ok(AGENT))
    runs.listByAgent.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await SteelAgentService.listRuns('u1', 'ws1', 'a', { limit: 10 }),
      'DATABASE_ERROR',
    )
  })

  it('should return the run detail with canApprove for owner or manager', async () => {
    const detail = createFakeSteelAgentRunDetail({
      id: 'run1',
      agentId: 'agent1',
      steps: [
        createFakeSteelAgentRunStep({ toolName: 'sd_list_tickets' }),
        createFakeSteelAgentRunStep({ toolName: 'removed_tool' }),
        createFakeSteelAgentRunStep({ kind: 'MODEL', toolName: null }),
      ],
    })
    detail.agent.ownerId = 'owner1'
    runs.findDetail.mockResolvedValue(ok(detail))

    const asAdmin = expectOk(
      await SteelAgentService.getRun('admin1', 'ws1', 'agent1', 'run1'),
    )
    expect(asAdmin.canApprove).toBe(true)
    expect(asAdmin.steps.map((s) => s.toolLabel)).toEqual([
      'Label sd_list_tickets',
      null,
      null,
    ])

    member.mockResolvedValue(ok(MEMBER))
    expect(
      expectOk(
        await SteelAgentService.getRun('owner1', 'ws1', 'agent1', 'run1'),
      ).canApprove,
    ).toBe(true)
    expect(
      expectOk(await SteelAgentService.getRun('m2', 'ws1', 'agent1', 'run1'))
        .canApprove,
    ).toBe(false)
  })

  it('should 404 a run of another agent and propagate errors', async () => {
    runs.findDetail.mockResolvedValue(
      ok(createFakeSteelAgentRunDetail({ agentId: 'other' })),
    )
    expectErr(
      await SteelAgentService.getRun('u1', 'ws1', 'agent1', 'run1'),
      'STEEL_AGENT_RUN_NOT_FOUND',
    )
    runs.findDetail.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await SteelAgentService.getRun('u1', 'ws1', 'agent1', 'run1'),
      'DATABASE_ERROR',
    )
  })
})
