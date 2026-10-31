import type { SdRemoteEndpoint, SdRemoteSettings } from '@prisma/client'
import type { SdRemoteSessionRow } from '@/src/repositories/sd-remote.repository'
import type {
  SdRemoteEndpointDTO,
  SdRemoteSessionDTO,
  SdRemoteSettingsDTO,
} from '@/types/sd-remote'

/** Padrões enquanto o workspace não salvou nada: desligado, RustDesk. */
export const SD_REMOTE_DEFAULT_SETTINGS: SdRemoteSettingsDTO = {
  enabled: false,
  provider: 'RUSTDESK',
  linkTemplate: null,
}

export function toSdRemoteSettingsDTO(
  row: SdRemoteSettings | null,
): SdRemoteSettingsDTO {
  if (!row) return SD_REMOTE_DEFAULT_SETTINGS
  return {
    enabled: row.enabled,
    provider: row.provider,
    linkTemplate: row.linkTemplate,
  }
}

export function toSdRemoteEndpointDTO(
  row: SdRemoteEndpoint,
): SdRemoteEndpointDTO {
  return {
    id: row.id,
    configItemId: row.configItemId,
    provider: row.provider,
    remoteId: row.remoteId,
    source: row.source === 'INVENTORY' ? 'INVENTORY' : 'MANUAL',
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toSdRemoteSessionDTO(
  row: SdRemoteSessionRow,
): SdRemoteSessionDTO {
  return {
    id: row.id,
    configItemId: row.configItemId,
    ticketId: row.ticketId,
    provider: row.provider,
    remoteId: row.remoteId,
    startedAt: row.startedAt.toISOString(),
    user: { id: row.user.id, name: row.user.name },
  }
}
