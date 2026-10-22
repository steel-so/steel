import type { VoiceAgentRoute, VoiceAgentSettings } from '@prisma/client'
import { DEFAULT_VOICE_NOTICE } from '@/src/lib/voice-agent/prompt'
import type {
  VoiceAgentRouteDTO,
  VoiceAgentSettingsDTO,
} from '@/types/voice-agent'

/** What a workspace without a saved row gets: the attendant is off. */
export const VOICE_AGENT_DEFAULTS = {
  enabled: false,
  noticeText: null,
  instructions: null,
  voice: 'alloy',
  maxCallSeconds: 300,
  monthlyMinutesCap: 300,
  silenceTimeoutSeconds: 20,
  runAsUserId: null,
  canOpenTickets: true,
  canLookupTickets: true,
  fallbackTarget: null,
  pabxSecretHash: null,
  pabxSecretHint: null,
} as const

export function toVoiceAgentSettingsDTO(
  workspaceId: string,
  row: VoiceAgentSettings | null,
  serverReady: boolean,
): VoiceAgentSettingsDTO {
  const settings = row ?? VOICE_AGENT_DEFAULTS
  return {
    workspaceId,
    enabled: settings.enabled,
    noticeText: settings.noticeText,
    effectiveNotice: settings.noticeText?.trim() || DEFAULT_VOICE_NOTICE,
    instructions: settings.instructions,
    voice: settings.voice,
    maxCallSeconds: settings.maxCallSeconds,
    monthlyMinutesCap: settings.monthlyMinutesCap,
    silenceTimeoutSeconds: settings.silenceTimeoutSeconds,
    runAsUserId: settings.runAsUserId,
    canOpenTickets: settings.canOpenTickets,
    canLookupTickets: settings.canLookupTickets,
    fallbackTarget: settings.fallbackTarget,
    pabxSecretConfigured: Boolean(settings.pabxSecretHash),
    pabxSecretHint: settings.pabxSecretHint,
    serverReady,
  }
}

export function toVoiceAgentRouteDTO(row: VoiceAgentRoute): VoiceAgentRouteDTO {
  return {
    id: row.id,
    kind: row.kind,
    value: row.value,
    label: row.label,
    enabled: row.enabled,
    transferTarget: row.transferTarget,
  }
}
