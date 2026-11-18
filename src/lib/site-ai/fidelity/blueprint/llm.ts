import type { AiProvider, AiUsageTokens } from '@/src/lib/ai/types'

/** The model every fidelity call runs on, and where its token usage goes
 * (the service's meter: ledger + running cost). */
export interface FidelityLlm {
  provider: AiProvider
  model: string
  onUsage: (usage: AiUsageTokens) => Promise<void>
}

/** Runs `tasks` with at most `limit` in flight; a task that throws
 * rejects the whole run, so tasks here catch their own failures. */
export async function runLimited<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length)
  let next = 0
  const worker = async () => {
    while (next < tasks.length) {
      const index = next++
      results[index] = await tasks[index]()
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, worker),
  )
  return results
}

/** Message for the logs from an unknown cause. */
export function causeMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
