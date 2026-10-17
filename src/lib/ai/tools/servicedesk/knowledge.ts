import { z } from 'zod'
import { validationError } from '@/src/errors/app-error'
import { err, ok, type Result } from '@/src/lib/result'
import { extractSdKbPlainText } from '@/src/lib/servicedesk/sd-kb-text'
import {
  SdKbStatusEnum,
  SdKbVisibilityEnum,
} from '@/src/schemas/sd-kb-article.schema'
import { SdKbArticleService } from '@/src/services/sd-kb-article.service'
import { SdKbDraftService } from '@/src/services/sd-kb-draft.service'
import type { SdKbArticleDTO } from '@/types/sd-kb-article'
import type { AiToolContext, SteelAiTool } from '../types'
import { lookupKbArticle } from './lookups'
import {
  clip,
  limitParameter,
  limitSchema,
  refSchema,
  resolveNamed,
  SD_MODULE,
  sdBasePath,
  sdHref,
  ticketRefParameter,
  zodParser,
} from './shared'
import { loadTicket } from './ticket-fields'

const STATUS_LABELS: Record<SdKbArticleDTO['status'], string> = {
  DRAFT: 'Rascunho',
  IN_REVIEW: 'Em revisão',
  PUBLISHED: 'Publicado',
}

async function resolveKbCategory(
  ctx: AiToolContext,
  input: string,
): Promise<Result<{ id: string; name: string }>> {
  const categories = await SdKbArticleService.listCategories(
    ctx.actorId,
    ctx.workspaceId,
  )
  if (!categories.ok) return categories
  return resolveNamed(categories.value, input, 'a categoria')
}

/* --------------------------------- search -------------------------------- */

const SearchArgs = z.object({
  query: z.string().trim().max(200).default(''),
  status: SdKbStatusEnum.optional(),
  visibility: SdKbVisibilityEnum.optional(),
  category: refSchema.optional(),
  tag: z.string().trim().toLowerCase().min(1).max(40).optional(),
  limit: limitSchema,
})

export const sdSearchKbTool: SteelAiTool<z.infer<typeof SearchArgs>> = {
  name: 'sd_search_kb',
  label: 'Buscando na base de conhecimento',
  module: SD_MODULE,
  kind: 'READ',
  description:
    'Busca artigos da base de conhecimento do ServiceDesk por relevância (texto), com filtros de status (DRAFT, IN_REVIEW, PUBLISHED — só agentes), visibilidade (INTERNAL, PORTAL), categoria e tag. Retorna trecho e `href`; use `sd_get_kb_article` para o texto completo.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Termos de busca.' },
      status: { type: 'string', enum: ['DRAFT', 'IN_REVIEW', 'PUBLISHED'] },
      visibility: { type: 'string', enum: ['INTERNAL', 'PORTAL'] },
      category: { type: 'string', description: 'Nome ou id da categoria.' },
      tag: { type: 'string' },
      limit: limitParameter,
    },
    additionalProperties: false,
  },
  permission: { resource: 'sd-knowledge', action: 'VIEW' },
  parse: zodParser(SearchArgs),
  async execute(ctx, args) {
    let categoryId: string | undefined
    if (args.category) {
      const category = await resolveKbCategory(ctx, args.category)
      if (!category.ok) return category
      categoryId = category.value.id
    }
    const [found, base] = await Promise.all([
      SdKbArticleService.search(ctx.actorId, ctx.workspaceId, {
        q: args.query,
        status: args.status,
        visibility: args.visibility,
        categoryId,
        tag: args.tag,
        limit: args.limit,
      }),
      sdBasePath(ctx),
    ])
    if (!found.ok) return found
    if (!base.ok) return base
    return ok({
      data: {
        items: found.value.map((a) => ({
          id: a.id,
          title: a.title,
          status: a.status,
          visibility: a.visibility,
          tags: a.tags,
          excerpt: clip(a.excerpt, 300),
          reuseCount: a.reuseCount,
          helpfulCount: a.helpfulCount,
          updatedAt: a.updatedAt,
          href: sdHref.article(base.value, a.id),
        })),
      },
      summary: `${found.value.length} artigo(s) encontrado(s)`,
    })
  },
}

/* ---------------------------------- get ---------------------------------- */

const ARTICLE_TEXT_MAX = 6000

const GetArgs = z.object({ article: refSchema })

export const sdGetKbArticleTool: SteelAiTool<z.infer<typeof GetArgs>> = {
  name: 'sd_get_kb_article',
  label: 'Lendo artigo da base',
  module: SD_MODULE,
  kind: 'READ',
  description:
    'Texto completo (até ~6 mil caracteres) e metadados de um artigo da base de conhecimento, por id ou título.',
  parameters: {
    type: 'object',
    properties: {
      article: { type: 'string', description: 'Id ou título do artigo.' },
    },
    required: ['article'],
    additionalProperties: false,
  },
  permission: { resource: 'sd-knowledge', action: 'VIEW' },
  parse: zodParser(GetArgs),
  async execute(ctx, args) {
    const ref = await lookupKbArticle(ctx, args.article)
    if (!ref.ok) return ref
    const [article, base] = await Promise.all([
      SdKbArticleService.getById(ctx.actorId, ctx.workspaceId, ref.value.id),
      sdBasePath(ctx),
    ])
    if (!article.ok) return article
    if (!base.ok) return base
    const a = article.value
    const href = sdHref.article(base.value, a.id)
    return ok({
      data: {
        id: a.id,
        title: a.title,
        status: a.status,
        visibility: a.visibility,
        category: a.category?.name ?? null,
        tags: a.tags,
        text: clip(extractSdKbPlainText(a.content), ARTICLE_TEXT_MAX),
        reuseCount: a.reuseCount,
        helpfulCount: a.helpfulCount,
        notHelpfulCount: a.notHelpfulCount,
        reviewDueAt: a.reviewDueAt,
        publishedAt: a.publishedAt,
        updatedAt: a.updatedAt,
        href,
      },
      summary: `Artigo “${a.title}” (${STATUS_LABELS[a.status]})`,
      target: { type: 'sd_kb_article', id: a.id, label: a.title, href },
    })
  },
}

/* --------------------------- draft from a ticket ------------------------- */

const DraftArgs = z.object({
  ticket: refSchema,
  useAi: z.boolean().default(true),
  category: refSchema.optional(),
})
type DraftArgs = z.infer<typeof DraftArgs>

async function planDraft(ctx: AiToolContext, args: DraftArgs) {
  const loaded = await loadTicket(ctx, args.ticket)
  if (!loaded.ok) return loaded
  let category: { id: string; name: string } | null = null
  if (args.category) {
    const found = await resolveKbCategory(ctx, args.category)
    if (!found.ok) return found
    category = found.value
  }
  return ok({ loaded: loaded.value, category })
}

export const sdCreateKbDraftFromTicketTool: SteelAiTool<DraftArgs> = {
  name: 'sd_create_kb_draft_from_ticket',
  label: 'Criando rascunho de artigo',
  module: SD_MODULE,
  kind: 'CREATE',
  annotations: { destructiveHint: false },
  description:
    'Fluxo KCS: cria um RASCUNHO de artigo da base a partir de um chamado (problema, causa, solução) e já o vincula ao chamado. `useAi` (padrão true) escreve o rascunho com a IA do ServiceDesk, sem dados pessoais; false entrega o esqueleto KCS vazio. Nada é publicado.',
  parameters: {
    type: 'object',
    properties: {
      ticket: ticketRefParameter,
      useAi: { type: 'boolean' },
      category: {
        type: 'string',
        description: 'Categoria (senão a do catálogo do chamado).',
      },
    },
    required: ['ticket'],
    additionalProperties: false,
  },
  permission: { resource: 'sd-knowledge', action: 'CREATE' },
  parse: zodParser(DraftArgs),
  async preview(ctx, args) {
    const plan = await planDraft(ctx, args)
    if (!plan.ok) return plan
    const { loaded, category } = plan.value
    return ok({
      title: `Rascunho de artigo a partir de ${loaded.ticket.code}`,
      summary: args.useAi
        ? 'A IA escreve o rascunho a partir do chamado (dados pessoais mascarados; consome a cota de IA do workspace). O artigo fica como rascunho, vinculado ao chamado.'
        : 'Cria o esqueleto KCS vazio como rascunho, vinculado ao chamado.',
      fields: [
        {
          label: 'Chamado',
          after: `${loaded.ticket.code} — ${loaded.ticket.title}`,
        },
        { label: 'Situação', after: STATUS_LABELS.DRAFT },
        {
          label: 'Categoria',
          after: category?.name ?? 'A do catálogo do chamado',
        },
        {
          label: 'Conteúdo',
          after: args.useAi ? 'Gerado pela IA' : 'Esqueleto KCS',
        },
      ],
      target: {
        type: 'sd_ticket',
        id: loaded.ticket.id,
        label: loaded.ticket.code,
        href: loaded.href,
      },
    })
  },
  async execute(ctx, args) {
    const plan = await planDraft(ctx, args)
    if (!plan.ok) return plan
    const draft = await SdKbDraftService.fromTicket(
      ctx.actorId,
      ctx.workspaceId,
      {
        ticketId: plan.value.loaded.ticket.id,
        useAi: args.useAi,
        categoryId: plan.value.category?.id,
      },
    )
    if (!draft.ok) return draft
    const base = await sdBasePath(ctx)
    if (!base.ok) return base
    const a = draft.value.article
    const href = sdHref.article(base.value, a.id)
    return ok({
      data: {
        articleId: a.id,
        title: a.title,
        aiUsed: draft.value.aiUsed,
        aiSkippedReason: draft.value.aiSkippedReason,
        href,
      },
      summary: draft.value.aiUsed
        ? `Rascunho “${a.title}” criado pela IA`
        : `Rascunho “${a.title}” criado (esqueleto KCS)`,
      target: { type: 'sd_kb_article', id: a.id, label: a.title, href },
    })
  },
}

/* ------------------------------- drop draft ------------------------------ */

const DeleteDraftArgs = z.object({ article: refSchema })
type DeleteDraftArgs = z.infer<typeof DeleteDraftArgs>

async function planDeleteDraft(
  ctx: AiToolContext,
  args: DeleteDraftArgs,
): Promise<Result<{ article: SdKbArticleDTO; href: string }>> {
  const ref = await lookupKbArticle(ctx, args.article)
  if (!ref.ok) return ref
  const [article, base] = await Promise.all([
    SdKbArticleService.getById(ctx.actorId, ctx.workspaceId, ref.value.id),
    sdBasePath(ctx),
  ])
  if (!article.ok) return article
  if (!base.ok) return base
  if (article.value.status !== 'DRAFT' || article.value.archivedAt) {
    return err(
      validationError(
        'Só rascunhos ativos podem ser descartados por ferramenta; artigos publicados ou em revisão ficam com a equipe.',
      ),
    )
  }
  return ok({
    article: article.value,
    href: sdHref.article(base.value, article.value.id),
  })
}

export const sdDeleteKbDraftTool: SteelAiTool<DeleteDraftArgs> = {
  name: 'sd_delete_kb_draft',
  label: 'Descartando rascunho',
  module: SD_MODULE,
  kind: 'DELETE',
  annotations: { idempotentHint: true, destructiveHint: true },
  description:
    'Descarta um artigo em RASCUNHO da base (vai para a lixeira da base, com os subartigos; um admin pode restaurar). Recusa artigos publicados ou em revisão.',
  parameters: {
    type: 'object',
    properties: {
      article: { type: 'string', description: 'Id ou título do rascunho.' },
    },
    required: ['article'],
    additionalProperties: false,
  },
  permission: { resource: 'sd-knowledge', action: 'EDIT' },
  parse: zodParser(DeleteDraftArgs),
  async preview(ctx, args) {
    const plan = await planDeleteDraft(ctx, args)
    if (!plan.ok) return plan
    const { article, href } = plan.value
    return ok({
      title: `Descartar o rascunho “${article.title}”`,
      summary:
        'O rascunho (e seus subartigos) vai para a lixeira da base de conhecimento.',
      fields: [
        { label: 'Artigo', before: article.title, after: null },
        { label: 'Situação', before: STATUS_LABELS.DRAFT, after: 'Na lixeira' },
      ],
      target: {
        type: 'sd_kb_article',
        id: article.id,
        label: article.title,
        href,
      },
    })
  },
  async execute(ctx, args) {
    const plan = await planDeleteDraft(ctx, args)
    if (!plan.ok) return plan
    const archived = await SdKbArticleService.archive(
      ctx.actorId,
      ctx.workspaceId,
      plan.value.article.id,
    )
    if (!archived.ok) return archived
    return ok({
      data: {
        articleId: archived.value.id,
        archivedAt: archived.value.archivedAt,
      },
      summary: `Rascunho “${archived.value.title}” enviado para a lixeira`,
      target: {
        type: 'sd_kb_article',
        id: archived.value.id,
        label: archived.value.title,
      },
    })
  },
}

export const SD_KNOWLEDGE_TOOLS = [
  sdSearchKbTool,
  sdGetKbArticleTool,
  sdCreateKbDraftFromTicketTool,
  sdDeleteKbDraftTool,
]
