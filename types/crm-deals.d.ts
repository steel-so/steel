/** DTOs of the CRM deal tools (nov: crm-deals): C6, C8 and C9. */

export interface CrmDealsSettingsDTO {
  proposalPaymentEnabled: boolean
  proposalSignatureEnabled: boolean
  renewalLeadDays: number
  renewalAutoCreate: boolean
}

// ─── C6 · proposal signature and charge ─────────────────────────────────────

export type CrmPaymentMethodDTO = 'PIX' | 'BOLETO'
export type CrmProposalChargeStatusDTO =
  | 'PENDING'
  | 'PAID'
  | 'EXPIRED'
  | 'CANCELED'

export interface CrmProposalChargeDTO {
  id: string
  proposalId: string
  opportunityId: string | null
  method: CrmPaymentMethodDTO
  provider: string
  /** True when the provider does not move real money (the mock). */
  isTest: boolean
  amount: number
  description: string
  /** Pix "copia e cola" or the boleto digitable line. */
  paymentCode: string
  /** `PENDING` becomes `EXPIRED` once `expiresAt` passes. */
  status: CrmProposalChargeStatusDTO
  expiresAt: string
  paidAt: string | null
  paidAmount: number | null
  payerName: string | null
  createdAt: string
}

export interface CrmProposalSignatureDTO {
  id: string
  proposalId: string
  signerName: string
  signerDocument: string | null
  signerEmail: string | null
  imageSha256: string
  proposalSha256: string
  signedAt: string
}

/** What the proposal screen of the seller shows. */
export interface CrmProposalCheckoutDTO {
  paymentEnabled: boolean
  signatureEnabled: boolean
  charges: CrmProposalChargeDTO[]
  signatures: CrmProposalSignatureDTO[]
}

/** What the public proposal page needs besides the sections. */
export interface CrmProposalPublicCheckoutDTO {
  signatureEnabled: boolean
  paymentEnabled: boolean
  signedBy: string | null
  signedAt: string | null
  charges: Pick<
    CrmProposalChargeDTO,
    | 'id'
    | 'method'
    | 'isTest'
    | 'amount'
    | 'description'
    | 'paymentCode'
    | 'status'
    | 'expiresAt'
    | 'paidAt'
  >[]
}

// ─── C8 · deal room ─────────────────────────────────────────────────────────

export interface DealRoomMaterialDTO {
  id: string
  title: string
  url: string
  position: number
}

export interface DealRoomActionDTO {
  id: string
  title: string
  owner: 'SELLER' | 'CUSTOMER'
  dueDate: string | null
  done: boolean
  doneAt: string | null
  doneByLabel: string | null
}

export interface DealRoomVisitorDTO {
  id: string
  name: string
  email: string
  firstSeenAt: string
  lastSeenAt: string
}

export type DealRoomEventKindDTO =
  | 'ROOM_OPENED'
  | 'PROPOSAL_VIEWED'
  | 'MATERIAL_OPENED'
  | 'ACTION_COMPLETED'
  | 'MESSAGE_SENT'

export interface DealRoomEventDTO {
  id: string
  kind: DealRoomEventKindDTO
  /** pt-BR sentence: "abriu a proposta". */
  label: string
  visitorName: string | null
  visitorEmail: string | null
  targetLabel: string | null
  createdAt: string
}

export interface DealRoomMessageDTO {
  id: string
  authorKind: 'SELLER' | 'CUSTOMER'
  authorName: string
  body: string
  createdAt: string
}

export interface CrmDealRoomDTO {
  id: string
  opportunityId: string
  enabled: boolean
  token: string
  /** Path of the public page (`/sala/<token>`). */
  publicPath: string
  title: string | null
  welcomeMessage: string | null
  proposalId: string | null
  materials: DealRoomMaterialDTO[]
  actions: DealRoomActionDTO[]
  visitors: DealRoomVisitorDTO[]
  events: DealRoomEventDTO[]
  createdAt: string
  updatedAt: string
}

export interface PublicDealRoomDTO {
  title: string
  welcomeMessage: string | null
  companyName: string | null
  workspaceName: string
  proposal: { name: string; sharePath: string } | null
  materials: DealRoomMaterialDTO[]
  actions: DealRoomActionDTO[]
  messages: DealRoomMessageDTO[]
}

export interface DealRoomVisitorSessionDTO {
  visitorId: string
  name: string
}

// ─── C9 · contracts and renewals ────────────────────────────────────────────

export type CrmContractStatusDTO = 'ACTIVE' | 'RENEWED' | 'EXPIRED' | 'CANCELED'
export type CrmRenewalStateDTO = 'OVERDUE' | 'EXPIRING' | 'HEALTHY'

export interface CrmContractDTO {
  id: string
  companyId: string
  companyName: string
  opportunityId: string | null
  renewalOpportunityId: string | null
  ownerId: string | null
  name: string
  value: number | null
  startDate: string
  endDate: string
  autoRenews: boolean
  status: CrmContractStatusDTO
  notes: string | null
  /** Whole days to the end (negative once ended). */
  daysLeft: number
  renewalState: CrmRenewalStateDTO
  renewalStateLabel: string
  alertedAt: string | null
  renewalCreatedAt: string | null
  createdAt: string
}

export interface CrmUpsellSuggestionDTO {
  productId: string
  name: string
  buyers: number
  peers: number
  adoptionPct: number
  unitPrice: number | null
}

export interface CrmUpsellDTO {
  companyId: string
  timing: 'GO' | 'WAIT' | 'NEUTRAL'
  timingReason: string
  satisfaction: {
    kind: 'NPS' | 'CSAT' | 'CES'
    score: number
    answeredAt: string
  } | null
  healthLevel: 'LOW' | 'MEDIUM' | 'HIGH' | null
  suggestions: CrmUpsellSuggestionDTO[]
}

export interface CrmRenewalScanResultDTO {
  workspaces: number
  expired: number
  rolled: number
  alerted: number
  renewalsCreated: number
  errors: number
}
