import { createId } from '@paralleldrive/cuid2'
import type {
  CrmEmailBrand,
  CrmEmailCampaign,
  CrmEmailCampaignRecipient,
  CrmEmailTemplate,
  CrmMailingList,
  CrmMailingListMember,
  Prisma,
} from '@prisma/client'
import { createEmailDocumentFromLayout } from '@/src/lib/canvas-email/convert-v1'
import { createBuilderDocument } from '@/src/lib/crm-email-builder/layouts'
import { prisma } from '@/src/lib/prisma'
import type { EmailBuilderLayoutId } from '@/src/schemas/crm-email-builder.schema'

export function createFakeCrmEmailTemplate(
  overrides?: Partial<CrmEmailTemplate>,
): CrmEmailTemplate {
  const now = new Date()
  return {
    id: createId(),
    name: 'Boas-vindas',
    subject: 'Bem-vindo!',
    contentHtml: '<p>Oi</p>',
    contentJson: null,
    templateId: null,
    templateProps: null,
    kind: 'LEGACY',
    builderDocument: null,
    contentText: null,
    workspaceId: createId(),
    createdById: createId(),
    updatedById: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  }
}

export async function seedCrmEmailTemplate(
  workspaceId: string,
  createdById: string,
  overrides?: Partial<Pick<CrmEmailTemplate, 'name' | 'subject' | 'deletedAt'>>,
) {
  return prisma.crmEmailTemplate.create({
    data: {
      name: 'Seed Template',
      subject: 'Assunto',
      contentHtml: '<p>Oi</p>',
      workspaceId,
      createdById,
      ...overrides,
    },
  })
}

export function createFakeCrmEmailCampaign(
  overrides?: Partial<CrmEmailCampaign>,
): CrmEmailCampaign {
  const now = new Date()
  return {
    id: createId(),
    subject: 'Promo',
    contentHtml: '<p>Oi</p>',
    contentJson: null,
    contentText: null,
    templateId: null,
    campaignLink: null,
    fromAddress: 'crm@stratustelecom.com.br',
    status: 'DRAFT',
    recipientScope: 'ALL',
    scheduledAt: null,
    sentAt: null,
    workspaceId: createId(),
    createdById: createId(),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export async function seedCrmEmailCampaign(
  workspaceId: string,
  createdById: string,
  overrides?: Partial<
    Pick<
      CrmEmailCampaign,
      'subject' | 'status' | 'recipientScope' | 'scheduledAt' | 'fromAddress'
    >
  >,
) {
  return prisma.crmEmailCampaign.create({
    data: {
      subject: 'Seed Campaign',
      contentHtml: '<p>Oi</p>',
      fromAddress: 'crm@stratustelecom.com.br',
      recipientScope: 'ALL',
      workspaceId,
      createdById,
      ...overrides,
    },
  })
}

export function createFakeCrmEmailCampaignRecipient(
  overrides?: Partial<CrmEmailCampaignRecipient>,
): CrmEmailCampaignRecipient {
  const now = new Date()
  return {
    id: createId(),
    campaignId: createId(),
    personId: null,
    email: 'jane@acme.com',
    name: 'Jane',
    status: 'PENDING',
    providerMessageId: null,
    errorMessage: null,
    sentAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export async function seedCrmEmailCampaignRecipient(
  campaignId: string,
  overrides?: Partial<
    Pick<CrmEmailCampaignRecipient, 'email' | 'status' | 'personId'>
  >,
) {
  return prisma.crmEmailCampaignRecipient.create({
    data: { campaignId, email: 'seed@acme.com', ...overrides },
  })
}

export function createFakeCrmMailingList(
  overrides?: Partial<CrmMailingList>,
): CrmMailingList {
  const now = new Date()
  return {
    id: createId(),
    name: 'Newsletter',
    description: null,
    workspaceId: createId(),
    createdById: createId(),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  }
}

export async function seedCrmMailingList(
  workspaceId: string,
  createdById: string,
  overrides?: Partial<Pick<CrmMailingList, 'name' | 'deletedAt'>>,
) {
  return prisma.crmMailingList.create({
    data: { name: 'Seed List', workspaceId, createdById, ...overrides },
  })
}

export function createFakeCrmMailingListMember(
  overrides?: Partial<CrmMailingListMember>,
): CrmMailingListMember {
  return {
    id: createId(),
    mailingListId: createId(),
    email: 'jane@acme.com',
    name: 'Jane',
    personId: null,
    createdAt: new Date(),
    ...overrides,
  }
}

export async function seedCrmMailingListMember(
  mailingListId: string,
  overrides?: Partial<Pick<CrmMailingListMember, 'email' | 'name'>>,
) {
  return prisma.crmMailingListMember.create({
    data: { mailingListId, email: 'seed@acme.com', ...overrides },
  })
}

/** BUILDER template (visual editor) with the layout's default document. */
export function createFakeCrmEmailBuilderTemplate(
  layout: EmailBuilderLayoutId = 'newsletter',
  overrides?: Partial<CrmEmailTemplate>,
): CrmEmailTemplate {
  return createFakeCrmEmailTemplate({
    kind: 'BUILDER',
    builderDocument: createBuilderDocument(layout),
    contentHtml: '<html>{{unsubscribe_url}}</html>',
    contentText: 'Descadastrar {{unsubscribe_url}}',
    subject: 'Oi {{primeiro_nome}}',
    ...overrides,
  })
}

/** BUILDER template holding a Steel Canvas (v2) document. */
export function createFakeCrmEmailCanvasTemplate(
  layout: EmailBuilderLayoutId = 'newsletter',
  overrides?: Partial<CrmEmailTemplate>,
): CrmEmailTemplate {
  return createFakeCrmEmailBuilderTemplate(layout, {
    builderDocument: createEmailDocumentFromLayout(
      layout,
    ) as unknown as Prisma.JsonObject,
    ...overrides,
  })
}

export async function seedCrmEmailBuilderTemplate(
  workspaceId: string,
  createdById: string,
  layout: EmailBuilderLayoutId = 'newsletter',
) {
  return prisma.crmEmailTemplate.create({
    data: {
      name: 'Builder',
      subject: 'Oi {{primeiro_nome}}',
      contentHtml: '<html>{{unsubscribe_url}}</html>',
      kind: 'BUILDER',
      builderDocument: createBuilderDocument(layout),
      workspaceId,
      createdById,
    },
  })
}

export function createFakeCrmEmailBrand(
  overrides?: Partial<CrmEmailBrand>,
): CrmEmailBrand {
  const now = new Date()
  return {
    id: createId(),
    workspaceId: createId(),
    companyName: 'Acme',
    logoUrl: '',
    primaryColor: '#2893CC',
    address: 'Rua das Flores, 10',
    website: 'https://acme.com.br',
    updatedById: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export async function seedCrmEmailBrand(
  workspaceId: string,
  overrides?: Partial<
    Pick<
      CrmEmailBrand,
      'companyName' | 'logoUrl' | 'primaryColor' | 'address' | 'website'
    >
  >,
) {
  return prisma.crmEmailBrand.create({
    data: {
      workspaceId,
      companyName: 'Acme',
      primaryColor: '#2893CC',
      ...overrides,
    },
  })
}
