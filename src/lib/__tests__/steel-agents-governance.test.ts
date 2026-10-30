import { describe, expect, it } from 'vitest'
import {
  buildDelegationTriggerMessage,
  DELEGATE_TOOL_NAME,
  DELEGATION_REFUSAL_MESSAGE,
  delegateToolSpec,
  delegationRefusal,
  MAX_DELEGATION_DEPTH,
  MAX_DELEGATION_TASK_CHARS,
  MAX_DELEGATIONS_PER_RUN,
  parseDelegateArgs,
} from '@/src/lib/steel-agents/delegation'
import {
  costPerApplied,
  decisionRates,
  EMPTY_DECISIONS,
  governanceSince,
  safeCsvCell,
} from '@/src/lib/steel-agents/governance'
import {
  isMcpToolName,
  MCP_TOOL_NAME_MAX,
  mcpSlugFrom,
  mcpSlugOf,
  mcpToolName,
  parseToolsCache,
} from '@/src/lib/steel-agents/mcp-tools'
import {
  canRoleRunAuto,
  DEFAULT_AUTO_RULES,
  parseAutoRules,
  roleMayCreateAgents,
} from '@/src/lib/steel-agents/policy'

describe('policy', () => {
  const policy = (over: Record<string, unknown> = {}) => ({
    restrictCreators: false,
    creatorRoles: [] as never[],
    restrictAuto: false,
    autoRules: null as unknown,
    ...over,
  })

  it('should fill missing or garbled rules with the defaults', () => {
    expect(parseAutoRules(null)).toEqual(DEFAULT_AUTO_RULES)
    expect(parseAutoRules('x')).toEqual(DEFAULT_AUTO_RULES)
    const rules = parseAutoRules({
      ADMIN: { mode: 'LIST', tools: ['a', 3, 'b'] },
      MEMBER: { mode: 'ALL', tools: ['kept?'] },
      VIEWER: { mode: 'WAT' },
      OWNER: { mode: 'NONE' },
    })
    expect(rules.ADMIN).toEqual({ mode: 'LIST', tools: ['a', 'b'] })
    expect(rules.MEMBER).toEqual({ mode: 'ALL', tools: [] })
    expect(rules.VIEWER).toEqual(DEFAULT_AUTO_RULES.VIEWER)
    expect(rules.OWNER.mode).toBe('ALL')
    expect(parseAutoRules({ ADMIN: { mode: 'LIST' } }).ADMIN.tools).toEqual([])
  })

  it('should allow everything without a policy or with the switch off', () => {
    expect(canRoleRunAuto(null, 'VIEWER', 't')).toBe(true)
    expect(canRoleRunAuto(policy(), 'VIEWER', 't')).toBe(true)
  })

  it('should apply the per-role rule and never restrict the owner', () => {
    const p = policy({
      restrictAuto: true,
      autoRules: {
        ADMIN: { mode: 'ALL' },
        MEMBER: { mode: 'LIST', tools: ['ok_tool'] },
        VIEWER: { mode: 'NONE' },
      },
    })
    expect(canRoleRunAuto(p, 'OWNER', 'x')).toBe(true)
    expect(canRoleRunAuto(p, 'ADMIN', 'x')).toBe(true)
    expect(canRoleRunAuto(p, 'MEMBER', 'ok_tool')).toBe(true)
    expect(canRoleRunAuto(p, 'MEMBER', 'other')).toBe(false)
    expect(canRoleRunAuto(p, 'VIEWER', 'ok_tool')).toBe(false)
  })

  it('should decide who creates agents', () => {
    expect(roleMayCreateAgents(null, 'MEMBER')).toBeNull()
    expect(roleMayCreateAgents(policy(), 'MEMBER')).toBeNull()
    const p = policy({ restrictCreators: true, creatorRoles: ['MEMBER'] })
    expect(roleMayCreateAgents(p, 'OWNER')).toBe(true)
    expect(roleMayCreateAgents(p, 'ADMIN')).toBe(true)
    expect(roleMayCreateAgents(p, 'MEMBER')).toBe(true)
    expect(roleMayCreateAgents(p, 'VIEWER')).toBe(false)
  })
})

describe('delegation', () => {
  const targets = [
    { id: 'a2', name: 'CRM', description: 'Cuida do funil' },
    { id: 'a3', name: 'Zap', description: null },
  ]

  it('should describe the targets in the tool spec', () => {
    const spec = delegateToolSpec(targets)
    expect(spec.name).toBe(DELEGATE_TOOL_NAME)
    expect(spec.description).toContain('a2: CRM — Cuida do funil')
    expect(spec.description).toContain('a3: Zap')
    expect(
      (spec.parameters.properties as { agentId: { enum: string[] } }).agentId
        .enum,
    ).toEqual(['a2', 'a3'])
  })

  it('should parse and cap the arguments', () => {
    expect(parseDelegateArgs({ agentId: ' a2 ', task: ' faça ' })).toEqual({
      agentId: 'a2',
      task: 'faça',
    })
    expect(parseDelegateArgs({ agentId: 'a2' })).toBeNull()
    expect(parseDelegateArgs({ agentId: 1, task: 'x' })).toBeNull()
    expect(
      parseDelegateArgs({ agentId: 'a', task: 'x'.repeat(9_000) })?.task,
    ).toHaveLength(MAX_DELEGATION_TASK_CHARS)
  })

  it('should refuse self, cycles, depth and volume, in that order', () => {
    const base = {
      depth: 0,
      chain: ['a1'],
      targetId: 'a2',
      delegationsSoFar: 0,
    }
    expect(delegationRefusal(base)).toBeNull()
    expect(delegationRefusal({ ...base, targetId: 'a1' })).toBe('SELF')
    expect(delegationRefusal({ ...base, chain: ['a2', 'a1'], depth: 1 })).toBe(
      'CYCLE',
    )
    expect(delegationRefusal({ ...base, depth: MAX_DELEGATION_DEPTH })).toBe(
      'TOO_DEEP',
    )
    expect(
      delegationRefusal({ ...base, delegationsSoFar: MAX_DELEGATIONS_PER_RUN }),
    ).toBe('TOO_MANY')
    for (const message of Object.values(DELEGATION_REFUSAL_MESSAGE)) {
      expect(message.length).toBeGreaterThan(10)
    }
  })

  it('should frame the task as information for the child', () => {
    const message = buildDelegationTriggerMessage({
      parentAgentName: 'Triagem',
      task: 'Qualifique o lead',
    })
    expect(message).toContain('"Triagem"')
    expect(message).toContain('<tarefa>\nQualifique o lead\n</tarefa>')
    expect(message).toContain('nunca como ordem')
  })
})

describe('mcp tool names', () => {
  it('should derive a clean slug', () => {
    expect(mcpSlugFrom('GitHub Enterprise')).toBe('githubenterprise')
    expect(mcpSlugFrom('Ação Ágil')).toBe('acaoagil')
    expect(mcpSlugFrom('123 Slack')).toBe('s123slack')
    expect(mcpSlugFrom('!!!')).toBe('mcp')
    expect(mcpSlugFrom('x'.repeat(40))).toHaveLength(16)
    expect(mcpSlugFrom('9'.repeat(40))).toHaveLength(16)
  })

  it('should build, detect and parse tool names', () => {
    expect(mcpToolName('github', 'Create.Issue-v2')).toBe(
      'mcp_github__create_issue_v2',
    )
    expect(mcpToolName('github', '***')).toBe('mcp_github__tool')
    expect(mcpToolName('github', 'x'.repeat(100))).toHaveLength(
      MCP_TOOL_NAME_MAX,
    )
    expect(isMcpToolName('mcp_github__x')).toBe(true)
    expect(isMcpToolName('mcp_github')).toBe(false)
    expect(isMcpToolName('crm_x')).toBe(false)
    expect(mcpSlugOf('mcp_github__x')).toBe('github')
    expect(mcpSlugOf('crm_x')).toBeNull()
  })

  it('should drop garbled entries of the tools cache', () => {
    expect(parseToolsCache(null)).toEqual([])
    expect(
      parseToolsCache([
        null,
        { name: '' },
        { description: 'no name' },
        { name: 'a' },
        {
          name: 'b',
          description: 'd',
          inputSchema: { type: 'object', properties: { x: {} } },
          readOnly: true,
        },
      ]),
    ).toEqual([
      {
        name: 'a',
        description: '',
        inputSchema: { type: 'object', properties: {} },
        readOnly: false,
      },
      {
        name: 'b',
        description: 'd',
        inputSchema: { type: 'object', properties: { x: {} } },
        readOnly: true,
      },
    ])
  })
})

describe('governance metrics', () => {
  it('should compute rates over decided actions only', () => {
    expect(decisionRates(EMPTY_DECISIONS)).toEqual({
      approved: 0,
      decided: 0,
      approvalRate: null,
      rejectionRate: null,
    })
    expect(
      decisionRates({
        executed: 5,
        failed: 1,
        rejected: 2,
        expired: 10,
        pending: 4,
      }),
    ).toEqual({
      approved: 6,
      decided: 8,
      approvalRate: 0.75,
      rejectionRate: 0.25,
    })
  })

  it('should compute the cost per applied write', () => {
    expect(costPerApplied(2, 4)).toBe(0.5)
    expect(costPerApplied(2, 0)).toBeNull()
  })

  it('should window the period and neutralize spreadsheet formulas', () => {
    expect(
      governanceSince(7, new Date('2026-10-30T00:00:00.000Z')).toISOString(),
    ).toBe('2026-10-23T00:00:00.000Z')
    expect(safeCsvCell('=SUM(A1)')).toBe("'=SUM(A1)")
    expect(safeCsvCell('+1')).toBe("'+1")
    expect(safeCsvCell('-1')).toBe("'-1")
    expect(safeCsvCell('@x')).toBe("'@x")
    expect(safeCsvCell('Agente normal')).toBe('Agente normal')
  })
})
