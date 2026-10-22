import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { consume, whatsappWebhookLimiter } from '@/src/lib/rate-limit'
import { getClientIp } from '@/src/lib/rate-limit-helpers'
import { PabxVoiceOutcomeSchema } from '@/src/schemas/voice-agent.schema'
import { VoiceAgentService } from '@/src/services/voice-agent.service'
import { handleError, standardError } from '@/utils/http-response'

function plain(body: string): Response {
  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}

/**
 * Second question of the dialplan, after `AudioSocket()` returns: where does
 * the call go? Answers `TRANSFER|<extension or queue>` or `HANGUP`. The
 * transfer itself is always done by Asterisk.
 */
export const POST = withAxiom(async (request: NextRequest) => {
  const limit = await consume(
    whatsappWebhookLimiter,
    `pabx-voice:${getClientIp(request)}`,
  )
  if (!limit.ok) return handleError(limit.error)

  const form = await request.formData().catch(() => null)
  const parsed = PabxVoiceOutcomeSchema.safeParse(
    form ? Object.fromEntries(form) : {},
  )
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await VoiceAgentService.outcome(parsed.data)
  if (!result.ok) return handleError(result.error)

  return plain(
    result.value.transferTarget
      ? `TRANSFER|${result.value.transferTarget}`
      : 'HANGUP',
  )
})
