import { createId } from '@paralleldrive/cuid2'
import {
  type CrmDealRoomAction,
  type CrmDealRoomMaterial,
  type CrmDealRoomMessage,
  type CrmDealRoomVisitor,
  type CrmDealsSettings,
  type CrmProposalCharge,
  type CrmProposalSignature,
  Prisma,
} from '@prisma/client'
import type {
  CrmContractWithCompany,
} from '@/src/repositories/crm-contract.repository'
import type {
  CrmDealRoomEventWithVisitor,
  CrmDealRoomFull,
  CrmDealRoomPublicRow,
} from '@/src/repositories/crm-deal-room.repository'

const NOW = new Date('2026-10-30T12:00:00.000Z')

export function createFakeCrmDealsSettings(
  overrides?: Partial<CrmDealsSettings>,
): CrmDealsSettings {
  return {
    id: createId(),
    workspaceId: createId(),
    proposalPaymentEnabled: false,
    proposalSignatureEnabled: false,
    renewalLeadDays: 60,
    renewalAutoCreate: true,
    updatedById: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

export function createFakeCrmProposalCharge(
  overrides?: Partial<CrmProposalCharge>,
): CrmProposalCharge {
  return {
    id: createId(),
    workspaceId: createId(),
    proposalId: createId(),
    opportunityId: createId(),
    createdById: createId(),
    method: 'PIX',
    provider: 'mock',
    providerChargeId: createId(),
    amount: new Prisma.Decimal(1500),
    description: 'Proposta: Plano anual',
    paymentCode: '000201mock',
    status: 'PENDING',
    // Far enough that a test never sees it expire by itself.
    expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    paidAt: null,
    paidAmount: null,
    endToEndId: null,
    payerName: null,
    canceledAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

export function createFakeCrmProposalSignature(
  overrides?: Partial<CrmProposalSignature>,
): CrmProposalSignature {
  return {
    id: createId(),
    workspaceId: createId(),
    proposalId: createId(),
    signerName: 'Carlos Lima',
    signerDocument: null,
    signerEmail: null,
    storageKey: 'ws/proposal/signatures/sig.png',
    imageSha256: 'a'.repeat(64),
    proposalSha256: 'b'.repeat(64),
    ipHash: 'c'.repeat(64),
    signedAt: NOW,
    createdAt: NOW,
    ...overrides,
  }
}

export function createFakeCrmContract(
  overrides?: Partial<CrmContractWithCompany>,
): CrmContractWithCompany {
  const companyId = overrides?.companyId ?? createId()
  return {
    id: createId(),
    workspaceId: createId(),
    companyId,
    opportunityId: null,
    renewalOpportunityId: null,
    ownerId: createId(),
    createdById: createId(),
    name: 'Plano anual',
    value: new Prisma.Decimal(24000),
    startDate: new Date('2026-01-01T12:00:00.000Z'),
    endDate: new Date('2026-12-15T12:00:00.000Z'),
    autoRenews: false,
    status: 'ACTIVE',
    notes: null,
    alertedAt: null,
    renewalCreatedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    company: { id: companyId, name: 'Acme', accountOwnerId: createId() },
    ...overrides,
  }
}

export function createFakeDealRoomMaterial(
  overrides?: Partial<CrmDealRoomMaterial>,
): CrmDealRoomMaterial {
  return {
    id: createId(),
    roomId: createId(),
    title: 'Apresentação',
    url: 'https://example.com/deck.pdf',
    position: 0,
    createdAt: NOW,
    ...overrides,
  }
}

export function createFakeDealRoomAction(
  overrides?: Partial<CrmDealRoomAction>,
): CrmDealRoomAction {
  return {
    id: createId(),
    roomId: createId(),
    title: 'Enviar o contrato assinado',
    owner: 'CUSTOMER',
    dueDate: null,
    doneAt: null,
    doneByLabel: null,
    position: 0,
    createdAt: NOW,
    ...overrides,
  }
}

export function createFakeDealRoomVisitor(
  overrides?: Partial<CrmDealRoomVisitor>,
): CrmDealRoomVisitor {
  return {
    id: createId(),
    roomId: createId(),
    name: 'Ana Souza',
    email: 'ana@example.com',
    ipHash: null,
    firstSeenAt: NOW,
    lastSeenAt: NOW,
    ...overrides,
  }
}

export function createFakeDealRoomMessage(
  overrides?: Partial<CrmDealRoomMessage>,
): CrmDealRoomMessage {
  return {
    id: createId(),
    roomId: createId(),
    authorKind: 'CUSTOMER',
    authorUserId: null,
    authorName: 'Ana Souza',
    visitorId: null,
    body: 'Podemos fechar na sexta?',
    createdAt: NOW,
    ...overrides,
  }
}

export function createFakeDealRoom(
  overrides?: Partial<CrmDealRoomFull>,
): CrmDealRoomFull {
  const id = overrides?.id ?? createId()
  return {
    id,
    workspaceId: createId(),
    opportunityId: createId(),
    token: 'tok_abc123',
    enabled: true,
    title: null,
    welcomeMessage: 'Bem-vindo',
    proposalId: null,
    createdById: createId(),
    createdAt: NOW,
    updatedAt: NOW,
    materials: [createFakeDealRoomMaterial({ roomId: id })],
    actions: [createFakeDealRoomAction({ roomId: id })],
    ...overrides,
  }
}

export function createFakeDealRoomPublicRow(
  overrides?: Partial<CrmDealRoomPublicRow>,
): CrmDealRoomPublicRow {
  const base = createFakeDealRoom()
  return {
    ...base,
    workspace: { name: 'Stratus' },
    opportunity: { name: 'Negócio X', company: { name: 'Acme' } },
    proposal: null,
    ...overrides,
  }
}

export function createFakeDealRoomEvent(
  overrides?: Partial<CrmDealRoomEventWithVisitor>,
): CrmDealRoomEventWithVisitor {
  return {
    id: createId(),
    roomId: createId(),
    visitorId: createId(),
    kind: 'PROPOSAL_VIEWED',
    targetId: null,
    targetLabel: 'Proposta X',
    createdAt: NOW,
    visitor: { name: 'Ana Souza', email: 'ana@example.com' },
    ...overrides,
  }
}
