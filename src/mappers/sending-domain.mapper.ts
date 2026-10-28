import type { WorkspaceSendingDomain } from '@prisma/client'
import {
  type SendingDomainDmarcDTO,
  type SendingDomainDTO,
  type SendingDomainRecord,
  SendingDomainRecordSchema,
} from '@/src/schemas/sending-domain.schema'

/** `records` is a JSON snapshot; anything malformed is dropped, not thrown. */
export function toSendingDomainRecordList(
  value: unknown,
): SendingDomainRecord[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const parsed = SendingDomainRecordSchema.safeParse(item)
    return parsed.success ? [parsed.data] : []
  })
}

export function toSendingDomainDTO(
  domain: WorkspaceSendingDomain,
  newslettersCount: number,
  dmarc?: SendingDomainDmarcDTO,
): SendingDomainDTO {
  return {
    id: domain.id,
    name: domain.name,
    status: domain.status,
    region: domain.region,
    records: toSendingDomainRecordList(domain.records),
    failureReason: domain.failureReason,
    lastCheckedAt: domain.lastCheckedAt?.toISOString() ?? null,
    verifiedAt: domain.verifiedAt?.toISOString() ?? null,
    newslettersCount,
    createdAt: domain.createdAt.toISOString(),
    ...(dmarc ? { dmarc } : {}),
  }
}
