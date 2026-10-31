import { Prisma } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import {
  createFakeSteelAgentPolicy,
  createFakeSteelMcpServer,
} from '@/src/__tests__/factories/nov-ai-governance.factory'
import {
  createFakeSteelAgentRun,
  createFakeSteelAgentTool,
  createFakeSteelAgentWithRelations,
} from '@/src/__tests__/factories/steel-agent.factory'
import { DEFAULT_AUTO_RULES } from '@/src/lib/steel-agents/policy'
import { toSteelAgentDTO, toSteelAgentRunDTO } from '../steel-agent.mapper'
import {
  toKillSwitchDTO,
  toSteelAgentPolicyDTO,
} from '../steel-agent-governance.mapper'
import { toSteelMcpServerDTO } from '../steel-mcp-server.mapper'

describe('toSteelAgentPolicyDTO', () => {
  it('should default to no restriction', () => {
    expect(toSteelAgentPolicyDTO(null)).toEqual({
      restrictCreators: false,
      creatorRoles: [],
      restrictAuto: false,
      autoRules: DEFAULT_AUTO_RULES,
    })
  })

  it('should hide the roles that always may create and parse the rules', () => {
    const dto = toSteelAgentPolicyDTO(
      createFakeSteelAgentPolicy({
        restrictCreators: true,
        creatorRoles: ['OWNER', 'ADMIN', 'MEMBER'],
        restrictAuto: true,
        autoRules: { MEMBER: { mode: 'LIST', tools: ['a'] } },
      }),
    )
    expect(dto.creatorRoles).toEqual(['MEMBER'])
    expect(dto.autoRules.MEMBER).toEqual({ mode: 'LIST', tools: ['a'] })
    expect(dto.autoRules.VIEWER).toEqual(DEFAULT_AUTO_RULES.VIEWER)
  })
})

describe('toKillSwitchDTO', () => {
  it('should be inactive without a policy or killedAt', () => {
    const off = { active: false, at: null, byName: null, reason: null }
    expect(toKillSwitchDTO(null, 'Ana')).toEqual(off)
    expect(
      toKillSwitchDTO(
        createFakeSteelAgentPolicy({ killReason: 'stale', killedAt: null }),
        'Ana',
      ),
    ).toEqual(off)
  })

  it('should carry the actor and reason when active', () => {
    const at = new Date('2026-10-30T10:00:00.000Z')
    expect(
      toKillSwitchDTO(
        createFakeSteelAgentPolicy({ killedAt: at, killReason: 'Incidente' }),
        'Ana',
      ),
    ).toEqual({
      active: true,
      at: at.toISOString(),
      byName: 'Ana',
      reason: 'Incidente',
    })
    expect(
      toKillSwitchDTO(createFakeSteelAgentPolicy({ killedAt: at }), null)
        .reason,
    ).toBeNull()
  })
})

describe('toSteelMcpServerDTO', () => {
  it('should never expose the secret and mark the allow-listed tools', () => {
    const dto = toSteelMcpServerDTO(
      createFakeSteelMcpServer({
        encryptedAuthValue: 'cipher',
        allowedTools: ['create_issue'],
      }),
    )
    expect(JSON.stringify(dto)).not.toContain('cipher')
    expect(dto.hasAuth).toBe(true)
    expect(dto.tools).toEqual([
      expect.objectContaining({
        name: 'list_issues',
        agentToolName: 'mcp_github__list_issues',
        readOnly: true,
        allowed: false,
      }),
      expect.objectContaining({
        name: 'create_issue',
        agentToolName: 'mcp_github__create_issue',
        readOnly: false,
        allowed: true,
      }),
    ])
  })

  it('should handle a server that was never discovered', () => {
    const dto = toSteelMcpServerDTO(
      createFakeSteelMcpServer({
        toolsCache: null,
        discoveredAt: null,
        lastError: 'fora do ar',
      }),
    )
    expect(dto).toEqual(
      expect.objectContaining({
        hasAuth: false,
        tools: [],
        discoveredAt: null,
        lastError: 'fora do ar',
      }),
    )
  })
})

describe('agent and run DTOs (A7)', () => {
  it('should list the delegate ids of an agent', () => {
    const agent = createFakeSteelAgentWithRelations({
      tools: [createFakeSteelAgentTool()],
      delegates: [{ targetAgentId: 'a2' }, { targetAgentId: 'a3' }],
    } as never)
    expect(toSteelAgentDTO(agent, () => 'READ').delegateAgentIds).toEqual([
      'a2',
      'a3',
    ])
    const legacy = { ...agent, delegates: undefined } as never
    expect(toSteelAgentDTO(legacy, () => 'READ').delegateAgentIds).toEqual([])
  })

  it('should expose the delegation columns of a run', () => {
    const dto = toSteelAgentRunDTO(
      createFakeSteelAgentRun({
        parentRunId: 'parent',
        depth: 2,
        delegatedCostUsd: new Prisma.Decimal('0.5'),
      }),
    )
    expect(dto).toEqual(
      expect.objectContaining({
        parentRunId: 'parent',
        depth: 2,
        delegatedCostUsd: 0.5,
      }),
    )
    const legacy = toSteelAgentRunDTO({
      ...createFakeSteelAgentRun(),
      parentRunId: undefined,
      depth: undefined,
      delegatedCostUsd: undefined,
    } as never)
    expect(legacy).toEqual(
      expect.objectContaining({
        parentRunId: null,
        depth: 0,
        delegatedCostUsd: 0,
      }),
    )
  })
})
