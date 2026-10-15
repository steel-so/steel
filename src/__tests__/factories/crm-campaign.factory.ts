import { createId } from '@paralleldrive/cuid2'
import type {
  CrmCampaign,
  CrmCampaignConversion,
  CrmCampaignRecipient,
  Prisma,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'

export function createFakeCrmCampaign(
  overrides?: Partial<CrmCampaign>,
): CrmCampaign {
  const now = new Date('2026-10-09T12:00:00.000Z')
  return {
    id: createId(),
    workspaceId: createId(),
    name: 'Black Friday',
    slug: 'black-friday',
    status: 'DRAFT',
    destinationType: null,
    landingPageId: null,
    formId: null,
    siteId: null,
    sitePageId: null,
    utmMedium: 'campanha',
    emailFrom: null,
    emailSubject: null,
    emailPreheader: null,
    emailTemplateId: null,
    emailLegalBasis: null,
    audience: { mailingListIds: [], allPeople: false, leadStages: [] },
    whatsappEnabled: false,
    whatsappConnectionId: null,
    whatsappTemplateId: null,
    whatsappVariables: null,
    whatsappText: null,
    whatsappMediaUrl: null,
    whatsappQuickReplyId: null,
    whatsappDelayHours: 0,
    whatsappLegalBasis: null,
    scheduledAt: null,
    sendWindowStartHour: null,
    sendWindowEndHour: null,
    sendWeekdaysOnly: false,
    consentConfirmedAt: null,
    consentConfirmedById: null,
    launchedAt: null,
    startAt: null,
    completedAt: null,
    createdById: createId(),
    updatedById: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  }
}

export function createFakeCrmCampaignRecipient(
  overrides?: Partial<CrmCampaignRecipient>,
): CrmCampaignRecipient {
  const now = new Date('2026-10-09T12:00:00.000Z')
  return {
    id: createId(),
    campaignId: createId(),
    workspaceId: createId(),
    personId: null,
    leadId: null,
    name: 'Ana Souza',
    email: 'ana@example.com',
    waId: null,
    emailStatus: 'PENDING',
    emailSkipReason: null,
    emailProviderMessageId: null,
    emailError: null,
    emailSentAt: null,
    emailDeliveredAt: null,
    emailOpenedAt: null,
    emailClickedAt: null,
    emailBouncedAt: null,
    unsubscribedAt: null,
    whatsappStatus: 'NONE',
    whatsappSkipReason: null,
    whatsappProviderMessageId: null,
    whatsappError: null,
    whatsappSentAt: null,
    whatsappDeliveredAt: null,
    whatsappReadAt: null,
    whatsappClickedAt: null,
    whatsappRepliedAt: null,
    conversationId: null,
    convertedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export function createFakeCrmCampaignConversion(
  overrides?: Partial<CrmCampaignConversion>,
): CrmCampaignConversion {
  return {
    id: createId(),
    campaignId: createId(),
    recipientId: null,
    channel: null,
    kind: 'FORM_SUBMISSION',
    sourceRef: createId(),
    leadId: null,
    personId: null,
    siteId: null,
    sitePageId: null,
    formId: null,
    createdAt: new Date('2026-10-09T12:00:00.000Z'),
    ...overrides,
  }
}

export async function seedCrmCampaign(
  workspaceId: string,
  createdById: string,
  overrides?: Partial<
    Omit<Prisma.CrmCampaignUncheckedCreateInput, 'workspaceId' | 'createdById'>
  >,
) {
  return prisma.crmCampaign.create({
    data: {
      name: 'Seed Campaign',
      slug: `seed-${createId()}`,
      ...overrides,
      workspaceId,
      createdById,
    },
  })
}

export async function seedCrmCampaignRecipient(
  campaign: { id: string; workspaceId: string },
  overrides?: Partial<
    Omit<
      Prisma.CrmCampaignRecipientUncheckedCreateInput,
      'campaignId' | 'workspaceId'
    >
  >,
) {
  return prisma.crmCampaignRecipient.create({
    data: {
      name: 'Contato',
      email: `${createId()}@example.com`,
      emailStatus: 'PENDING',
      ...overrides,
      campaignId: campaign.id,
      workspaceId: campaign.workspaceId,
    },
  })
}
