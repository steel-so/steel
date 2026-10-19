import type { WhatsAppSentiment } from '@prisma/client'
import { logger } from '@/lib/axiom/logger'
import { wrapUntrusted } from '@/src/lib/ai/guardrails/injection'
import { ok, type Result } from '@/src/lib/result'
import { WhatsAppAiConfigRepository } from '@/src/repositories/whatsapp-ai-config.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppMessageRepository } from '@/src/repositories/whatsapp-message.repository'
import { AiUsageService } from './ai-usage.service'
import {
  type WhatsAppSentimentAlertOutcome,
  WhatsAppSentimentAlertService,
} from './whatsapp-sentiment-alert.service'

const SENTIMENT_HISTORY_SAMPLE = 50
const SENTIMENT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    sentiment: { type: 'string', enum: ['NEGATIVE', 'NEUTRAL', 'POSITIVE'] },
    score: { type: 'number' },
  },
  required: ['sentiment', 'score'],
  additionalProperties: false,
}

const SYSTEM_PROMPT = `Classifique o sentimento da mensagem de um cliente em uma conversa de atendimento via WhatsApp. Responda só com um JSON no formato {"sentiment": "NEGATIVE"|"NEUTRAL"|"POSITIVE", "score": number}, onde score vai de -1 (muito negativo) a 1 (muito positivo).`

interface SentimentResult {
  sentiment: WhatsAppSentiment
  score: number
}

export type WhatsAppSentimentOutcome =
  | {
      status: 'skipped'
      reason:
        | 'message_not_found'
        | 'not_inbound'
        | 'no_text'
        | 'no_ai_config'
        | 'ai_quota_exceeded'
        | 'ai_provider_unavailable'
        | 'ai_prepare_failed'
        | 'unparseable_response'
    }
  | {
      status: 'failed'
      reason: 'provider_failed'
      detail: string
      provider: string
      model: string
    }
  | {
      status: 'classified'
      sentiment: WhatsAppSentiment
      score: number
      conversationId: string
      workspaceId: string
      /** Nova média da conversa (null se nada classificado ainda). */
      avgSentimentScore: number | null
      /** Regra de alerta aos supervisores (null = falhou, só logado). */
      alert: WhatsAppSentimentAlertOutcome | null
    }

export function parseSentimentResponse(
  content: string,
): SentimentResult | null {
  try {
    const parsed = JSON.parse(content)
    if (
      (parsed.sentiment === 'NEGATIVE' ||
        parsed.sentiment === 'NEUTRAL' ||
        parsed.sentiment === 'POSITIVE') &&
      typeof parsed.score === 'number'
    ) {
      return {
        sentiment: parsed.sentiment,
        score: Math.max(-1, Math.min(1, parsed.score)),
      }
    }
    return null
  } catch {
    return null
  }
}

function prepareFailureReason(
  code: string,
): 'ai_quota_exceeded' | 'ai_provider_unavailable' | 'ai_prepare_failed' {
  if (code === 'AI_QUOTA_EXCEEDED') return 'ai_quota_exceeded'
  if (code === 'AI_PROVIDER_UNAVAILABLE') return 'ai_provider_unavailable'
  return 'ai_prepare_failed'
}

async function recomputeConversationAvgSentiment(
  conversationId: string,
): Promise<Result<number | null>> {
  const recent = await WhatsAppMessageRepository.listRecentSentimentScores(
    conversationId,
    SENTIMENT_HISTORY_SAMPLE,
  )
  if (!recent.ok) return recent
  if (recent.value.length === 0) return ok(null)

  const avg =
    recent.value.reduce((sum, score) => sum + score, 0) / recent.value.length

  const updated = await WhatsAppConversationRepository.update(conversationId, {
    avgSentimentScore: avg,
  })
  if (!updated.ok) return updated
  return ok(avg)
}

export const WhatsAppSentimentService = {
  /**
   * Classifica o humor de uma mensagem recebida e atualiza a média da
   * conversa. Fluxo de sistema (job em background, sem usuário): usa o
   * modelo padrão do workspace e respeita a cota — esgotada, só registra e
   * segue sem classificar.
   */
  async analyzeMessage(
    messageId: string,
  ): Promise<Result<WhatsAppSentimentOutcome>> {
    const found = await WhatsAppMessageRepository.findById(messageId)
    if (!found.ok) return found
    const message = found.value
    if (!message) return ok({ status: 'skipped', reason: 'message_not_found' })
    if (message.direction !== 'IN') {
      return ok({ status: 'skipped', reason: 'not_inbound' })
    }
    if (!message.text?.trim()) {
      return ok({ status: 'skipped', reason: 'no_text' })
    }

    const aiConfig = await WhatsAppAiConfigRepository.findByWorkspace(
      message.workspaceId,
    )
    if (!aiConfig.ok) return aiConfig
    if (!aiConfig.value) {
      return ok({ status: 'skipped', reason: 'no_ai_config' })
    }

    const prepared = await AiUsageService.prepare(
      message.workspaceId,
      'WHATSAPP_SENTIMENT',
    )
    if (!prepared.ok) {
      return ok({
        status: 'skipped',
        reason: prepareFailureReason(prepared.error.code),
      })
    }
    const call = prepared.value

    let result: SentimentResult | null
    try {
      const response = await call.provider.chat({
        model: call.model.model,
        system: SYSTEM_PROMPT,
        // Customer text is third-party content (ADR 0041): fenced as data.
        messages: [
          {
            role: 'user',
            content: wrapUntrusted(message.text, 'whatsapp_message'),
          },
        ],
        jsonSchema: { name: 'sentiment', schema: SENTIMENT_JSON_SCHEMA },
      })
      await AiUsageService.record(call, {
        workspaceId: message.workspaceId,
        userId: null,
        usage: response.usage,
      })
      result = parseSentimentResponse(response.text)
    } catch (error) {
      return ok({
        status: 'failed',
        reason: 'provider_failed',
        detail: error instanceof Error ? error.message : String(error),
        provider: call.model.provider,
        model: call.model.model,
      })
    }

    if (!result) {
      return ok({ status: 'skipped', reason: 'unparseable_response' })
    }

    const updated = await WhatsAppMessageRepository.update(messageId, {
      sentiment: result.sentiment,
      sentimentScore: result.score,
    })
    if (!updated.ok) return updated

    const avg = await recomputeConversationAvgSentiment(message.conversationId)
    if (!avg.ok) return avg

    // Ação sobre o sentimento: falha no alerta não desfaz a classificação.
    const alert = await WhatsAppSentimentAlertService.evaluate({
      workspaceId: message.workspaceId,
      conversationId: message.conversationId,
      avgSentimentScore: avg.value,
    })
    if (!alert.ok) {
      logger.error('whatsapp.sentiment_alert.failed', {
        component: 'WhatsAppSentimentService',
        conversationId: message.conversationId,
        reason: alert.error.code,
      })
    }

    return ok({
      status: 'classified',
      sentiment: result.sentiment,
      score: result.score,
      conversationId: message.conversationId,
      workspaceId: message.workspaceId,
      avgSentimentScore: avg.value,
      alert: alert.ok ? alert.value : null,
    })
  },
}
