import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Ties an OAuth consent to the `IntegrationGrant` it creates (ADR 0033).
 *
 * The oauth-provider plugin asks `postLogin.consentReferenceId` for a
 * reference while it stores the consent and issues the authorization code;
 * the code, the tokens and the consent row all carry that value as
 * `referenceId`. The plugin only hands the callback the user and session, so
 * the grant id travels through this AsyncLocalStorage: the consent route runs
 * the plugin call inside `runWithGrantReference(grant.id, …)`.
 *
 * Outside of that call (the plain `/oauth2/authorize` hit) the reference is a
 * value no consent row ever has. That makes the plugin always send the user
 * to `/oauth/consent`, where the workspace and modules are picked again —
 * a token never exists without a grant behind it.
 */

const storage = new AsyncLocalStorage<string>()

export const PENDING_GRANT_REFERENCE = 'pending-consent'

export function runWithGrantReference<T>(
  grantId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(grantId, fn)
}

export function currentGrantReference(): string {
  return storage.getStore() ?? PENDING_GRANT_REFERENCE
}
