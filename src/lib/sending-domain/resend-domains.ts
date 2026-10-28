import type { DomainRegion } from 'resend'
import { logger } from '@/lib/axiom/logger'
import { sendingDomainProviderError, sendingDomainTaken } from '@/src/errors'
import type { AppError } from '@/src/errors/app-error'
import { resend } from '@/src/lib/mail/client'
import { err, ok, type Result } from '@/src/lib/result'
import type {
  SendingDomainRecord,
  SendingDomainStatusValue,
} from '@/src/schemas/sending-domain.schema'

/**
 * Thin `Result` wrapper over the Resend domains API (ADR 0054). Nothing
 * here throws; every provider failure becomes `SENDING_DOMAIN_PROVIDER_ERROR`
 * (or `SENDING_DOMAIN_TAKEN` when Resend says the name is already taken).
 */

export interface ProviderDomain {
  id: string
  status: SendingDomainStatusValue
  /** Raw Resend status, for logs. */
  providerStatus: string
  records: SendingDomainRecord[]
}

type ProviderRecord = {
  record: string
  type: string
  name: string
  value: string
  ttl?: string
  priority?: number
  status: string
}

type ProviderError = { message: string; statusCode: number | null } | null

/** Records that make the domain able to send (the rest is tracking). */
const SENDING_RECORDS = new Set(['SPF', 'DKIM'])

export function toSendingDomainRecords(
  records: readonly ProviderRecord[] | null | undefined,
): SendingDomainRecord[] {
  return (records ?? []).map((item) => ({
    record: item.record,
    type: item.type,
    name: item.name,
    value: item.value,
    ...(item.ttl !== undefined ? { ttl: String(item.ttl) } : {}),
    ...(typeof item.priority === 'number' ? { priority: item.priority } : {}),
    status: item.status,
  }))
}

/**
 * Resend domain status → ours. `partially_verified` counts as VERIFIED when
 * every SPF/DKIM record is verified (what is missing is only tracking);
 * otherwise PENDING. `partially_failed` is FAILED.
 */
export function toSendingDomainStatus(
  providerStatus: string,
  records: readonly SendingDomainRecord[],
): SendingDomainStatusValue {
  switch (providerStatus) {
    case 'verified':
      return 'VERIFIED'
    case 'failed':
    case 'partially_failed':
      return 'FAILED'
    case 'temporary_failure':
      return 'TEMPORARY_FAILURE'
    case 'not_started':
      return 'NOT_STARTED'
    case 'partially_verified': {
      const sending = records.filter((item) => SENDING_RECORDS.has(item.record))
      return sending.length > 0 &&
        sending.every((item) => item.status === 'verified')
        ? 'VERIFIED'
        : 'PENDING'
    }
    default:
      return 'PENDING'
  }
}

function toProviderDomain(data: {
  id: string
  status: string
  records?: readonly ProviderRecord[] | null
}): ProviderDomain {
  const records = toSendingDomainRecords(data.records)
  return {
    id: data.id,
    providerStatus: data.status,
    status: toSendingDomainStatus(data.status, records),
    records,
  }
}

function providerFailure(
  operation: string,
  error: ProviderError | unknown,
  context: Record<string, string>,
): AppError {
  const info =
    error && typeof error === 'object' && 'message' in error
      ? {
          message: String((error as { message: unknown }).message),
          statusCode:
            (error as { statusCode?: number | null }).statusCode ?? null,
        }
      : { message: String(error), statusCode: null }
  logger.warn('sending_domain.provider_error', {
    component: 'SendingDomain',
    operation,
    providerMessage: info.message,
    providerStatus: info.statusCode,
    ...context,
  })
  return sendingDomainProviderError()
}

function looksTaken(error: ProviderError): boolean {
  if (!error) return false
  return (
    error.statusCode === 409 ||
    /already (been )?(registered|exists|taken|added)|has already been/i.test(
      error.message,
    )
  )
}

export const ResendDomains = {
  async create(name: string, region: string): Promise<Result<ProviderDomain>> {
    try {
      const response = await resend.domains.create({
        name,
        region: region as DomainRegion,
        openTracking: true,
        clickTracking: true,
      })
      if (response.error || !response.data) {
        if (looksTaken(response.error)) {
          logger.warn('sending_domain.provider_taken', {
            component: 'SendingDomain',
            domain: name,
          })
          return err(sendingDomainTaken())
        }
        return err(providerFailure('create', response.error, { domain: name }))
      }
      return ok(toProviderDomain(response.data))
    } catch (error) {
      return err(providerFailure('create', error, { domain: name }))
    }
  },

  /** Asks Resend to re-check the DNS now (asynchronous on their side). */
  async verify(id: string): Promise<Result<void>> {
    try {
      const response = await resend.domains.verify(id)
      if (response.error) {
        return err(
          providerFailure('verify', response.error, { resendDomainId: id }),
        )
      }
      return ok(undefined)
    } catch (error) {
      return err(providerFailure('verify', error, { resendDomainId: id }))
    }
  },

  async get(id: string): Promise<Result<ProviderDomain>> {
    try {
      const response = await resend.domains.get(id)
      if (response.error || !response.data) {
        return err(
          providerFailure('get', response.error, { resendDomainId: id }),
        )
      }
      return ok(toProviderDomain(response.data))
    } catch (error) {
      return err(providerFailure('get', error, { resendDomainId: id }))
    }
  },

  /** Removing a domain Resend no longer knows (404) counts as done. */
  async remove(id: string): Promise<Result<void>> {
    try {
      const response = await resend.domains.remove(id)
      if (response.error && response.error.statusCode !== 404) {
        return err(
          providerFailure('remove', response.error, { resendDomainId: id }),
        )
      }
      return ok(undefined)
    } catch (error) {
      return err(providerFailure('remove', error, { resendDomainId: id }))
    }
  },
}
