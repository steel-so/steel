import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { consume, whatsappWebhookLimiter } from '@/src/lib/rate-limit'
import { getClientIp } from '@/src/lib/rate-limit-helpers'
import { PabxVoiceSessionSchema } from '@/src/schemas/voice-agent.schema'
import { VoiceAgentService } from '@/src/services/voice-agent.service'
import { handleError, standardError } from '@/utils/http-response'

function plain(body: string): Response {
  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}

/**
 * First question of the voice attendant dialplan (Asterisk `CURL()`, form
 * body, ADR 0046): may the AI take this call? Answers `OK:<session-uuid>` —
 * the id the dialplan hands to `AudioSocket()` — or `NO:<reason>`, and the
 * dialplan keeps its human path. Public: the workspace secret authenticates.
 */
export const POST = withAxiom(async (request: NextRequest) => {
  const limit = await consume(
    whatsappWebhookLimiter,
    `pabx-voice:${getClientIp(request)}`,
  )
  if (!limit.ok) return handleError(limit.error)

  const form = await request.formData().catch(() => null)
  const parsed = PabxVoiceSessionSchema.safeParse(
    form ? Object.fromEntries(form) : {},
  )
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await VoiceAgentService.startSession(parsed.data)
  if (!result.ok) return handleError(result.error)

  return plain(
    result.value.started
      ? `OK:${result.value.sessionId}`
      : `NO:${result.value.reason}`,
  )
})
