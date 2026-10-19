/**
 * Catálogo de provedores/modelos de IA oferecidos pela plataforma. Módulo
 * isomórfico (sem SDK, sem env) — importado pelo schema Zod, pelos services
 * e pela UI de ajustes. Um modelo é identificado por uma `AiModelKey` no
 * formato `"<provider>:<model>"`, que é o valor persistido no banco.
 */
export const AI_PROVIDERS = ['openai', 'anthropic'] as const
export type AiProviderId = (typeof AI_PROVIDERS)[number]

export const AI_PROVIDER_LABELS: Record<AiProviderId, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic (Claude)',
}

/** Funcionalidades de produto que consomem IA. */
export const AI_FEATURES = [
  'CRM_ASSISTANT',
  'WHATSAPP_REPLY',
  'WHATSAPP_SENTIMENT',
] as const
export type AiFeature = (typeof AI_FEATURES)[number]

export const AI_FEATURE_LABELS: Record<AiFeature, string> = {
  CRM_ASSISTANT: 'Steel AI (assistente)',
  WHATSAPP_REPLY: 'Resposta automática do WhatsApp',
  WHATSAPP_SENTIMENT: 'Análise de sentimento do WhatsApp',
}

/** Provider list price in US$ per 1 million tokens. */
export interface AiModelPricing {
  inputUsdPer1M: number
  outputUsdPer1M: number
  /** Price of input tokens served from the provider cache, when it reports them. */
  cachedInputUsdPer1M?: number
}

export interface AiModelDefinition {
  key: string
  provider: AiProviderId
  model: string
  label: string
  /** Absent only for definitions built outside the catalog (tests, legacy). */
  pricing?: AiModelPricing
}

/*
 * Prices (standard tier, text, US$ per 1M tokens), checked on 2026-10-06:
 * - OpenAI: https://developers.openai.com/api/docs/pricing ("short context"
 *   input / cached input / output).
 * - Anthropic: platform.claude.com pricing (model table cached 2026-09-25 in
 *   the official claude-api reference); cache reads cost 0.1x the input.
 * Update this table when a provider changes prices — `AiUsage.costUsd` is
 * frozen at call time, so past usage keeps the price it was charged with.
 */
export const AI_MODEL_CATALOG = [
  {
    key: 'openai:gpt-4o-mini',
    provider: 'openai',
    model: 'gpt-4o-mini',
    label: 'GPT-4o mini',
    pricing: {
      inputUsdPer1M: 0.15,
      outputUsdPer1M: 0.6,
      cachedInputUsdPer1M: 0.075,
    },
  },
  {
    key: 'openai:gpt-4.1-mini',
    provider: 'openai',
    model: 'gpt-4.1-mini',
    label: 'GPT-4.1 mini',
    pricing: {
      inputUsdPer1M: 0.4,
      outputUsdPer1M: 1.6,
      cachedInputUsdPer1M: 0.1,
    },
  },
  {
    key: 'openai:gpt-5-mini',
    provider: 'openai',
    model: 'gpt-5-mini',
    label: 'GPT-5 mini',
    pricing: {
      inputUsdPer1M: 0.25,
      outputUsdPer1M: 2,
      cachedInputUsdPer1M: 0.025,
    },
  },
  {
    key: 'openai:gpt-5',
    provider: 'openai',
    model: 'gpt-5',
    label: 'GPT-5',
    pricing: {
      inputUsdPer1M: 1.25,
      outputUsdPer1M: 10,
      cachedInputUsdPer1M: 0.125,
    },
  },
  {
    key: 'anthropic:claude-haiku-4-5',
    provider: 'anthropic',
    model: 'claude-haiku-4-5',
    label: 'Claude Haiku 4.5',
    pricing: { inputUsdPer1M: 1, outputUsdPer1M: 5, cachedInputUsdPer1M: 0.1 },
  },
  {
    key: 'anthropic:claude-sonnet-5',
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    label: 'Claude Sonnet 5',
    pricing: {
      inputUsdPer1M: 2,
      outputUsdPer1M: 10,
      cachedInputUsdPer1M: 0.2,
    },
  },
  {
    key: 'anthropic:claude-opus-5',
    provider: 'anthropic',
    model: 'claude-opus-5',
    label: 'Claude Opus 5',
    pricing: {
      inputUsdPer1M: 5,
      outputUsdPer1M: 25,
      cachedInputUsdPer1M: 0.5,
    },
  },
] as const satisfies readonly AiModelDefinition[]

export type AiModelKey = (typeof AI_MODEL_CATALOG)[number]['key']

export const AI_MODEL_KEYS = AI_MODEL_CATALOG.map((m) => m.key) as [
  AiModelKey,
  ...AiModelKey[],
]

/**
 * Padrão da plataforma: mantém o comportamento anterior (tudo em
 * `gpt-4o-mini`) para workspaces que ainda não configuraram a IA.
 */
export const DEFAULT_AI_MODEL_KEY: AiModelKey = 'openai:gpt-4o-mini'

/**
 * @deprecated Old fixed cost rule (1000 tokens = US$ 4,00), replaced by the
 * per-model price × platform margin (ADR 0019). Only the default of the
 * legacy `usd_per_1k_tokens` column.
 */
export const DEFAULT_USD_PER_1K_TOKENS = 4

/**
 * Pricing for a model outside the catalog (removed from it, or a call
 * built by hand): the most expensive catalog price, so an unknown model is
 * never under-charged.
 */
export const FALLBACK_AI_MODEL_PRICING: AiModelPricing = AI_MODEL_CATALOG.map(
  (m): AiModelPricing => m.pricing,
).reduce((max, p) =>
  p.inputUsdPer1M + p.outputUsdPer1M > max.inputUsdPer1M + max.outputUsdPer1M
    ? p
    : max,
)

/** Default platform margin over the provider price (1 = at cost). */
export const DEFAULT_AI_COST_MARGIN = 1
export const MIN_AI_COST_MARGIN = 0.1
export const MAX_AI_COST_MARGIN = 100

/**
 * Cota mensal padrão por workspace: US$ 50,00 de custo real (preço do
 * provedor × margem da plataforma). O admin do workspace pode alterar em
 * Ajustes > Steel IA.
 */
export const DEFAULT_MONTHLY_QUOTA_USD = 50

/** Teto aceito para a cota configurável (evita valores absurdos por engano). */
export const MAX_MONTHLY_QUOTA_USD = 1_000_000

const CATALOG_BY_KEY = new Map<string, AiModelDefinition>(
  AI_MODEL_CATALOG.map((m) => [m.key, m]),
)

export function findAiModel(key: string): AiModelDefinition | undefined {
  return CATALOG_BY_KEY.get(key)
}

export function isAiModelKey(key: string): key is AiModelKey {
  return CATALOG_BY_KEY.has(key)
}

/** Price of a model: catalog first, then its own, then the fallback. */
export function aiModelPricing(model: {
  key: string
  pricing?: AiModelPricing
}): AiModelPricing {
  return (
    CATALOG_BY_KEY.get(model.key)?.pricing ??
    model.pricing ??
    FALLBACK_AI_MODEL_PRICING
  )
}

/*
 * Task classes (ADR 0042): every AI feature belongs to one, and each class
 * has its own model — cheap and fast for classification, strong for the
 * assistant and the agents. The workspace picks the model of each class;
 * the global admin sets the defaults for workspaces that did not.
 */
export const AI_TASK_CLASSES = [
  'CLASSIFICATION',
  'CONVERSATION',
  'ASSISTANT',
  'AGENT',
] as const
export type AiTaskClass = (typeof AI_TASK_CLASSES)[number]

export const AI_TASK_CLASS_LABELS: Record<AiTaskClass, string> = {
  CLASSIFICATION: 'Classificação (sentimento, triagem, proteções)',
  CONVERSATION: 'Atendimento automático (WhatsApp e pré-atendimento)',
  ASSISTANT: 'Assistente (Steel AI, copiloto, Wiki, CRM)',
  AGENT: 'Steel Agents',
}

export type AiModelTier = 'fast' | 'strong'

/** Tier of each catalog model: the failover prefers one of the same tier. */
export const AI_MODEL_TIER: Record<AiModelKey, AiModelTier> = {
  'openai:gpt-4o-mini': 'fast',
  'openai:gpt-4.1-mini': 'fast',
  'openai:gpt-5-mini': 'fast',
  'openai:gpt-5': 'strong',
  'anthropic:claude-haiku-4-5': 'fast',
  'anthropic:claude-sonnet-5': 'strong',
  'anthropic:claude-opus-5': 'strong',
}

export const AI_TASK_CLASS_TIER: Record<AiTaskClass, AiModelTier> = {
  CLASSIFICATION: 'fast',
  CONVERSATION: 'fast',
  ASSISTANT: 'strong',
  AGENT: 'strong',
}

/**
 * How long one provider call of each class may take before it counts as a
 * failure and the failover tries the next model. For a streamed answer it
 * bounds the wait for the first chunk.
 */
export const AI_TASK_TIMEOUT_MS: Record<AiTaskClass, number> = {
  CLASSIFICATION: 30_000,
  CONVERSATION: 60_000,
  ASSISTANT: 120_000,
  AGENT: 120_000,
}
