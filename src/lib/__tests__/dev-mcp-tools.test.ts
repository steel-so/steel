import { describe, expect, it } from 'vitest'
import { STEEL_AI_TOOLS } from '@/src/lib/ai/tools'
import type { AnySteelAiTool } from '@/src/lib/ai/tools/types'
import {
  buildMcpToolCatalog,
  MCP_TOOL_KIND_LABELS,
  mcpToolCatalogMarkdown,
} from '@/src/lib/dev/mcp-tools'
import { ok } from '@/src/lib/result'

function tool(overrides: Partial<AnySteelAiTool>): AnySteelAiTool {
  return {
    name: 'sd_list_tickets',
    label: 'Consultando chamados',
    module: 'SERVICE_DESK',
    kind: 'READ',
    description: 'Lista chamados.',
    parameters: { type: 'object', properties: {} },
    parse: () => ok({}),
    execute: async () => ok({ data: null, summary: '' }),
    ...overrides,
  }
}

describe('buildMcpToolCatalog', () => {
  it('groups by module in guide order, read tools first, then by name', () => {
    const catalog = buildMcpToolCatalog([
      tool({ name: 'zap_list_conversations', module: 'COMMUNICATION' }),
      tool({ name: 'sd_update_ticket', kind: 'UPDATE', label: 'Editando' }),
      tool({ name: 'sd_list_tickets' }),
      tool({ name: 'sd_get_ticket' }),
      tool({ name: 'crm_create_lead', module: 'CRM', kind: 'CREATE' }),
      tool({ name: 'get_skill', module: null, label: 'Abrindo skill' }),
      tool({ name: 'sd_assign', kind: 'ACTION' }),
    ])

    expect(catalog.groups.map((group) => group.label)).toEqual([
      'Plataforma',
      'ServiceDesk',
      'CRM',
      'Comunicação',
    ])
    expect(catalog.groups.map((group) => group.module)).toEqual([
      null,
      'SERVICE_DESK',
      'CRM',
      'COMMUNICATION',
    ])
    expect(catalog.groups[1].tools.map((t) => t.name)).toEqual([
      'sd_get_ticket',
      'sd_list_tickets',
      'sd_assign',
      'sd_update_ticket',
    ])
    expect(catalog.groups[1].tools[3]).toEqual({
      name: 'sd_update_ticket',
      label: 'Editando',
      kind: 'UPDATE',
      access: 'write',
    })
    expect(catalog.groups[2].tools[0].access).toBe('write')
    expect(catalog.groups[0].tools[0].access).toBe('read')
    expect(catalog.readCount).toBe(4)
    expect(catalog.writeCount).toBe(3)
    expect(catalog.deleteCount).toBe(0)
  })

  it('leaves DELETE tools out and only counts them; drops empty groups', () => {
    const catalog = buildMcpToolCatalog([
      tool({ name: 'crm_delete_lead', module: 'CRM', kind: 'DELETE' }),
      tool({ name: 'sd_delete_ticket', kind: 'DELETE' }),
      tool({ name: 'sd_list_tickets' }),
    ])
    expect(catalog.deleteCount).toBe(2)
    expect(catalog.groups.map((group) => group.label)).toEqual(['ServiceDesk'])
    expect(
      catalog.groups.flatMap((group) => group.tools).map((t) => t.name),
    ).toEqual(['sd_list_tickets'])
  })

  it('returns an empty catalog for no tools', () => {
    expect(buildMcpToolCatalog([])).toEqual({
      groups: [],
      readCount: 0,
      writeCount: 0,
      deleteCount: 0,
    })
  })

  it('covers the real registry: every non-DELETE tool, once', () => {
    const catalog = buildMcpToolCatalog()
    const names = catalog.groups.flatMap((group) =>
      group.tools.map((t) => t.name),
    )
    const expected = STEEL_AI_TOOLS.filter((t) => t.kind !== 'DELETE').map(
      (t) => t.name,
    )
    expect([...names].sort()).toEqual([...expected].sort())
    expect(catalog.deleteCount).toBe(
      STEEL_AI_TOOLS.filter((t) => t.kind === 'DELETE').length,
    )
    expect(catalog.readCount).toBe(
      STEEL_AI_TOOLS.filter((t) => t.kind === 'READ').length,
    )
  })
})

describe('mcpToolCatalogMarkdown', () => {
  it('renders the counts and one table per group, escaping pipes', () => {
    const md = mcpToolCatalogMarkdown(
      buildMcpToolCatalog([
        tool({ name: 'sd_list_tickets', label: 'Chamados | filas' }),
        tool({ name: 'crm_create_lead', module: 'CRM', kind: 'CREATE' }),
        tool({ name: 'crm_delete_lead', module: 'CRM', kind: 'DELETE' }),
      ]),
    )
    expect(md).toBe(
      [
        '1 ferramentas de leitura e 1 de escrita; 1 de exclusão ficam fora do MCP.',
        '#### ServiceDesk\n\n| Ferramenta | O que faz | Tipo | Escopo |\n| ---------- | --------- | ---- | ------ |\n| `sd_list_tickets` | Chamados \\| filas | Leitura | `mcp:read` |',
        `#### CRM\n\n| Ferramenta | O que faz | Tipo | Escopo |\n| ---------- | --------- | ---- | ------ |\n| \`crm_create_lead\` | Consultando chamados | ${MCP_TOOL_KIND_LABELS.CREATE} | \`mcp:write\` |`,
      ].join('\n\n'),
    )
  })

  it('defaults to the real registry', () => {
    expect(mcpToolCatalogMarkdown()).toContain('#### ServiceDesk')
  })
})
