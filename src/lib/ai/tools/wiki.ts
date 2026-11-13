import { z } from 'zod'
import { ok } from '@/src/lib/result'
import { plateToPlainText } from '@/src/lib/sites/blog/plate'
import { WikiPageService } from '@/src/services/wiki-page.service'
import { WorkspaceService } from '@/src/services/workspace.service'
import type { WikiPageDTO } from '@/types/wiki-page'
import type { AiToolContext, AnySteelAiTool, SteelAiTool } from './types'
import {
  limitParameter,
  limitSchema,
  matches,
  offsetParameter,
  offsetSchema,
  paginate,
  truncate,
  zodParser,
} from './whatsapp/shared'

/**
 * Steel AI tools for the Wiki (platform-level, `module: null`). Each tool
 * calls `WikiPageService` with the caller's id, so "Ajustes > Wiki" being
 * on, page locks and archived pages are enforced by the service.
 */

/** Plain text returned to the model per page (the tool budget is ~20 KB). */
const WIKI_TEXT_MAX = 8000

async function wikiHref(
  ctx: AiToolContext,
  id: string,
): Promise<string | undefined> {
  const workspace = await WorkspaceService.getById(ctx.actorId, ctx.workspaceId)
  return workspace.ok ? `/${workspace.value.slug}/wiki/${id}` : undefined
}

function compactPage(page: WikiPageDTO) {
  return {
    id: page.id,
    title: page.title || 'Sem título',
    parentId: page.parentId,
    published: page.publishedAt !== null,
    updatedAt: page.updatedAt,
  }
}

/* ---------------------------------- list ---------------------------------- */

const ListArgs = z.object({
  query: z.string().trim().min(1).max(200).optional(),
  limit: limitSchema,
  offset: offsetSchema,
})

export const wikiPagesListTool: SteelAiTool<z.output<typeof ListArgs>> = {
  name: 'wiki_pages_list',
  label: 'Consultando a Wiki',
  module: null,
  onDemand: true,
  kind: 'READ',
  description:
    'Lista as páginas da Wiki do workspace (título, página-mãe, se está publicada e a data da última edição). Filtre por parte do título com `query`. Para ler o conteúdo de uma página use wiki_page_get; para responder perguntas de "como fazemos…" prefira steel_search.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Parte do título.' },
      limit: limitParameter,
      offset: offsetParameter,
    },
    additionalProperties: false,
  },
  parse: zodParser(ListArgs),
  async execute(ctx, args) {
    const pages = await WikiPageService.list(ctx.actorId, ctx.workspaceId)
    if (!pages.ok) return pages
    const filtered = pages.value.filter(
      (page) =>
        page.archivedAt === null &&
        (!args.query || matches(page.title, args.query)),
    )
    const page = paginate(filtered, args.offset, args.limit)
    return ok({
      data: { ...page, items: page.items.map(compactPage) },
      summary: `${page.total} página(s) da Wiki`,
    })
  },
}

/* ----------------------------------- get ---------------------------------- */

const GetArgs = z.object({ pageId: z.string().trim().min(1).max(64) })

export const wikiPageGetTool: SteelAiTool<z.output<typeof GetArgs>> = {
  name: 'wiki_page_get',
  label: 'Lendo página da Wiki',
  module: null,
  onDemand: true,
  kind: 'READ',
  description:
    'Lê uma página da Wiki: título e o conteúdo em texto simples (cortado em cerca de 8 mil caracteres), com o link para abrir no Steel.',
  parameters: {
    type: 'object',
    properties: {
      pageId: {
        type: 'string',
        description: 'Id da página (de wiki_pages_list).',
      },
    },
    required: ['pageId'],
    additionalProperties: false,
  },
  parse: zodParser(GetArgs),
  async execute(ctx, args) {
    const found = await WikiPageService.getById(
      ctx.actorId,
      ctx.workspaceId,
      args.pageId,
    )
    if (!found.ok) return found
    const page = found.value
    const text = plateToPlainText(page.content, WIKI_TEXT_MAX)
    const href = await wikiHref(ctx, page.id)
    return ok({
      data: { ...compactPage(page), text: truncate(text, WIKI_TEXT_MAX), href },
      summary: `Página “${page.title || 'Sem título'}”`,
    })
  },
}

/* --------------------------------- create --------------------------------- */

const CreateArgs = z.object({
  title: z.string().trim().min(1).max(255),
  parentId: z.string().trim().min(1).max(64).optional(),
  text: z.string().trim().max(20_000).optional(),
})
type CreateArgs = z.output<typeof CreateArgs>

/** Paragraph blocks (Plate) from plain text: one block per non-empty line. */
export function textToPlateBlocks(
  text: string,
): Array<Record<string, unknown>> {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ type: 'p', children: [{ text: line }] }))
}

export const wikiPageCreateTool: SteelAiTool<CreateArgs> = {
  name: 'wiki_page_create',
  label: 'Criando página na Wiki',
  module: null,
  onDemand: true,
  kind: 'CREATE',
  annotations: { destructiveHint: false },
  description:
    'Cria uma página na Wiki com `title` e, opcionalmente, um texto inicial (`text`, uma linha por parágrafo) e uma página-mãe (`parentId`). A página nasce interna ao workspace, sem link público; o conteúdo é refinado depois no editor do Steel.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Título da página.' },
      parentId: {
        type: 'string',
        description: 'Página-mãe (id de wiki_pages_list), opcional.',
      },
      text: {
        type: 'string',
        description: 'Texto inicial em parágrafos (uma linha por parágrafo).',
      },
    },
    required: ['title'],
    additionalProperties: false,
  },
  parse: zodParser(CreateArgs),
  async preview(_ctx, args) {
    return ok({
      title: `Criar a página “${args.title}” na Wiki`,
      summary: 'A página será criada só para os membros do workspace.',
      fields: [
        { label: 'Título', after: args.title },
        ...(args.text
          ? [{ label: 'Texto inicial', after: truncate(args.text, 500) ?? '' }]
          : []),
      ],
      target: { type: 'wiki_page', label: args.title },
    })
  },
  async execute(ctx, args) {
    const created = await WikiPageService.create(ctx.actorId, ctx.workspaceId, {
      title: args.title,
      parentId: args.parentId,
    })
    if (!created.ok) return created
    let page = created.value
    const blocks = args.text ? textToPlateBlocks(args.text) : []
    if (blocks.length > 0) {
      const updated = await WikiPageService.update(
        ctx.actorId,
        ctx.workspaceId,
        page.id,
        { content: blocks },
      )
      if (!updated.ok) return updated
      page = updated.value
    }
    const href = await wikiHref(ctx, page.id)
    return ok({
      data: { id: page.id, title: page.title, href },
      summary: `Página “${page.title}” criada na Wiki`,
      target: { type: 'wiki_page', id: page.id, label: page.title, href },
    })
  },
}

export const WIKI_AI_TOOLS: AnySteelAiTool[] = [
  wikiPagesListTool,
  wikiPageGetTool,
  wikiPageCreateTool,
]
