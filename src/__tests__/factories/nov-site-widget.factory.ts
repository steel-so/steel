import { createId } from '@paralleldrive/cuid2'
import type {
  WhatsAppWidgetSettings,
  WhatsAppWidgetVisitor,
} from '@prisma/client'

export function createFakeWhatsAppWidgetSettings(
  overrides?: Partial<WhatsAppWidgetSettings>,
): WhatsAppWidgetSettings {
  const now = new Date()
  return {
    id: createId(),
    workspaceId: createId(),
    enabled: true,
    publicKey: `stw_${createId()}`,
    allowedOrigins: ['https://cliente.example.com'],
    title: 'Fale com a gente',
    welcomeMessage: 'Olá! Como podemos ajudar?',
    accentColor: '#2563eb',
    position: 'RIGHT',
    preChatEnabled: false,
    preChatAskEmail: true,
    preChatAskPhone: false,
    offlineEnabled: true,
    offlineMessage: 'Estamos fora do horário.',
    teamId: null,
    connectionId: createId(),
    showPortal: false,
    showSurvey: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export function createFakeWhatsAppWidgetVisitor(
  overrides?: Partial<WhatsAppWidgetVisitor>,
): WhatsAppWidgetVisitor {
  const now = new Date()
  return {
    id: createId(),
    workspaceId: createId(),
    contactId: createId(),
    tokenHash: createId(),
    name: null,
    email: null,
    phone: null,
    origin: null,
    lastSeenAt: now,
    createdAt: now,
    ...overrides,
  }
}
