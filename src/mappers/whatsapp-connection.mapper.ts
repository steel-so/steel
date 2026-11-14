import type { WhatsAppConnection } from '@prisma/client'
import type {
  WhatsAppConnectionCreatedDTO,
  WhatsAppConnectionDTO,
} from '@/types/whatsapp-connection'

/**
 * Full Z-API webhook URL (carries the connection secret, so only build it for
 * actors who may manage connections).
 */
export function buildZapiWebhookUrl(
  baseUrl: string,
  webhookSecret: string,
): string {
  return `${baseUrl.replace(/\/+$/, '')}/api/whatsapp/webhook/zapi?secret=${encodeURIComponent(webhookSecret)}`
}

/**
 * `webhookBaseUrl` must be passed only for admins: when present, Z-API
 * connections get `webhookUrl` (it embeds the secret).
 */
export function toWhatsAppConnectionDTO(
  connection: WhatsAppConnection,
  webhookBaseUrl?: string,
): WhatsAppConnectionDTO {
  return {
    id: connection.id,
    workspaceId: connection.workspaceId,
    provider: connection.provider,
    label: connection.label,
    phoneNumber: connection.phoneNumber,
    status: connection.status,
    statusError: connection.statusError,
    zapiInstanceId: connection.zapiInstanceId,
    metaPhoneNumberId: connection.metaPhoneNumberId,
    metaWabaId: connection.metaWabaId,
    createdById: connection.createdById,
    createdAt: connection.createdAt.toISOString(),
    updatedAt: connection.updatedAt.toISOString(),
    ...(webhookBaseUrl && connection.provider === 'ZAPI'
      ? {
          webhookUrl: buildZapiWebhookUrl(
            webhookBaseUrl,
            connection.webhookSecret,
          ),
        }
      : {}),
  }
}

export function toWhatsAppConnectionCreatedDTO(
  connection: WhatsAppConnection,
  webhookBaseUrl?: string,
): WhatsAppConnectionCreatedDTO {
  return {
    ...toWhatsAppConnectionDTO(connection, webhookBaseUrl),
    webhookSecret: connection.webhookSecret,
  }
}
