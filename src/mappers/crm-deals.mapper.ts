import type {
  CrmDealsSettings,
  CrmDealRoomAction,
  CrmDealRoomMaterial,
  CrmDealRoomMessage,
  CrmDealRoomVisitor,
  CrmProposalCharge,
  CrmProposalSignature,
} from '@prisma/client'
import {
  daysUntil,
  RENEWAL_STATE_LABEL,
  renewalState,
} from '@/src/lib/crm-deals/renewal'
import type {
  CrmContractWithCompany,
} from '@/src/repositories/crm-contract.repository'
import type {
  CrmDealRoomEventWithVisitor,
  CrmDealRoomFull,
} from '@/src/repositories/crm-deal-room.repository'
import type {
  CrmContractDTO,
  CrmDealRoomDTO,
  CrmDealsSettingsDTO,
  CrmProposalChargeDTO,
  CrmProposalPublicCheckoutDTO,
  CrmProposalSignatureDTO,
  DealRoomActionDTO,
  DealRoomEventDTO,
  DealRoomEventKindDTO,
  DealRoomMaterialDTO,
  DealRoomMessageDTO,
  DealRoomVisitorDTO,
} from '@/types/crm-deals'

export const DEFAULT_RENEWAL_LEAD_DAYS = 60

export const DEFAULT_CRM_DEALS_SETTINGS: CrmDealsSettingsDTO = {
  proposalPaymentEnabled: false,
  proposalSignatureEnabled: false,
  renewalLeadDays: DEFAULT_RENEWAL_LEAD_DAYS,
  renewalAutoCreate: true,
}

export function toCrmDealsSettingsDTO(
  row: CrmDealsSettings | null,
): CrmDealsSettingsDTO {
  if (!row) return { ...DEFAULT_CRM_DEALS_SETTINGS }
  return {
    proposalPaymentEnabled: row.proposalPaymentEnabled,
    proposalSignatureEnabled: row.proposalSignatureEnabled,
    renewalLeadDays: row.renewalLeadDays,
    renewalAutoCreate: row.renewalAutoCreate,
  }
}

// ─── C6 ─────────────────────────────────────────────────────────────────────

export function toCrmProposalChargeDTO(
  charge: CrmProposalCharge,
  isTest: boolean,
  now: Date = new Date(),
): CrmProposalChargeDTO {
  const expired =
    charge.status === 'PENDING' && charge.expiresAt.getTime() <= now.getTime()
  return {
    id: charge.id,
    proposalId: charge.proposalId,
    opportunityId: charge.opportunityId,
    method: charge.method,
    provider: charge.provider,
    isTest,
    amount: Number(charge.amount),
    description: charge.description,
    paymentCode: charge.paymentCode,
    status: expired ? 'EXPIRED' : charge.status,
    expiresAt: charge.expiresAt.toISOString(),
    paidAt: charge.paidAt ? charge.paidAt.toISOString() : null,
    paidAmount: charge.paidAmount === null ? null : Number(charge.paidAmount),
    payerName: charge.payerName,
    createdAt: charge.createdAt.toISOString(),
  }
}

export function toCrmProposalSignatureDTO(
  row: CrmProposalSignature,
): CrmProposalSignatureDTO {
  return {
    id: row.id,
    proposalId: row.proposalId,
    signerName: row.signerName,
    signerDocument: row.signerDocument,
    signerEmail: row.signerEmail,
    imageSha256: row.imageSha256,
    proposalSha256: row.proposalSha256,
    signedAt: row.signedAt.toISOString(),
  }
}

/** The customer sees the charges that can still be paid or were paid. */
export function toPublicChargeDTOs(
  charges: CrmProposalChargeDTO[],
): CrmProposalPublicCheckoutDTO['charges'] {
  return charges
    .filter((charge) => charge.status === 'PENDING' || charge.status === 'PAID')
    .map((charge) => ({
      id: charge.id,
      method: charge.method,
      isTest: charge.isTest,
      amount: charge.amount,
      description: charge.description,
      paymentCode: charge.paymentCode,
      status: charge.status,
      expiresAt: charge.expiresAt,
      paidAt: charge.paidAt,
    }))
}

// ─── C8 ─────────────────────────────────────────────────────────────────────

export function toDealRoomMaterialDTO(
  row: CrmDealRoomMaterial,
): DealRoomMaterialDTO {
  return { id: row.id, title: row.title, url: row.url, position: row.position }
}

export function toDealRoomActionDTO(row: CrmDealRoomAction): DealRoomActionDTO {
  return {
    id: row.id,
    title: row.title,
    owner: row.owner,
    dueDate: row.dueDate ? row.dueDate.toISOString() : null,
    done: row.doneAt !== null,
    doneAt: row.doneAt ? row.doneAt.toISOString() : null,
    doneByLabel: row.doneByLabel,
  }
}

export function toDealRoomVisitorDTO(
  row: CrmDealRoomVisitor,
): DealRoomVisitorDTO {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
  }
}

export const DEAL_ROOM_EVENT_LABEL: Record<DealRoomEventKindDTO, string> = {
  ROOM_OPENED: 'abriu a sala',
  PROPOSAL_VIEWED: 'abriu a proposta',
  MATERIAL_OPENED: 'abriu um material',
  ACTION_COMPLETED: 'concluiu uma ação do plano',
  MESSAGE_SENT: 'enviou uma mensagem',
}

export function toDealRoomEventDTO(
  row: CrmDealRoomEventWithVisitor,
): DealRoomEventDTO {
  return {
    id: row.id,
    kind: row.kind,
    label: DEAL_ROOM_EVENT_LABEL[row.kind],
    visitorName: row.visitor?.name ?? null,
    visitorEmail: row.visitor?.email ?? null,
    targetLabel: row.targetLabel,
    createdAt: row.createdAt.toISOString(),
  }
}

export function toDealRoomMessageDTO(
  row: CrmDealRoomMessage,
): DealRoomMessageDTO {
  return {
    id: row.id,
    authorKind: row.authorKind,
    authorName: row.authorName,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  }
}

export function toCrmDealRoomDTO(
  room: CrmDealRoomFull,
  visitors: CrmDealRoomVisitor[],
  events: CrmDealRoomEventWithVisitor[],
): CrmDealRoomDTO {
  return {
    id: room.id,
    opportunityId: room.opportunityId,
    enabled: room.enabled,
    token: room.token,
    publicPath: `/sala/${room.token}`,
    title: room.title,
    welcomeMessage: room.welcomeMessage,
    proposalId: room.proposalId,
    materials: room.materials.map(toDealRoomMaterialDTO),
    actions: room.actions.map(toDealRoomActionDTO),
    visitors: visitors.map(toDealRoomVisitorDTO),
    events: events.map(toDealRoomEventDTO),
    createdAt: room.createdAt.toISOString(),
    updatedAt: room.updatedAt.toISOString(),
  }
}

// ─── C9 ─────────────────────────────────────────────────────────────────────

export function toCrmContractDTO(
  row: CrmContractWithCompany,
  leadDays: number,
  now: Date = new Date(),
): CrmContractDTO {
  const state = renewalState(row.endDate, leadDays, now)
  return {
    id: row.id,
    companyId: row.companyId,
    companyName: row.company.name,
    opportunityId: row.opportunityId,
    renewalOpportunityId: row.renewalOpportunityId,
    ownerId: row.ownerId,
    name: row.name,
    value: row.value === null ? null : Number(row.value),
    startDate: row.startDate.toISOString(),
    endDate: row.endDate.toISOString(),
    autoRenews: row.autoRenews,
    status: row.status,
    notes: row.notes,
    daysLeft: daysUntil(row.endDate, now),
    renewalState: state,
    renewalStateLabel: RENEWAL_STATE_LABEL[state],
    alertedAt: row.alertedAt ? row.alertedAt.toISOString() : null,
    renewalCreatedAt: row.renewalCreatedAt
      ? row.renewalCreatedAt.toISOString()
      : null,
    createdAt: row.createdAt.toISOString(),
  }
}
