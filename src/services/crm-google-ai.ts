import { logger } from '@/lib/axiom/logger'
import { crmGoogleAiFailed } from '@/src/errors'
import {
  GOOGLE_SUGGESTION_JSON_SCHEMA,
  GoogleSuggestionOutputSchema,
} from '@/src/lib/google-business/ai-prompts'
import { err, ok, type Result } from '@/src/lib/result'
import { parseSdAiJson } from '@/src/schemas/sd-ai.schema'
import { AiUsageService } from './ai-usage.service'
import { assertFeature } from './feature-flag.service'

const SUGGESTION_MAX_TOKENS = 900

/**
 * One structured AI call for the Google presence screens (profile
 * description, review reply). Same gate and ledger as the other CRM AI
 * features: plan feature `crm.aiAssistant`, the workspace model and the
 * monthly quota through `AiUsageService` (ADR 0007) — the usage row is the
 * audit trail. Nothing but the prompt built by the caller leaves the server.
 */
export async function runGoogleSuggestion(input: {
  actorId: string
  workspaceId: string
  surface: 'description' | 'review_reply'
  system: string
  user: string
}): Promise<Result<string>> {
  const feature = await assertFeature(input.workspaceId, 'crm.aiAssistant')
  if (!feature.ok) return feature

  const call = await AiUsageService.prepare(
    input.workspaceId,
    'CRM_ASSISTANT',
    input.actorId,
  )
  if (!call.ok) return call

  let text: string
  try {
    const response = await call.value.provider.chat({
      model: call.value.model.model,
      system: input.system,
      messages: [{ role: 'user', content: input.user }],
      jsonSchema: GOOGLE_SUGGESTION_JSON_SCHEMA,
      maxTokens: SUGGESTION_MAX_TOKENS,
    })
    await AiUsageService.record(call.value, {
      workspaceId: input.workspaceId,
      userId: input.actorId,
      usage: response.usage,
      scope: { module: 'CRM' },
    })
    text = response.text
  } catch (error) {
    logger.error('crm_google_ai.provider_failed', {
      component: 'CrmGoogleAi',
      workspaceId: input.workspaceId,
      surface: input.surface,
      provider: call.value.model.provider,
      model: call.value.model.model,
      message: error instanceof Error ? error.message : String(error),
    })
    return err(crmGoogleAiFailed())
  }

  const parsed = parseSdAiJson(GoogleSuggestionOutputSchema, text)
  if (!parsed?.suggestion.trim()) {
    logger.warn('crm_google_ai.invalid_output', {
      component: 'CrmGoogleAi',
      workspaceId: input.workspaceId,
      surface: input.surface,
      model: call.value.model.key,
    })
    return err(crmGoogleAiFailed())
  }
  return ok(parsed.suggestion)
}
