import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import type { ModuleKind } from '@prisma/client'
import {
  compactSchema,
  FIND_TOOLS_TOOL_NAME,
  findTools,
} from '@/src/lib/ai/tools/selection'
import type { AnySteelAiTool } from '@/src/lib/ai/tools/types'

/**
 * Tool discovery for grants that expose many tools (ADR 0032). MCP clients
 * put every listed tool in the model's context, and past ~40 tools both
 * the token cost and the model's choice get worse. Above the threshold,
 * `tools/list` carries a compact set and two meta-tools reach the rest:
 *
 * - always listed: platform tools (`module: null`) and every write tool
 *   (clients decide what to confirm from each write's own annotations, so a
 *   write is never hidden behind a generic tool);
 * - READ tools of the most-used categories (category = module × RBAC
 *   resource), ranked by this workspace's MCP calls in the last two months
 *   (`tool-usage.ts`) and then by a default order, up to
 *   {@link MCP_COMPACT_READ_TOOLS} — each module first gets a fair share
 *   of its top category, and a category may be listed in part;
 * - `steel_find_tools`: searches every exposed tool by module and subject
 *   and returns name, description and input schema;
 * - `steel_call_tool`: runs a READ tool found that way (clients only let
 *   the model call listed tools). Writes are refused there: they are
 *   always listed and called by their own name.
 *
 * `tools/call` with the real name of a hidden tool also works: hiding is a
 * listing decision, never an access one. Pure and deterministic.
 */

/** Above this many exposed tools, `tools/list` goes compact. */
export const MCP_TOOLS_LIST_THRESHOLD = 40
/** Module READ tools listed in compact mode (platform tools aside). */
export const MCP_COMPACT_READ_TOOLS = 20

export const MCP_FIND_TOOLS_NAME = FIND_TOOLS_TOOL_NAME
export const MCP_CALL_TOOL_NAME = 'steel_call_tool'
export const MCP_META_TOOL_NAMES: ReadonlySet<string> = new Set([
  MCP_FIND_TOOLS_NAME,
  MCP_CALL_TOOL_NAME,
])

/**
 * Category order when usage ties (or there is none yet): the day-to-day
 * records of each module first.
 */
const DEFAULT_CATEGORY_ORDER = [
  'SERVICE_DESK:sd-tickets',
  'CRM:opportunities',
  'CRM:leads',
  'COMMUNICATION:conversations',
  'SERVICE_DESK:sd-knowledge',
  'CRM:tasks',
  'COMMUNICATION:contacts',
  'SERVICE_DESK:sd-dashboards',
  'CRM:pipelines',
  'CRM:people',
  'CRM:companies',
]

const MODULE_ORDER: ModuleKind[] = ['SERVICE_DESK', 'CRM', 'COMMUNICATION']

/** `<module>:<resource>`; tools without an RBAC resource share `geral`. */
export function toolCategory(tool: AnySteelAiTool): string {
  return `${tool.module ?? 'PLATFORM'}:${tool.permission?.resource ?? 'geral'}`
}

interface CategoryRank {
  category: string
  module: ModuleKind
  tools: AnySteelAiTool[]
  calls: number
  defaultIndex: number
  firstIndex: number
}

/** Module READ categories, most used first. */
export function rankReadCategories(
  tools: readonly AnySteelAiTool[],
  usage: Readonly<Record<string, number>>,
): CategoryRank[] {
  const byCategory = new Map<string, CategoryRank>()
  tools.forEach((tool, index) => {
    if (tool.kind !== 'READ' || !tool.module) return
    const category = toolCategory(tool)
    const rank = byCategory.get(category) ?? {
      category,
      module: tool.module,
      tools: [],
      calls: 0,
      defaultIndex: indexOrEnd(DEFAULT_CATEGORY_ORDER.indexOf(category)),
      firstIndex: index,
    }
    rank.tools.push(tool)
    rank.calls += usage[tool.name] ?? 0
    byCategory.set(category, rank)
  })
  return [...byCategory.values()].sort(
    (a, b) =>
      b.calls - a.calls ||
      a.defaultIndex - b.defaultIndex ||
      a.firstIndex - b.firstIndex,
  )
}

function indexOrEnd(index: number): number {
  return index === -1 ? Number.MAX_SAFE_INTEGER : index
}

export interface McpToolListing {
  /** Tools sent in `tools/list` (registry order). */
  listed: AnySteelAiTool[]
  /** Exposed tools left out of the list (reachable via the meta-tools). */
  hidden: AnySteelAiTool[]
}

/**
 * Splits the exposed tools into listed and hidden. At or under the
 * threshold everything is listed; above it, see the module doc.
 */
export function planMcpToolListing(
  exposed: readonly AnySteelAiTool[],
  usage: Readonly<Record<string, number>> = {},
): McpToolListing {
  if (exposed.length <= MCP_TOOLS_LIST_THRESHOLD) {
    return { listed: [...exposed], hidden: [] }
  }
  const keep = new Set<string>()
  for (const tool of exposed) {
    if (!tool.module || tool.kind !== 'READ') keep.add(tool.name)
  }

  const ranked = rankReadCategories(exposed, usage)
  let reads = 0
  /** Adds up to `max` not-yet-listed tools of a category, most used first. */
  const take = (rank: CategoryRank, max: number) => {
    const order = rank.tools
      .map((tool, index) => ({ tool, index }))
      .filter(({ tool }) => !keep.has(tool.name))
      .sort(
        (a, b) =>
          (usage[b.tool.name] ?? 0) - (usage[a.tool.name] ?? 0) ||
          a.index - b.index,
      )
    for (const { tool } of order.slice(0, max)) {
      if (reads >= MCP_COMPACT_READ_TOOLS) return
      keep.add(tool.name)
      reads += 1
    }
  }
  // Each module with READ tools gets a fair share of its top category
  // first, so one heavy module never crowds the others out; the rest of the
  // budget follows the ranking (a category may be listed in part).
  const modules = MODULE_ORDER.filter((m) => ranked.some((r) => r.module === m))
  const share = Math.floor(MCP_COMPACT_READ_TOOLS / Math.max(modules.length, 1))
  for (const module of modules) {
    const top = ranked.find((rank) => rank.module === module)
    if (top) take(top, share)
  }
  for (const rank of ranked) take(rank, MCP_COMPACT_READ_TOOLS)

  return {
    listed: exposed.filter((tool) => keep.has(tool.name)),
    hidden: exposed.filter((tool) => !keep.has(tool.name)),
  }
}

/* -------------------------------- meta-tools ------------------------------- */

const META_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const

export function mcpFindToolsDefinition(): Tool {
  return {
    name: MCP_FIND_TOOLS_NAME,
    title: 'Procurar ferramentas',
    description:
      'Procura ferramentas do Steel que não estão na lista, por módulo e/ou assunto, e devolve nome, descrição e o esquema de parâmetros de cada uma (até 10). Use antes de concluir que não há ferramenta para o pedido. Ferramentas de leitura encontradas são executadas com steel_call_tool; as de escrita já estão na lista e são chamadas pelo próprio nome.',
    inputSchema: {
      type: 'object',
      properties: {
        module: {
          type: 'string',
          enum: [...MODULE_ORDER],
          description: 'Restringe a busca a um módulo.',
        },
        query: {
          type: 'string',
          description:
            'Assunto ou ação, em português. Ex.: "base de conhecimento", "concorrentes", "transmissões".',
        },
      },
    },
    annotations: { title: 'Procurar ferramentas', ...META_ANNOTATIONS },
  }
}

export function mcpCallToolDefinition(): Tool {
  return {
    name: MCP_CALL_TOOL_NAME,
    title: 'Executar ferramenta de leitura',
    description:
      'Executa uma ferramenta de leitura do Steel encontrada com steel_find_tools que não está na lista. Informe o nome exato e os argumentos conforme o esquema devolvido pela busca. Só aceita ferramentas de leitura.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description:
            'Nome exato da ferramenta (ex.: "crm_list_competitors").',
        },
        arguments: {
          type: 'object',
          description: 'Argumentos da ferramenta, conforme o esquema dela.',
        },
      },
      required: ['name'],
    },
    annotations: {
      title: 'Executar ferramenta de leitura',
      ...META_ANNOTATIONS,
    },
  }
}

/** Meta-tool definitions to append when some tool was hidden. */
export function mcpMetaToolDefinitions(listing: McpToolListing): Tool[] {
  return listing.hidden.length > 0
    ? [mcpFindToolsDefinition(), mcpCallToolDefinition()]
    : []
}

export interface McpFoundTool {
  name: string
  title: string
  kind: string
  module: string
  description: string
  inputSchema: unknown
  /** Already in `tools/list` (call it by name). */
  listed: boolean
}

export interface McpFindToolsResult {
  summary: string
  data: { tools: McpFoundTool[] }
}

/**
 * `steel_find_tools` over MCP: the ranking of the in-app meta-tool
 * (`findTools`, module + keyword overlap) over the exposed tools, returned
 * with what a client needs to call them right away.
 */
export function runMcpFindTools(
  exposed: readonly AnySteelAiTool[],
  listing: McpToolListing,
  args: unknown,
): McpFindToolsResult {
  const raw = isRecord(args) ? args : {}
  const found = findTools(exposed, raw)
  const byName = new Map(exposed.map((tool) => [tool.name, tool]))
  const listed = new Set(listing.listed.map((tool) => tool.name))
  const tools = found.names.flatMap((name, index) => {
    const tool = byName.get(name)
    if (!tool) return []
    return [
      {
        name,
        title: tool.label,
        kind: tool.kind,
        module: found.data.tools[index].module,
        description: tool.description.replace(/\s+/g, ' ').trim(),
        inputSchema: compactSchema(tool.parameters),
        listed: listed.has(name),
      },
    ]
  })
  return { summary: found.summary, data: { tools } }
}

export type McpCallTarget =
  | { ok: true; tool: AnySteelAiTool; arguments: Record<string, unknown> }
  | { ok: false; reason: 'missing_name' }
  | { ok: false; reason: 'unknown' | 'write'; name: string }

/**
 * What `steel_call_tool` should run: an exposed READ tool. Writes are
 * refused (they are always listed, with their own annotations); a name the
 * grant can't see is `unknown`, like in `tools/call`.
 */
export function resolveCallToolTarget(
  exposed: readonly AnySteelAiTool[],
  args: unknown,
): McpCallTarget {
  if (!isRecord(args) || typeof args.name !== 'string' || !args.name) {
    return { ok: false, reason: 'missing_name' }
  }
  const name = args.name
  const tool = exposed.find((t) => t.name === name)
  if (!tool) return { ok: false, reason: 'unknown', name }
  if (tool.kind !== 'READ') return { ok: false, reason: 'write', name }
  return {
    ok: true,
    tool,
    arguments: isRecord(args.arguments) ? args.arguments : {},
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
