import { isIP } from 'node:net'
import {
  type Resolver,
  SAFE_FETCH_MAX_REDIRECTS,
  type SafeFetchFailure,
  validateFetchTarget,
} from '@/src/lib/safe-fetch/fetch-html'
import { isBlockedAddress } from '@/src/lib/safe-fetch/ip'

/**
 * Network policy of the capture browser: every request (page, redirects,
 * subresources) goes through the same checks as `safe-fetch`.
 */

export type RouteDecision =
  | { allow: true }
  | { allow: false; reason: SafeFetchFailure | 'redirects' | 'scheme' }

/** Schemes that never touch the network. */
const INLINE_SCHEMES = new Set(['data:', 'blob:', 'about:'])

export interface RedirectLink {
  redirectedFrom(): RedirectLink | null
}

export function redirectDepth(request: RedirectLink): number {
  let depth = 0
  let current = request.redirectedFrom()
  while (current && depth <= SAFE_FETCH_MAX_REDIRECTS + 1) {
    depth++
    current = current.redirectedFrom()
  }
  return depth
}

export async function decideRoute(
  url: string,
  depth: number,
  resolver?: Resolver,
): Promise<RouteDecision> {
  if (depth > SAFE_FETCH_MAX_REDIRECTS) {
    return { allow: false, reason: 'redirects' }
  }
  let protocol: string
  try {
    protocol = new URL(url).protocol
  } catch {
    return { allow: false, reason: 'invalid_url' }
  }
  if (INLINE_SCHEMES.has(protocol)) return { allow: true }
  if (protocol !== 'http:' && protocol !== 'https:') {
    return { allow: false, reason: 'scheme' }
  }
  const checked = await validateFetchTarget(url, resolver)
  return checked.ok ? { allow: true } : { allow: false, reason: checked.reason }
}

/**
 * The address the browser actually connected to (Chromium resolves DNS by
 * itself, so this closes the rebinding window after the fact).
 */
export function isServerAddressAllowed(address: string | undefined): boolean {
  if (!address) return true
  const host = address.replace(/^\[|\]$/g, '')
  if (!isIP(host)) return true
  return !isBlockedAddress(host)
}
