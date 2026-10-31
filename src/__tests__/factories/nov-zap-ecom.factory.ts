import { createId } from '@paralleldrive/cuid2'
import type {
  WhatsAppCatalogOrder,
  WhatsAppCatalogProduct,
  WhatsAppCommerceSettings,
  WhatsAppContact,
  WhatsAppEcomEvent,
  WhatsAppEcomTrigger,
  WhatsAppSchedAppointment,
  WhatsAppSchedProfessional,
  WhatsAppSchedService,
  WhatsAppSchedulingSettings,
  WhatsAppStoreIntegration,
} from '@prisma/client'
import { Prisma } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import type {
  SchedAppointmentFull,
  SchedProfessionalWithServices,
} from '@/src/repositories/whatsapp-scheduling.repository'
import type { EcomEventWithStore } from '@/src/repositories/whatsapp-store.repository'

const now = () => new Date()

export function createFakeCommerceSettings(
  overrides?: Partial<WhatsAppCommerceSettings>,
): WhatsAppCommerceSettings {
  return {
    id: createId(),
    workspaceId: createId(),
    catalogEnabled: true,
    metaCatalogId: '1234567890',
    catalogSource: 'CRM',
    catalogIntegrationId: null,
    storeSyncEnabled: false,
    lastCatalogSyncAt: null,
    orderCreatesOpportunity: true,
    orderPipelineId: null,
    orderPixEnabled: false,
    ownerUserId: createId(),
    triggersEnabled: true,
    throttleHours: 24,
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  }
}

export function createFakeCatalogProduct(
  overrides?: Partial<WhatsAppCatalogProduct>,
): WhatsAppCatalogProduct {
  const id = createId()
  return {
    id,
    workspaceId: createId(),
    source: 'CRM',
    externalId: createId(),
    retailerId: `SKU-${id.slice(0, 6)}`,
    name: 'Camiseta',
    description: null,
    price: new Prisma.Decimal('59.90'),
    currency: 'BRL',
    imageUrl: null,
    url: null,
    available: true,
    syncedAt: now(),
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  }
}

export function createFakeCatalogOrder(
  overrides?: Partial<WhatsAppCatalogOrder>,
): WhatsAppCatalogOrder {
  return {
    id: createId(),
    workspaceId: createId(),
    contactId: createId(),
    conversationId: createId(),
    providerMessageId: `wamid.${createId()}`,
    metaCatalogId: null,
    note: null,
    items: [
      { retailerId: 'SKU-1', name: 'Camiseta', quantity: 2, unitPrice: 59.9 },
    ],
    total: new Prisma.Decimal('119.80'),
    currency: 'BRL',
    leadId: null,
    opportunityId: null,
    pixChargeId: null,
    createdAt: now(),
    ...overrides,
  }
}

export function createFakeStoreIntegration(
  overrides?: Partial<WhatsAppStoreIntegration>,
): WhatsAppStoreIntegration {
  return {
    id: createId(),
    workspaceId: createId(),
    provider: 'TRAY',
    name: 'Loja Tray',
    connectionId: createId(),
    enabled: true,
    storeUrl: null,
    encryptedWebhookSecret: 'enc-secret',
    encryptedCredentials: null,
    lastEventAt: null,
    createdById: createId(),
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  }
}

export function createFakeEcomTrigger(
  overrides?: Partial<WhatsAppEcomTrigger>,
): WhatsAppEcomTrigger {
  return {
    id: createId(),
    workspaceId: createId(),
    kind: 'ABANDONED_CART',
    enabled: true,
    templateId: createId(),
    delayMinutes: 60,
    variables: ['{nome}', '{link_carrinho}'],
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  }
}

export function createFakeEcomEvent(
  overrides?: Partial<WhatsAppEcomEvent>,
): WhatsAppEcomEvent {
  return {
    id: createId(),
    workspaceId: createId(),
    integrationId: createId(),
    kind: 'CART_ABANDONED',
    externalId: createId(),
    waId: '5511988887777',
    contactName: 'Maria Souza',
    data: {
      kind: 'CART_ABANDONED',
      externalId: 'c1',
      waId: '5511988887777',
      name: 'Maria Souza',
      orderNumber: null,
      total: 99.9,
      cartUrl: 'https://loja/cart',
      trackingCode: null,
      trackingUrl: null,
      items: ['Camiseta'],
    },
    status: 'PENDING',
    skipReason: null,
    scheduledAt: now(),
    claimedAt: null,
    processedAt: null,
    providerMessageId: null,
    createdAt: now(),
    ...overrides,
  }
}

export function createFakeEcomEventWithStore(
  overrides?: Partial<EcomEventWithStore>,
): EcomEventWithStore {
  const integration = overrides?.integration ?? createFakeStoreIntegration()
  return {
    ...createFakeEcomEvent({
      workspaceId: integration.workspaceId,
      integrationId: integration.id,
    }),
    integration,
    ...overrides,
  }
}

export function createFakeSchedulingSettings(
  overrides?: Partial<WhatsAppSchedulingSettings>,
): WhatsAppSchedulingSettings {
  return {
    id: createId(),
    workspaceId: createId(),
    enabled: true,
    connectionId: createId(),
    timezone: 'America/Sao_Paulo',
    slotMinutes: 30,
    minNoticeMinutes: 60,
    maxDaysAhead: 30,
    confirmationTemplateId: createId(),
    reminderTemplateId: createId(),
    reminderOffsets: [1440],
    bookingFlowId: null,
    ownerUserId: createId(),
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  }
}

export function createFakeSchedService(
  overrides?: Partial<WhatsAppSchedService>,
): WhatsAppSchedService {
  return {
    id: createId(),
    workspaceId: createId(),
    name: 'Corte de cabelo',
    description: null,
    durationMinutes: 30,
    bufferMinutes: 0,
    active: true,
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  }
}

export const WEEKDAY_HOURS = Object.fromEntries(
  ['1', '2', '3', '4', '5'].map((day) => [
    day,
    [{ start: '09:00', end: '17:00' }],
  ]),
)

export function createFakeSchedProfessional(
  overrides?: Partial<SchedProfessionalWithServices>,
): SchedProfessionalWithServices {
  return {
    id: createId(),
    workspaceId: createId(),
    name: 'Ana',
    userId: null,
    active: true,
    workingHours:
      WEEKDAY_HOURS as unknown as WhatsAppSchedProfessional['workingHours'],
    createdAt: now(),
    updatedAt: now(),
    services: [],
    ...overrides,
  }
}

export function createFakeSchedAppointment(
  overrides?: Partial<WhatsAppSchedAppointment>,
): WhatsAppSchedAppointment {
  const startsAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
  return {
    id: createId(),
    workspaceId: createId(),
    serviceId: createId(),
    professionalId: createId(),
    contactId: createId(),
    conversationId: null,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 30 * 60 * 1000),
    status: 'PENDING',
    source: 'AGENT',
    notes: null,
    createdById: null,
    confirmationSentAt: null,
    confirmedAt: null,
    canceledAt: null,
    cancelReason: null,
    remindersSent: [],
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  }
}

export function createFakeSchedAppointmentFull(
  overrides?: Partial<SchedAppointmentFull>,
): SchedAppointmentFull {
  const workspaceId = overrides?.workspaceId ?? createId()
  const service = overrides?.service ?? createFakeSchedService({ workspaceId })
  const professional =
    overrides?.professional ?? createFakeSchedProfessional({ workspaceId })
  const contact: WhatsAppContact =
    overrides?.contact ??
    ({
      id: createId(),
      workspaceId,
      waId: '5511988887777',
      bsuid: null,
      username: null,
      name: 'Maria Souza',
      avatarUrl: null,
      description: null,
      broadcastOptedOutAt: null,
      broadcastOptOutSource: null,
      hasWhatsapp: null,
      whatsappCheckedAt: null,
      whatsappLid: null,
      createdAt: now(),
      updatedAt: now(),
    } as WhatsAppContact)
  return {
    ...createFakeSchedAppointment({
      workspaceId,
      serviceId: service.id,
      professionalId: professional.id,
      contactId: contact.id,
    }),
    service,
    professional,
    contact,
    ...overrides,
  }
}

/** Workspace + user + connection + contact rows for integration tests. */
export async function seedEcomFixtures(workspaceId: string, userId: string) {
  const connection = await prisma.whatsAppConnection.create({
    data: {
      workspaceId,
      provider: 'META',
      module: 'COMMUNICATION',
      label: 'Loja',
      phoneNumber: `55119${Math.floor(Math.random() * 1e8)}`,
      status: 'CONNECTED',
      metaPhoneNumberId: 'phone1',
      metaWabaId: 'waba1',
      createdById: userId,
    },
  })
  const contact = await prisma.whatsAppContact.create({
    data: {
      workspaceId,
      waId: `55119${Math.floor(Math.random() * 1e8)}`,
      name: 'Maria',
    },
  })
  return { connection, contact }
}
