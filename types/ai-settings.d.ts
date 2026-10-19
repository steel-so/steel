export interface AiProviderStatusDTO {
  id: 'openai' | 'anthropic'
  label: string
  /** `false` quando a chave de API da plataforma não está configurada. */
  available: boolean
}

export interface AiModelOptionDTO {
  key: string
  provider: 'openai' | 'anthropic'
  model: string
  label: string
  available: boolean
  enabled: boolean
  /** What the workspace pays, US$ per 1M tokens (provider price × margin). */
  inputUsdPer1M: number
  outputUsdPer1M: number
}

export interface AiUsageSummaryDTO {
  /** Início do ciclo de cobrança (1º dia do mês, UTC). */
  periodStart: string
  inputTokens: number
  outputTokens: number
  usedUsd: number
  remainingUsd: number
  exceeded: boolean
}

export interface WorkspaceAiSettingsDTO {
  workspaceId: string
  providers: AiProviderStatusDTO[]
  models: AiModelOptionDTO[]
  enabledModels: string[]
  crmAssistantModel: string
  whatsappReplyModel: string
  whatsappSentimentModel: string
  monthlyQuotaUsd: number
  /** Steel AI agent mode (write tools, always confirmed). Admin switch. */
  agentModeEnabled: boolean
  /** Master switch of every Steel AI feature (admin). */
  aiEnabled: boolean
  /** Steel Agents may run (admin). */
  agentsEnabled: boolean
  /** Steel AI may save and use memories (admin). */
  memoryEnabled: boolean
  /** Autopilot allowed: writes run without confirmation (admin, off by default). */
  autopilotEnabled: boolean
  /** Weekly usage summary e-mailed to the owners (admin, on by default). */
  usageWeeklyEmailEnabled: boolean
  /**
   * External AI clients connected over MCP with `mcp:write` may create,
   * update and run actions; DELETE is never exposed (admin, off by default).
   */
  mcpWriteEnabled: boolean
  /**
   * Model of the Steel Agents task class (ADR 0042). Null = the platform
   * default for agents, else the assistant model.
   */
  agentModel: string | null
  /** Automatic failover to another provider/model when one fails. */
  failoverEnabled: boolean
  usage: AiUsageSummaryDTO
  /** Modelo escolhido pelo usuário atual (`null` = segue o padrão). */
  userPreference: string | null
  /** O usuário atual pode alterar os ajustes do workspace (OWNER/ADMIN). */
  canManage: boolean
}
