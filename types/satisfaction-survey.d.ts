export type SurveyKindDTO = 'NPS' | 'CSAT' | 'CES'
export type SurveyTriggerDTO = 'CONVERSATION_CLOSED' | 'TICKET_RESOLVED' | 'MANUAL'
export type SurveyChannelDTO = 'WHATSAPP' | 'EMAIL'
export type SurveyStatusDTO =
  | 'SCHEDULED'
  | 'SENT'
  | 'ANSWERED'
  | 'SKIPPED'
  | 'FAILED'

export interface SurveyConfigDTO {
  trigger: Exclude<SurveyTriggerDTO, 'MANUAL'>
  kind: SurveyKindDTO
  enabled: boolean
  delayMinutes: number
  expiresInHours: number
  cooldownDays: number
  emailFallback: boolean
  questionText: string | null
  thankYouText: string | null
}

export interface SurveyDTO {
  id: string
  kind: SurveyKindDTO
  trigger: SurveyTriggerDTO
  channel: SurveyChannelDTO
  status: SurveyStatusDTO
  conversationId: string | null
  ticketId: string | null
  recipientName: string | null
  customerName: string | null
  assigneeName: string | null
  teamName: string | null
  score: number | null
  comment: string | null
  failureReason: string | null
  sentAt: string | null
  answeredAt: string | null
  createdAt: string
}

export interface SurveyListDTO {
  items: SurveyDTO[]
  total: number
  page: number
  pageSize: number
}

export interface SurveyReportRowDTO {
  key: string
  name: string
  sent: number
  answered: number
  responseRate: number | null
  average: number | null
  nps: number | null
  csat: number | null
  ces: number | null
  promoters: number
  passives: number
  detractors: number
}

export interface SurveyReportDTO {
  kind: SurveyKindDTO
  groupBy: 'agent' | 'team' | 'technician' | 'customer'
  from: string | null
  to: string | null
  total: SurveyReportRowDTO
  rows: SurveyReportRowDTO[]
}

/** What the public (e-mail) page shows for a token. */
export interface PublicSurveyDTO {
  kind: SurveyKindDTO
  question: string
  scaleMin: number
  scaleMax: number
  workspaceName: string
  state: 'OPEN' | 'ANSWERED' | 'EXPIRED'
}
