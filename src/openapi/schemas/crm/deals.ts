import { z } from 'zod'
import { dto } from '../../common'

/** DTOs das ferramentas de negócio do CRM (`types/crm-deals.d.ts`). */

export const CrmDealsSettingsDTO = dto(
  'CrmDealsSettings',
  z.object({
    proposalPaymentEnabled: z.boolean().meta({
      description:
        'Cobrança Pix/boleto na proposta. Desligada por padrão: só existe o provedor de teste.',
    }),
    proposalSignatureEnabled: z.boolean().meta({
      description:
        'A proposta pública é aceita com assinatura desenhada, no lugar do aceite só com o nome.',
    }),
    renewalLeadDays: z.number().int().meta({
      description:
        'Quantos dias antes do fim do contrato o responsável é avisado e a oportunidade de renovação é criada.',
    }),
    renewalAutoCreate: z.boolean(),
  }),
)

const ChargeStatus = z.enum(['PENDING', 'PAID', 'EXPIRED', 'CANCELED'])
const Method = z.enum(['PIX', 'BOLETO'])

export const CrmProposalChargeDTO = dto(
  'CrmProposalCharge',
  z.object({
    id: z.string(),
    proposalId: z.string(),
    opportunityId: z.string().nullable(),
    method: Method,
    provider: z.string().meta({ example: 'mock' }),
    isTest: z.boolean().meta({
      description: 'Verdadeiro quando o provedor não movimenta dinheiro de verdade.',
    }),
    amount: z.number(),
    description: z.string(),
    paymentCode: z.string().meta({
      description: 'Pix "copia e cola" ou a linha digitável do boleto.',
    }),
    status: ChargeStatus.meta({
      description: '`PENDING` vira `EXPIRED` quando `expiresAt` passa.',
    }),
    expiresAt: z.iso.datetime(),
    paidAt: z.iso.datetime().nullable(),
    paidAmount: z.number().nullable(),
    payerName: z.string().nullable(),
    createdAt: z.iso.datetime(),
  }),
)

export const CrmProposalSignatureDTO = dto(
  'CrmProposalSignature',
  z.object({
    id: z.string(),
    proposalId: z.string(),
    signerName: z.string(),
    signerDocument: z.string().nullable(),
    signerEmail: z.string().nullable(),
    imageSha256: z.string(),
    proposalSha256: z.string().meta({
      description: 'SHA-256 do conteúdo da proposta no momento da assinatura.',
    }),
    signedAt: z.iso.datetime(),
  }),
)

export const CrmProposalCheckoutDTO = dto(
  'CrmProposalCheckout',
  z.object({
    paymentEnabled: z.boolean(),
    signatureEnabled: z.boolean(),
    charges: z.array(CrmProposalChargeDTO),
    signatures: z.array(CrmProposalSignatureDTO),
  }),
)

export const CrmProposalPublicCheckoutDTO = dto(
  'CrmProposalPublicCheckout',
  z.object({
    signatureEnabled: z.boolean(),
    paymentEnabled: z.boolean(),
    signedBy: z.string().nullable(),
    signedAt: z.iso.datetime().nullable(),
    charges: z.array(
      z.object({
        id: z.string(),
        method: Method,
        isTest: z.boolean(),
        amount: z.number(),
        description: z.string(),
        paymentCode: z.string(),
        status: ChargeStatus,
        expiresAt: z.iso.datetime(),
        paidAt: z.iso.datetime().nullable(),
      }),
    ),
  }),
)

const DealRoomMaterial = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  position: z.number().int(),
})

const DealRoomAction = z.object({
  id: z.string(),
  title: z.string(),
  owner: z.enum(['SELLER', 'CUSTOMER']),
  dueDate: z.iso.datetime().nullable(),
  done: z.boolean(),
  doneAt: z.iso.datetime().nullable(),
  doneByLabel: z.string().nullable(),
})

export const DealRoomMessageDTO = dto(
  'DealRoomMessage',
  z.object({
    id: z.string(),
    authorKind: z.enum(['SELLER', 'CUSTOMER']),
    authorName: z.string(),
    body: z.string(),
    createdAt: z.iso.datetime(),
  }),
)

export const CrmDealRoomDTO = dto(
  'CrmDealRoom',
  z.object({
    id: z.string(),
    opportunityId: z.string(),
    enabled: z.boolean(),
    token: z.string(),
    publicPath: z.string().meta({ example: '/sala/abc123' }),
    title: z.string().nullable(),
    welcomeMessage: z.string().nullable(),
    proposalId: z.string().nullable(),
    materials: z.array(DealRoomMaterial),
    actions: z.array(DealRoomAction),
    visitors: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        email: z.string(),
        firstSeenAt: z.iso.datetime(),
        lastSeenAt: z.iso.datetime(),
      }),
    ),
    events: z
      .array(
        z.object({
          id: z.string(),
          kind: z.enum([
            'ROOM_OPENED',
            'PROPOSAL_VIEWED',
            'MATERIAL_OPENED',
            'ACTION_COMPLETED',
            'MESSAGE_SENT',
          ]),
          label: z.string().meta({ example: 'abriu a proposta' }),
          visitorName: z.string().nullable(),
          visitorEmail: z.string().nullable(),
          targetLabel: z.string().nullable(),
          createdAt: z.iso.datetime(),
        }),
      )
      .meta({ description: 'Quem abriu o quê, do mais recente ao mais antigo.' }),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  }),
)

export const PublicDealRoomDTO = dto(
  'PublicDealRoom',
  z.object({
    title: z.string(),
    welcomeMessage: z.string().nullable(),
    companyName: z.string().nullable(),
    workspaceName: z.string(),
    proposal: z
      .object({ name: z.string(), sharePath: z.string() })
      .nullable(),
    materials: z.array(DealRoomMaterial),
    actions: z.array(DealRoomAction),
    messages: z.array(DealRoomMessageDTO),
  }),
)

export const DealRoomVisitorSessionDTO = dto(
  'DealRoomVisitorSession',
  z.object({ visitorId: z.string(), name: z.string() }),
)

export const CrmContractDTO = dto(
  'CrmContract',
  z.object({
    id: z.string(),
    companyId: z.string(),
    companyName: z.string(),
    opportunityId: z.string().nullable(),
    renewalOpportunityId: z.string().nullable(),
    ownerId: z.string().nullable(),
    name: z.string(),
    value: z.number().nullable(),
    startDate: z.iso.datetime(),
    endDate: z.iso.datetime(),
    autoRenews: z.boolean(),
    status: z.enum(['ACTIVE', 'RENEWED', 'EXPIRED', 'CANCELED']),
    notes: z.string().nullable(),
    daysLeft: z.number().int().meta({
      description: 'Dias inteiros até o fim (negativo depois que acabou).',
    }),
    renewalState: z.enum(['OVERDUE', 'EXPIRING', 'HEALTHY']),
    renewalStateLabel: z.string(),
    alertedAt: z.iso.datetime().nullable(),
    renewalCreatedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
  }),
)

export const CrmUpsellDTO = dto(
  'CrmUpsell',
  z.object({
    companyId: z.string(),
    timing: z.enum(['GO', 'WAIT', 'NEUTRAL']).meta({
      description:
        '`GO` = bom momento para ampliar; `WAIT` = resolva o risco ou a nota baixa antes.',
    }),
    timingReason: z.string(),
    satisfaction: z
      .object({
        kind: z.enum(['NPS', 'CSAT', 'CES']),
        score: z.number().int(),
        answeredAt: z.iso.datetime(),
      })
      .nullable(),
    healthLevel: z.enum(['LOW', 'MEDIUM', 'HIGH']).nullable(),
    suggestions: z.array(
      z.object({
        productId: z.string(),
        name: z.string(),
        buyers: z.number().int(),
        peers: z.number().int(),
        adoptionPct: z.number().int(),
        unitPrice: z.number().nullable(),
      }),
    ),
  }),
)

export const CrmRenewalScanResultDTO = dto(
  'CrmRenewalScanResult',
  z.object({
    workspaces: z.number().int(),
    expired: z.number().int(),
    rolled: z.number().int(),
    alerted: z.number().int(),
    renewalsCreated: z.number().int(),
    errors: z.number().int(),
  }),
)
