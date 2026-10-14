export type WhatsAppTeamRoleDTO = 'LEADER' | 'AGENT'

export interface WhatsAppTeamMemberDTO {
  userId: string
  name: string
  email: string
  image: string | null
  role: WhatsAppTeamRoleDTO
}

export interface WhatsAppTeamDTO {
  id: string
  workspaceId: string
  name: string
  description: string | null
  members: WhatsAppTeamMemberDTO[]
  createdAt: string
  updatedAt: string
}

/** How the viewer sees conversations — `GET /whatsapp/teams/me`. */
export interface WhatsAppConversationScopeDTO {
  /** ALL = owner, or admin outside any team. */
  mode: 'ALL' | 'SCOPED'
  /** Teams the viewer leads (sees their agents' conversations). */
  leadsTeamIds: string[]
  /** Teams the viewer belongs to (their queues are visible). */
  memberTeamIds: string[]
}
