import { logger } from '@/lib/axiom/logger'
import type { WikiAiAction } from '@/types/wiki-page'
import { wikiAiFailed, wikiPageForbidden } from '../errors'
import { err, ok, type Result } from '../lib/result'
import { WikiPageRepository } from '../repositories/wiki-page.repository'
import type { WikiAiDTO } from '../schemas/wiki-page.schema'
import { assertWikiMember } from './_wiki-access'
import { assertSteelAiEnabled } from './ai-conversation.service'
import { AiUsageService } from './ai-usage.service'

/** Longest title the `title` action returns. */
const TITLE_MAX = 120

const MAX_TOKENS: Record<WikiAiAction, number> = {
  paraphrase: 4000,
  simplify: 4000,
  elaborate: 6000,
  summarize: 1200,
  title: 60,
}

/** Over this many characters, `summarize` may answer in bullets. */
const LONG_INPUT = 3000

const TASK: Record<WikiAiAction, (text: string) => string> = {
  paraphrase: () =>
    'Reescreva o texto com outras palavras, mantendo exatamente o mesmo sentido, o mesmo tom e aproximadamente o mesmo tamanho.',
  simplify: () =>
    'Simplifique o texto: frases curtas, palavras do dia a dia, sem jargão desnecessário. Mantenha todas as informações importantes.',
  elaborate: () =>
    'Desenvolva o texto com mais detalhes, explicações e exemplos, mantendo o tom. Só amplie o que já está no texto ou decorre diretamente dele.',
  summarize: (text) =>
    text.length > LONG_INPUT
      ? 'Resuma o texto em poucos tópicos curtos (lista com "- "), só com os pontos principais.'
      : 'Resuma o texto em um parágrafo curto, só com os pontos principais.',
  title: () =>
    'Sugira UM título curto (no máximo 8 palavras) para o texto. Responda só com o título, em uma linha, sem aspas, sem ponto final e sem markdown.',
}

/** Pure: the system prompt of one rewrite. */
export function buildWikiAiSystem(action: WikiAiAction, text: string): string {
  return [
    'Você é um assistente de escrita da Wiki do Steel, a base de conhecimento interna de uma empresa.',
    TASK[action](text),
    'Escreva no mesmo idioma do texto; na dúvida, em português do Brasil.',
    'Nunca invente fatos, números, nomes, datas ou links que não estejam no texto.',
    'Preserve a formatação Markdown do texto original (listas, negrito, links) quando houver.',
    'Devolva só o texto final: sem introdução, sem comentários, sem aspas em volta e sem explicar o que foi feito.',
  ].join('\n')
}

/** Cleans the model output; null when nothing usable came back. */
export function fitWikiAiText(
  action: WikiAiAction,
  raw: string,
): string | null {
  let text = raw
    .trim()
    .replace(/^["“'«]([\s\S]*)["”'»]$/, '$1')
    .trim()
  if (action === 'title') {
    text = (text.split('\n').find((line) => line.trim()) ?? '')
      .replace(/^#+\s*/, '')
      .replace(/[.\s]+$/, '')
      .replace(/^["“'«]+|["”'»]+$/g, '')
      .replace(/\.$/, '')
      .trim()
      .slice(0, TITLE_MAX)
      .trim()
  }
  return text ? text : null
}

export const WikiAiService = {
  /**
   * Inline AI of the wiki editor (paraphrase, simplify, elaborate,
   * summarize, title). Any wiki member, on a page of this workspace, with
   * Steel AI switched on. Provider/model and the monthly quota come from
   * the workspace AI settings through `AiUsageService` (ADR 0007); usage is
   * recorded as `WIKI_ASSISTANT`. Only the given text goes to the provider.
   */
  async rewrite(
    actorId: string,
    workspaceId: string,
    wikiPageId: string,
    dto: WikiAiDTO,
  ): Promise<Result<{ text: string }>> {
    const membership = await assertWikiMember(actorId, workspaceId)
    if (!membership.ok) return membership

    const page = await WikiPageRepository.findById(wikiPageId)
    if (!page.ok) return page
    if (page.value.workspaceId !== workspaceId) return err(wikiPageForbidden())

    const enabled = await assertSteelAiEnabled(workspaceId)
    if (!enabled.ok) return enabled

    const call = await AiUsageService.prepare(
      workspaceId,
      'WIKI_ASSISTANT',
      actorId,
    )
    if (!call.ok) return call

    let raw: string
    try {
      const response = await call.value.provider.chat({
        model: call.value.model.model,
        system: buildWikiAiSystem(dto.action, dto.text),
        messages: [{ role: 'user', content: dto.text }],
        maxTokens: MAX_TOKENS[dto.action],
      })
      await AiUsageService.record(call.value, {
        workspaceId,
        userId: actorId,
        usage: response.usage,
      })
      raw = response.text
    } catch (error) {
      logger.error('wiki_ai.provider_failed', {
        component: 'WikiAiService',
        workspaceId,
        action: dto.action,
        provider: call.value.model.provider,
        model: call.value.model.model,
        message: error instanceof Error ? error.message : String(error),
      })
      return err(wikiAiFailed())
    }

    const text = fitWikiAiText(dto.action, raw)
    if (!text) {
      logger.warn('wiki_ai.empty_output', {
        component: 'WikiAiService',
        workspaceId,
        action: dto.action,
        model: call.value.model.key,
      })
      return err(wikiAiFailed())
    }

    logger.info('wiki_ai.rewrite', {
      component: 'WikiAiService',
      workspaceId,
      wikiPageId,
      action: dto.action,
      model: call.value.model.key,
      inputChars: dto.text.length,
      outputChars: text.length,
    })
    return ok({ text })
  },
}
