import {
  AI_MODEL_TIER,
  AI_TASK_CLASS_TIER,
  type AiModelDefinition,
  type AiModelKey,
  type AiTaskClass,
} from '../models'

/** A provider call that took longer than its task class allows. */
export class AiTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`AI provider did not answer within ${timeoutMs} ms`)
    this.name = 'AiTimeoutError'
  }
}

const NETWORK_ERROR_NAMES = new Set([
  'APIConnectionError',
  'APIConnectionTimeoutError',
  'AbortError',
  'FetchError',
  'AiTimeoutError',
])
const NETWORK_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
])
/** The request itself is wrong: another provider would refuse it too. */
const REQUEST_ERROR_STATUSES = new Set([400, 413, 422])

/**
 * Whether an error of a provider call should make the failover try the next
 * model: timeouts, network errors, rate limits, overload, 5xx, and auth or
 * "model not found" errors (a revoked platform key or a retired model is an
 * outage from the workspace's point of view). Malformed requests are not.
 */
export function isFailoverError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { name?: unknown; code?: unknown; status?: unknown }
  if (typeof e.name === 'string' && NETWORK_ERROR_NAMES.has(e.name)) return true
  if (typeof e.code === 'string' && NETWORK_ERROR_CODES.has(e.code)) return true
  if (typeof e.status === 'number') {
    return e.status >= 401 && !REQUEST_ERROR_STATUSES.has(e.status)
  }
  return false
}

/** Short reason for logs and usage analytics (never the error body). */
export function failoverReason(error: unknown): string {
  if (error && typeof error === 'object') {
    const e = error as { name?: unknown; status?: unknown; code?: unknown }
    if (typeof e.status === 'number') return `status_${e.status}`
    if (e.name === 'AiTimeoutError') return 'timeout'
    if (typeof e.code === 'string') return e.code.toLowerCase()
    if (typeof e.name === 'string') return e.name
  }
  return 'unknown'
}

/** How many other models the failover tries after the chosen one. */
export const MAX_FALLBACK_MODELS = 2

/**
 * Fallback models of a call, best first: models of *another* provider come
 * first (an outage is usually provider-wide), and inside each group a model
 * of the tier the task class asks for. Candidates are the usable models of
 * the workspace (enabled, provider key configured), in catalog order.
 */
export function selectFallbackModels(
  primary: AiModelDefinition,
  usable: readonly AiModelDefinition[],
  taskClass: AiTaskClass,
  max: number = MAX_FALLBACK_MODELS,
): AiModelDefinition[] {
  const tier = AI_TASK_CLASS_TIER[taskClass]
  const rank = (model: AiModelDefinition) =>
    (model.provider === primary.provider ? 2 : 0) +
    (AI_MODEL_TIER[model.key as AiModelKey] === tier ? 0 : 1)
  return usable
    .filter((model) => model.key !== primary.key)
    .map((model, index) => ({ model, index }))
    .sort((a, b) => rank(a.model) - rank(b.model) || a.index - b.index)
    .slice(0, max)
    .map(({ model }) => model)
}

export async function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new AiTimeoutError(timeoutMs)),
          timeoutMs,
        )
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
