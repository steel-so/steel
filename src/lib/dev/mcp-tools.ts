import type { ModuleKind } from '@prisma/client'
import { STEEL_AI_TOOLS } from '@/src/lib/ai/tools'
import type { AiToolKind, AnySteelAiTool } from '@/src/lib/ai/tools/types'

/**
 * The tool list of the MCP guide (`/dev/mcp`), built from the Steel AI
 * registry (`STEEL_AI_TOOLS`) — the same list the MCP server filters for
 * `tools/list` (ADR 0032). The page is statically rendered, so the table is
 * fixed at build time: a new tool shows up in the guide on the next deploy
 * and a removed one disappears. Never typed by hand.
 *
 * `DELETE` tools are never exposed over MCP, so they are left out and only
 * counted.
 */

export type McpToolAccess = 'read' | 'write'

export interface McpToolEntry {
  name: string
  label: string
  kind: Exclude<AiToolKind, 'DELETE'>
  /** `read` needs `mcp:read`; `write` needs `mcp:write` and the admin switch. */
  access: McpToolAccess
  /** First sentence of the tool description: what the tool does. */
  summary: string
}

export interface McpToolGroup {
  /** `null` = platform tools, available whatever modules are enabled. */
  module: ModuleKind | null
  label: string
  tools: McpToolEntry[]
}

export interface McpToolCatalog {
  groups: McpToolGroup[]
  readCount: number
  writeCount: number
  /** DELETE tools of the registry, never exposed. */
  deleteCount: number
}

/** Group order of the guide: platform first, then the modules. */
const GROUPS: readonly { module: ModuleKind | null; label: string }[] = [
  { module: null, label: 'Plataforma' },
  { module: 'SERVICE_DESK', label: 'ServiceDesk' },
  { module: 'CRM', label: 'CRM' },
  { module: 'COMMUNICATION', label: 'Comunicação' },
]

export const MCP_TOOL_KIND_LABELS: Record<McpToolEntry['kind'], string> = {
  READ: 'Leitura',
  CREATE: 'Criação',
  UPDATE: 'Edição',
  ACTION: 'Ação',
}

export const MCP_TOOL_ACCESS_LABELS: Record<McpToolAccess, string> = {
  read: 'mcp:read',
  write: 'mcp:write',
}

const SUMMARY_MAX = 220

/**
 * What the tool does, for the guide: the first sentence of its description
 * (the text the model reads), whitespace collapsed and capped.
 */
export function toolSummary(description: string): string {
  const text = description.replace(/\s+/g, ' ').trim()
  const first = text.split(/(?<=[.!?])\s+(?=[A-ZÀ-Ú(])/)[0] ?? text
  return first.length > SUMMARY_MAX
    ? `${first.slice(0, SUMMARY_MAX - 1).trimEnd()}…`
    : first
}

function compareEntries(a: McpToolEntry, b: McpToolEntry): number {
  if (a.access !== b.access) return a.access === 'read' ? -1 : 1
  return a.name.localeCompare(b.name, 'en')
}

/**
 * Tools grouped by module (platform, ServiceDesk, CRM, Comunicação), read
 * tools first and alphabetical inside each access level. Empty groups are
 * dropped.
 */
export function buildMcpToolCatalog(
  tools: readonly AnySteelAiTool[] = STEEL_AI_TOOLS,
): McpToolCatalog {
  let deleteCount = 0
  const byModule = new Map<ModuleKind | null, McpToolEntry[]>()
  for (const tool of tools) {
    if (tool.kind === 'DELETE') {
      deleteCount += 1
      continue
    }
    const entries = byModule.get(tool.module) ?? []
    entries.push({
      name: tool.name,
      label: tool.label,
      kind: tool.kind,
      access: tool.kind === 'READ' ? 'read' : 'write',
      summary: toolSummary(tool.description),
    })
    byModule.set(tool.module, entries)
  }

  const groups = GROUPS.map(({ module, label }) => ({
    module,
    label,
    tools: (byModule.get(module) ?? []).sort(compareEntries),
  })).filter((group) => group.tools.length > 0)

  const all = groups.flatMap((group) => group.tools)
  return {
    groups,
    readCount: all.filter((tool) => tool.access === 'read').length,
    writeCount: all.filter((tool) => tool.access === 'write').length,
    deleteCount,
  }
}

const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ')

/**
 * The same table as markdown, for `llms-full.txt`, where the page's
 * `<McpToolTable />` component can't render.
 */
export function mcpToolCatalogMarkdown(
  catalog: McpToolCatalog = buildMcpToolCatalog(),
): string {
  const intro = `${catalog.readCount} ferramentas de leitura e ${catalog.writeCount} de escrita; ${catalog.deleteCount} de exclusão ficam fora do MCP.`
  const tables = catalog.groups.map((group) =>
    [
      `#### ${group.label}`,
      '',
      '| Ferramenta | O que faz | Tipo | Escopo |',
      '| ---------- | --------- | ---- | ------ |',
      ...group.tools.map(
        (tool) =>
          `| \`${tool.name}\` | ${cell(tool.summary)} | ${MCP_TOOL_KIND_LABELS[tool.kind]} | \`${MCP_TOOL_ACCESS_LABELS[tool.access]}\` |`,
      ),
    ].join('\n'),
  )
  return [intro, ...tables].join('\n\n')
}
