import { describe, expect, it } from 'vitest'
import { createFakeAiMessage } from '@/src/__tests__/factories/steel-ai.factory'
import { ok } from '@/src/lib/result'
import { buildSteelAiSystemPrompt } from '../ai/steel-ai-prompt'
import { STEEL_AI_TOOLS } from '../ai/tools'
import {
  type AiToolAccess,
  availableTools,
  toolMeta,
  toToolSpecs,
} from '../ai/tools/registry'
import {
  compactSchema,
  compactToolSpec,
  detectModules,
  estimateTokens,
  FIND_TOOLS_MAX_RESULTS,
  FIND_TOOLS_TOOL_NAME,
  findTools,
  findToolsSpec,
  hasWriteIntent,
  keywordStems,
  MAX_PINNED_TOOLS,
  normalizeText,
  pinnedToolsFromHistory,
  scoreTool,
  selectionSpecs,
  selectSteelAiTools,
  TOOL_SPECS_TOKEN_BUDGET,
} from '../ai/tools/selection'
import type { AnySteelAiTool } from '../ai/tools/types'

function tool(overrides: Partial<AnySteelAiTool>): AnySteelAiTool {
  return {
    name: 'x_tool',
    label: 'Ferramenta',
    module: null,
    kind: 'READ',
    description: 'Descrição.',
    parameters: { type: 'object', properties: {} },
    parse: (args) => ok(args),
    execute: async () => ok({ data: null, summary: 'ok' }),
    ...overrides,
  }
}

const platform = tool({ name: 'ws_overview', label: 'Consultando o workspace' })
const sdSearch = tool({
  name: 'sd_search_tickets',
  label: 'Consultando chamados',
  module: 'SERVICE_DESK',
  description: 'Busca chamados por status, fila e SLA.',
})
const sdSla = tool({
  name: 'sd_sla_at_risk',
  label: 'Consultando SLA em risco',
  module: 'SERVICE_DESK',
  description: 'Chamados com SLA perto de estourar.',
})
const sdCreate = tool({
  name: 'sd_create_ticket',
  label: 'Abrindo chamado',
  module: 'SERVICE_DESK',
  kind: 'CREATE',
  description: 'Abre um chamado.',
})
const crmLeads = tool({
  name: 'crm_list_leads',
  label: 'Consultando leads',
  module: 'CRM',
  description: 'Lista leads do funil.',
})
const crmLost = tool({
  name: 'crm_close_lead_lost',
  label: 'Fechando lead como perdido',
  module: 'CRM',
  kind: 'ACTION',
  description: 'Fecha o lead como perdido, com motivo.',
})
const zapConversations = tool({
  name: 'zap_conversations_list',
  label: 'Consultando conversas do WhatsApp',
  module: 'COMMUNICATION',
  description: 'Lista conversas.',
})

const ALL = [
  platform,
  sdSearch,
  sdSla,
  sdCreate,
  crmLeads,
  crmLost,
  zapConversations,
]
const names = (tools: readonly AnySteelAiTool[]) => tools.map((t) => t.name)

describe('text helpers', () => {
  it('should normalize accents, case and punctuation', () => {
    expect(normalizeText('  Transmissões, AÇÃO!  ')).toBe('transmissoes acao')
  })

  it('should detect modules by word prefixes, ambiguous words in several', () => {
    expect(detectModules('Quais chamados estão abertos?')).toEqual([
      'SERVICE_DESK',
    ])
    expect(detectModules('Mostre os leads do funil')).toEqual(['CRM'])
    expect(detectModules('mensagens do WhatsApp')).toEqual(['COMMUNICATION'])
    expect(detectModules('meus contatos')).toEqual([
      'SERVICE_DESK',
      'CRM',
      'COMMUNICATION',
    ])
    expect(detectModules('oi, tudo bem?')).toEqual([])
    expect(detectModules('')).toEqual([])
    // Prefix of a word, not a substring in the middle of one.
    expect(detectModules('a fileira')).toEqual([])
  })

  it('should spot a change request', () => {
    expect(hasWriteIntent('Crie uma tarefa')).toBe(true)
    expect(hasWriteIntent('feche o lead como perdido')).toBe(true)
    expect(hasWriteIntent('quantos leads tenho?')).toBe(false)
    expect(hasWriteIntent('chamados críticos')).toBe(false)
  })

  it('should keep 5-char stems of meaningful words only', () => {
    expect(keywordStems('Quais são os chamados da fila?')).toEqual([
      'chama',
      'fila',
    ])
  })

  it('should score name/label hits above description hits', () => {
    const stems = keywordStems('SLA em risco')
    expect(scoreTool(sdSla, stems)).toBeGreaterThan(scoreTool(sdSearch, stems))
    expect(scoreTool(sdSearch, stems)).toBe(1)
    expect(scoreTool(crmLeads, [])).toBe(0)
  })

  it('should estimate ~4 chars per token', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('abcde')).toBe(2)
  })
})

describe('compactSchema() / compactToolSpec()', () => {
  it('should drop bounds and additionalProperties but keep the contract', () => {
    const schema = {
      type: 'object',
      additionalProperties: false,
      required: ['title'],
      properties: {
        title: { type: 'string', maxLength: 200, minLength: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'd' },
        tags: { type: 'array', items: { type: 'string' }, maxItems: 5 },
        minimum: { type: 'number' },
        kind: { type: 'string', enum: ['a', 'b'] },
      },
    }
    expect(compactSchema(schema)).toEqual({
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string' },
        limit: { type: 'integer', description: 'd' },
        tags: { type: 'array', items: { type: 'string' } },
        minimum: { type: 'number' },
        kind: { type: 'string', enum: ['a', 'b'] },
      },
    })
  })

  it('should collapse whitespace in descriptions', () => {
    expect(
      compactToolSpec({
        name: 'a',
        description: '  linha um\n   linha dois ',
        parameters: { type: 'object' },
      }).description,
    ).toBe('linha um linha dois')
  })

  it('should make toToolSpecs compact too', () => {
    expect(
      toToolSpecs([
        tool({ parameters: { type: 'object', additionalProperties: false } }),
      ])[0].parameters,
    ).toEqual({ type: 'object' })
  })
})

describe('selectSteelAiTools()', () => {
  it('should always keep platform tools and offer the finder for the rest', () => {
    const selection = selectSteelAiTools({ available: ALL, message: 'Oi' })
    expect(names(selection.tools)).toEqual(['ws_overview'])
    expect(selection.modules).toEqual([])
    expect(selection.offerFinder).toBe(true)
    expect(names(selectionSpecs(selection) as never)).toEqual([
      'ws_overview',
      FIND_TOOLS_TOOL_NAME,
    ])
  })

  it('should add the tools of the detected module, reads first', () => {
    const selection = selectSteelAiTools({
      available: ALL,
      message: 'Quais chamados estão abertos?',
    })
    expect(names(selection.tools)).toEqual([
      'ws_overview',
      'sd_search_tickets',
      'sd_sla_at_risk',
      'sd_create_ticket',
    ])
    expect(selection.modules).toEqual(['SERVICE_DESK'])
  })

  it('should rank write tools first on a change request and respect the budget', () => {
    const budget =
      estimateTokens(JSON.stringify(findToolsSpec())) +
      estimateTokens(JSON.stringify(compactToolSpec(platform))) +
      estimateTokens(JSON.stringify(compactToolSpec(crmLost)))
    const selection = selectSteelAiTools({
      available: ALL,
      message: 'Feche o lead da Acme como perdido',
      budgetTokens: budget,
    })
    expect(names(selection.tools)).toEqual([
      'ws_overview',
      'crm_close_lead_lost',
    ])
    expect(selection.offerFinder).toBe(true)
  })

  it('should not offer the finder when everything fits', () => {
    const selection = selectSteelAiTools({
      available: [platform, crmLeads],
      message: 'leads',
    })
    expect(selection.offerFinder).toBe(false)
    expect(names(selectionSpecs(selection) as never)).toEqual([
      'ws_overview',
      'crm_list_leads',
    ])
  })

  it('should keep pinned tools (only allowed ones) and use their modules', () => {
    const selection = selectSteelAiTools({
      available: ALL,
      message: 'e os de ontem?',
      pinned: [
        'crm_list_leads',
        'removed_tool',
        'crm_list_leads',
        'ws_overview',
      ],
    })
    expect(names(selection.tools)).toEqual([
      'ws_overview',
      'crm_list_leads',
      'crm_close_lead_lost',
    ])
    expect(selection.modules).toEqual(['CRM'])
  })

  it('should cap the pinned tools', () => {
    const many = Array.from({ length: MAX_PINNED_TOOLS + 3 }, (_, i) =>
      tool({ name: `crm_t${i}`, module: 'CRM' }),
    )
    const selection = selectSteelAiTools({
      available: many,
      message: 'oi',
      pinned: names(many),
      budgetTokens: 0,
    })
    expect(selection.tools).toHaveLength(MAX_PINNED_TOOLS)
  })

  it('should fall back to the previous user message for the module', () => {
    const selection = selectSteelAiTools({
      available: ALL,
      message: 'e agora?',
      previousMessages: ['Mostre as conversas do WhatsApp', 'antes'],
    })
    expect(selection.modules).toEqual(['COMMUNICATION'])
    expect(names(selection.tools)).toContain('zap_conversations_list')
  })

  it('should ignore modules the caller has no tools for', () => {
    const selection = selectSteelAiTools({
      available: [platform, crmLeads],
      message: 'chamados do WhatsApp',
    })
    expect(selection.modules).toEqual([])
  })
})

describe('findTools()', () => {
  it('should list allowed tools of a module, ranked by the query', () => {
    const found = findTools(ALL, { module: 'CRM', query: 'perdido' })
    expect(found.names).toEqual(['crm_close_lead_lost'])
    expect(found.data.tools[0]).toEqual({
      name: 'crm_close_lead_lost',
      kind: 'ACTION',
      module: 'CRM',
      summary: 'Fecha o lead como perdido, com motivo.',
    })
    expect(found.summary).toBe('1 ferramenta(s) encontrada(s)')
  })

  it('should infer the module from the query and ignore a bogus module', () => {
    expect(findTools(ALL, { module: 'NOPE', query: 'whatsapp' }).names).toEqual(
      ['zap_conversations_list'],
    )
    expect(findTools(ALL, { query: 42 }).names).toEqual([
      'sd_search_tickets',
      'sd_sla_at_risk',
      'sd_create_ticket',
      'crm_list_leads',
      'crm_close_lead_lost',
      'zap_conversations_list',
    ])
  })

  it('should cap the results, cut long descriptions and say when nothing matched', () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      tool({
        name: `sd_t${i}`,
        module: 'SERVICE_DESK',
        description: `${'x'.repeat(200)} fim`,
      }),
    )
    const found = findTools(many, { module: 'SERVICE_DESK' })
    expect(found.names).toHaveLength(FIND_TOOLS_MAX_RESULTS)
    expect(found.data.tools[0].summary).toHaveLength(158)
    expect(findTools(ALL, { query: 'xyzzy' })).toMatchObject({
      names: [],
      summary: 'Nenhuma ferramenta encontrada',
    })
  })

  it('should never offer a tool outside the allowed list', () => {
    expect(
      findTools([platform, crmLeads], { module: 'SERVICE_DESK' }).names,
    ).toEqual([])
  })
})

describe('pinnedToolsFromHistory()', () => {
  it('should collect called and activated tools, most recent first', () => {
    const rows = [
      createFakeAiMessage({
        role: 'ASSISTANT',
        toolCalls: [{ id: 'a', name: 'sd_search_tickets', arguments: {} }],
      }),
      createFakeAiMessage({
        role: 'TOOL',
        toolName: FIND_TOOLS_TOOL_NAME,
        content: JSON.stringify({
          status: 'done',
          data: { tools: [{ name: 'crm_list_leads' }, { name: 7 }] },
        }),
      }),
      createFakeAiMessage({
        role: 'ASSISTANT',
        toolCalls: [
          { id: 'b', name: FIND_TOOLS_TOOL_NAME, arguments: {} },
          { id: 'c', name: 'sd_search_tickets', arguments: {} },
          null,
        ] as never,
      }),
      createFakeAiMessage({
        role: 'TOOL',
        toolName: FIND_TOOLS_TOOL_NAME,
        content: '{trunc',
      }),
      createFakeAiMessage({
        role: 'TOOL',
        toolName: FIND_TOOLS_TOOL_NAME,
        content: '{}',
      }),
      createFakeAiMessage({ role: 'ASSISTANT', toolCalls: null }),
      createFakeAiMessage({ role: 'USER' }),
    ]
    expect(pinnedToolsFromHistory(rows)).toEqual([
      'sd_search_tickets',
      'crm_list_leads',
    ])
  })
})

describe('meta-tool label', () => {
  it('should describe steel_find_tools in the transcript', () => {
    expect(toolMeta(FIND_TOOLS_TOOL_NAME)).toEqual({
      label: 'Procurando ferramentas',
      module: null,
    })
  })
})

/* ----------------------- token budget on the real registry ----------------------- */

const FULL_ACCESS: AiToolAccess = {
  modules: ['SERVICE_DESK', 'CRM', 'COMMUNICATION'],
  isPrivileged: true,
  permissions: null,
  agentModeEnabled: true,
  aiEnabled: true,
  agentsEnabled: true,
  autopilotEnabled: false,
}

/** What every call sent before this change: all tools, raw schemas. */
function legacyToolTokens(tools: readonly AnySteelAiTool[]): number {
  return estimateTokens(
    JSON.stringify(
      tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
    ),
  )
}

function firstTurnTokens(message: string): number {
  const available = availableTools(FULL_ACCESS, 'AGENT', STEEL_AI_TOOLS)
  const specs = selectionSpecs(selectSteelAiTools({ available, message }))
  const system = buildSteelAiSystemPrompt({
    userName: 'Ana Souza',
    workspaceName: 'Acme Telecom',
    now: new Date('2026-10-06T12:00:00Z'),
    timezone: 'America/Sao_Paulo',
    modules: FULL_ACCESS.modules,
    mode: 'AGENT',
  })
  return (
    estimateTokens(system) +
    estimateTokens(JSON.stringify(specs)) +
    estimateTokens(message)
  )
}

describe('token budget (real Steel AI registry)', () => {
  const available = availableTools(FULL_ACCESS, 'AGENT', STEEL_AI_TOOLS)

  it('should have sent ~14k tokens of tool specs per call before', () => {
    expect(legacyToolTokens(available)).toBeGreaterThan(13_000)
  })

  it.each([
    'Oi, tudo bem?',
    'Quais chamados estão com SLA em risco hoje?',
    'Abra um chamado de incidente: a impressora do 3º andar parou',
    'Crie uma tarefa no CRM para ligar para a Acme amanhã',
    'Quantos leads entraram esta semana e quais oportunidades estão paradas?',
    'Resuma as últimas conversas do WhatsApp sem resposta',
    'Mostre meus contatos e clientes',
  ])('should keep a first turn under ~5k input tokens: %s', (message) => {
    expect(firstTurnTokens(message)).toBeLessThanOrEqual(5_000)
  })

  it.each([
    [
      'Quais chamados estão com SLA em risco hoje?',
      ['sd_sla_at_risk', 'sd_search_tickets'],
    ],
    ['Abra um chamado de incidente: a impressora parou', ['sd_create_ticket']],
    ['Feche o lead da Acme como perdido', ['crm_close_lead_lost']],
    ['Envie uma mensagem no WhatsApp para o João', ['zap_message_send_text']],
  ])('should pick the tools the request needs: %s', (message, expected) => {
    const picked = names(selectSteelAiTools({ available, message }).tools)
    for (const name of expected) expect(picked).toContain(name)
  })

  it('should keep the on-demand Wiki tools out of unrelated rounds', () => {
    const picked = names(
      selectSteelAiTools({
        available,
        message: 'Quais chamados estão com SLA em risco hoje?',
      }).tools,
    )
    expect(picked).not.toContain('wiki_pages_list')
    expect(picked).toContain('sd_search_tickets')
  })

  it('should offer the Wiki tools when the request mentions the Wiki', () => {
    const picked = names(
      selectSteelAiTools({
        available,
        message: 'Procure na Wiki a página de onboarding',
      }).tools,
    )
    expect(picked).toContain('wiki_pages_list')
  })

  it('should let steel_find_tools surface the on-demand Wiki tools', () => {
    expect(findTools(available, { query: 'wiki' }).names).toContain(
      'wiki_pages_list',
    )
    expect(
      findTools(available, { module: 'CRM', query: 'wiki' }).names,
    ).not.toContain('wiki_pages_list')
  })

  it('should keep the tool specs of any selection within the budget', () => {
    const selection = selectSteelAiTools({
      available,
      message: 'chamados leads conversas whatsapp crm servicedesk',
    })
    const specsTokens = estimateTokens(
      JSON.stringify(selectionSpecs(selection)),
    )
    expect(specsTokens).toBeLessThanOrEqual(TOOL_SPECS_TOKEN_BUDGET)
    expect(selection.tools.length).toBeLessThan(available.length)
  })

  it('should find every allowed tool by module through the meta-tool', () => {
    const reachable = new Set<string>()
    for (const module of FULL_ACCESS.modules) {
      // No query: the first page of the module; queries reach the rest.
      for (const name of findTools(available, { module }).names) {
        reachable.add(name)
      }
      for (const t of available.filter((x) => x.module === module)) {
        for (const name of findTools(available, { module, query: t.label })
          .names) {
          reachable.add(name)
        }
      }
    }
    const moduleTools = available.filter((t) => t.module)
    expect(moduleTools.every((t) => reachable.has(t.name))).toBe(true)
  })
})
