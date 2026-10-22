import type {
  WhatsAppPhoneCall,
  WhatsAppPhoneCallAiStatus,
  WhatsAppSentiment,
} from '@prisma/client'
import { logger } from '@/lib/axiom/logger'
import { getOpenAiClient } from '@/src/lib/ai'
import {
  UNTRUSTED_CONTENT_POLICY,
  wrapUntrusted,
} from '@/src/lib/ai/guardrails/injection'
import {
  priceTranscription,
  TRANSCRIPTION_MODEL,
  transcribeAudio,
} from '@/src/lib/ai/transcription'
import {
  PHONE_CALL_RECORDINGS_BUCKET,
  phoneMatchKey,
} from '@/src/lib/pabx/recording'
import { ok, type Result } from '@/src/lib/result'
import { getObject } from '@/src/lib/storage/s3'
import { publishWhatsAppEvent } from '@/src/lib/whatsapp/realtime'
import { toEffectiveAiSettings } from '@/src/mappers/ai-settings.mapper'
import { toWhatsAppPhoneCallDTO } from '@/src/mappers/whatsapp-phone-call.mapper'
import { toWhatsAppSettingsDTO } from '@/src/mappers/whatsapp-settings.mapper'
import {
  AiUsageRepository,
  WorkspaceAiSettingsRepository,
} from '@/src/repositories/ai-settings.repository'
import { PhoneCallLinkRepository } from '@/src/repositories/phone-call-link.repository'
import { WhatsAppPhoneCallRepository } from '@/src/repositories/whatsapp-phone-call.repository'
import { WhatsAppSettingsRepository } from '@/src/repositories/whatsapp-settings.repository'
import { AiUsageService, type PreparedAiCall } from './ai-usage.service'

/** Transcript characters sent to the summary model at most (~40 min). */
export const SUMMARY_TRANSCRIPT_CHAR_BUDGET = 60_000
/** Next steps kept from the summary. */
export const MAX_NEXT_STEPS = 5
const NEXT_STEP_MAX_CHARS = 200

const SUMMARY_JSON_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    sentiment: { type: 'string', enum: ['NEGATIVE', 'NEUTRAL', 'POSITIVE'] },
    score: { type: 'number' },
    nextSteps: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'sentiment', 'score', 'nextSteps'],
  additionalProperties: false,
}

const SUMMARY_SYSTEM_PROMPT = `Você recebe a transcrição automática de uma ligação telefônica entre um atendente de uma empresa e um cliente. A transcrição pode ter erros de reconhecimento e não separa quem fala.

Responda só com um JSON no formato {"summary": string, "sentiment": "NEGATIVE"|"NEUTRAL"|"POSITIVE", "score": number, "nextSteps": string[]}:
- summary: resumo objetivo em português, em até 5 frases: o motivo da ligação, o que foi combinado e o que ficou pendente.
- sentiment e score: o humor do cliente na ligação; score vai de -1 (muito negativo) a 1 (muito positivo).
- nextSteps: até ${MAX_NEXT_STEPS} próximos passos concretos que a empresa precisa fazer, cada um começando por um verbo no infinitivo (ex.: "Enviar a segunda via do boleto"). Lista vazia se não houver.

Use apenas o que está na transcrição. Não invente nomes, valores, datas ou prazos.`

export interface CallSummary {
  summary: string
  sentiment: WhatsAppSentiment
  score: number
  nextSteps: string[]
}

export type PhoneCallAiOutcome =
  | { status: 'ignored'; reason: 'call_not_found' | 'not_pending' }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; reason: 'transcription_failed'; detail: string }
  | {
      status: 'done'
      callId: string
      workspaceId: string
      summarized: boolean
      links: {
        sdTicketId: string | null
        crmPersonId: string | null
        crmOpportunityId: string | null
      }
    }

export function parseCallSummary(content: string): CallSummary | null {
  try {
    const parsed = JSON.parse(content)
    if (
      typeof parsed?.summary !== 'string' ||
      !parsed.summary.trim() ||
      !['NEGATIVE', 'NEUTRAL', 'POSITIVE'].includes(parsed.sentiment) ||
      typeof parsed.score !== 'number' ||
      !Array.isArray(parsed.nextSteps)
    )
      return null
    return {
      summary: parsed.summary.trim(),
      sentiment: parsed.sentiment,
      score: Math.max(-1, Math.min(1, parsed.score)),
      nextSteps: parsed.nextSteps
        .filter((step: unknown): step is string => typeof step === 'string')
        .map((step: string) => step.trim().slice(0, NEXT_STEP_MAX_CHARS))
        .filter(Boolean)
        .slice(0, MAX_NEXT_STEPS),
    }
  } catch {
    return null
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function finish(
  call: WhatsAppPhoneCall,
  status: WhatsAppPhoneCallAiStatus,
  reason: string | null,
): Promise<Result<WhatsAppPhoneCall>> {
  const updated = await WhatsAppPhoneCallRepository.update(call.id, {
    aiStatus: status,
    aiSkipReason: reason,
  })
  if (!updated.ok) return updated
  await publishWhatsAppEvent(call.workspaceId, {
    type: 'phone-call.updated',
    call: toWhatsAppPhoneCallDTO(updated.value),
  })
  return updated
}

/**
 * Why the AI step cannot run for this workspace, or `null` when it can.
 * `voice` = a call of the IVR attendant (ADR 0046): the transcript already
 * exists, so the recorded-call transcription switch and the Whisper key do
 * not apply.
 */
async function blocker(
  workspaceId: string,
  voice = false,
): Promise<
  Result<
    | { reason: string }
    | {
        call: PreparedAiCall
        client: ReturnType<typeof getOpenAiClient>
      }
  >
> {
  if (!voice) {
    const zap = await WhatsAppSettingsRepository.findByWorkspace(workspaceId)
    if (!zap.ok) return zap
    if (!toWhatsAppSettingsDTO(workspaceId, zap.value).callTranscriptionEnabled)
      return ok({ reason: 'transcription_disabled' })
  }

  const ai = await WorkspaceAiSettingsRepository.findByWorkspace(workspaceId)
  if (!ai.ok) return ai
  if (!toEffectiveAiSettings(ai.value).aiEnabled)
    return ok({ reason: 'ai_disabled' })

  const client = getOpenAiClient()
  if (!client && !voice) return ok({ reason: 'no_transcription_provider' })

  const prepared = await AiUsageService.prepare(workspaceId, 'PHONE_CALL_AI')
  if (!prepared.ok) {
    return ok({
      reason:
        prepared.error.code === 'AI_QUOTA_EXCEEDED'
          ? 'ai_quota_exceeded'
          : 'ai_provider_unavailable',
    })
  }
  return ok({ call: prepared.value, client })
}

/** Ledger row of the transcription: priced per minute, not per token. */
async function recordTranscription(
  call: WhatsAppPhoneCall,
  prepared: PreparedAiCall,
  seconds: number,
): Promise<void> {
  const saved = await AiUsageRepository.record({
    workspaceId: call.workspaceId,
    userId: call.userId,
    feature: 'PHONE_CALL_AI',
    provider: 'openai',
    model: TRANSCRIPTION_MODEL,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: priceTranscription(seconds, prepared.costMargin ?? 1),
    module: 'COMMUNICATION',
  })
  if (!saved.ok) {
    logger.error('phone_call.transcription_usage_failed', {
      component: 'PhoneCallAiService',
      workspaceId: call.workspaceId,
      callId: call.id,
      message: saved.error.message,
    })
  }
}

async function summarize(
  call: WhatsAppPhoneCall,
  prepared: PreparedAiCall,
  transcript: string,
): Promise<CallSummary | null> {
  try {
    const response = await prepared.provider.chat({
      model: prepared.model.model,
      system: `${SUMMARY_SYSTEM_PROMPT}\n\n${UNTRUSTED_CONTENT_POLICY}`,
      messages: [
        {
          role: 'user',
          content: wrapUntrusted(
            transcript.slice(0, SUMMARY_TRANSCRIPT_CHAR_BUDGET),
            'phone_call',
          ),
        },
      ],
      jsonSchema: { name: 'call_summary', schema: SUMMARY_JSON_SCHEMA },
    })
    await AiUsageService.record(prepared, {
      workspaceId: call.workspaceId,
      userId: call.userId,
      usage: response.usage,
      scope: { module: 'COMMUNICATION' },
    })
    const parsed = parseCallSummary(response.text)
    if (!parsed) {
      logger.warn('phone_call.summary_unparseable', {
        component: 'PhoneCallAiService',
        workspaceId: call.workspaceId,
        callId: call.id,
      })
    }
    return parsed
  } catch (error) {
    logger.error('phone_call.summary_failed', {
      component: 'PhoneCallAiService',
      workspaceId: call.workspaceId,
      callId: call.id,
      provider: prepared.model.provider,
      model: prepared.model.model,
      message: errorMessage(error),
    })
    return null
  }
}

/** A lookup that fails only loses that link; the summary still lands. */
function linkOrNull(
  result: Result<string | null>,
  call: WhatsAppPhoneCall,
  link: string,
): string | null {
  if (result.ok) return result.value
  logger.warn('phone_call.link_lookup_failed', {
    component: 'PhoneCallAiService',
    workspaceId: call.workspaceId,
    callId: call.id,
    link,
  })
  return null
}

async function resolveLinks(call: WhatsAppPhoneCall) {
  const sdTicketId = linkOrNull(
    await PhoneCallLinkRepository.findTicketForConversation(
      call.workspaceId,
      call.conversationId,
    ),
    call,
    'sd_ticket',
  )
  const key = phoneMatchKey(call.destination)
  const crmPersonId = key
    ? linkOrNull(
        await PhoneCallLinkRepository.findPersonByPhoneKey(
          call.workspaceId,
          key,
        ),
        call,
        'crm_person',
      )
    : null
  const crmOpportunityId = crmPersonId
    ? linkOrNull(
        await PhoneCallLinkRepository.findOpenOpportunityForPerson(
          call.workspaceId,
          crmPersonId,
        ),
        call,
        'crm_opportunity',
      )
    : null
  return { sdTicketId, crmPersonId, crmOpportunityId }
}

/**
 * Turns an uploaded call recording into information (ADR 0043): Whisper
 * transcript, then summary, sentiment and next steps by the workspace model,
 * and the records the call belongs to. System flow (worker, no user):
 * respects the transcription switch, the Steel AI switch and the monthly
 * quota; every provider call lands in the AI usage as `PHONE_CALL_AI`.
 */
export const PhoneCallAiService = {
  async process(callId: string): Promise<Result<PhoneCallAiOutcome>> {
    const found = await WhatsAppPhoneCallRepository.findById(callId)
    if (!found.ok) return found
    const call = found.value
    if (!call) return ok({ status: 'ignored', reason: 'call_not_found' })
    // PROCESSING is accepted too: a retry after a crash mid-way.
    if (call.aiStatus !== 'PENDING' && call.aiStatus !== 'PROCESSING')
      return ok({ status: 'ignored', reason: 'not_pending' })
    // A voice-attendant call (ADR 0046) arrives with its transcript from the
    // realtime session and has no audio: only the summary step is left.
    const voiceTranscript =
      call.voiceAgent && call.transcript ? call.transcript : null
    if (!call.recordingKey && !voiceTranscript) {
      const done = await finish(call, 'SKIPPED', 'no_recording')
      if (!done.ok) return done
      return ok({ status: 'skipped', reason: 'no_recording' })
    }

    const gate = await blocker(call.workspaceId, Boolean(voiceTranscript))
    if (!gate.ok) return gate
    if ('reason' in gate.value) {
      const done = await finish(call, 'SKIPPED', gate.value.reason)
      if (!done.ok) return done
      return ok({ status: 'skipped', reason: gate.value.reason })
    }
    const { call: prepared, client } = gate.value

    const processing = await WhatsAppPhoneCallRepository.update(call.id, {
      aiStatus: 'PROCESSING',
    })
    if (!processing.ok) return processing

    let transcription: { text: string; durationSeconds?: number | null } | null
    if (voiceTranscript) {
      transcription = { text: voiceTranscript }
    } else {
      // Storage errors throw on purpose: the job retries (BullMQ attempts).
      const audio = await getObject({
        bucket: PHONE_CALL_RECORDINGS_BUCKET,
        key: call.recordingKey as string,
      })
      const key = call.recordingKey as string
      const ext = key.slice(key.lastIndexOf('.') + 1)

      try {
        transcription = await transcribeAudio(
          client as NonNullable<typeof client>,
          audio,
          `call.${ext}`,
          { language: 'pt', withDuration: true },
        )
      } catch (error) {
        const detail = errorMessage(error)
        logger.error('phone_call.transcription_failed', {
          component: 'PhoneCallAiService',
          workspaceId: call.workspaceId,
          callId: call.id,
          message: detail,
        })
        const done = await finish(call, 'FAILED', 'transcription_failed')
        if (!done.ok) return done
        return ok({ status: 'failed', reason: 'transcription_failed', detail })
      }

      await recordTranscription(
        call,
        prepared,
        transcription?.durationSeconds ?? call.durationSeconds ?? 0,
      )
      if (!transcription) {
        const done = await finish(call, 'SKIPPED', 'empty_transcript')
        if (!done.ok) return done
        return ok({ status: 'skipped', reason: 'empty_transcript' })
      }
    }

    // PII masking and provider failover run inside the guarded provider
    // from AiUsageService.prepare (ADR 0041/0042); the speech is fenced.
    const summary = await summarize(call, prepared, transcription.text)
    const resolved = await resolveLinks(call)
    // The ticket the voice attendant opened stays when the conversation has none.
    const links = {
      ...resolved,
      sdTicketId: resolved.sdTicketId ?? call.sdTicketId,
    }

    const updated = await WhatsAppPhoneCallRepository.update(call.id, {
      aiStatus: 'DONE',
      aiSkipReason: summary ? null : 'summary_failed',
      transcript: transcription.text,
      summary: summary?.summary ?? null,
      sentiment: summary?.sentiment ?? null,
      sentimentScore: summary?.score ?? null,
      nextSteps: summary?.nextSteps ?? [],
      aiModel: summary ? prepared.model.key : null,
      aiProcessedAt: new Date(),
      ...links,
    })
    if (!updated.ok) return updated

    logger.info('phone_call.ai_done', {
      component: 'PhoneCallAiService',
      workspaceId: call.workspaceId,
      callId: call.id,
      summarized: Boolean(summary),
      transcriptChars: transcription.text.length,
      ...links,
    })
    await publishWhatsAppEvent(call.workspaceId, {
      type: 'phone-call.updated',
      call: toWhatsAppPhoneCallDTO(updated.value),
    })
    return ok({
      status: 'done',
      callId: call.id,
      workspaceId: call.workspaceId,
      summarized: Boolean(summary),
      links,
    })
  },
}
