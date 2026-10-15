import { createId } from '@paralleldrive/cuid2'
import type { WhatsAppTemplate } from '@prisma/client'

export function createFakeWhatsAppTemplate(
  overrides?: Partial<WhatsAppTemplate>,
): WhatsAppTemplate {
  const now = new Date()
  return {
    id: createId(),
    workspaceId: createId(),
    connectionId: createId(),
    name: 'boas_vindas',
    language: 'pt_BR',
    category: 'MARKETING',
    status: 'APPROVED',
    components: [{ type: 'BODY', text: 'Bem-vindo!' }],
    quality: 'UNKNOWN',
    qualityUpdatedAt: null,
    statusReason: null,
    headerFormat: null,
    headerMediaUrl: null,
    buttons: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}
