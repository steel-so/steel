import { resolveTxt } from 'node:dns/promises'
import {
  type SendingDomainDmarcDTO,
  SUGGESTED_DMARC_VALUE,
} from '@/src/schemas/sending-domain.schema'
import { registrableDomain } from './public-suffix'

/**
 * DMARC hint of a sending domain (ADR 0054). Resend does not require DMARC,
 * but Gmail and Yahoo do for bulk senders, so the screen checks
 * `_dmarc.<registrable domain>` and suggests `v=DMARC1; p=none;` when there
 * is none. Never fails: NXDOMAIN/NODATA is "not found"; any other error or
 * a timeout is "unknown" (`found: null`).
 */

export const DMARC_LOOKUP_TIMEOUT_MS = 3000

type TxtResolver = (hostname: string) => Promise<string[][]>

const NOT_FOUND_CODES = new Set(['ENOTFOUND', 'ENODATA'])

export async function lookupDmarc(
  domainName: string,
  options: { resolver?: TxtResolver; timeoutMs?: number } = {},
): Promise<SendingDomainDmarcDTO> {
  const name = `_dmarc.${registrableDomain(domainName)}`
  const resolver = options.resolver ?? resolveTxt
  const timeoutMs = options.timeoutMs ?? DMARC_LOOKUP_TIMEOUT_MS
  const base = { name, suggested: SUGGESTED_DMARC_VALUE }

  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs)
  })

  try {
    const answer = await Promise.race([resolver(name), timeout])
    if (answer === 'timeout') return { ...base, found: null, value: null }
    const value = answer
      .map((chunks) => chunks.join(''))
      .find((txt) => /^v=DMARC1\b/i.test(txt.trim()))
    return value
      ? { ...base, found: true, value: value.trim() }
      : { ...base, found: false, value: null }
  } catch (error) {
    const code = (error as { code?: string } | null)?.code
    return code && NOT_FOUND_CODES.has(code)
      ? { ...base, found: false, value: null }
      : { ...base, found: null, value: null }
  } finally {
    clearTimeout(timer)
  }
}
