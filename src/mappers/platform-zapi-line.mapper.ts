import type { PlatformZapiLine } from '@prisma/client'
import type { PlatformZapiLineDTO } from '@/types/platform-zapi-line'

/** `3C4A5B6C7D` -> `3C4A****7D`: enough to recognise the instance. */
export function maskInstanceId(instanceId: string): string {
  if (instanceId.length <= 8) return `${instanceId.slice(0, 2)}****`
  return `${instanceId.slice(0, 4)}****${instanceId.slice(-4)}`
}

export const NOT_CONFIGURED_LINE: PlatformZapiLineDTO = {
  configured: false,
  instanceIdMasked: null,
  hasClientToken: false,
  label: null,
  phone: null,
  status: null,
  statusError: null,
  connectedAt: null,
  statusCheckedAt: null,
  updatedAt: null,
}

/** Never includes the encrypted tokens. */
export function toPlatformZapiLineDTO(
  row: PlatformZapiLine | null,
): PlatformZapiLineDTO {
  if (!row) return NOT_CONFIGURED_LINE
  return {
    configured: true,
    instanceIdMasked: maskInstanceId(row.instanceId),
    hasClientToken: row.encryptedClientToken !== null,
    label: row.label,
    phone: row.phone,
    status: row.status,
    statusError: row.statusError,
    connectedAt: row.connectedAt?.toISOString() ?? null,
    statusCheckedAt: row.statusCheckedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  }
}
