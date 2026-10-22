export type VoiceAgentRouteKindDTO = 'QUEUE' | 'DID'

export interface VoiceAgentSettingsDTO {
  workspaceId: string
  enabled: boolean
  noticeText: string | null
  /** Notice actually spoken: the workspace text, else the platform default. */
  effectiveNotice: string
  instructions: string | null
  voice: string
  maxCallSeconds: number
  monthlyMinutesCap: number
  silenceTimeoutSeconds: number
  runAsUserId: string | null
  canOpenTickets: boolean
  canLookupTickets: boolean
  fallbackTarget: string | null
  /** The dialplan secret exists; only its last characters are shown. */
  pabxSecretConfigured: boolean
  pabxSecretHint: string | null
  /** The server can run the attendant (OpenAI key and AudioSocket port). */
  serverReady: boolean
}

export interface VoiceAgentRouteDTO {
  id: string
  kind: VoiceAgentRouteKindDTO
  value: string
  label: string | null
  enabled: boolean
  transferTarget: string | null
}

export interface VoiceAgentUsageDTO {
  /** Minutes the attendant talked this month (UTC month, like the AI quota). */
  minutesUsed: number
  minutesCap: number
  calls: number
  periodStart: string
}

/** Returned once, when the dialplan secret is generated or rotated. */
export interface VoiceAgentSecretDTO {
  secret: string
  hint: string
}
