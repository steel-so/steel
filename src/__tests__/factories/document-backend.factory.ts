import { createId } from '@paralleldrive/cuid2'
import {
  type Document,
  type DocumentRecipient,
  type DocumentVersion,
  Prisma,
} from '@prisma/client'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import { prisma } from '@/src/lib/prisma'
import type {
  DocumentFull,
  DocumentPublicContext,
} from '@/src/repositories/document.repository'
import { DEFAULT_DOCUMENT_SETTINGS } from '@/src/schemas/document.schema'

const SETTINGS = { ...DEFAULT_DOCUMENT_SETTINGS } as unknown as Prisma.JsonValue

/** Factories of the documents backend (CRM > Documentos, ADR 0063). */

/**
 * A small valid `document` canvas: one section with a heading, plus an
 * optional required text field, a CPF field and a pricing table.
 */
export function sampleDocumentContent(options?: {
  fields?: boolean
  pricing?: boolean
  empty?: boolean
}): CanvasDocument {
  const children: string[] = []
  const nodes: CanvasDocument['nodes'] = {
    root: {
      id: 'root',
      type: 'document',
      props: {},
      children: ['section-1'],
    },
  }
  if (!options?.empty) {
    children.push('heading-1')
    nodes['heading-1'] = {
      id: 'heading-1',
      type: 'heading',
      props: { text: 'Proposta comercial' },
    }
  }
  if (options?.fields) {
    children.push('field-name', 'field-cpf')
    nodes['field-name'] = {
      id: 'field-name',
      type: 'field-text',
      props: { label: 'Nome completo', required: true },
    }
    nodes['field-cpf'] = {
      id: 'field-cpf',
      type: 'field-cpf',
      props: { label: 'CPF' },
    }
  }
  if (options?.pricing) {
    children.push('pricing-1')
    nodes['pricing-1'] = {
      id: 'pricing-1',
      type: 'pricing-table',
      props: {
        items: [
          { id: 'setup', name: 'Implantação', unitPrice: 1000, quantity: 1 },
          {
            id: 'extra',
            name: 'Treinamento',
            unitPrice: 500,
            quantity: 1,
            optional: true,
          },
          {
            id: 'seats',
            name: 'Licenças',
            unitPrice: 100,
            quantity: 2,
            quantityEditable: true,
            recurrence: 'monthly',
          },
        ],
      },
    }
  }
  nodes['section-1'] = {
    id: 'section-1',
    type: 'section',
    props: {},
    children,
    meta: { name: 'Seção 1' },
  }
  return { catalog: 'document', version: 1, rootId: 'root', nodes }
}

export function createFakeDocument(overrides?: Partial<Document>): Document {
  const now = new Date()
  return {
    id: createId(),
    workspaceId: createId(),
    kind: 'OTHER',
    status: 'DRAFT',
    title: 'Proposta comercial',
    description: null,
    isTemplate: false,
    templateId: null,
    source: 'BLANK',
    content: sampleDocumentContent() as unknown as Prisma.JsonValue,
    theme: {},
    settings: SETTINGS,
    currentVersionId: null,
    publicToken: createId(),
    linkEnabled: true,
    validUntil: null,
    totalValue: null,
    sentAt: null,
    firstViewedAt: null,
    lastViewedAt: null,
    acceptedAt: null,
    acceptedByName: null,
    acceptedByEmail: null,
    declinedAt: null,
    declineReason: null,
    expiredAt: null,
    paidAt: null,
    companyId: null,
    personId: null,
    opportunityId: null,
    leadId: null,
    ownerId: createId(),
    createdById: createId(),
    updatedById: null,
    legacyProposalId: null,
    legacyTemplateId: null,
    position: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  }
}

export function createFakeDocumentVersion(
  overrides?: Partial<DocumentVersion>,
): DocumentVersion {
  return {
    id: createId(),
    documentId: createId(),
    workspaceId: createId(),
    number: 1,
    content: sampleDocumentContent() as unknown as Prisma.JsonValue,
    theme: {},
    settings: SETTINGS,
    sha256: 'a'.repeat(64),
    createdById: null,
    createdAt: new Date(),
    ...overrides,
  }
}

export function createFakeDocumentRecipient(
  overrides?: Partial<DocumentRecipient>,
): DocumentRecipient {
  const now = new Date()
  return {
    id: createId(),
    documentId: createId(),
    workspaceId: createId(),
    name: 'Maria Souza',
    email: 'maria@example.com',
    phone: null,
    personId: null,
    role: 'APPROVER',
    status: 'PENDING',
    channel: 'LINK',
    token: createId(),
    sentAt: null,
    firstViewedAt: null,
    lastViewedAt: null,
    respondedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export function createFakeDocumentFull(
  overrides?: Partial<DocumentFull>,
): DocumentFull {
  const base = createFakeDocument(overrides)
  return {
    ...base,
    owner: {
      id: base.ownerId,
      name: 'João Lima',
      image: null,
      email: 'joao@example.com',
    },
    workspace: { name: 'Stratus Lab', slug: 'stratus-lab' },
    company: null,
    person: null,
    opportunity: null,
    lead: null,
    _count: { sessions: 0 },
    currentVersion: null,
    recipients: [],
    ...overrides,
  }
}

/** A sent document as the public link loads it (version frozen). */
export function createFakePublicContext(
  overrides?: Partial<DocumentPublicContext>,
  version?: Partial<DocumentVersion>,
): DocumentPublicContext & { currentVersion: DocumentVersion } {
  const document = createFakeDocument({
    status: 'SENT',
    sentAt: new Date(),
    ...overrides,
  })
  const currentVersion = createFakeDocumentVersion({
    documentId: document.id,
    workspaceId: document.workspaceId,
    ...version,
  })
  return {
    ...document,
    currentVersionId: currentVersion.id,
    currentVersion,
    workspace: {
      id: document.workspaceId,
      name: 'Stratus Lab',
      slug: 'stratus-lab',
      logoUrl: null,
    },
    owner: {
      id: document.ownerId,
      name: 'João Lima',
      email: 'joao@example.com',
    },
    ...overrides,
  } as DocumentPublicContext & { currentVersion: DocumentVersion }
}

export const decimal = (value: number) => new Prisma.Decimal(value)

// ── Integration seeds ──────────────────────────────────────────────────────

export async function seedDocument(
  workspaceId: string,
  userId: string,
  overrides?: Partial<Prisma.DocumentUncheckedCreateInput>,
) {
  return prisma.document.create({
    data: {
      workspaceId,
      title: 'Seed document',
      content: sampleDocumentContent() as unknown as Prisma.InputJsonValue,
      settings: { ...DEFAULT_DOCUMENT_SETTINGS },
      publicToken: createId(),
      ownerId: userId,
      createdById: userId,
      ...overrides,
    },
  })
}

export async function seedDocumentVersion(
  documentId: string,
  workspaceId: string,
  overrides?: Partial<Prisma.DocumentVersionUncheckedCreateInput>,
) {
  return prisma.documentVersion.create({
    data: {
      documentId,
      workspaceId,
      number: 1,
      content: sampleDocumentContent() as unknown as Prisma.InputJsonValue,
      sha256: 'b'.repeat(64),
      ...overrides,
    },
  })
}

export async function seedDocumentRecipient(
  documentId: string,
  workspaceId: string,
  overrides?: Partial<Prisma.DocumentRecipientUncheckedCreateInput>,
) {
  return prisma.documentRecipient.create({
    data: {
      documentId,
      workspaceId,
      name: 'Maria Souza',
      email: 'maria@example.com',
      token: createId(),
      ...overrides,
    },
  })
}
