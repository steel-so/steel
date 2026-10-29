import { z } from 'zod'
import { logger } from '@/lib/axiom/logger'
import { crmNewsletterAiFailed, crmNewsletterIssueLocked } from '@/src/errors'
import type { AiChatResponse } from '@/src/lib/ai/types'
import type { CanvasFragment } from '@/src/lib/canvas/types'
import {
  buildAiSection,
  EMAIL_AI_SECTION_JSON_SCHEMA,
  EmailAiSectionOutputSchema,
} from '@/src/lib/canvas-email/ai-blocks'
import { EMAIL_VARIABLES } from '@/src/lib/crm-email-builder/variables'
import {
  documentText,
  postsSection,
} from '@/src/lib/crm-newsletter/digest-document'
import { err, ok, type Result } from '@/src/lib/result'
import { BLOG_BASE } from '@/src/lib/sites/blog/routes'
import { publicSiteUrl } from '@/src/lib/sites/public-url'
import {
  type AiKbRow,
  type AiPostRow,
  type AiProductRow,
  CrmNewsletterAiRepository,
} from '@/src/repositories/crm-newsletter-ai.repository'
import { EDITABLE_ISSUE_STATUSES } from '@/src/repositories/crm-newsletter-issue.repository'
import {
  CRM_NEWSLETTER_AI_SUBJECTS_JSON_SCHEMA,
  CRM_NEWSLETTER_AI_SUGGESTIONS,
  type CrmNewsletterAiDraftDTO,
  type CrmNewsletterAiDraftResultDTO,
  type CrmNewsletterAiSourcesDTO,
  type CrmNewsletterAiSubjectsDTO,
  CrmNewsletterAiSubjectsOutputSchema,
  type CrmNewsletterAiSubjectsResultDTO,
} from '@/src/schemas/crm-newsletter-ai.schema'
import { parseSdAiJson } from '@/src/schemas/sd-ai.schema'
import { AiUsageService } from './ai-usage.service'
import { assertModuleMember } from './authz'
import { loadIssue, loadNewsletterScope } from './crm-newsletter-issue.service'
import { assertFeature } from './feature-flag.service'

/**
 * AI in the newsletter issue editor (newsletter2 nl2-digest-ai). Same gate
 * as the other CRM AI features — plan feature `crm.aiAssistant`, the
 * workspace provider/model and the monthly quota through `AiUsageService`
 * (ADR 0007/0019). What goes to the provider is only what the member
 * chose: the brief, the sources ticked in the dialog (title + a short
 * excerpt each) and, for subjects, the issue's own copy. No subscriber,
 * person or deal data ever does; variables travel as `{{…}}`.
 */

const DRAFT_MAX_TOKENS = 6000
const SUBJECTS_MAX_TOKENS = 1500
/** Characters of each source sent to the provider. */
export const SOURCE_EXCERPT_CHARS = 700
const MAX_SECTIONS = 5

const VARIABLES = EMAIL_VARIABLES.filter((v) => v.pickable)
  .map((v) => `{{${v.key}}}`)
  .join(', ')

const TONE: Record<CrmNewsletterAiDraftDTO['tone'], string> = {
  friendly: 'Tom próximo e amigável, sem ser informal demais.',
  neutral: 'Tom claro e neutro, informativo.',
  formal: 'Tom formal e institucional.',
}

const DraftOutputSchema = z.object({
  reply: z.string(),
  subject: z.string(),
  preheader: z.string(),
  sections: z.array(EmailAiSectionOutputSchema.shape.section).min(1),
})

const SECTION_SCHEMA = (
  EMAIL_AI_SECTION_JSON_SCHEMA.properties as Record<string, unknown>
).section

const DRAFT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'subject', 'preheader', 'sections'],
  properties: {
    reply: { type: 'string' },
    subject: { type: 'string' },
    preheader: { type: 'string' },
    sections: { type: 'array', items: SECTION_SCHEMA },
  },
}

const clip = (value: string, max: number) => {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
}

const oneLine = (value: string, max: number) =>
  value
    .replace(/<[^>]+>/g, '')
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/^["“]([\s\S]*)["”]$/, '$1')
    .trim()
    .slice(0, max)
    .trimEnd()

function postUrl(post: AiPostRow): string | null {
  if (!post.site.publishedAt) return null
  return `${publicSiteUrl(post.site.slug)}/${BLOG_BASE}/${post.slug}`
}

/** Pure: the user message with the brief and the chosen sources. */
export function buildDraftMessage(input: {
  brief: string
  posts: AiPostRow[]
  articles: AiKbRow[]
  products: AiProductRow[]
}): string {
  const lines = [`Pedido do usuário:\n"""\n${input.brief}\n"""`]
  if (input.posts.length > 0) {
    lines.push(
      'Posts do blog escolhidos (a edição já ganha uma lista com os links deles no fim — cite-os no texto, sem repetir links):',
    )
    for (const post of input.posts) {
      lines.push(
        `- ${post.title}: ${clip(post.excerpt || post.autoExcerpt || post.plainText, SOURCE_EXCERPT_CHARS)}`,
      )
    }
  }
  if (input.articles.length > 0) {
    lines.push('Artigos da base de conhecimento escolhidos:')
    for (const article of input.articles) {
      lines.push(
        `- ${article.title}: ${clip(article.plainText, SOURCE_EXCERPT_CHARS)}`,
      )
    }
  }
  if (input.products.length > 0) {
    lines.push('Produtos do CRM escolhidos:')
    for (const product of input.products) {
      const price = Number(product.unitPrice.toString())
      lines.push(
        `- ${product.name}${price > 0 ? ` (${price.toLocaleString('pt-BR', { style: 'currency', currency: product.currency || 'BRL' })})` : ''}: ${clip(product.description ?? '', SOURCE_EXCERPT_CHARS)}`,
      )
    }
  }
  return lines.join('\n')
}

/** Pure: system prompt of "Escrever com IA". */
export function buildDraftSystem(input: {
  newsletterName: string
  tone: CrmNewsletterAiDraftDTO['tone']
}): string {
  return [
    `Você escreve edições da newsletter "${input.newsletterName}" de uma empresa brasileira para os próprios clientes.`,
    'Escreva em português do Brasil. Copy clara, útil e específica; nada de promessas ou dados que o pedido e as fontes não sustentem.',
    TONE[input.tone],
    `Pode usar as variáveis de personalização exatamente nesta forma: ${VARIABLES}. Não invente outras.`,
    'Devolva JSON com:',
    '- "reply": uma frase curta para o usuário sobre a edição gerada.',
    '- "subject": assunto da edição (até 80 caracteres, sem emojis a menos que o pedido peça).',
    '- "preheader": texto de pré-visualização que complementa o assunto (até 120 caracteres).',
    `- "sections": de 2 a ${MAX_SECTIONS} seções, na ordem do e-mail (a primeira abre com um título h1). O rodapé com descadastro já existe — não crie.`,
    'Cada seção: background "none" (fundo do e-mail) ou "soft" (faixa em destaque); columns de 1 a 3 colunas, cada uma com "blocks" na ordem.',
    'Tipos de bloco e os campos que usam (deixe os outros como string vazia, "h2" ou lista vazia):',
    '- heading: text, level (h1 só no título principal; depois h2/h3).',
    '- text: text (1 a 3 parágrafos curtos separados por linha em branco).',
    '- button: text (rótulo curto), url (link https das fontes, ou vazio).',
    '- list: items (2 a 5 itens com title e text curtos).',
    '- quote: text, author, role.',
    '- coupon: code, text — só se o pedido trouxer um cupom.',
    '- divider: nenhum campo.',
    '- product: não use.',
    'Nunca invente links: use só URLs que aparecem no pedido, ou deixe url vazio.',
  ].join('\n')
}

/** Pure: system prompt of "Sugerir assuntos". */
export function buildSubjectsSystem(newsletterName: string): string {
  return [
    `Você sugere assuntos de e-mail para a newsletter "${newsletterName}" de uma empresa brasileira.`,
    'Escreva em português do Brasil, a menos que o conteúdo esteja em outro idioma.',
    `Devolva JSON com "suggestions": exatamente ${CRM_NEWSLETTER_AI_SUGGESTIONS} pares { "subject", "preheader" }.`,
    'Assunto: até 60 caracteres, específico sobre o conteúdo, sem caixa alta, sem "!!!" e sem palavras de spam (grátis, urgente, imperdível).',
    'Pré-visualização: até 110 caracteres, complementa o assunto sem repeti-lo.',
    'Varie o estilo: um direto, uma pergunta, um com número, um com benefício, um curioso.',
    'Emojis no máximo em um dos assuntos.',
  ].join('\n')
}

type PreparedCall = Extract<
  Awaited<ReturnType<typeof AiUsageService.prepare>>,
  { ok: true }
>['value']

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
    logger.error('crm_newsletter_ai.provider_failed', {
      component: 'CrmNewsletterAiService',
      workspaceId: input.workspaceId,
      action: input.action,
      provider: call.model.provider,
      model: call.model.model,
      message: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/** Editor gate: CRM `email` EDIT, an editable issue, plan feature, quota. */
async function prepareForIssue(
  actorId: string,
  workspaceId: string,
  newsletterId: string,
  issueId: string,
): Promise<
  Result<{
    call: PreparedCall
    newsletterName: string
    issue: { subject: string; builderDocument: unknown }
  }>
> {
  const scope = await loadNewsletterScope(
    actorId,
    workspaceId,
    newsletterId,
    'EDIT',
  )
  if (!scope.ok) return scope
  const issue = await loadIssue(workspaceId, newsletterId, issueId)
  if (!issue.ok) return issue
  if (!EDITABLE_ISSUE_STATUSES.includes(issue.value.status)) {
    return err(crmNewsletterIssueLocked())
  }
  const feature = await assertFeature(workspaceId, 'crm.aiAssistant')
  if (!feature.ok) return feature
  const call = await AiUsageService.prepare(
    workspaceId,
    'CRM_ASSISTANT',
    actorId,
  )
  if (!call.ok) return call
  return ok({
    call: call.value,
    newsletterName: scope.value.newsletter.name,
    issue: issue.value,
  })
}

export const CrmNewsletterAiService = {
  /** Titles the "Escrever com IA" dialog offers (nothing is sent yet). */
  async sources(
    actorId: string,
    workspaceId: string,
    newsletterId: string,
    now: Date,
  ): Promise<Result<CrmNewsletterAiSourcesDTO>> {
    const scope = await loadNewsletterScope(
      actorId,
      workspaceId,
      newsletterId,
      'EDIT',
    )
    if (!scope.ok) return scope
    const serviceDesk = await assertModuleMember(
      actorId,
      workspaceId,
      'SERVICE_DESK',
    )
    const [posts, products, articles] = await Promise.all([
      CrmNewsletterAiRepository.listRecentPosts(workspaceId, now),
      CrmNewsletterAiRepository.listProducts(workspaceId),
      serviceDesk.ok
        ? CrmNewsletterAiRepository.listKbArticles(workspaceId)
        : Promise.resolve(null),
    ])
    if (!posts.ok) return posts
    if (!products.ok) return products
    if (articles && !articles.ok) return articles
    return ok({
      posts: posts.value.map((post) => ({
        id: post.id,
        title: post.title,
        siteName: post.site.name,
        publishedAt: post.publishedAt?.toISOString() ?? null,
      })),
      kbArticles: articles ? articles.value : null,
      products: products.value,
    })
  },

  /** "Escrever com IA": the whole issue from a brief and chosen sources. */
  async draft(
    actorId: string,
    workspaceId: string,
    newsletterId: string,
    issueId: string,
    dto: CrmNewsletterAiDraftDTO,
    now: Date,
  ): Promise<Result<CrmNewsletterAiDraftResultDTO>> {
    const prepared = await prepareForIssue(
      actorId,
      workspaceId,
      newsletterId,
      issueId,
    )
    if (!prepared.ok) return prepared

    let articleIds = dto.kbArticleIds
    if (articleIds.length > 0) {
      const serviceDesk = await assertModuleMember(
        actorId,
        workspaceId,
        'SERVICE_DESK',
      )
      if (!serviceDesk.ok) articleIds = []
    }
    const [posts, articles, products] = await Promise.all([
      CrmNewsletterAiRepository.findPosts(workspaceId, dto.postIds, now),
      CrmNewsletterAiRepository.findKbArticles(workspaceId, articleIds),
      CrmNewsletterAiRepository.findProducts(workspaceId, dto.productIds),
    ])
    if (!posts.ok) return posts
    if (!articles.ok) return articles
    if (!products.ok) return products

    const { call } = prepared.value
    const response = await callProvider(call, {
      actorId,
      workspaceId,
      system: buildDraftSystem({
        newsletterName: prepared.value.newsletterName,
        tone: dto.tone,
      }),
      message: buildDraftMessage({
        brief: dto.brief,
        posts: posts.value,
        articles: articles.value,
        products: products.value,
      }),
      schemaName: 'newsletter_issue',
      schema: DRAFT_JSON_SCHEMA,
      maxTokens: DRAFT_MAX_TOKENS,
      action: 'draft',
    })
    if (!response) return err(crmNewsletterAiFailed())

    const parsed = parseSdAiJson(DraftOutputSchema, response.text)
    const sections: CanvasFragment[] = []
    for (const spec of parsed?.sections.slice(0, MAX_SECTIONS) ?? []) {
      const built = buildAiSection(spec)
      if (built.ok) sections.push(built.value.fragment)
    }
    const subject = parsed ? oneLine(parsed.subject, 200) : ''
    if (!parsed || sections.length === 0 || !subject) {
      logger.warn('crm_newsletter_ai.invalid_draft', {
        component: 'CrmNewsletterAiService',
        workspaceId,
        issueId,
        model: call.model.key,
      })
      return err(
        crmNewsletterAiFailed(
          'A IA não devolveu uma edição aproveitável — tente de novo ou detalhe mais o pedido',
        ),
      )
    }
    // The chosen posts close the issue with their real links and images.
    const linked = posts.value
      .map((post) => ({ post, url: postUrl(post) }))
      .filter((entry): entry is { post: AiPostRow; url: string } => !!entry.url)
    const list = postsSection(
      linked.map(({ post, url }) => ({
        title: post.title,
        excerpt: post.excerpt || post.autoExcerpt,
        url,
        imageUrl: post.coverImageUrl,
      })),
      { prefix: 'ai-posts', heading: 'Leia no blog' },
    )
    if (list) sections.push(list)

    logger.info('crm_newsletter_ai.draft', {
      component: 'CrmNewsletterAiService',
      workspaceId,
      issueId,
      model: call.model.key,
      sections: sections.length,
      posts: posts.value.length,
      articles: articles.value.length,
      products: products.value.length,
    })
    return ok({
      reply: parsed.reply.trim() || 'Pronto! Revise a edição antes de enviar.',
      subject,
      preheader: oneLine(parsed.preheader, 150),
      sections,
    })
  },

  /** "Sugerir assuntos": 5 subjects + preheaders from the issue's copy. */
  async subjects(
    actorId: string,
    workspaceId: string,
    newsletterId: string,
    issueId: string,
    dto: CrmNewsletterAiSubjectsDTO,
  ): Promise<Result<CrmNewsletterAiSubjectsResultDTO>> {
    const prepared = await prepareForIssue(
      actorId,
      workspaceId,
      newsletterId,
      issueId,
    )
    if (!prepared.ok) return prepared
    const { call, issue } = prepared.value
    const text = documentText(issue.builderDocument)
    const message = [
      `Assunto atual: ${issue.subject}`,
      text
        ? `Conteúdo da edição:\n"""\n${text}\n"""`
        : 'A edição ainda está vazia — baseie-se no assunto atual.',
      dto.brief ? `Pedido do usuário: ${dto.brief}` : '',
    ]
      .filter(Boolean)
      .join('\n\n')
    const response = await callProvider(call, {
      actorId,
      workspaceId,
      system: buildSubjectsSystem(prepared.value.newsletterName),
      message,
      schemaName: 'newsletter_subjects',
      schema: CRM_NEWSLETTER_AI_SUBJECTS_JSON_SCHEMA,
      maxTokens: SUBJECTS_MAX_TOKENS,
      action: 'subjects',
    })
    if (!response) return err(crmNewsletterAiFailed())
    const parsed = parseSdAiJson(
      CrmNewsletterAiSubjectsOutputSchema,
      response.text,
    )
    const seen = new Set<string>()
    const suggestions = (parsed?.suggestions ?? [])
      .map((entry) => ({
        subject: oneLine(entry.subject, 200),
        preheader: oneLine(entry.preheader, 150),
      }))
      .filter((entry) => {
        const key = entry.subject.toLowerCase()
        if (!entry.subject || seen.has(key)) return false
        seen.add(key)
        return true
      })
      .slice(0, CRM_NEWSLETTER_AI_SUGGESTIONS)
    if (suggestions.length === 0) {
      logger.warn('crm_newsletter_ai.invalid_subjects', {
        component: 'CrmNewsletterAiService',
        workspaceId,
        issueId,
        model: call.model.key,
      })
      return err(
        crmNewsletterAiFailed('A IA não devolveu sugestões — tente de novo'),
      )
    }
    logger.info('crm_newsletter_ai.subjects', {
      component: 'CrmNewsletterAiService',
      workspaceId,
      issueId,
      model: call.model.key,
      count: suggestions.length,
    })
    return ok({ suggestions })
  },
}
