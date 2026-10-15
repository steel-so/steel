import type { Site, SitePage } from '@prisma/client'
import z from 'zod'
import { logger } from '@/lib/axiom/logger'
import { appError } from '@/src/errors/app-error'
import type { AiChatResponse } from '@/src/lib/ai/types'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import { err, ok, type Result } from '@/src/lib/result'
import { questionAnswers } from '@/src/lib/sites/search/aeo-checks'
import { formatAddress } from '@/src/lib/sites/search/business'
import { extractPageContent } from '@/src/lib/sites/search/content'
import {
  buildCheckContext,
  renderedTitle,
  resolveBusinessProfile,
} from '@/src/lib/sites/search/context'
import { SitePageRepository } from '@/src/repositories/site-page.repository'
import { parseSdAiJson } from '@/src/schemas/sd-ai.schema'
import { parseSiteSettings } from '@/src/schemas/site.schema'
import { parseSitePageSeo } from '@/src/schemas/site-page.schema'
import type {
  SearchAiField,
  SearchAiOptimizeDTO,
  SearchAiSummaryDTO,
} from '@/src/schemas/site-search.schema'
import type {
  SiteSearchAiOptimizeDTO,
  SiteSearchAiSuggestionDTO,
  SiteSearchAiSummaryDTO,
} from '@/types/site-search'
import { AiUsageService } from './ai-usage.service'
import { assertFeature } from './feature-flag.service'
import { authorizeSite } from './site-access'

/**
 * AI of the "Buscadores": "Como a IA resumiria esta página" (a generative
 * engine's view of the page, with suggestions) and "Otimizar com IA"
 * (titles, descriptions and direct answers for review before applying).
 * Same gate and quota as the other CRM AI features (`crm.aiAssistant`,
 * `AiUsageService`, ADR 0007); nothing is written here — `apply` in
 * `SiteSearchService` saves what the user approved.
 */

/** Page text sent to the model (characters). */
export const AI_CONTENT_MAX_CHARS = 12_000
const SUMMARY_MAX_TOKENS = 1500
const OPTIMIZE_MAX_TOKENS = 2500

const aiFailed = (message?: string) =>
  appError(
    'SITE_SEARCH_AI_FAILED',
    message ??
      'A IA não conseguiu responder agora — tente de novo em instantes',
  )

const SUMMARY_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'entities', 'questions', 'suggestions'],
  properties: {
    summary: { type: 'string' },
    entities: { type: 'array', items: { type: 'string' } },
    questions: { type: 'array', items: { type: 'string' } },
    suggestions: { type: 'array', items: { type: 'string' } },
  },
}

const SummaryOutputSchema = z.object({
  summary: z.string().trim().min(1),
  entities: z.array(z.string().trim().min(1)).default([]),
  questions: z.array(z.string().trim().min(1)).default([]),
  suggestions: z.array(z.string().trim().min(1)).default([]),
})

const OPTIMIZE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'description', 'answers'],
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
    answers: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['question', 'answer'],
        properties: {
          question: { type: 'string' },
          answer: { type: 'string' },
        },
      },
    },
  },
}

const OptimizeOutputSchema = z.object({
  title: z.string().trim().default(''),
  description: z.string().trim().default(''),
  answers: z
    .array(z.object({ question: z.string().trim(), answer: z.string().trim() }))
    .default([]),
})

/** What the prompts know about a page. */
export interface AiPageBrief {
  siteName: string
  business: string
  title: string
  description: string
  keyword: string | null
  text: string
  questions: Array<{ question: string; answer: string }>
}

/** Pure: the page as the model reads it. */
export function pageBrief(site: Site, page: SitePage): AiPageBrief {
  const settings = parseSiteSettings(site.settings)
  const seo = parseSitePageSeo(page.seo)
  const document = page.document as unknown as CanvasDocument
  const ctx = buildCheckContext({
    page: {
      id: page.id,
      title: page.title,
      slug: page.slug,
      isHome: page.isHome,
      seo,
    },
    document,
    site: { name: site.name, settings, pageUrl: '' },
    siblings: [],
    now: new Date(),
  })
  const profile = resolveBusinessProfile(settings, site.name)
  const business = [
    profile.name,
    profile.category,
    profile.description,
    formatAddress(profile),
  ]
    .filter(Boolean)
    .join(' — ')
  const markdown = extractPageContent(document)
    .flow.map((item) =>
      item.type === 'heading'
        ? `${'#'.repeat(Math.max(1, Math.min(6, item.level || 3)))} ${item.text}`
        : item.text,
    )
    .join('\n\n')
  const questions = [
    ...(ctx.search.questions ?? []).map((item) => ({
      question: item.question,
      answer: item.answer,
    })),
    ...questionAnswers(ctx).map((item) => ({
      question: item.question,
      answer: item.answer ?? '',
    })),
  ]
  return {
    siteName: site.name,
    business,
    title: renderedTitle(settings, { title: page.title, seo }),
    description: ctx.description,
    keyword: ctx.keyword,
    text: markdown.slice(0, AI_CONTENT_MAX_CHARS),
    questions: questions.slice(0, 12),
  }
}

/** Pure: the brief as the user message. */
export function briefMessage(brief: AiPageBrief): string {
  return [
    `Site: ${brief.siteName}`,
    brief.business ? `Empresa: ${brief.business}` : '',
    `Título atual: ${brief.title}`,
    `Descrição atual: ${brief.description || '(vazia)'}`,
    brief.keyword ? `Palavra-chave principal: ${brief.keyword}` : '',
    brief.questions.length
      ? `Perguntas da página:\n${brief.questions
          .map(
            (item) =>
              `- ${item.question}${item.answer ? ` → ${item.answer}` : ''}`,
          )
          .join('\n')}`
      : '',
    `Conteúdo da página:\n"""\n${brief.text || '(sem texto)'}\n"""`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

export const SUMMARY_SYSTEM = [
  'Você simula um mecanismo de resposta generativo (como ChatGPT Search, Perplexity ou Google AI Overviews) lendo uma página de uma empresa brasileira.',
  'Responda em português do Brasil, em JSON com: "summary" (2 a 4 frases, como você resumiria a página para alguém que perguntou sobre o assunto; use só o que a página diz, sem inventar), "entities" (empresa, lugares, serviços e pessoas que você identificou, no máximo 8), "questions" (até 6 perguntas que a página responde bem) e "suggestions" (3 a 6 sugestões objetivas e específicas para a página ser citada com mais confiança: dados concretos que faltam, perguntas sem resposta direta, ambiguidades sobre a empresa, fontes).',
  'Se a página for vaga, diga isso no resumo — não complete com suposições.',
].join('\n')

/** Pure: system prompt of "Otimizar com IA". */
export function optimizeSystem(fields: SearchAiField[]): string {
  const lines = [
    'Você é especialista em SEO, AEO e GEO para empresas brasileiras. Escreva em português do Brasil, sem inventar fatos que a página não traga (preços, prazos, números).',
    'Devolva JSON com "title", "description" e "answers"; deixe vazio ("" ou lista vazia) o que não foi pedido.',
  ]
  if (fields.includes('title')) {
    lines.push(
      '"title": título para o Google com 45 a 60 caracteres, a palavra-chave principal no começo, específico e sem o nome do site.',
    )
  }
  if (fields.includes('description')) {
    lines.push(
      '"description": meta descrição de 130 a 155 caracteres com a palavra-chave, o benefício e um convite à ação.',
    )
  }
  if (fields.includes('answers')) {
    lines.push(
      '"answers": para cada pergunta da página, uma resposta direta de 40 a 60 palavras que comece respondendo (sim/não, o valor, o prazo) e depois explique. Repita a pergunta exatamente como veio.',
    )
  }
  return lines.join('\n')
}

type PreparedCall = Extract<
  Awaited<ReturnType<typeof AiUsageService.prepare>>,
  { ok: true }
>['value']

async function prepare(
  actorId: string,
  workspaceId: string,
  siteId: string,
): Promise<Result<{ site: Site; call: PreparedCall }>> {
  const site = await authorizeSite(actorId, workspaceId, siteId, 'EDIT')
  if (!site.ok) return site
  const feature = await assertFeature(workspaceId, 'crm.aiAssistant')
  if (!feature.ok) return feature
  const call = await AiUsageService.prepare(
    workspaceId,
    'CRM_ASSISTANT',
    actorId,
  )
  if (!call.ok) return call
  return ok({ site: site.value, call: call.value })
}

async function callProvider(
  call: PreparedCall,
  input: {
    actorId: string
    workspaceId: string
    system: string
    message: string
    schemaName: string
    schema: Record<string, unknown>
    maxTokens: number
    action: string
  },
): Promise<AiChatResponse | null> {
  try {
    const response = await call.provider.chat({
      model: call.model.model,
      system: input.system,
      messages: [{ role: 'user', content: input.message }],
      jsonSchema: { name: input.schemaName, schema: input.schema },
      maxTokens: input.maxTokens,
    })
    await AiUsageService.record(call, {
      workspaceId: input.workspaceId,
      userId: input.actorId,
      usage: response.usage,
      scope: { module: 'CRM' },
    })
    return response
  } catch (error) {
    logger.error('site_search_ai.provider_failed', {
      component: 'SiteSearchAiService',
      workspaceId: input.workspaceId,
      action: input.action,
      provider: call.model.provider,
      model: call.model.model,
      message: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/** Trims a suggestion to the field's limit on a word boundary. */
function fitText(value: string, max: number): string {
  const clean = value.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max)
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), 1)).trim()
}

export const SiteSearchAiService = {
  async summary(
    actorId: string,
    workspaceId: string,
    siteId: string,
    dto: SearchAiSummaryDTO,
  ): Promise<Result<SiteSearchAiSummaryDTO>> {
    const prepared = await prepare(actorId, workspaceId, siteId)
    if (!prepared.ok) return prepared
    const page = await SitePageRepository.findById(dto.pageId, siteId)
    if (!page.ok) return page

    const response = await callProvider(prepared.value.call, {
      actorId,
      workspaceId,
      system: SUMMARY_SYSTEM,
      message: briefMessage(pageBrief(prepared.value.site, page.value)),
      schemaName: 'site_page_ai_summary',
      schema: SUMMARY_JSON_SCHEMA,
      maxTokens: SUMMARY_MAX_TOKENS,
      action: 'summary',
    })
    if (!response) return err(aiFailed())
    const parsed = parseSdAiJson(SummaryOutputSchema, response.text)
    if (!parsed)
      return err(
        aiFailed('A IA não devolveu um resumo aproveitável — tente de novo'),
      )

    logger.info('site_search_ai.summary', {
      component: 'SiteSearchAiService',
      workspaceId,
      siteId,
      pageId: dto.pageId,
      model: prepared.value.call.model.key,
    })
    return ok({
      summary: parsed.summary,
      entities: parsed.entities.slice(0, 8),
      questions: parsed.questions.slice(0, 6),
      suggestions: parsed.suggestions.slice(0, 6),
    })
  },

  /** Suggestions per page for review; one provider call per page. */
  async optimize(
    actorId: string,
    workspaceId: string,
    siteId: string,
    dto: SearchAiOptimizeDTO,
  ): Promise<Result<SiteSearchAiOptimizeDTO>> {
    const prepared = await prepare(actorId, workspaceId, siteId)
    if (!prepared.ok) return prepared
    const pages = await SitePageRepository.listWithDocuments(siteId)
    if (!pages.ok) return pages
    const selected = dto.pageIds
      .map((id) => pages.value.find((page) => page.id === id))
      .filter((page): page is SitePage => page !== undefined)
    if (selected.length !== dto.pageIds.length) {
      return err(appError('SITE_PAGE_NOT_FOUND', 'Página não encontrada'))
    }

    const items: SiteSearchAiSuggestionDTO[] = []
    const failed: SiteSearchAiOptimizeDTO['failed'] = []
    for (const page of selected) {
      const brief = pageBrief(prepared.value.site, page)
      const response = await callProvider(prepared.value.call, {
        actorId,
        workspaceId,
        system: optimizeSystem(dto.fields),
        message: briefMessage(brief),
        schemaName: 'site_page_ai_optimize',
        schema: OPTIMIZE_JSON_SCHEMA,
        maxTokens: OPTIMIZE_MAX_TOKENS,
        action: 'optimize',
      })
      const parsed = response
        ? parseSdAiJson(OptimizeOutputSchema, response.text)
        : null
      if (!parsed) {
        failed.push({ pageId: page.id, pageTitle: page.title })
        continue
      }
      const seo = parseSitePageSeo(page.seo)
      const item: SiteSearchAiSuggestionDTO = {
        pageId: page.id,
        pageTitle: page.title,
      }
      if (dto.fields.includes('title') && parsed.title) {
        item.title = {
          current: seo.title || page.title,
          suggested: fitText(parsed.title, 120),
        }
      }
      if (dto.fields.includes('description') && parsed.description) {
        item.description = {
          current: seo.description ?? '',
          suggested: fitText(parsed.description, 320),
        }
      }
      if (dto.fields.includes('answers')) {
        const known = new Map(
          brief.questions.map((entry) => [
            entry.question.trim().toLowerCase(),
            entry,
          ]),
        )
        const answers = parsed.answers
          .map((answer) => ({
            answer,
            source: known.get(answer.question.trim().toLowerCase()),
          }))
          .filter((entry) => entry.source && entry.answer.answer)
          .map((entry) => ({
            question: entry.source?.question as string,
            current: entry.source?.answer ?? '',
            suggested: fitText(entry.answer.answer, 2000),
          }))
        if (answers.length) item.answers = answers
      }
      items.push(item)
    }

    logger.info('site_search_ai.optimize', {
      component: 'SiteSearchAiService',
      workspaceId,
      siteId,
      pages: selected.length,
      failed: failed.length,
      model: prepared.value.call.model.key,
    })
    if (items.length === 0) return err(aiFailed())
    return ok({ items, failed })
  },
}
