import { logger } from '@/lib/axiom/logger'
import { appError } from '@/src/errors/app-error'
import { err, ok, type Result } from '@/src/lib/result'
import { markdownToPlate } from '@/src/lib/sites/blog/plate'
import { parseSdAiJson } from '@/src/schemas/sd-ai.schema'
import {
  BlogAiOutputSchema,
  type SiteBlogAiDTO,
} from '@/src/schemas/site-blog.schema'
import type { SiteBlogAiResultDTO } from '@/types/site-blog'
import { AiUsageService } from './ai-usage.service'
import { assertFeature } from './feature-flag.service'
import { authorizeSite } from './site-access'

/**
 * AI helpers of the post editor: write a post from a topic/outline,
 * summarize it, suggest titles and turn it into a FAQ. Same gate, model and
 * monthly quota as the other CRM AI features (plan feature
 * `crm.aiAssistant`, `AiUsageService`, ADR 0007). The result is always a
 * draft the editor shows for review — nothing is saved or published here.
 * Only the topic/outline or the post text goes to the provider.
 */

const MAX_TOKENS: Record<SiteBlogAiDTO['action'], number> = {
  write: 6000,
  summary: 600,
  titles: 600,
  faq: 2500,
}

const TONES: Record<NonNullable<SiteBlogAiDTO['tone']>, string> = {
  profissional: 'profissional e claro',
  descontraido: 'leve e conversado, sem perder a clareza',
  tecnico: 'técnico e preciso, com termos da área explicados',
}

export const BLOG_AI_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'excerpt', 'body', 'titles', 'faq', 'description'],
  properties: {
    title: { type: 'string' },
    excerpt: { type: 'string' },
    body: { type: 'string' },
    titles: { type: 'array', items: { type: 'string' } },
    faq: {
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
    description: { type: 'string' },
  },
}

/** Pure: the system prompt of one action. */
export function buildBlogAiSystem(dto: SiteBlogAiDTO): string {
  const lines = [
    'Você é um redator de blog que escreve em português do Brasil para o site de uma empresa.',
    'Escreva com fatos verificáveis e sem inventar números, nomes, preços, prazos ou citações. Quando um dado for necessário e você não o tiver, escreva [completar] no lugar.',
    'Responda só com JSON nas chaves title, excerpt, body, titles, faq e description; deixe vazias ("" ou []) as que a tarefa não pede.',
  ]
  if (dto.tone) lines.push(`Tom: ${TONES[dto.tone]}.`)
  if (dto.focusKeyword) {
    lines.push(
      `Palavra-chave principal: "${dto.focusKeyword}" — use no título, no primeiro parágrafo e em um subtítulo, de forma natural.`,
    )
  }
  switch (dto.action) {
    case 'write':
      lines.push(
        'Tarefa: escrever um post completo.',
        '- title: título com até 70 caracteres.',
        '- excerpt: resumo de 1 a 2 frases (até 300 caracteres) para os cartões do blog.',
        '- description: meta description de até 155 caracteres.',
        '- body: o texto em Markdown, de 600 a 1200 palavras, com subtítulos ## e ###, parágrafos curtos, listas quando ajudarem e uma conclusão com chamada para ação. Não repita o título no corpo.',
      )
      break
    case 'summary':
      lines.push(
        'Tarefa: resumir o post.',
        '- excerpt: resumo de 1 a 2 frases (até 300 caracteres) que desperte a vontade de ler.',
        '- description: meta description de até 155 caracteres.',
      )
      break
    case 'titles':
      lines.push(
        'Tarefa: sugerir 5 títulos diferentes para o post (titles), cada um com até 70 caracteres, variando o ângulo (benefício, pergunta, lista, guia, curiosidade).',
      )
      break
    case 'faq':
      lines.push(
        'Tarefa: transformar o post em perguntas frequentes (faq): de 3 a 6 perguntas que um leitor faria, cada resposta com 40 a 60 palavras, respondendo de forma direta só com o que está no texto.',
      )
      break
  }
  return lines.join('\n')
}

function userMessage(dto: SiteBlogAiDTO): string {
  if (dto.action === 'write') {
    return [
      `Assunto: ${dto.topic}`,
      dto.outline ? `Roteiro e instruções:\n${dto.outline}` : '',
    ]
      .filter(Boolean)
      .join('\n\n')
  }
  return [
    dto.topic ? `Título atual: ${dto.topic}` : '',
    `Texto do post:\n"""\n${(dto.text ?? '').slice(0, 30_000)}\n"""`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

const failed = () =>
  appError(
    'SITE_BLOG_AI_FAILED',
    'A IA não conseguiu gerar o rascunho. Tente novamente.',
  )

export const SiteBlogAiService = {
  async run(
    actorId: string,
    workspaceId: string,
    siteId: string,
    dto: SiteBlogAiDTO,
  ): Promise<Result<SiteBlogAiResultDTO>> {
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

    let text: string
    try {
      const response = await call.value.provider.chat({
        model: call.value.model.model,
        system: buildBlogAiSystem(dto),
        messages: [{ role: 'user', content: userMessage(dto) }],
        jsonSchema: { name: 'site_blog_draft', schema: BLOG_AI_JSON_SCHEMA },
        maxTokens: MAX_TOKENS[dto.action],
      })
      await AiUsageService.record(call.value, {
        workspaceId,
        userId: actorId,
        usage: response.usage,
        scope: { module: 'CRM' },
      })
      text = response.text
    } catch (error) {
      logger.error('site_blog_ai.provider_failed', {
        component: 'SiteBlogAiService',
        workspaceId,
        siteId,
        action: dto.action,
        provider: call.value.model.provider,
        message: error instanceof Error ? error.message : String(error),
      })
      return err(failed())
    }

    const parsed = parseSdAiJson(BlogAiOutputSchema, text)
    if (!parsed) {
      logger.warn('site_blog_ai.invalid_output', {
        component: 'SiteBlogAiService',
        workspaceId,
        siteId,
        action: dto.action,
      })
      return err(failed())
    }

    const result: SiteBlogAiResultDTO = { action: dto.action }
    switch (dto.action) {
      case 'write':
        if (!parsed.body.trim()) return err(failed())
        result.title = parsed.title.trim().slice(0, 200)
        result.excerpt = parsed.excerpt.trim().slice(0, 400)
        result.description = parsed.description.trim().slice(0, 320)
        result.content = markdownToPlate(parsed.body)
        break
      case 'summary':
        if (!parsed.excerpt.trim()) return err(failed())
        result.excerpt = parsed.excerpt.trim().slice(0, 400)
        result.description = parsed.description.trim().slice(0, 320)
        break
      case 'titles': {
        const titles = parsed.titles
          .map((title) => title.trim().slice(0, 200))
          .filter(Boolean)
          .slice(0, 8)
        if (titles.length === 0) return err(failed())
        result.titles = titles
        break
      }
      case 'faq': {
        const faq = parsed.faq
          .map((item) => ({
            question: item.question.trim().slice(0, 300),
            answer: item.answer.trim().slice(0, 2000),
          }))
          .filter((item) => item.question && item.answer)
          .slice(0, 20)
        if (faq.length === 0) return err(failed())
        result.faq = faq
        break
      }
    }
    logger.info('site_blog_ai.draft', {
      component: 'SiteBlogAiService',
      workspaceId,
      siteId,
      action: dto.action,
      model: call.value.model.key,
    })
    return ok(result)
  },
}
