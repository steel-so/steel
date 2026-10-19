import type { z } from 'zod'
import { validationError } from '@/src/errors/app-error'
import { STEEL_SEARCH_TOOL_NAME } from '@/src/lib/ai/knowledge/citations'
import { KNOWLEDGE_SOURCE_TYPES } from '@/src/lib/ai/knowledge/sources'
import { ok, type Result } from '@/src/lib/result'
import {
  AI_KNOWLEDGE_DEFAULT_LIMIT,
  AI_KNOWLEDGE_MAX_LIMIT,
  SteelSearchToolArgsSchema,
} from '@/src/schemas/ai-knowledge.schema'
import { AiKnowledgeSearchService } from '@/src/services/ai-knowledge-search.service'
import type { AnySteelAiTool, SteelAiTool } from './types'

/**
 * `steel_search` (ADR 0037): the knowledge search as a Steel AI tool, so
 * the assistant, Steel Agents and MCP clients answer "how do we…" questions
 * from the workspace's own documentation and cite it. READ, platform-level
 * (`module: null`): the service filters each source by its own module and
 * permission rules, so a user without the CRM simply gets no CRM sources.
 */

type Args = z.infer<typeof SteelSearchToolArgsSchema>

function parse(args: Record<string, unknown>): Result<Args> {
  const parsed = SteelSearchToolArgsSchema.safeParse(args ?? {})
  if (parsed.success) return ok(parsed.data)
  return {
    ok: false,
    error: validationError(
      'Argumentos inválidos para a ferramenta',
      parsed.error.issues,
    ),
  }
}

export const steelSearchTool: SteelAiTool<Args> = {
  name: STEEL_SEARCH_TOOL_NAME,
  label: 'Buscando na base de conhecimento',
  module: null,
  kind: 'READ',
  description:
    'Busca por significado e por palavras na base de conhecimento do workspace: artigos da base de conhecimento do ServiceDesk, páginas da Wiki, chamados resolvidos (título e solução), documentos da IA do WhatsApp e notas e propostas do CRM. Só retorna o que o usuário pode abrir. Use para perguntas sobre procedimentos, políticas, como resolver um problema, o que foi combinado com um cliente ou o que já foi feito antes, escrevendo `query` como a pergunta em linguagem natural. Cada resultado traz `ref`, `source`, `title`, `snippet` e `href`: responda só com base nos trechos e cite as fontes usadas pelo título com o link em Markdown, por exemplo [Título](href). Se nada relevante voltar, diga que não encontrou na base em vez de inventar. Para localizar um registro por nome, código ou telefone, prefira ws_search.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'A pergunta ou o assunto, em linguagem natural (2 a 500 caracteres).',
      },
      sources: {
        type: 'array',
        items: { type: 'string', enum: [...KNOWLEDGE_SOURCE_TYPES] },
        description:
          'Restringe as fontes (opcional): sd-kb-article, wiki-page, sd-ticket (resolvidos), zap-knowledge-doc, crm-note, crm-proposal.',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: AI_KNOWLEDGE_MAX_LIMIT,
        description: `Quantidade máxima de fontes (padrão ${AI_KNOWLEDGE_DEFAULT_LIMIT}, máximo ${AI_KNOWLEDGE_MAX_LIMIT}).`,
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
  parse,
  async execute(ctx, args) {
    const result = await AiKnowledgeSearchService.search(
      ctx.actorId,
      ctx.workspaceId,
      { q: args.query, sources: args.sources, limit: args.limit },
    )
    if (!result.ok) return result
    const results = result.value.results.map((r, index) => ({
      ref: index + 1,
      sourceType: r.sourceType,
      source: r.sourceLabel,
      title: r.title,
      snippet: r.snippet,
      href: r.href,
      updatedAt: r.updatedAt,
    }))
    return ok({
      data: { mode: result.value.mode, results },
      summary:
        results.length === 0
          ? `Nada encontrado para "${args.query}"`
          : `${results.length} fonte(s) para "${args.query}"`,
    })
  },
}

export const KNOWLEDGE_AI_TOOLS: AnySteelAiTool[] = [steelSearchTool]
