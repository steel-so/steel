/** Provider price of a catalog model and what workspaces pay (× margin). */
export interface PlatformAiModelPriceDTO {
  key: string
  provider: 'openai' | 'anthropic'
  label: string
  /** Provider list price, US$ per 1M tokens. */
  inputUsdPer1M: number
  outputUsdPer1M: number
  cachedInputUsdPer1M: number | null
  /** Price × margin, US$ per 1M tokens. */
  chargedInputUsdPer1M: number
  chargedOutputUsdPer1M: number
}

/** Global admin view of the platform AI settings. */
export interface PlatformAiSettingsDTO {
  costMargin: number
  /** ISO date of the last change, null while on defaults. */
  updatedAt: string | null
  models: PlatformAiModelPriceDTO[]
  /** Knowledge search embeddings switch (ADR 0037). */
  embeddingsEnabled: boolean
  /** Live state of the knowledge search on this deployment. */
  knowledgeSearch: PlatformKnowledgeSearchStatusDTO
  /**
   * Default model of each task class (ADR 0042) for workspaces that did not
   * choose one. Null = the platform default model (agents: the assistant's).
   */
  taskModels: Record<
    'CLASSIFICATION' | 'CONVERSATION' | 'ASSISTANT' | 'AGENT',
    string | null
  >
  /** Platform-wide switch of the provider failover. */
  failoverEnabled: boolean
}

export interface PlatformKnowledgeSearchStatusDTO {
  /** `OPENAI_API_KEY` is set (the embedding provider). */
  providerConfigured: boolean
  /** The database has pgvector and the embeddings table. */
  vectorIndexReady: boolean
  /** What a search runs right now. */
  mode: 'hybrid' | 'text'
}
