import { createId } from '@paralleldrive/cuid2'
import type { WhatsAppFlow, WhatsAppFlowResponse } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { flowFromPreset } from '@/src/lib/whatsapp/flows/templates'

const sample = flowFromPreset('SIGN_UP')

export function createFakeFlow(
  overrides?: Partial<WhatsAppFlow>,
): WhatsAppFlow {
  const now = new Date()
  return {
    id: createId(),
    workspaceId: createId(),
    connectionId: createId(),
    name: 'Cadastro',
    description: null,
    category: 'SIGN_UP',
    status: 'DRAFT',
    definition: sample.definition as unknown as WhatsAppFlow['definition'],
    publishedDefinition: null,
    publishedVersion: 0,
    publishedAt: null,
    metaFlowId: null,
    metaStatus: null,
    publishError: null,
    bodyText: sample.bodyText,
    ctaLabel: sample.ctaLabel,
    confirmationText: sample.confirmationText,
    crmAction: 'LEAD',
    sourceCrmFormId: null,
    createdByUserId: createId(),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

/** A flow already live at Meta, with its published copy. */
export function createFakePublishedFlow(
  overrides?: Partial<WhatsAppFlow>,
): WhatsAppFlow {
  return createFakeFlow({
    status: 'PUBLISHED',
    metaFlowId: 'meta-flow-1',
    metaStatus: 'PUBLISHED',
    publishedDefinition:
      sample.definition as unknown as WhatsAppFlow['publishedDefinition'],
    publishedVersion: 1,
    publishedAt: new Date(),
    ...overrides,
  })
}

export function createFakeFlowResponse(
  overrides?: Partial<WhatsAppFlowResponse>,
): WhatsAppFlowResponse {
  return {
    id: createId(),
    workspaceId: createId(),
    flowId: createId(),
    contactId: createId(),
    conversationId: createId(),
    flowToken: `stlf.${createId()}.${createId()}`,
    status: 'SENT',
    sentByUserId: null,
    messageId: null,
    answers: null,
    createdLeadId: null,
    createdPersonId: null,
    createdCompanyId: null,
    mappingNote: null,
    sentAt: new Date(),
    respondedAt: null,
    ...overrides,
  }
}

let counter = 0

/** Real rows for the repository integration tests. */
export async function seedFlowFixtures(workspaceId: string, userId: string) {
  counter += 1
  const connection = await prisma.whatsAppConnection.create({
    data: {
      workspaceId,
      provider: 'META',
      label: 'Oficial',
      phoneNumber: '5511999999999',
      metaPhoneNumberId: `flow-phone-${counter}-${createId()}`,
      metaWabaId: `flow-waba-${counter}`,
      encryptedMetaAccessToken: 'enc:token',
      createdById: userId,
    },
  })
  const contact = await prisma.whatsAppContact.create({
    data: {
      workspaceId,
      waId: `55119${counter}${Date.now()}`.slice(0, 13),
      name: 'Maria',
    },
  })
  const conversation = await prisma.whatsAppConversation.create({
    data: {
      workspaceId,
      connectionId: connection.id,
      contactId: contact.id,
      status: 'NEW',
    },
  })
  const flow = await prisma.whatsAppFlow.create({
    data: {
      workspaceId,
      connectionId: connection.id,
      name: `Cadastro ${counter}`,
      category: 'SIGN_UP',
      definition: sample.definition as never,
      createdByUserId: userId,
    },
  })
  return { connection, contact, conversation, flow }
}
