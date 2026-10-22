import { createId } from '@paralleldrive/cuid2'
import type { WhatsAppConnection } from '@prisma/client'

export function createFakeWhatsAppConnection(
  overrides?: Partial<WhatsAppConnection>,
): WhatsAppConnection {
  const now = new Date()
  return {
    id: createId(),
    workspaceId: createId(),
    provider: 'ZAPI',
    module: 'COMMUNICATION',
    label: 'Suporte',
    phoneNumber: '5511999999999',
    status: 'CONNECTING',
    statusError: null,
    webhookSecret: createId(),
    zapiInstanceId: 'instance-1',
    encryptedZapiToken: 'enc:token',
    encryptedZapiClientToken: null,
    metaPhoneNumberId: null,
    metaWabaId: null,
    encryptedMetaAccessToken: null,
    encryptedMetaPin: null,
    monthlyFee: null,
    createdById: createId(),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}
