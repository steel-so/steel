import type { Server } from 'node:net'
import { logger } from '../lib/axiom/logger'
import {
  VOICE_AGENT_AUDIOSOCKET_HOST,
  VOICE_AGENT_AUDIOSOCKET_PORT,
} from '../lib/env/server'
import { createAudioSocketServer } from '../src/lib/voice-agent/server'
import { VoiceAgentRepository } from '../src/repositories/voice-agent.repository'
import { VoiceAgentSessionService } from '../src/services/voice-agent-session.service'

/** Voice calls older than this and still open belong to a dead worker. */
const STALE_SESSION_MS = 60 * 60 * 1000

/**
 * Starts the AudioSocket server of the IVR voice attendant (ADR 0046).
 * Inert without `VOICE_AGENT_AUDIOSOCKET_PORT`.
 */
export async function startVoiceAgentServer(): Promise<Server | null> {
  if (!VOICE_AGENT_AUDIOSOCKET_PORT) return null

  const now = new Date()
  const swept = await VoiceAgentRepository.failStaleSessions(
    new Date(now.getTime() - STALE_SESSION_MS),
    now,
  )
  if (swept.ok && swept.value > 0) {
    logger.warn('voice_agent.stale_sessions_closed', {
      component: 'VoiceAgentServer',
      count: swept.value,
    })
  }

  const server = createAudioSocketServer({
    port: VOICE_AGENT_AUDIOSOCKET_PORT,
    host: VOICE_AGENT_AUDIOSOCKET_HOST,
    onSession: (sessionId, channel) => {
      void VoiceAgentSessionService.handle(sessionId, channel)
    },
    onError: (error) =>
      logger.error('voice_agent.server_error', {
        component: 'VoiceAgentServer',
        message: error.message,
      }),
  })
  logger.info('voice_agent.server_listening', {
    component: 'VoiceAgentServer',
    host: VOICE_AGENT_AUDIOSOCKET_HOST,
    port: VOICE_AGENT_AUDIOSOCKET_PORT,
  })
  return server
}
