import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Where a mutation came from, attached to every `auditMutation` emitted
 * while the callback runs. The public API v1 (ADR 0035) wraps each call in
 * `{ source: 'api', apiTokenId }`, so the services keep auditing as they do
 * for the app and the log still tells a token write apart from a click.
 */
export interface AuditContext {
  source: 'api'
  apiTokenId: string
}

const storage = new AsyncLocalStorage<AuditContext>()

export function runWithAuditContext<T>(
  context: AuditContext,
  fn: () => T,
): T {
  return storage.run(context, fn)
}

export function currentAuditContext(): AuditContext | undefined {
  return storage.getStore()
}
