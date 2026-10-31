import { describe, expect, it } from 'vitest'
import {
  CreateSteelAgentSchema,
  UpdateSteelAgentSchema,
} from '../steel-agent.schema'
import {
  KillSteelAgentsSchema,
  SteelGovernanceQuerySchema,
  UpdateSteelAgentPolicySchema,
} from '../steel-agent-governance.schema'
import {
  CreateSteelMcpServerSchema,
  UpdateSteelMcpServerSchema,
} from '../steel-mcp-server.schema'

describe('SteelGovernanceQuerySchema', () => {
  it('should default to 30 days and bound the window', () => {
    expect(SteelGovernanceQuerySchema.parse({}).days).toBe(30)
    expect(SteelGovernanceQuerySchema.parse({ days: '7' }).days).toBe(7)
    expect(SteelGovernanceQuerySchema.safeParse({ days: '0' }).success).toBe(
      false,
    )
    expect(SteelGovernanceQuerySchema.safeParse({ days: '999' }).success).toBe(
      false,
    )
  })
})

describe('KillSteelAgentsSchema', () => {
  it('should take an optional bounded reason', () => {
    expect(KillSteelAgentsSchema.parse({})).toEqual({})
    expect(KillSteelAgentsSchema.parse({ reason: ' x ' }).reason).toBe('x')
    expect(KillSteelAgentsSchema.parse({ reason: null }).reason).toBeNull()
    expect(
      KillSteelAgentsSchema.safeParse({ reason: 'x'.repeat(501) }).success,
    ).toBe(false)
  })
})

describe('UpdateSteelAgentPolicySchema', () => {
  const rule = { mode: 'LIST' as const, tools: ['crm_create_task'] }
  const valid = {
    restrictCreators: true,
    creatorRoles: ['MEMBER'],
    restrictAuto: true,
    autoRules: { ADMIN: rule, MEMBER: rule, VIEWER: { mode: 'NONE' } },
  }

  it('should accept a full policy and default empty tool lists', () => {
    const parsed = UpdateSteelAgentPolicySchema.parse(valid)
    expect(parsed.autoRules.VIEWER).toEqual({ mode: 'NONE', tools: [] })
  })

  it('should reject unknown roles, modes and malformed tool names', () => {
    expect(
      UpdateSteelAgentPolicySchema.safeParse({
        ...valid,
        creatorRoles: ['ROOT'],
      }).success,
    ).toBe(false)
    expect(
      UpdateSteelAgentPolicySchema.safeParse({
        ...valid,
        autoRules: { ...valid.autoRules, ADMIN: { mode: 'MAYBE' } },
      }).success,
    ).toBe(false)
    expect(
      UpdateSteelAgentPolicySchema.safeParse({
        ...valid,
        autoRules: {
          ...valid.autoRules,
          ADMIN: { mode: 'LIST', tools: ['Bad Name!'] },
        },
      }).success,
    ).toBe(false)
    expect(
      UpdateSteelAgentPolicySchema.safeParse({ ...valid, autoRules: {} })
        .success,
    ).toBe(false)
  })
})

describe('MCP server schemas', () => {
  it('should default the header, flags and allow-list', () => {
    expect(
      CreateSteelMcpServerSchema.parse({
        name: ' GitHub ',
        url: 'https://mcp.example.com/mcp',
      }),
    ).toEqual({
      name: 'GitHub',
      url: 'https://mcp.example.com/mcp',
      authHeaderName: 'Authorization',
      enabled: true,
      allowedTools: [],
    })
  })

  it('should validate names, header and sizes', () => {
    const base = { name: 'x', url: 'https://a.example.com' }
    expect(
      CreateSteelMcpServerSchema.safeParse({ ...base, name: '' }).success,
    ).toBe(false)
    expect(
      CreateSteelMcpServerSchema.safeParse({
        ...base,
        authHeaderName: 'Bad Header',
      }).success,
    ).toBe(false)
    expect(
      CreateSteelMcpServerSchema.safeParse({
        ...base,
        allowedTools: Array.from({ length: 101 }, (_, i) => `t${i}`),
      }).success,
    ).toBe(false)
    expect(UpdateSteelMcpServerSchema.safeParse({}).success).toBe(false)
    expect(UpdateSteelMcpServerSchema.parse({ authValue: null })).toEqual({
      authValue: null,
    })
  })
})

describe('delegateAgentIds on agents', () => {
  const create = {
    name: 'A',
    instructions: 'x',
    triggerType: 'MANUAL' as const,
    ownerId: 'u1',
  }

  it('should default to none, trim and cap the list', () => {
    expect(CreateSteelAgentSchema.parse(create).delegateAgentIds).toEqual([])
    expect(
      CreateSteelAgentSchema.parse({ ...create, delegateAgentIds: [' a2 '] })
        .delegateAgentIds,
    ).toEqual(['a2'])
    expect(
      CreateSteelAgentSchema.safeParse({
        ...create,
        delegateAgentIds: Array.from({ length: 11 }, (_, i) => `a${i}`),
      }).success,
    ).toBe(false)
    expect(UpdateSteelAgentSchema.parse({ delegateAgentIds: ['a2'] })).toEqual({
      delegateAgentIds: ['a2'],
    })
  })
})
