import { describe, expect, it, vi } from 'vitest'
import { STEEL_AI_TOOLS } from '@/src/lib/ai/tools'
import type { AnySteelAiTool } from '@/src/lib/ai/tools/types'
import {
  MCP_CALL_TOOL_NAME,
  MCP_COMPACT_READ_TOOLS,
  MCP_FIND_TOOLS_NAME,
  MCP_TOOLS_LIST_THRESHOLD,
  mcpCallToolDefinition,
  mcpFindToolsDefinition,
  mcpMetaToolDefinitions,
  planMcpToolListing,
  rankReadCategories,
  resolveCallToolTarget,
  runMcpFindTools,
  toolCategory,
} from '@/src/lib/mcp/discovery'
import { mcpTools } from '@/src/lib/mcp/tools'
import { ok } from '@/src/lib/result'
import { fakeTool, mcpAccess, mcpGrant } from './mcp.fixtures'

type Resource = NonNullable<AnySteelAiTool['permission']>['resource']

function group(
  prefix: string,
  module: AnySteelAiTool['module'],
  resource: string | null,
  count: number,
): AnySteelAiTool[] {
  return Array.from({ length: count }, (_, i) =>
    fakeTool({
      name: `${prefix}_${i}`,
      label: `${prefix} ${i}`,
      module,
      description: `Consulta ${prefix.replace(/_/g, ' ')} ${i}. Detalhes.`,
      ...(resource && {
        permission: { resource: resource as Resource, action: 'VIEW' },
      }),
    }),
  )
}

const names = (tools: { name: string }[]) => tools.map((t) => t.name)

describe('toolCategory()', () => {
  it('should combine module and RBAC resource', () => {
    expect(toolCategory(group('a', 'CRM', 'leads', 1)[0])).toBe('CRM:leads')
    expect(toolCategory(group('b', 'CRM', null, 1)[0])).toBe('CRM:geral')
    expect(toolCategory(group('c', null, null, 1)[0])).toBe('PLATFORM:geral')
  })
})

describe('rankReadCategories()', () => {
  const tools = [
    ...group('crm_social', 'CRM', 'social', 2),
    ...group('sd_ticket', 'SERVICE_DESK', 'sd-tickets', 2),
    ...group('crm_misc', 'CRM', null, 1),
    ...group('ws', null, null, 1),
    fakeTool({ name: 'sd_write', module: 'SERVICE_DESK', kind: 'CREATE' }),
  ]

  it('should follow the default order without usage, then registry order', () => {
    expect(rankReadCategories(tools, {}).map((r) => r.category)).toEqual([
      'SERVICE_DESK:sd-tickets',
      'CRM:social',
      'CRM:geral',
    ])
  })

  it('should put the most-called category first', () => {
    const ranked = rankReadCategories(tools, { crm_social_1: 3, sd_write: 99 })
    expect(ranked[0]).toMatchObject({ category: 'CRM:social', calls: 3 })
  })
})

describe('planMcpToolListing()', () => {
  it('should list everything at or under the threshold', () => {
    const tools = group('sd_ticket', 'SERVICE_DESK', 'sd-tickets', 40)
    const plan = planMcpToolListing(tools)
    expect(plan.listed).toHaveLength(MCP_TOOLS_LIST_THRESHOLD)
    expect(plan.hidden).toEqual([])
    expect(mcpMetaToolDefinitions(plan)).toEqual([])
  })

  it('should keep platform and write tools and cap module READ tools', () => {
    const writes = Array.from({ length: 3 }, (_, i) =>
      fakeTool({
        name: `crm_write_${i}`,
        module: 'CRM',
        kind: 'UPDATE',
        preview: vi.fn(async () => ok({ title: 't', summary: 's' })),
      }),
    )
    const tools = [
      ...group('ws', null, null, 4),
      ...group('sd_ticket', 'SERVICE_DESK', 'sd-tickets', 12),
      ...group('crm_lead', 'CRM', 'leads', 12),
      ...group('zap_conv', 'COMMUNICATION', 'conversations', 12),
      ...writes,
    ]
    const plan = planMcpToolListing(tools)
    const reads = plan.listed.filter((t) => t.module && t.kind === 'READ')

    expect(reads).toHaveLength(MCP_COMPACT_READ_TOOLS)
    expect(names(plan.listed)).toEqual(
      expect.arrayContaining(['ws_0', 'ws_3', ...names(writes)]),
    )
    expect(plan.hidden.every((t) => t.kind === 'READ' && t.module)).toBe(true)
    expect(plan.listed.length + plan.hidden.length).toBe(tools.length)
    // Fair share: every module is represented.
    for (const prefix of ['sd_ticket_0', 'crm_lead_0', 'zap_conv_0']) {
      expect(names(plan.listed)).toContain(prefix)
    }
    expect(names(mcpMetaToolDefinitions(plan))).toEqual([
      MCP_FIND_TOOLS_NAME,
      MCP_CALL_TOOL_NAME,
    ])
  })

  it('should follow the usage ranking, most-called tools first', () => {
    const tools = [
      ...group('sd_ticket', 'SERVICE_DESK', 'sd-tickets', 30),
      ...group('sd_cmdb', 'SERVICE_DESK', 'sd-config-items', 15),
    ]
    const plan = planMcpToolListing(tools, { sd_cmdb_14: 50, sd_cmdb_2: 10 })
    const listed = names(plan.listed)
    // Single module: its share is the whole budget, so the top category
    // (CMDB, by usage) goes in whole and tickets fill the rest.
    expect(listed.filter((n) => n.startsWith('sd_cmdb_'))).toHaveLength(15)
    expect(listed.filter((n) => n.startsWith('sd_ticket_'))).toEqual([
      'sd_ticket_0',
      'sd_ticket_1',
      'sd_ticket_2',
      'sd_ticket_3',
      'sd_ticket_4',
    ])
  })

  it('should keep the most-called tools of a category listed in part', () => {
    const tools = group('sd_ticket', 'SERVICE_DESK', 'sd-tickets', 45)
    const listed = names(planMcpToolListing(tools, { sd_ticket_44: 1 }).listed)
    expect(listed).toHaveLength(MCP_COMPACT_READ_TOOLS)
    expect(listed).toContain('sd_ticket_44')
    expect(listed).not.toContain('sd_ticket_19')
  })

  it('should compact the real registry for an admin with every module', () => {
    const exposed = mcpTools(
      STEEL_AI_TOOLS,
      mcpGrant(),
      mcpAccess({ isPrivileged: true }),
    )
    expect(exposed.length).toBeGreaterThan(MCP_TOOLS_LIST_THRESHOLD)
    const plan = planMcpToolListing(exposed)
    expect(plan.listed.length).toBeLessThanOrEqual(MCP_TOOLS_LIST_THRESHOLD)
    expect(names(plan.listed)).toEqual(
      expect.arrayContaining([
        'sd_search_tickets',
        'crm_list_opportunities',
        'zap_conversations_list',
      ]),
    )
    expect(plan.hidden.length).toBeGreaterThan(0)
  })
})

describe('meta-tools', () => {
  it('should be read-only, non-destructive and closed-world', () => {
    for (const def of [mcpFindToolsDefinition(), mcpCallToolDefinition()]) {
      expect(def.annotations).toEqual({
        title: def.title,
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      })
    }
    expect(mcpCallToolDefinition().inputSchema.required).toEqual(['name'])
  })
})

describe('runMcpFindTools()', () => {
  const tools = [
    ...group('sd_ticket', 'SERVICE_DESK', 'sd-tickets', 2),
    ...group('crm_competitor', 'CRM', 'social', 2),
  ]
  const plan = { listed: [tools[0]], hidden: tools.slice(1) }

  it('should return the full definition and whether the tool is listed', () => {
    const result = runMcpFindTools(tools, plan, { module: 'CRM' })
    expect(result.summary).toBe('2 ferramenta(s) encontrada(s)')
    expect(result.data.tools[0]).toEqual({
      name: 'crm_competitor_0',
      title: 'crm_competitor 0',
      kind: 'READ',
      module: 'CRM',
      description: 'Consulta crm competitor 0. Detalhes.',
      inputSchema: { type: 'object', properties: {} },
      listed: false,
    })

    const sd = runMcpFindTools(tools, plan, { module: 'SERVICE_DESK' })
    expect(sd.data.tools.map((t) => [t.name, t.listed])).toEqual([
      ['sd_ticket_0', true],
      ['sd_ticket_1', false],
    ])
  })

  it('should rank by subject and accept missing arguments', () => {
    const result = runMcpFindTools(tools, plan, { query: 'competitor' })
    expect(result.data.tools.map((t) => t.name)).toEqual([
      'crm_competitor_0',
      'crm_competitor_1',
    ])
    expect(runMcpFindTools(tools, plan, null).data.tools).toHaveLength(4)
    expect(runMcpFindTools(tools, plan, { query: 'zzzzz' }).data.tools).toEqual(
      [],
    )
  })
})

describe('resolveCallToolTarget()', () => {
  const read = group('sd_ticket', 'SERVICE_DESK', 'sd-tickets', 1)[0]
  const write = fakeTool({ name: 'sd_write', kind: 'CREATE' })
  const tools = [read, write]

  it('should resolve an exposed READ tool with its arguments', () => {
    expect(
      resolveCallToolTarget(tools, {
        name: 'sd_ticket_0',
        arguments: { q: 1 },
      }),
    ).toEqual({ ok: true, tool: read, arguments: { q: 1 } })
    expect(resolveCallToolTarget(tools, { name: 'sd_ticket_0' })).toEqual({
      ok: true,
      tool: read,
      arguments: {},
    })
  })

  it('should refuse missing names, unknown tools and writes', () => {
    expect(resolveCallToolTarget(tools, {})).toEqual({
      ok: false,
      reason: 'missing_name',
    })
    expect(resolveCallToolTarget(tools, 'x')).toEqual({
      ok: false,
      reason: 'missing_name',
    })
    expect(resolveCallToolTarget(tools, { name: 'nope' })).toEqual({
      ok: false,
      reason: 'unknown',
      name: 'nope',
    })
    expect(resolveCallToolTarget(tools, { name: 'sd_write' })).toEqual({
      ok: false,
      reason: 'write',
      name: 'sd_write',
    })
  })
})
