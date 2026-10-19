import { logger } from '@/lib/axiom/logger'
import type { AiModelDefinition } from '../models'
import type {
  AiChatRequest,
  AiChatResponse,
  AiContentPart,
  AiMessage,
  AiProvider,
  AiStreamChunk,
} from '../types'
import type { AiCircuitBreaker } from './circuit-breaker'
import { failoverReason, isFailoverError, withTimeout } from './failover'
import {
  extractUntrusted,
  injectionVerdict,
  scanPromptInjection,
  UNTRUSTED_CONTENT_POLICY,
} from './injection'
import {
  createPiiVault,
  createStreamUnmasker,
  emptyPiiCounts,
  mapStrings,
  PII_MASKING_INSTRUCTION,
  type PiiCounts,
  type PiiVault,
} from './pii'

/**
 * Wraps the provider of one prepared AI call (ADRs 0041, 0042). Every call
 * site keeps calling `call.provider.chat(...)` / `chatStream(...)`; the
 * wrapper, per request:
 *
 * 1. scans third-party content (tool results and `<untrusted_content>`
 *    blocks) for prompt injection, optionally asking a classifier about the
 *    ambiguous ones, and adds the "third-party content is data" policy;
 * 2. masks personal data with a per-call vault when the policy says so;
 * 3. sends to the chosen model, failing over to the next one on provider
 *    errors and timeouts (circuit breaker in Redis);
 * 4. unmasks the answer (text, streamed deltas and tool arguments).
 */

export interface AiCallTarget {
  model: AiModelDefinition
  provider: AiProvider
}

export interface AiGuardReport {
  /** Distinct values masked in this call, by kind. */
  piiCounts: PiiCounts
  injection: { detected: boolean; signals: string[]; sources: string[] }
  /** Every switch to a fallback model, in order. */
  failovers: { from: string; to: string; reason: string }[]
}

export interface AiCallGuard {
  readonly report: AiGuardReport
  /** Third-party content tried to instruct the model during this call. */
  tainted(): boolean
}

export interface GuardedProviderOptions {
  primary: AiCallTarget
  /** Tried in order when the current model fails (empty = no failover). */
  fallbacks: AiCallTarget[]
  maskPii: boolean
  /** Optional classifier for text the heuristics find only suspicious. */
  classify?: (text: string) => Promise<boolean>
  breaker?: AiCircuitBreaker
  /** Per provider call (first chunk, for a stream). Only with fallbacks. */
  timeoutMs: number
  /** Called when the answering model changes (keeps `call.model` honest). */
  onModelChange?: (model: AiModelDefinition) => void
  /** Called once per newly detected injection (audit). */
  onInjection?: (detail: { signals: string[]; source: string }) => void
  log?: { workspaceId: string; feature: string }
}

function maskContent(
  content: string | AiContentPart[],
  vault: PiiVault,
): string | AiContentPart[] {
  if (typeof content === 'string') return vault.mask(content)
  return content.map((part) =>
    part.type === 'text' ? { ...part, text: vault.mask(part.text) } : part,
  )
}

function textsOf(message: AiMessage): string[] {
  if (message.role === 'tool') return [message.content]
  if (typeof message.content === 'string') return [message.content]
  return message.content.flatMap((part) =>
    part.type === 'text' ? [part.text] : [],
  )
}

function appendSystem(system: string | undefined, extra: string): string {
  return system ? `${system}\n\n${extra}` : extra
}

export function createGuardedProvider(options: GuardedProviderOptions): {
  provider: AiProvider
  guard: AiCallGuard
} {
  let current = options.primary
  const vault = options.maskPii ? createPiiVault() : null
  const scanned = new Set<string>()
  const report: AiGuardReport = {
    piiCounts: emptyPiiCounts(),
    injection: { detected: false, signals: [], sources: [] },
    failovers: [],
  }

  async function inspect(text: string, source: string): Promise<void> {
    if (!text || scanned.has(text)) return
    scanned.add(text)
    const scan = scanPromptInjection(text)
    let verdict = injectionVerdict(scan)
    if (verdict === 'suspicious' && options.classify) {
      verdict = (await options.classify(text)) ? 'detected' : 'clean'
      if (verdict === 'detected') scan.signals.push('classifier')
    }
    if (verdict !== 'detected') return
    report.injection.detected = true
    report.injection.signals = [
      ...new Set([...report.injection.signals, ...scan.signals]),
    ]
    if (!report.injection.sources.includes(source)) {
      report.injection.sources.push(source)
    }
    logger.warn('ai.prompt_injection_detected', {
      component: 'AiGuardrails',
      ...options.log,
      source,
      signals: scan.signals,
      score: scan.score,
    })
    options.onInjection?.({ signals: scan.signals, source })
  }

  async function prepare(request: AiChatRequest): Promise<AiChatRequest> {
    let untrustedSeen = false
    for (const block of extractUntrusted(request.system ?? '')) {
      untrustedSeen = true
      await inspect(block.text, block.source)
    }
    for (const message of request.messages) {
      if (message.role === 'tool') {
        untrustedSeen = true
        await inspect(message.content, 'tool_result')
        continue
      }
      if (message.role === 'assistant') continue
      for (const text of textsOf(message)) {
        for (const block of extractUntrusted(text)) {
          untrustedSeen = true
          await inspect(block.text, block.source)
        }
      }
    }

    let system = request.system
    if (untrustedSeen || (request.tools && request.tools.length > 0)) {
      system = appendSystem(system, UNTRUSTED_CONTENT_POLICY)
    }
    if (!vault) return { ...request, system }

    const messages = request.messages.map((message): AiMessage => {
      if (message.role === 'tool') {
        return { ...message, content: vault.mask(message.content) }
      }
      if (message.role === 'assistant') {
        return {
          ...message,
          content: vault.mask(message.content),
          ...(message.toolCalls && {
            toolCalls: message.toolCalls.map((call) => ({
              ...call,
              arguments: mapStrings(call.arguments, vault.mask),
            })),
          }),
        }
      }
      return { ...message, content: maskContent(message.content, vault) }
    })
    system = system === undefined ? undefined : vault.mask(system)
    if (vault.size() > 0) system = appendSystem(system, PII_MASKING_INSTRUCTION)
    report.piiCounts = vault.counts()
    return { ...request, system, messages }
  }

  function unmaskResponse(response: AiChatResponse): AiChatResponse {
    if (!vault || vault.size() === 0) return response
    const toolCalls = response.toolCalls.map((call) => ({
      ...call,
      arguments: mapStrings(call.arguments, vault.unmask),
    }))
    return {
      ...response,
      text: vault.unmask(response.text),
      toolCalls,
      message: {
        ...response.message,
        content: vault.unmask(response.message.content),
        ...(response.message.toolCalls && {
          toolCalls: response.message.toolCalls.map((call) => ({
            ...call,
            arguments: mapStrings(call.arguments, vault.unmask),
          })),
        }),
      },
    }
  }

  /** Current model first; providers with an open breaker go last. */
  async function attempts(): Promise<AiCallTarget[]> {
    const all = [current, ...options.fallbacks].filter(
      (target, index, list) =>
        list.findIndex((t) => t.model.key === target.model.key) === index,
    )
    if (all.length === 1 || !options.breaker) return all
    const open = await Promise.all(
      all.map((target) => options.breaker?.isOpen(target.model.provider)),
    )
    return [
      ...all.filter((_, index) => !open[index]),
      ...all.filter((_, index) => open[index]),
    ]
  }

  function switchTo(target: AiCallTarget, reason: string) {
    if (target.model.key === current.model.key) return
    report.failovers.push({
      from: current.model.key,
      to: target.model.key,
      reason,
    })
    logger.warn('ai.failover', {
      component: 'AiGuardrails',
      ...options.log,
      from: current.model.key,
      to: target.model.key,
      reason,
    })
    current = target
    options.onModelChange?.(target.model)
  }

  async function onFailure(
    target: AiCallTarget,
    error: unknown,
    isLast: boolean,
  ): Promise<string> {
    if (isLast || !isFailoverError(error)) throw error
    const reason = failoverReason(error)
    await options.breaker?.recordFailure(target.model.provider)
    logger.warn('ai.provider_call_failed', {
      component: 'AiGuardrails',
      ...options.log,
      model: target.model.key,
      reason,
    })
    return reason
  }

  const provider: AiProvider = {
    get id() {
      return current.provider.id
    },

    async chat(request) {
      const prepared = await prepare(request)
      const list = options.fallbacks.length > 0 ? await attempts() : [current]
      let reason = 'unavailable'
      // Ends by returning or by onFailure() rethrowing on the last model.
      for (let index = 0; ; index++) {
        const target = list[index]
        try {
          const work = target.provider.chat({
            ...prepared,
            model: target.model.model,
          })
          const response =
            list.length > 1
              ? await withTimeout(work, options.timeoutMs)
              : await work
          if (list.length > 1) {
            await options.breaker?.recordSuccess(target.model.provider)
          }
          switchTo(target, reason)
          return unmaskResponse(response)
        } catch (error) {
          reason = await onFailure(target, error, index === list.length - 1)
        }
      }
    },

    async *chatStream(request) {
      const prepared = await prepare(request)
      const list = options.fallbacks.length > 0 ? await attempts() : [current]
      let reason = 'unavailable'
      for (let index = 0; ; index++) {
        const target = list[index]
        const iterator = target.provider
          .chatStream({ ...prepared, model: target.model.model })
          [Symbol.asyncIterator]()
        let first: IteratorResult<AiStreamChunk>
        try {
          const next = iterator.next()
          first =
            list.length > 1
              ? await withTimeout(next, options.timeoutMs)
              : await next
        } catch (error) {
          void iterator.return?.()
          reason = await onFailure(target, error, index === list.length - 1)
          continue
        }
        if (list.length > 1) {
          await options.breaker?.recordSuccess(target.model.provider)
        }
        switchTo(target, reason)

        // From the first chunk on, the answer belongs to this model.
        const unmasker = vault ? createStreamUnmasker(vault) : null
        let step = first
        while (!step.done) {
          const chunk = step.value
          if (chunk.type === 'text') {
            const delta = unmasker ? unmasker.push(chunk.delta) : chunk.delta
            if (delta) yield { type: 'text', delta }
          } else {
            const rest = unmasker?.flush()
            if (rest) yield { type: 'text', delta: rest }
            yield { type: 'done', response: unmaskResponse(chunk.response) }
          }
          step = await iterator.next()
        }
        return
      }
    },
  }

  return {
    provider,
    guard: {
      report,
      tainted: () => report.injection.detected,
    },
  }
}
