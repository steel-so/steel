import { logger } from '@/lib/axiom/logger'
import { crmTextAiFailed } from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import {
  CRM_TEXT_AI_JSON_SCHEMA,
  type CrmTextAiAssistDTO,
  CrmTextAiOutputSchema,
  type CrmTextAiSurface,
} from '@/src/schemas/crm-text-ai.schema'
import { parseSdAiJson } from '@/src/schemas/sd-ai.schema'
import type { CrmTextAiReplyDTO } from '@/types/crm-text-ai'
import { AiUsageService } from './ai-usage.service'
import { assertModuleMember, type PermissionRequirement } from './authz'
import { assertFeature } from './feature-flag.service'

/** Short answers: the chat lives in a popover next to one text field. */
const ASSIST_MAX_TOKENS = 1500

/** Who may ask the AI about a field: whoever may edit that surface. */
const SURFACE_PERMISSION: Record<CrmTextAiSurface, PermissionRequirement> = {
  LANDING_PAGE: { resource: 'landing-pages', action: 'EDIT' },
  DOCUMENT: { resource: 'documents', action: 'EDIT' },
  SOCIAL: { resource: 'social', action: 'CREATE' },
}

const SURFACE_ROLE: Record<CrmTextAiSurface, string[]> = {
  LANDING_PAGE: [
    'Você é um redator de landing pages que ajuda o usuário a ajustar o texto de UM campo da página.',
    'Escreva copy de conversão: clara, específica e orientada ao benefício.',
  ],
  DOCUMENT: [
    'Você é um redator de propostas comerciais B2B que ajuda o usuário a ajustar o texto de UM campo do documento.',
    'Tom profissional, claro e objetivo; nada de exageros de marketing. Não invente valores, prazos, cláusulas nem dados do cliente que não estejam no texto ou no pedido.',
  ],
  SOCIAL: [
    'Você é um social media que ajuda o usuário a escrever o texto de UM campo de uma publicação (título, descrição ou legenda).',
    'Adapte ao formato e ao público da rede: gancho forte no início, frases curtas, chamada para ação quando fizer sentido. Hashtags só no fim e só quando a rede usa (no máximo 5), a menos que o usuário peça diferente.',
  ],
}

/** Pure: the system prompt for one field. */
export function buildTextAiSystem(
  dto: Pick<CrmTextAiAssistDTO, 'surface' | 'text' | 'field' | 'context'>,
): string {
  const kind = dto.field.multiline
    ? 'um texto que pode ter várias linhas'
    : 'uma linha só (sem quebras de linha)'
  const lines = [
    ...SURFACE_ROLE[dto.surface],
    'Responda sempre em português do Brasil, a menos que o texto atual ou o usuário usem outro idioma — nesse caso, mantenha o idioma do texto.',
    'Devolva JSON com duas chaves:',
    '- "reply": resposta curta ao usuário (1 a 3 frases), explicando a sugestão ou respondendo a pergunta.',
    '- "suggestion": o novo texto completo do campo, pronto para substituir o atual; string vazia quando o usuário só fez uma pergunta e não há texto a propor.',
    `O campo é ${kind}.`,
    'A sugestão não leva aspas, markdown nem comentários — só o texto final. Emojis só se o usuário pedir ou se o texto atual já usar.',
  ]
  if (dto.field.maxLength) {
    lines.push(
      `A sugestão deve ter no máximo ${dto.field.maxLength} caracteres.`,
    )
  }
  if (dto.field.label) lines.push(`Campo: ${dto.field.label}.`)
  if (dto.context.platform) lines.push(`Rede social: ${dto.context.platform}.`)
  if (dto.context.section) lines.push(`Seção: ${dto.context.section}.`)
  if (dto.context.title) lines.push(`Título: ${dto.context.title}.`)
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
  field: CrmTextAiAssistDTO['field'],
): string | null {
  let text = suggestion.trim().replace(/^["“]([\s\S]*)["”]$/, '$1')
  if (!field.multiline) text = text.replace(/\s*\n+\s*/g, ' ')
  if (field.maxLength) text = text.slice(0, field.maxLength).trimEnd()
  return text ? text : null
}

export const CrmTextAiService = {
  /**
   * One turn of the per-field AI chat (landing pages, documents, social
   * posts). Same gate as the other CRM AI features (plan feature
   * `crm.aiAssistant`), same model and monthly quota through
   * `AiUsageService` (ADR 0007). Stateless: the client sends the field text
   * and the short history every turn and applies the suggestion itself —
   * nothing else from the CRM (client data, amounts) goes to the provider.
   */
  async assist(
    actorId: string,
    workspaceId: string,
    dto: CrmTextAiAssistDTO,
  ): Promise<Result<CrmTextAiReplyDTO>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'CRM',
      SURFACE_PERMISSION[dto.surface],
    )
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
        system: buildTextAiSystem(dto),
        messages: dto.messages.map((turn) =>
          turn.role === 'user'
            ? { role: 'user' as const, content: turn.content }
            : { role: 'assistant' as const, content: turn.content },
        ),
        jsonSchema: { name: 'crm_field_copy', schema: CRM_TEXT_AI_JSON_SCHEMA },
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
      logger.error('crm_text_ai.provider_failed', {
        component: 'CrmTextAiService',
        workspaceId,
        surface: dto.surface,
        provider: call.value.model.provider,
        model: call.value.model.model,
        message: error instanceof Error ? error.message : String(error),
      })
      return err(crmTextAiFailed())
    }

    const parsed = parseSdAiJson(CrmTextAiOutputSchema, text)
    if (!parsed || (!parsed.reply.trim() && !parsed.suggestion.trim())) {
      logger.warn('crm_text_ai.invalid_output', {
        component: 'CrmTextAiService',
        workspaceId,
        surface: dto.surface,
        model: call.value.model.key,
      })
      return err(crmTextAiFailed())
    }

    const suggestion = fitSuggestion(parsed.suggestion, dto.field)
    logger.info('crm_text_ai.assist', {
      component: 'CrmTextAiService',
      workspaceId,
      surface: dto.surface,
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
