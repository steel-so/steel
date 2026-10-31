export type WhatsAppWidgetPositionDTO = 'RIGHT' | 'LEFT'

/** Admin view of the site chat widget settings (Comunicação). */
export interface WhatsAppWidgetSettingsDTO {
  workspaceId: string
  enabled: boolean
  publicKey: string
  allowedOrigins: string[]
  title: string
  welcomeMessage: string
  accentColor: string
  position: WhatsAppWidgetPositionDTO
  preChatEnabled: boolean
  preChatAskEmail: boolean
  preChatAskPhone: boolean
  offlineEnabled: boolean
  offlineMessage: string
  teamId: string | null
  showPortal: boolean
  showSurvey: boolean
  /** `<script>` the customer pastes on the site. */
  snippet: string
  /** Absolute URL of the portal link shown in the chat (when on). */
  portalUrl: string
}

/** Public look and behaviour, read by the script on the site. */
export interface WidgetPublicConfigDTO {
  title: string
  welcomeMessage: string
  accentColor: string
  position: WhatsAppWidgetPositionDTO
  preChatEnabled: boolean
  preChatAskEmail: boolean
  preChatAskPhone: boolean
  /** Inside the Comunicação business hours (always true when none is set). */
  online: boolean
  /** Shown to the visitor while offline; null when the notice is off. */
  offlineMessage: string | null
  portalUrl: string | null
}

export type WidgetMessageAuthorDTO = 'visitor' | 'agent' | 'ai'

export interface WidgetMessageDTO {
  id: string
  from: WidgetMessageAuthorDTO
  text: string
  createdAt: string
}

export type WidgetConversationStateDTO = 'NONE' | 'OPEN' | 'CLOSED'

export interface WidgetSurveyDTO {
  kind: 'NPS' | 'CSAT' | 'CES'
  question: string
  scaleMin: number
  scaleMax: number
}

export interface WidgetMessagesDTO {
  messages: WidgetMessageDTO[]
  conversation: WidgetConversationStateDTO
  /** Open survey of this visitor (only when the workspace asks it in the chat). */
  survey: WidgetSurveyDTO | null
}

export interface WidgetSendResultDTO {
  /** Visitor token, only on the first message (the script stores it). */
  token: string | null
}
