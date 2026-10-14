export type SdTicketTypeDTO =
  | 'INCIDENT'
  | 'SERVICE_REQUEST'
  | 'CHANGE'
  | 'PROBLEM'

export type SdTicketPrefixesDTO = Record<SdTicketTypeDTO, string>

/** Configuração geral do ServiceDesk (1:1 com a workspace). */
export interface SdSettingsDTO {
  id: string
  workspaceId: string
  nextTicketNumber: number
  ticketPrefixes: SdTicketPrefixesDTO
  defaultDepartmentId: string | null
  defaultSlaPolicyId: string | null
  whatsappConnectionId: string | null
  /** Chamado aberto pelo WhatsApp responde ao contato com o código. */
  whatsappSendAcknowledgement: boolean
  portalEnabled: boolean
  portalTicketTypes: SdTicketTypeDTO[]
  /** Portal externo: o contato vê os chamados das empresas dele. */
  portalCompanyScope: boolean
  requireSignatureOnClose: boolean
  requireSolutionOnResolve: boolean
  autoCloseResolvedAfterHours: number
  slaAtRiskPercent: number
  reopenOnRequesterReply: boolean
  autoAssignRoundRobin: boolean
  /** KCS: validade padrão (em dias) da revisão dos artigos da base. */
  kbReviewIntervalDays: number
  aiEnabled: boolean
  aiPreServiceEnabled: boolean
  aiAutoTriageEnabled: boolean
  aiWhatsappAutoReply: boolean
  aiPersona: string | null
  aiInstructions: string | null
  aiHandoffKeywords: string[]
  updatedById: string | null
  createdAt: string
  updatedAt: string
}

/** Recorte público da configuração (solicitantes / bootstrap). */
export type SdPublicSettingsDTO = Pick<
  SdSettingsDTO,
  | 'ticketPrefixes'
  | 'portalEnabled'
  | 'portalTicketTypes'
  | 'portalCompanyScope'
  | 'requireSignatureOnClose'
  | 'requireSolutionOnResolve'
  | 'reopenOnRequesterReply'
  | 'slaAtRiskPercent'
  | 'defaultDepartmentId'
  | 'aiEnabled'
  | 'aiPreServiceEnabled'
>
