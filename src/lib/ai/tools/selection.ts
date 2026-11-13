import type { AiMessage as AiMessageRow, ModuleKind } from '@prisma/client'
import type { AiToolSpec } from '../types'
import type { AnySteelAiTool } from './types'

/**
 * Which tool specs go to the model on each round. Sending all ~95 Steel AI
 * tools costs ~14k input tokens per provider call, so a round only carries:
 *
 * 1. platform tools (`module: null`) — small and always useful;
 * 2. pinned tools — called in the recent history or activated by the
 *    `steel_find_tools` meta-tool (keeps a follow-up question working);
 * 3. tools of the modules the message is about (keyword detection), ranked
 *    by keyword overlap with the message, while the token budget lasts;
 * 4. `steel_find_tools` whenever some allowed tool was left out, so the
 *    model can ask for it and get it on the next round.
 *
 * Selection never widens access: the input is the list already filtered by
 * mode × module × RBAC (`availableTools`), and callers keep executing any
 * call against that same filtered list. Pure and deterministic — shared by
 * the assistant and Steel Agents.
 */

export const FIND_TOOLS_TOOL_NAME = 'steel_find_tools'
export const FIND_TOOLS_LABEL = 'Procurando ferramentas'

/** Rough tokens of a text: ~4 chars per token (pt-BR prose and JSON). */
export const CHARS_PER_TOKEN = 4

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

/** Budget of the tool specs on one round (core + pinned + module tools). */
export const TOOL_SPECS_TOKEN_BUDGET = 3_000
/** At most this many pinned tools, most recent first. */
export const MAX_PINNED_TOOLS = 12
/** Tools the meta-tool activates per call. */
export const FIND_TOOLS_MAX_RESULTS = 10

/* ------------------------------ spec compaction ----------------------------- */

/**
 * JSON-Schema keywords dropped from what the model sees. Every tool still
 * validates its arguments with Zod (`parse`), so a bound the model breaks
 * comes back as a readable validation error; descriptions, enums, types
 * and `required` stay.
 */
const DROPPED_SCHEMA_KEYS = new Set([
  'additionalProperties',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'minItems',
  'maxItems',
  '$schema',
])

export function compactSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compactSchema)
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (DROPPED_SCHEMA_KEYS.has(key)) continue
    // `properties` maps names to schemas: a property may be called e.g.
    // "minimum", so only its value is compacted, never its name.
    out[key] =
      key === 'properties' && child && typeof child === 'object'
        ? Object.fromEntries(
            Object.entries(child).map(([name, schema]) => [
              name,
              compactSchema(schema),
            ]),
          )
        : compactSchema(child)
  }
  return out
}

/** Provider-neutral spec with the compacted JSON Schema. */
export function compactToolSpec(tool: {
  name: string
  description: string
  parameters: Record<string, unknown>
}): AiToolSpec {
  return {
    name: tool.name,
    description: tool.description.replace(/\s+/g, ' ').trim(),
    parameters: compactSchema(tool.parameters) as Record<string, unknown>,
  }
}

function specTokens(tool: AnySteelAiTool | AiToolSpec): number {
  return estimateTokens(JSON.stringify(compactToolSpec(tool)))
}

/* ---------------------------- keyword detection ---------------------------- */

/** Lowercase, no accents, only letters/digits/spaces. */
export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Word prefixes (normalized) that point at a module. Ambiguous words
 * ("cliente", "contato", "tarefa") point at every module that has them.
 */
const MODULE_KEYWORDS: Record<ModuleKind, readonly string[]> = {
  SERVICE_DESK: [
    'chamad',
    'ticket',
    'incident',
    'requisic',
    'mudanc',
    'problema',
    'sla',
    'fila',
    'servicedesk',
    'helpdesk',
    'suporte',
    'catalog',
    'cmdb',
    'ativo',
    'conhecimento',
    'artigo',
    'kb',
    'solicitante',
    'aprovac',
    'cliente',
    'contato',
    'tarefa',
    'nota interna',
    'item de configurac',
  ],
  CRM: [
    'crm',
    'lead',
    'oportunidad',
    'negocio',
    'negociac',
    'funil',
    'pipeline',
    'etapa',
    'proposta',
    'previsao',
    'forecast',
    'receita',
    'venda',
    'empresa',
    'pessoa',
    'concorrent',
    'formulario',
    'dashboard',
    'cliente',
    'contato',
    'tarefa',
    'nota',
    'post',
  ],
  COMMUNICATION: [
    'whatsapp',
    'zap',
    'conversa',
    'mensag',
    'grupo',
    'transmiss',
    'disparo',
    'broadcast',
    'template',
    'modelo de mensag',
    'resposta rapida',
    'mensagem rapida',
    'conexa',
    'contato',
  ],
}

const MODULE_ORDER: ModuleKind[] = ['SERVICE_DESK', 'CRM', 'COMMUNICATION']

/** Verb prefixes that signal a change request (write tools first). */
const WRITE_INTENT = [
  'cria',
  'crie',
  'abra',
  'abri',
  'atualiz',
  'alter',
  'mude',
  'mudar',
  'mova',
  'mover',
  'atribu',
  'exclu',
  'apag',
  'remov',
  'cancel',
  'envi',
  'mand',
  'respond',
  'fech',
  'reabr',
  'conclu',
  'vincul',
  'adicion',
  'registr',
  'marqu',
  'marcar',
  'edit',
  'troqu',
  'trocar',
  'encerr',
  'desativ',
  'descart',
  'pec',
  'pedir',
]

function hasKeyword(normalized: string, keyword: string): boolean {
  return ` ${normalized}`.includes(` ${keyword}`)
}

/** Modules the text mentions, in the platform order. */
export function detectModules(text: string): ModuleKind[] {
  const normalized = normalizeText(text)
  if (!normalized) return []
  return MODULE_ORDER.filter((module) =>
    MODULE_KEYWORDS[module].some((keyword) => hasKeyword(normalized, keyword)),
  )
}

export function hasWriteIntent(text: string): boolean {
  const words = normalizeText(text).split(' ')
  return words.some((word) =>
    WRITE_INTENT.some((verb) => word.startsWith(verb)),
  )
}

const STOPWORDS = new Set([
  'que',
  'para',
  'por',
  'com',
  'uma',
  'uns',
  'das',
  'dos',
  'nas',
  'nos',
  'como',
  'qual',
  'quais',
  'quem',
  'quando',
  'onde',
  'meu',
  'minha',
  'meus',
  'minhas',
  'esse',
  'essa',
  'este',
  'esta',
  'isso',
  'isto',
  'mais',
  'menos',
  'todos',
  'todas',
  'hoje',
  'ontem',
  'pode',
  'poderia',
  'favor',
  'voce',
  'sobre',
  'tem',
  'tenho',
  'estao',
  'esta',
  'sao',
])

/** Comparable stems of the meaningful words of a text (5-char prefixes). */
export function keywordStems(text: string): string[] {
  const stems = new Set<string>()
  for (const word of normalizeText(text).split(' ')) {
    if (word.length < 3 || STOPWORDS.has(word)) continue
    stems.add(word.slice(0, 5))
  }
  return [...stems]
}

/**
 * Relevance of a tool for a text: stems found in its name/label weigh 3,
 * in its description 1.
 */
export function scoreTool(tool: AnySteelAiTool, stems: string[]): number {
  if (stems.length === 0) return 0
  const head = keywordStems(`${tool.name.replace(/_/g, ' ')} ${tool.label}`)
  const body = keywordStems(tool.description)
  let score = 0
  for (const stem of stems) {
    if (head.some((s) => s.startsWith(stem) || stem.startsWith(s))) score += 3
    else if (body.includes(stem)) score += 1
  }
  return score
}

/* -------------------------------- selection -------------------------------- */

export interface ToolSelectionInput {
  /** Tools the caller may use (already filtered by mode, module and RBAC). */
  available: readonly AnySteelAiTool[]
  /** Latest user message (or the agent's instructions). */
  message: string
  /** Earlier user messages of the conversation, most recent first. */
  previousMessages?: readonly string[]
  /** Tool names called or activated recently, most recent first. */
  pinned?: readonly string[]
  budgetTokens?: number
}

export interface ToolSelection {
  tools: AnySteelAiTool[]
  /** Modules whose tools were ranked in. */
  modules: ModuleKind[]
  /** Whether `steel_find_tools` must be offered (some tool left out). */
  offerFinder: boolean
}

function rankForModules(
  available: readonly AnySteelAiTool[],
  modules: ModuleKind[],
  text: string,
): AnySteelAiTool[] {
  const stems = keywordStems(text)
  const writeFirst = hasWriteIntent(text)
  const ranked = available
    .filter((tool) => tool.module && modules.includes(tool.module))
    .map((tool, index) => {
      const isRead = tool.kind === 'READ'
      const kindBonus = writeFirst ? (isRead ? 1 : 2) : isRead ? 2 : 0
      return { tool, index, score: scoreTool(tool, stems) * 2 + kindBonus }
    })
  ranked.sort((a, b) => b.score - a.score || a.index - b.index)
  return ranked.map((entry) => entry.tool)
}

/**
 * Picks the tools for one round. See the module doc for the order; the
 * budget counts the compacted specs (`estimateTokens`).
 */
export function selectSteelAiTools(input: ToolSelectionInput): ToolSelection {
  const budget = input.budgetTokens ?? TOOL_SPECS_TOKEN_BUDGET
  const byName = new Map(input.available.map((tool) => [tool.name, tool]))
  const chosen = new Map<string, AnySteelAiTool>()
  let used = specTokens(findToolsSpec())

  const take = (tool: AnySteelAiTool) => {
    if (chosen.has(tool.name)) return
    chosen.set(tool.name, tool)
    used += specTokens(tool)
  }

  for (const tool of input.available)
    if (!tool.module && !tool.onDemand) take(tool)

  const pinned: AnySteelAiTool[] = []
  for (const name of input.pinned ?? []) {
    const tool = byName.get(name)
    if (tool && !pinned.includes(tool)) pinned.push(tool)
    if (pinned.length >= MAX_PINNED_TOOLS) break
  }
  for (const tool of pinned) take(tool)

  let modules = detectModules(input.message)
  if (modules.length === 0) {
    const fromPinned = MODULE_ORDER.filter((m) =>
      pinned.some((tool) => tool.module === m),
    )
    const previous = input.previousMessages?.[0]
    modules = fromPinned.length > 0 ? fromPinned : detectModules(previous ?? '')
  }
  modules = modules.filter((m) =>
    input.available.some((tool) => tool.module === m),
  )

  for (const tool of rankForModules(input.available, modules, input.message)) {
    if (chosen.has(tool.name)) continue
    const cost = specTokens(tool)
    if (used + cost > budget) continue
    take(tool)
  }

  // On-demand platform tools (e.g. the Wiki) enter only when the request
  // mentions them, after the module tools had their share of the budget.
  const stems = keywordStems(input.message)
  for (const tool of input.available) {
    if (tool.module || !tool.onDemand || chosen.has(tool.name)) continue
    if (scoreTool(tool, stems) === 0) continue
    if (used + specTokens(tool) > budget) continue
    take(tool)
  }

  const tools = input.available.filter((tool) => chosen.has(tool.name))
  return {
    tools,
    modules,
    offerFinder: tools.length < input.available.length,
  }
}

/* -------------------------------- meta-tool -------------------------------- */

const MODULE_NAMES: Record<ModuleKind, string> = {
  SERVICE_DESK: 'ServiceDesk',
  CRM: 'CRM',
  COMMUNICATION: 'Comunicação (WhatsApp)',
}

/** Spec of `steel_find_tools` (not a registry tool: it reads the catalog). */
export function findToolsSpec(): AiToolSpec {
  return {
    name: FIND_TOOLS_TOOL_NAME,
    description:
      'Procura ferramentas que ainda não foram oferecidas nesta conversa, por módulo e/ou assunto. Use antes de dizer que não consegue fazer algo; as ferramentas encontradas ficam disponíveis na próxima etapa.',
    parameters: {
      type: 'object',
      properties: {
        module: { type: 'string', enum: [...MODULE_ORDER] },
        query: {
          type: 'string',
          description: 'Assunto ou ação, ex.: "fechar lead", "SLA".',
        },
      },
    },
  }
}

export interface FindToolsResult {
  /** Activated tool names (full specs go out on the next round). */
  names: string[]
  data: {
    tools: { name: string; kind: string; module: string; summary: string }[]
  }
  summary: string
}

function firstSentence(description: string): string {
  const flat = description.replace(/\s+/g, ' ').trim()
  const end = flat.search(/[.!?](\s|$)/)
  const sentence = end > 0 ? flat.slice(0, end + 1) : flat
  return sentence.length > 160 ? `${sentence.slice(0, 157)}…` : sentence
}

/**
 * Runs `steel_find_tools` over the allowed tools: filter by `module`, rank
 * by `query`, return up to {@link FIND_TOOLS_MAX_RESULTS}. Never offers a
 * tool outside `available`.
 */
export function findTools(
  available: readonly AnySteelAiTool[],
  rawArgs: Record<string, unknown>,
): FindToolsResult {
  const module = MODULE_ORDER.find((m) => m === rawArgs.module)
  const query = typeof rawArgs.query === 'string' ? rawArgs.query : ''
  const queryModules = module ? [module] : detectModules(query)
  const pool = available.filter(
    (tool) =>
      (tool.onDemand && queryModules.length === 0) ||
      (tool.module &&
        (queryModules.length === 0 || queryModules.includes(tool.module))),
  )
  const stems = keywordStems(query)
  const ranked = pool
    .map((tool, index) => ({ tool, index, score: scoreTool(tool, stems) }))
    .filter((entry) => stems.length === 0 || entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, FIND_TOOLS_MAX_RESULTS)
    .map((entry) => entry.tool)

  return {
    names: ranked.map((tool) => tool.name),
    data: {
      tools: ranked.map((tool) => ({
        name: tool.name,
        kind: tool.kind,
        module: tool.module ? MODULE_NAMES[tool.module] : 'Plataforma',
        summary: firstSentence(tool.description),
      })),
    },
    summary:
      ranked.length > 0
        ? `${ranked.length} ferramenta(s) encontrada(s)`
        : 'Nenhuma ferramenta encontrada',
  }
}

/* --------------------------------- history --------------------------------- */

function namesFromFinderContent(content: string): string[] {
  try {
    const parsed = JSON.parse(content) as {
      data?: { tools?: { name?: unknown }[] }
    }
    return (parsed.data?.tools ?? [])
      .map((tool) => tool.name)
      .filter((name): name is string => typeof name === 'string')
  } catch {
    // Truncated or foreign content: nothing to pin.
    return []
  }
}

/**
 * Tool names to keep offering, most recent first: tools the assistant
 * called and tools the meta-tool activated in the given (already capped)
 * history rows.
 */
export function pinnedToolsFromHistory(
  rows: readonly AiMessageRow[],
): string[] {
  const names: string[] = []
  const push = (name: string) => {
    if (name !== FIND_TOOLS_TOOL_NAME && !names.includes(name)) names.push(name)
  }
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i]
    if (row.role === 'TOOL' && row.toolName === FIND_TOOLS_TOOL_NAME) {
      for (const name of namesFromFinderContent(row.content)) push(name)
    } else if (row.role === 'ASSISTANT' && Array.isArray(row.toolCalls)) {
      for (const call of row.toolCalls as { name?: unknown }[]) {
        if (call && typeof call.name === 'string') push(call.name)
      }
    }
  }
  return names
}

/** Specs for a round: the selection plus the meta-tool when it is useful. */
export function selectionSpecs(selection: ToolSelection): AiToolSpec[] {
  const specs = selection.tools.map(compactToolSpec)
  if (selection.offerFinder) specs.push(findToolsSpec())
  return specs
}
