import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import {
  createFakeSteelAgentPolicy,
  createFakeSteelMcpServer,
} from '@/src/__tests__/factories/nov-ai-governance.factory'
import {
  createFakeSteelAgentTool,
  createFakeSteelAgentWithRelations,
} from '@/src/__tests__/factories/steel-agent.factory'
import { createFakeUser } from '@/src/__tests__/factories/user.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, forbidden } from '@/src/errors'
import type { AnySteelAiTool } from '@/src/lib/ai/tools/types'
import { SYSTEM_PROFILE_PERMISSIONS } from '@/src/lib/permissions'
import { err, ok } from '@/src/lib/result'

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
  assertPrivileged: vi.fn(),
}))
vi.mock('@/src/repositories/steel-agent.repository')
vi.mock('@/src/repositories/steel-agent-governance.repository')
vi.mock('@/src/repositories/steel-mcp-server.repository')
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/user.repository')
vi.mock('@/lib/axiom/audit')

import { auditMutation } from '@/lib/axiom/audit'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { SteelAgentRepository } from '@/src/repositories/steel-agent.repository'
import {
  SteelAgentGovernanceMetricsRepository,
  SteelAgentPolicyRepository,
} from '@/src/repositories/steel-agent-governance.repository'
import { SteelMcpServerRepository } from '@/src/repositories/steel-mcp-server.repository'
import { UserRepository } from '@/src/repositories/user.repository'
import { assertMember, assertPrivileged } from '@/src/services/authz'
import { SteelAgentGovernanceService } from '../steel-agent-governance.service'

const member = vi.mocked(assertMember)
const privileged = vi.mocked(assertPrivileged)
const agents = vi.mocked(SteelAgentRepository)
const policies = vi.mocked(SteelAgentPolicyRepository)
const metrics = vi.mocked(SteelAgentGovernanceMetricsRepository)
const members = vi.mocked(MembershipRepository)
const mcp = vi.mocked(SteelMcpServerRepository)
const users = vi.mocked(UserRepository)

const NOW = new Date('2026-10-30T12:00:00.000Z')
const ADMIN = { role: 'ADMIN' as const, isPrivileged: true, permissions: null }
const MEMBER = {
  role: 'MEMBER' as const,
  isPrivileged: false,
  permissions: SYSTEM_PROFILE_PERMISSIONS.MEMBER,
}

const tool = (
  name: string,
  kind: AnySteelAiTool['kind'],
  module: AnySteelAiTool['module'],
): AnySteelAiTool => ({
  name,
  label: `Label ${name}`,
  module,
  kind,
  description: '',
  parameters: { type: 'object', properties: {} },
  parse: (args) => ok(args),
  ...(kind !== 'READ' && { preview: vi.fn() }),
  execute: vi.fn(),
})

function agent(
  overrides: Parameters<typeof createFakeSteelAgentWithRelations>[0] = {},
) {
  return createFakeSteelAgentWithRelations({
    id: 'a1',
    workspaceId: 'ws1',
    name: 'Triagem',
    ownerId: 'u1',
    createdById: 'u2',
    owner: { id: 'u1', name: 'Ana', email: 'ana@x.com', image: null },
    tools: [
      createFakeSteelAgentTool({ toolName: 'sd_list_tickets', mode: 'AUTO' }),
      createFakeSteelAgentTool({ toolName: 'crm_create_task', mode: 'AUTO' }),
      createFakeSteelAgentTool({ toolName: 'mcp_github__x', mode: 'APPROVAL' }),
      createFakeSteelAgentTool({ toolName: 'gone', mode: 'APPROVAL' }),
    ],
    delegates: [{ targetAgentId: 'a2' }, { targetAgentId: 'ghost' }],
    ...overrides,
  } as never)
}

beforeEach(() => {
  registry.tools = [
    tool('sd_list_tickets', 'READ', 'SERVICE_DESK'),
    tool('crm_create_task', 'CREATE', 'CRM'),
  ]
  member.mockResolvedValue(ok(ADMIN))
  privileged.mockResolvedValue(ok(ADMIN))
  agents.listByWorkspace.mockResolvedValue(
    ok([
      agent(),
      agent({
        id: 'a2',
        name: 'Funil',
        ownerId: null,
        owner: null,
        createdById: null,
        tools: [],
        delegates: [],
      } as never),
    ]),
  )
  members.listWithUserByWorkspace.mockResolvedValue(
    ok([
      {
        ...createFakeMembership({ userId: 'u1', role: 'ADMIN' }),
        user: { id: 'u1', name: 'Ana', email: 'ana@x.com', image: null },
      },
      {
        ...createFakeMembership({ userId: 'u2', role: 'OWNER' }),
        user: { id: 'u2', name: 'Bia', email: 'bia@x.com', image: null },
      },
    ] as never),
  )
  mcp.listByWorkspace.mockResolvedValue(
    ok([
      createFakeSteelMcpServer({
        workspaceId: 'ws1',
        allowedTools: ['list_issues'],
        slug: 'github',
      }),
    ]),
  )
  metrics.runs.mockResolvedValue(
    ok([
      {
        agentId: 'a1',
        runs: 10,
        succeeded: 8,
        failed: 1,
        skipped: 1,
        costUsd: 2,
        delegatedCostUsd: 0.5,
        lastRunAt: NOW,
      },
    ]),
  )
  metrics.decisions.mockResolvedValue(
    ok([
      {
        agentId: 'a1',
        executed: 6,
        failed: 1,
        rejected: 3,
        expired: 2,
        pending: 1,
      },
    ]),
  )
  metrics.impact.mockResolvedValue(ok([{ agentId: 'a1', applied: 4 }]))
  policies.find.mockResolvedValue(ok(null))
  users.findById.mockResolvedValue(ok(createFakeUser({ name: 'Bia' })))
  policies.kill.mockImplementation(async (workspaceId, killedById, reason) =>
    ok(
      createFakeSteelAgentPolicy({
        workspaceId,
        killedAt: NOW,
        killedById,
        killReason: reason,
      }),
    ),
  )
  policies.cancelInFlight.mockResolvedValue(ok({ runs: 2, actions: 3 }))
  policies.resume.mockResolvedValue(ok(createFakeSteelAgentPolicy()))
})

describe('SteelAgentGovernanceService.overview', () => {
  it('should build the inventory with owner, tools, metrics and risk flags', async () => {
    const dto = expectOk(
      await SteelAgentGovernanceService.overview('u1', 'ws1', 30, NOW),
    )
    expect(dto.periodDays).toBe(30)
    expect(dto.since).toBe('2026-09-30T12:00:00.000Z')
    expect(dto.killSwitch).toEqual({
      active: false,
      at: null,
      byName: null,
      reason: null,
    })
    expect(dto.totals).toEqual({
      agents: 2,
      active: 2,
      withoutOwner: 1,
      runs: 10,
      costUsd: 2,
      applied: 4,
      approvalRate: 7 / 10,
    })

    const [first, second] = dto.agents
    expect(first.owner).toEqual({
      id: 'u1',
      name: 'Ana',
      email: 'ana@x.com',
      role: 'ADMIN',
    })
    expect(first.createdByName).toBe('Bia')
    expect(first.tools).toEqual([
      expect.objectContaining({
        toolName: 'sd_list_tickets',
        kind: 'READ',
        mode: 'AUTO',
      }),
      expect.objectContaining({
        toolName: 'crm_create_task',
        kind: 'CREATE',
        mode: 'AUTO',
        module: 'CRM',
      }),
      expect.objectContaining({
        toolName: 'mcp_github__x',
        kind: 'UNKNOWN',
        external: true,
      }),
      expect.objectContaining({ toolName: 'gone', kind: 'UNKNOWN' }),
    ])
    expect(first.modules.sort()).toEqual(['CRM', 'SERVICE_DESK'])
    expect(first.delegates).toEqual([{ id: 'a2', name: 'Funil' }])
    expect(first.risks).toEqual([
      'AUTO_WRITES',
      'CONTACTS_THIRD_PARTIES',
      'DELEGATES',
    ])
    expect(first.metrics).toEqual({
      runs: 10,
      succeeded: 8,
      failed: 1,
      skipped: 1,
      costUsd: 2,
      delegatedCostUsd: 0.5,
      applied: 4,
      approvals: { approved: 7, rejected: 3, expired: 2, pending: 1 },
      approvalRate: 0.7,
      rejectionRate: 0.3,
      costPerApplied: 0.5,
      lastRunAt: NOW.toISOString(),
    })

    expect(second.owner).toBeNull()
    expect(second.createdByName).toBeNull()
    expect(second.risks).toEqual(['NO_OWNER'])
    expect(second.metrics.approvalRate).toBeNull()
    expect(second.metrics.costPerApplied).toBeNull()
    expect(second.metrics.lastRunAt).toBeNull()
  })

  it('should flag an owner who left the workspace and resolve MCP tool kinds', async () => {
    members.listWithUserByWorkspace.mockResolvedValue(ok([]))
    metrics.decisions.mockResolvedValue(ok([]))
    agents.listByWorkspace.mockResolvedValue(
      ok([
        agent({
          tools: [
            createFakeSteelAgentTool({
              toolName: 'mcp_github__list_issues',
              mode: 'APPROVAL',
            }),
          ],
          delegates: undefined,
        } as never),
      ]),
    )
    const dto = expectOk(
      await SteelAgentGovernanceService.overview('u1', 'ws1', 7, NOW),
    )
    expect(dto.agents[0].owner?.role).toBeNull()
    expect(dto.agents[0].risks).toContain('NO_OWNER')
    expect(dto.agents[0].tools[0]).toEqual(
      expect.objectContaining({ kind: 'READ', external: true }),
    )
    expect(dto.totals.approvalRate).toBeNull()
  })

  it('should show who stopped the agents and why', async () => {
    policies.find.mockResolvedValue(
      ok(
        createFakeSteelAgentPolicy({
          killedAt: NOW,
          killedById: 'u2',
          killReason: 'Comportamento estranho',
          restrictCreators: true,
          creatorRoles: ['MEMBER', 'ADMIN'],
        }),
      ),
    )
    const dto = expectOk(
      await SteelAgentGovernanceService.overview('u1', 'ws1', 30, NOW),
    )
    expect(dto.killSwitch).toEqual({
      active: true,
      at: NOW.toISOString(),
      byName: 'Bia',
      reason: 'Comportamento estranho',
    })
    expect(dto.policy.creatorRoles).toEqual(['MEMBER'])
  })

  it('should tolerate an unknown killer', async () => {
    policies.find.mockResolvedValue(
      ok(createFakeSteelAgentPolicy({ killedAt: NOW, killedById: 'gone' })),
    )
    users.findById.mockResolvedValue(err(databaseError('x')))
    const dto = expectOk(
      await SteelAgentGovernanceService.overview('u1', 'ws1', 30, NOW),
    )
    expect(dto.killSwitch.byName).toBeNull()
    policies.find.mockResolvedValue(
      ok(createFakeSteelAgentPolicy({ killedAt: NOW, killedById: null })),
    )
    expect(
      expectOk(await SteelAgentGovernanceService.overview('u1', 'ws1', 30, NOW))
        .killSwitch.byName,
    ).toBeNull()
  })

  it('should be limited to the people who manage agents', async () => {
    member.mockResolvedValue(ok(MEMBER))
    expectErr(
      await SteelAgentGovernanceService.overview('m', 'ws1', 30, NOW),
      'FORBIDDEN',
    )
    member.mockResolvedValue(err(forbidden()))
    expectErr(
      await SteelAgentGovernanceService.overview('x', 'ws1', 30, NOW),
      'FORBIDDEN',
    )
  })

  it('should propagate every data source failure', async () => {
    const fail = err(databaseError('x'))
    const cases: (() => void)[] = [
      () => agents.listByWorkspace.mockResolvedValue(fail),
      () => members.listWithUserByWorkspace.mockResolvedValue(fail),
      () => mcp.listByWorkspace.mockResolvedValue(fail),
      () => metrics.runs.mockResolvedValue(fail),
      () => metrics.decisions.mockResolvedValue(fail),
      () => metrics.impact.mockResolvedValue(fail),
      () => policies.find.mockResolvedValue(fail),
    ]
    for (const breakIt of cases) {
      beforeEachReset()
      breakIt()
      expectErr(
        await SteelAgentGovernanceService.overview('u1', 'ws1', 30, NOW),
        'DATABASE_ERROR',
      )
    }
  })
})

function beforeEachReset() {
  agents.listByWorkspace.mockResolvedValue(ok([agent()]))
  members.listWithUserByWorkspace.mockResolvedValue(ok([]))
  mcp.listByWorkspace.mockResolvedValue(ok([]))
  metrics.runs.mockResolvedValue(ok([]))
  metrics.decisions.mockResolvedValue(ok([]))
  metrics.impact.mockResolvedValue(ok([]))
  policies.find.mockResolvedValue(ok(null))
}

describe('SteelAgentGovernanceService.kill / resume', () => {
  it('should pause every agent, cancel in-flight work and audit it', async () => {
    const result = expectOk(
      await SteelAgentGovernanceService.kill(
        'u2',
        'ws1',
        { reason: ' Incidente ' },
        NOW,
      ),
    )
    expect(policies.kill).toHaveBeenCalledWith('ws1', 'u2', 'Incidente', NOW)
    expect(result).toEqual({
      killSwitch: {
        active: true,
        at: NOW.toISOString(),
        byName: 'Bia',
        reason: 'Incidente',
      },
      canceledRuns: 2,
      canceledActions: 3,
    })
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'steel_agent_governance',
        action: 'suspend',
        actorId: 'u2',
      }),
    )
  })

  it('should accept no reason and an unknown actor name', async () => {
    users.findById.mockResolvedValue(err(databaseError('x')))
    const result = expectOk(
      await SteelAgentGovernanceService.kill('u2', 'ws1', {}, NOW),
    )
    expect(policies.kill).toHaveBeenCalledWith('ws1', 'u2', null, NOW)
    expect(result.killSwitch.byName).toBeNull()
  })

  it('should be OWNER/ADMIN only and propagate failures', async () => {
    privileged.mockResolvedValue(err(forbidden()))
    expectErr(
      await SteelAgentGovernanceService.kill('m', 'ws1', {}, NOW),
      'FORBIDDEN',
    )
    expectErr(await SteelAgentGovernanceService.resume('m', 'ws1'), 'FORBIDDEN')
    privileged.mockResolvedValue(ok(ADMIN))
    policies.kill.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await SteelAgentGovernanceService.kill('u', 'ws1', {}, NOW),
      'DATABASE_ERROR',
    )
    policies.kill.mockResolvedValue(ok(createFakeSteelAgentPolicy()))
    policies.cancelInFlight.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await SteelAgentGovernanceService.kill('u', 'ws1', {}, NOW),
      'DATABASE_ERROR',
    )
    policies.resume.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await SteelAgentGovernanceService.resume('u', 'ws1'),
      'DATABASE_ERROR',
    )
  })

  it('should resume and audit, whether or not the switch was on', async () => {
    expect(
      expectOk(await SteelAgentGovernanceService.resume('u2', 'ws1')),
    ).toEqual({ active: false, at: null, byName: null, reason: null })
    policies.resume.mockResolvedValue(ok(null))
    expectOk(await SteelAgentGovernanceService.resume('u2', 'ws1'))
    expect(auditMutation).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: 'reactivate',
        meta: expect.objectContaining({ wasActive: false }),
      }),
    )
  })
})

describe('SteelAgentGovernanceService.updatePolicy', () => {
  const dto = {
    restrictCreators: true,
    creatorRoles: ['MEMBER', 'ADMIN', 'MEMBER'] as ('MEMBER' | 'ADMIN')[],
    restrictAuto: true,
    autoRules: {
      ADMIN: { mode: 'ALL' as const, tools: ['x_tool'] },
      MEMBER: {
        mode: 'LIST' as const,
        tools: ['crm_create_task', 'crm_create_task'],
      },
      VIEWER: { mode: 'NONE' as const, tools: [] },
    },
  }

  it('should normalize and save the policy', async () => {
    policies.saveRules.mockImplementation(async (workspaceId, _by, data) =>
      ok(
        createFakeSteelAgentPolicy({
          workspaceId,
          ...data,
          autoRules: data.autoRules as never,
        }),
      ),
    )
    const saved = expectOk(
      await SteelAgentGovernanceService.updatePolicy('u2', 'ws1', dto),
    )
    expect(policies.saveRules).toHaveBeenCalledWith('ws1', 'u2', {
      restrictCreators: true,
      creatorRoles: ['MEMBER'],
      restrictAuto: true,
      autoRules: {
        ADMIN: { mode: 'ALL', tools: [] },
        MEMBER: { mode: 'LIST', tools: ['crm_create_task'] },
        VIEWER: { mode: 'NONE', tools: [] },
      },
    })
    expect(saved.creatorRoles).toEqual(['MEMBER'])
    expect(saved.autoRules.MEMBER.tools).toEqual(['crm_create_task'])
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'steel_agent_policy',
        action: 'update',
      }),
    )
  })

  it('should be OWNER/ADMIN only and propagate failures', async () => {
    privileged.mockResolvedValue(err(forbidden()))
    expectErr(
      await SteelAgentGovernanceService.updatePolicy('m', 'ws1', dto),
      'FORBIDDEN',
    )
    privileged.mockResolvedValue(ok(ADMIN))
    policies.saveRules.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await SteelAgentGovernanceService.updatePolicy('u', 'ws1', dto),
      'DATABASE_ERROR',
    )
  })
})

describe('SteelAgentGovernanceService.exportCsv', () => {
  it('should export the inventory for the LGPD record, escaping formulas', async () => {
    agents.listByWorkspace.mockResolvedValue(
      ok([
        agent({ name: '=HYPERLINK("x")' } as never),
        agent({
          id: 'a2',
          name: 'Funil',
          ownerId: null,
          owner: null,
          createdById: null,
          tools: [],
          delegates: [],
        } as never),
      ]),
    )
    const result = expectOk(
      await SteelAgentGovernanceService.exportCsv('u1', 'ws1', 30, NOW),
    )
    expect(result.filename).toBe('governanca-agentes-2026-10-30.csv')
    const lines = result.csv.split('\r\n')
    expect(lines[0]).toContain(
      'Agente,Situação,Responsável,E-mail do responsável',
    )
    expect(lines[1]).toContain(`"'=HYPERLINK(""x"")"`)
    expect(lines[1]).toContain('ana@x.com')
    expect(lines[1]).toContain('Sim')
    expect(lines[2]).toContain('Sem responsável')
    expect(lines[2]).toContain('Não é mais membro')
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'steel_agent_governance',
        action: 'download',
      }),
    )
  })

  it('should propagate the overview errors', async () => {
    member.mockResolvedValue(ok(MEMBER))
    expectErr(
      await SteelAgentGovernanceService.exportCsv('m', 'ws1', 30, NOW),
      'FORBIDDEN',
    )
  })
})
