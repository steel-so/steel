import type { SdUserSummaryDTO } from './sd-ticket'

export type SdSwarmStatusDTO = 'OPEN' | 'CLOSED'
export type SdSwarmMemberStatusDTO = 'INVITED' | 'JOINED' | 'DECLINED'

/** NONE = no channel asked; FAILED = asked but Slack refused (see `error`). */
export type SdSwarmSlackStatusDTO = 'NONE' | 'ACTIVE' | 'ARCHIVED' | 'FAILED'

export interface SdSwarmMemberDTO {
  user: SdUserSummaryDTO
  status: SdSwarmMemberStatusDTO
  invitedAt: string
  respondedAt: string | null
}

export interface SdSwarmDTO {
  id: string
  ticketId: string
  status: SdSwarmStatusDTO
  reason: string
  outcome: string | null
  startedBy: SdUserSummaryDTO | null
  closedBy: SdUserSummaryDTO | null
  startedAt: string
  closedAt: string | null
  members: SdSwarmMemberDTO[]
  slack: {
    status: SdSwarmSlackStatusDTO
    channelName: string | null
    error: string | null
  }
}

export interface SdSwarmListDTO {
  items: SdSwarmDTO[]
  /** The workspace has a live Slack connection and the app is configured. */
  slackAvailable: boolean
  /** Max specialists per swarm. */
  maxMembers: number
}
