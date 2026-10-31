export type AiActionConnectorKindDTO = 'LOOKUP' | 'ACTION'

export interface AiActionParamDTO {
  name: string
  description: string
  required: boolean
}

/** Connector as the settings screen sees it: header values never leave. */
export interface AiActionConnectorDTO {
  id: string
  key: string
  name: string
  description: string
  kind: AiActionConnectorKindDTO
  method: string
  urlTemplate: string
  /** Names only — the values are encrypted and never returned. */
  headerNames: string[]
  params: AiActionParamDTO[]
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface AiActionZapToolDTO {
  toolName: string
  mode: 'AUTO' | 'APPROVAL'
}

export interface AiActionSettingsDTO {
  enabled: boolean
  zapTools: AiActionZapToolDTO[]
  zapActorId: string | null
}

export interface AiActionConnectorsDTO {
  connectors: AiActionConnectorDTO[]
  settings: AiActionSettingsDTO
  limit: number
}
