import { logger } from '@/lib/axiom/logger'
import { OPENAI_API_KEY, VOICE_AGENT_REALTIME_MODEL } from '@/lib/env/server'
import {
  type AudioChannel,
  VoiceCallBridge,
} from '@/src/lib/voice-agent/bridge'
import { latencyStats } from '@/src/lib/voice-agent/latency'
import {
  DEFAULT_REALTIME_MODEL,
  OpenAiRealtimeProvider,
} from '@/src/lib/voice-agent/openai-realtime'
import { buildVoiceInstructions } from '@/src/lib/voice-agent/prompt'
import type { RealtimeVoiceProvider } from '@/src/lib/voice-agent/provider'
import { createVoiceTools } from '@/src/lib/voice-agent/tools'
import { VoiceAgentService } from './voice-agent.service'

const SESSION_LANGUAGE = 'pt'

/** Flat log fields of the latency acceptance step (ADR 0046). */
function latencyFields(latenciesMs: readonly number[]) {
  const stats = latencyStats(latenciesMs)
  return {
    latencyTurns: stats.turns,
    latencyP50Ms: stats.p50Ms,
    latencyP95Ms: stats.p95Ms,
    latencyMaxMs: stats.maxMs,
  }
}

export interface VoiceSessionDeps {
  /** Builds the realtime provider; `null` = no key configured. */
  createProvider?: () => RealtimeVoiceProvider | null
}

function defaultProvider(): RealtimeVoiceProvider | null {
  if (!OPENAI_API_KEY) return null
  return new OpenAiRealtimeProvider({
    apiKey: OPENAI_API_KEY,
    model: VOICE_AGENT_REALTIME_MODEL ?? DEFAULT_REALTIME_MODEL,
  })
}

/**
 * One AudioSocket connection, from the session id to the stored outcome
 * (ADR 0046). Runs in the worker. Never throws: a bad id hangs the socket
 * up, a crash mid-call closes the call as failed, and in both cases the
 * dialplan's next question sends the caller to a person.
 */
export const VoiceAgentSessionService = {
  async handle(
    sessionId: string,
    channel: AudioChannel,
    deps: VoiceSessionDeps = {},
  ): Promise<void> {
    const base = { component: 'VoiceAgentSession' }
    let claimedCall: Awaited<
      ReturnType<typeof VoiceAgentService.claim>
    > | null = null
    try {
      claimedCall = await VoiceAgentService.claim(sessionId)
      if (!claimedCall.ok || !claimedCall.value) {
        logger.warn('voice_agent.session_rejected', {
          ...base,
          reason: claimedCall.ok
            ? 'unknown_or_expired'
            : claimedCall.error.code,
        })
        channel.hangup()
        return
      }
      const context = claimedCall.value
      const provider = (deps.createProvider ?? defaultProvider)()
      if (!provider) {
        await VoiceAgentService.fail(context.call, 'provider_unavailable')
        channel.hangup()
        return
      }

      const { settings, call } = context
      const tools = await createVoiceTools({
        workspaceId: call.workspaceId,
        runAsUserId: settings.runAsUserId as string,
        callId: call.id,
        callerNumber: call.destination,
        canOpenTickets: settings.canOpenTickets,
        canLookupTickets: settings.canLookupTickets,
        transferTarget: context.transferTarget,
      })

      logger.info('voice_agent.session_started', {
        ...base,
        workspaceId: call.workspaceId,
        callId: call.id,
        maxCallSeconds: context.maxCallSeconds,
      })
      const bridge = new VoiceCallBridge({
        channel,
        provider,
        config: {
          instructions: buildVoiceInstructions({
            workspaceName: context.workspaceName,
            instructions: settings.instructions,
            canOpenTickets: tools.definitions.some(
              (t) => t.name === 'open_ticket',
            ),
            canLookupTickets: tools.definitions.some(
              (t) => t.name === 'ticket_status',
            ),
            hasHumanFallback: Boolean(context.transferTarget),
          }),
          voice: settings.voice,
          tools: tools.definitions,
          language: SESSION_LANGUAGE,
        },
        notice: context.notice,
        tools: tools.executor,
        maxCallMs: context.maxCallSeconds * 1000,
        silenceMs: settings.silenceTimeoutSeconds * 1000,
        fallbackTarget: context.transferTarget,
      })
      const result = await bridge.run()

      const stored = await VoiceAgentService.complete(
        context,
        result,
        tools.state,
        provider.model,
      )
      logger.info('voice_agent.session_ended', {
        ...base,
        workspaceId: call.workspaceId,
        callId: call.id,
        endReason: result.endReason,
        durationMs: result.durationMs,
        transferred: Boolean(result.transfer),
        stored: stored.ok,
        ...latencyFields(result.latenciesMs),
      })
      // Hang up only after the outcome is stored: the dialplan asks for it
      // as soon as AudioSocket() returns.
      channel.hangup()
    } catch (cause) {
      logger.error('voice_agent.session_crashed', {
        ...base,
        message: cause instanceof Error ? cause.message : String(cause),
      })
      if (claimedCall?.ok && claimedCall.value) {
        await VoiceAgentService.fail(claimedCall.value.call, 'session_crashed')
      }
      channel.hangup()
    }
  },
}
