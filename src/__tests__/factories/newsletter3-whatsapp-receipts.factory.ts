import type { WhatsAppReceiptTarget } from '@/src/repositories/crm-newsletter-whatsapp.repository'

/**
 * Slice nl3-whatsapp-receipts: the receipt target and the status webhook
 * payloads of both providers. Payload shapes follow what the routes parse:
 * Meta Cloud API `statuses[]` (incl. `errors[]` on failure) and the Z-API
 * `MessageStatusCallback` documented at developer.z-api.io (`ids[]`), plus
 * the legacy `StatusCallback` + `messageId` the route already accepted.
 */

export function createFakeReceiptTarget(
  overrides?: Partial<WhatsAppReceiptTarget>,
): WhatsAppReceiptTarget {
  return {
    id: 'w1',
    issueId: 'is1',
    workspaceId: 'ws1',
    subscriberId: 's1',
    ...overrides,
  }
}

export const META_PHONE_NUMBER_ID = '106540352242922'

export function metaStatusPayload(
  status: 'sent' | 'delivered' | 'read' | 'failed',
  id = 'wamid.HBgNNTUxMTk5OTk5MDAwMBUCABEYEjQ4',
  errors?: { code?: number; title?: string; message?: string }[],
) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '102290129340398',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '15550783881',
                phone_number_id: META_PHONE_NUMBER_ID,
              },
              statuses: [
                {
                  id,
                  status,
                  timestamp: '1761742800',
                  recipient_id: '5511999990000',
                  ...(errors ? { errors } : {}),
                },
              ],
            },
          },
        ],
      },
    ],
  }
}

export function zapiStatusPayload(
  status: 'SENT' | 'RECEIVED' | 'READ' | 'READ_BY_ME' | 'PLAYED',
  ids: string[] = ['3EB0C767D26A1D5F8C2A'],
) {
  return {
    instanceId: 'zapi-instance-1',
    status,
    ids,
    momment: 1761742800000,
    phoneDevice: 0,
    phone: '5511999990000',
    type: 'MessageStatusCallback',
    isGroup: false,
  }
}
