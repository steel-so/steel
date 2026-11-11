import type { CanvasDocument } from '@/src/lib/canvas/types'
import { DEFAULT_DOCUMENT_SETTINGS } from '@/src/schemas/document.schema'
import type {
  DocumentDTO,
  DocumentListItemDTO,
  DocumentPublicDTO,
  DocumentRecipientDTO,
} from '@/types/document'

export const WS = 'ws_1'
export const SLUG = 'acme'
export const BASE = `/api/workspaces/${WS}/crm/documents`

/** A document with a cover section, a required field and a pricing line. */
export function fakeContent(): CanvasDocument {
  return {
    catalog: 'document',
    version: 1,
    rootId: 'root',
    nodes: {
      root: {
        id: 'root',
        type: 'document',
        props: {},
        children: ['s1', 's2'],
      },
      s1: {
        id: 's1',
        type: 'section',
        props: {},
        children: ['h1'],
        meta: { name: 'Capa' },
      },
      h1: {
        id: 'h1',
        type: 'heading',
        props: { text: 'Proposta comercial' },
        children: [],
      },
      s2: {
        id: 's2',
        type: 'section',
        props: {},
        children: ['f1', 'p1'],
        meta: { name: 'Investimento' },
      },
      f1: {
        id: 'f1',
        type: 'field-cnpj',
        props: { label: 'CNPJ da empresa', required: true },
        children: [],
      },
      p1: {
        id: 'p1',
        type: 'pricing-table',
        props: {
          items: [
            {
              id: 'i1',
              name: 'Implantação',
              unitPrice: 1000,
              quantity: 1,
            },
          ],
        },
        children: [],
      },
    },
  } as CanvasDocument
}

export function fakeListItem(
  overrides: Partial<DocumentListItemDTO> = {},
): DocumentListItemDTO {
  return {
    id: 'doc_1',
    workspaceId: WS,
    title: 'Proposta — Acme',
    kind: 'PROPOSAL',
    status: 'SENT',
    isTemplate: false,
    source: 'BLANK',
    owner: { id: 'u1', name: 'João Lima', image: null },
    company: { id: 'c1', name: 'Acme Ltda' },
    person: { id: 'p1', name: 'Maria Souza' },
    opportunity: { id: 'o1', name: 'Implantação 2027' },
    lead: null,
    totalValue: 48000,
    validUntil: '2026-11-30T23:59:59.000Z',
    sentAt: '2026-11-10T13:00:00.000Z',
    firstViewedAt: null,
    lastViewedAt: null,
    acceptedAt: null,
    viewCount: 3,
    createdAt: '2026-11-09T13:00:00.000Z',
    updatedAt: '2026-11-10T13:00:00.000Z',
    ...overrides,
  }
}

export function fakeRecipient(
  overrides: Partial<DocumentRecipientDTO> = {},
): DocumentRecipientDTO {
  return {
    id: 'r1',
    name: 'Maria Souza',
    email: 'maria@acme.com.br',
    phone: null,
    role: 'APPROVER',
    status: 'VIEWED',
    channel: 'EMAIL',
    url: 'https://steel.example.com/d/tok_maria',
    sentAt: '2026-11-10T13:00:00.000Z',
    firstViewedAt: '2026-11-10T14:00:00.000Z',
    lastViewedAt: '2026-11-10T15:00:00.000Z',
    respondedAt: null,
    ...overrides,
  }
}

export function fakeDocument(
  overrides: Partial<DocumentDTO> = {},
): DocumentDTO {
  return {
    ...fakeListItem(),
    description: null,
    content: fakeContent() as unknown as Record<string, unknown>,
    theme: {},
    settings: DEFAULT_DOCUMENT_SETTINGS,
    templateId: null,
    currentVersion: {
      id: 'v1',
      number: 1,
      sha256: 'a'.repeat(64),
      createdAt: '2026-11-10T13:00:00.000Z',
      createdBy: { id: 'u1', name: 'João Lima' },
    },
    hasUnsentChanges: false,
    publicToken: 'tok_public',
    publicUrl: 'https://steel.example.com/d/tok_public',
    linkEnabled: true,
    acceptedByName: null,
    acceptedByEmail: null,
    declinedAt: null,
    declineReason: null,
    expiredAt: null,
    paidAt: null,
    recipients: [fakeRecipient()],
    ...overrides,
  }
}

export function fakePublic(
  overrides: Partial<DocumentPublicDTO> = {},
  document: Partial<DocumentPublicDTO['document']> = {},
): DocumentPublicDTO {
  return {
    token: 'tok_maria',
    document: {
      id: 'doc_1',
      title: 'Proposta — Acme',
      kind: 'PROPOSAL',
      status: 'VIEWED',
      validUntil: '2099-12-31T23:59:59.000Z',
      acceptedAt: null,
      acceptedByName: null,
      declinedAt: null,
      settings: DEFAULT_DOCUMENT_SETTINGS,
      theme: {},
      ...document,
    },
    version: {
      id: 'v1',
      number: 1,
      content: fakeContent() as unknown as Record<string, unknown>,
    },
    recipient: {
      id: 'r1',
      name: 'Maria Souza',
      role: 'APPROVER',
      status: 'VIEWED',
    },
    variables: { 'contato.nome': 'Maria Souza' },
    canAccept: true,
    canDownload: true,
    paymentEnabled: false,
    brand: { name: 'Stratus Telecom', logoUrl: null },
    ...overrides,
  }
}
