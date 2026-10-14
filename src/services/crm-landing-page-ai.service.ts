import { logger } from '@/lib/axiom/logger'
import { crmLandingPageAiFailed } from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import {
  CRM_LANDING_PAGE_AI_JSON_SCHEMA,
  type CrmLandingPageAiAssistDTO,
  CrmLandingPageAiOutputSchema,
} from '@/src/schemas/crm-landing-page-ai.schema'
import { parseSdAiJson } from '@/src/schemas/sd-ai.schema'
import type { CrmLandingPageAiReplyDTO } from '@/types/crm-landing-page'
import { AiUsageService } from './ai-usage.service'
import { assertModuleMember } from './authz'
import { assertFeature } from './feature-flag.service'

/** Short answers: the chat lives in a popover next to one text field. */
const ASSIST_MAX_TOKENS = 1200

/** Pure: the system prompt for one field of the landing-page builder. */
export function buildLandingPageAiSystem(
  dto: Pick<CrmLandingPageAiAssistDTO, 'text' | 'field' | 'page'>,
): string {
  const kind = dto.field.multiline
    ? 'um parágrafo (pode ter quebras de linha)'
    : 'uma linha só (sem quebras de linha)'
  const lines = [
    'Você é um redator de landing pages que ajuda o usuário a ajustar o texto de UM campo da página.',
    'Responda sempre em português do Brasil, a menos que o texto atual ou o usuário usem outro idioma — nesse caso, mantenha o idioma do texto.',
    'Devolva JSON com duas chaves:',
    '- "reply": resposta curta ao usuário (1 a 3 frases), explicando a sugestão ou respondendo a pergunta.',
    '- "suggestion": o novo texto completo do campo, pronto para substituir o atual; string vazia quando o usuário só fez uma pergunta e não há texto a propor.',
    `O campo é ${kind}.`,
    'A sugestão não leva aspas, markdown, emojis (a menos que pedidos) nem comentários — só o texto final.',
  ]
  if (dto.field.maxLength) {
    lines.push(
      `A sugestão deve ter no máximo ${dto.field.maxLength} caracteres.`,
    )
  }
  if (dto.field.label) lines.push(`Campo: ${dto.field.label}.`)
  if (dto.page.section) lines.push(`Seção da página: ${dto.page.section}.`)
  if (dto.page.title) lines.push(`Título da página: ${dto.page.title}.`)
  lines.push(
    dto.text.trim()
      ? `Texto atual do campo:\n"""\n${dto.text}\n"""`
      : 'O campo está vazio — escreva do zero a partir do pedido.',
  )
  return lines.join('\n')
}

/** Keeps a single-line field single-line and inside its length cap. */
function fitSuggestion(
  suggestion: string,
  field: CrmLandingPageAiAssistDTO['field'],
): string | null {
  let text = suggestion.trim().replace(/^["“]([\s\S]*)["”]$/, '$1')
  if (!field.multiline) text = text.replace(/\s*\n+\s*/g, ' ')
  if (field.maxLength) text = text.slice(0, field.maxLength).trimEnd()
  return text ? text : null
}

export const CrmLandingPageAiService = {
  /**
   * One turn of the per-field AI chat. Same gate as the other CRM AI
   * features (plan feature `crm.aiAssistant`), same model and monthly quota
   * through `AiUsageService` (ADR 0007). Stateless: the client sends the
   * short history every turn and applies the suggestion itself.
   */
  async assist(
    actorId: string,
    workspaceId: string,
    dto: CrmLandingPageAiAssistDTO,
  ): Promise<Result<CrmLandingPageAiReplyDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'landing-pages',
      action: 'EDIT',
    })
    if (!membership.ok) return membership
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
        system: buildLandingPageAiSystem(dto),
        messages: dto.messages.map((turn) =>
          turn.role === 'user'
            ? { role: 'user' as const, content: turn.content }
            : { role: 'assistant' as const, content: turn.content },
        ),
        jsonSchema: {
          name: 'landing_page_copy',
          schema: CRM_LANDING_PAGE_AI_JSON_SCHEMA,
        },
        maxTokens: ASSIST_MAX_TOKENS,
      })
      await AiUsageService.record(call.value, {
        workspaceId,
        userId: actorId,
        usage: response.usage,
        scope: { module: 'CRM' },
      })
      text = response.text
    } catch (error) {
      logger.error('crm_landing_page.ai_provider_failed', {
        component: 'CrmLandingPageAiService',
        workspaceId,
        provider: call.value.model.provider,
        model: call.value.model.model,
        message: error instanceof Error ? error.message : String(error),
      })
      return err(crmLandingPageAiFailed())
    }

    const parsed = parseSdAiJson(CrmLandingPageAiOutputSchema, text)
    if (!parsed || (!parsed.reply.trim() && !parsed.suggestion.trim())) {
      logger.warn('crm_landing_page.ai_invalid_output', {
        component: 'CrmLandingPageAiService',
        workspaceId,
        model: call.value.model.key,
      })
      return err(crmLandingPageAiFailed())
    }

    const suggestion = fitSuggestion(parsed.suggestion, dto.field)
    logger.info('crm_landing_page.ai_assist', {
      component: 'CrmLandingPageAiService',
      workspaceId,
      model: call.value.model.key,
      turns: dto.messages.length,
      suggested: suggestion !== null,
    })
    return ok({
      reply: parsed.reply.trim() || 'Aqui está uma sugestão:',
      suggestion,
    })
  },
}
