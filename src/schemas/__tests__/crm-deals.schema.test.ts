import { describe, expect, it } from 'vitest'
import {
  CreateCrmContractSchema,
  CreateCrmProposalChargeSchema,
  DealRoomMaterialInputSchema,
  IdentifyDealRoomVisitorSchema,
  ListCrmContractsQuerySchema,
  RecordDealRoomEventSchema,
  SignCrmProposalSchema,
  UpdateCrmContractSchema,
  UpdateCrmDealsSettingsSchema,
  UpsertCrmDealRoomSchema,
} from '../crm-deals.schema'

const PNG = 'data:image/png;base64,iVBORw0KGgo='

describe('UpdateCrmDealsSettingsSchema', () => {
  it('accepts a partial update and bounds the renewal window', () => {
    expect(
      UpdateCrmDealsSettingsSchema.safeParse({ proposalPaymentEnabled: true })
        .success,
    ).toBe(true)
    expect(
      UpdateCrmDealsSettingsSchema.safeParse({ renewalLeadDays: 6 }).success,
    ).toBe(false)
    expect(
      UpdateCrmDealsSettingsSchema.safeParse({ renewalLeadDays: 366 }).success,
    ).toBe(false)
  })
})

describe('SignCrmProposalSchema', () => {
  it('requires a PNG data url and a name', () => {
    const ok = SignCrmProposalSchema.safeParse({
      signerName: ' Ana ',
      signerEmail: ' ANA@Example.com ',
      image: PNG,
    })
    expect(ok.success).toBe(true)
    if (ok.success) {
      expect(ok.data.signerName).toBe('Ana')
      expect(ok.data.signerEmail).toBe('ana@example.com')
    }
    expect(
      SignCrmProposalSchema.safeParse({
        signerName: 'Ana',
        image: 'data:image/jpeg;base64,AAAA',
      }).success,
    ).toBe(false)
    expect(
      SignCrmProposalSchema.safeParse({ signerName: 'A', image: PNG }).success,
    ).toBe(false)
    expect(
      SignCrmProposalSchema.safeParse({
        signerName: 'Ana',
        signerEmail: 'nope',
        image: PNG,
      }).success,
    ).toBe(false)
  })
})

describe('CreateCrmProposalChargeSchema', () => {
  it('defaults the validity and rejects non-positive amounts', () => {
    const parsed = CreateCrmProposalChargeSchema.parse({ method: 'PIX' })
    expect(parsed.expiresInDays).toBe(7)
    expect(
      CreateCrmProposalChargeSchema.safeParse({ method: 'PIX', amount: 0 })
        .success,
    ).toBe(false)
    expect(
      CreateCrmProposalChargeSchema.safeParse({ method: 'CARD' }).success,
    ).toBe(false)
    expect(
      CreateCrmProposalChargeSchema.safeParse({
        method: 'BOLETO',
        expiresInDays: 31,
      }).success,
    ).toBe(false)
  })
})

describe('deal room schemas', () => {
  it('accepts only http(s) material links', () => {
    expect(
      DealRoomMaterialInputSchema.safeParse({
        title: 'Deck',
        url: 'https://example.com/a.pdf',
      }).success,
    ).toBe(true)
    expect(
      DealRoomMaterialInputSchema.safeParse({
        title: 'Deck',
        url: 'javascript:alert(1)',
      }).success,
    ).toBe(false)
    expect(
      DealRoomMaterialInputSchema.safeParse({ title: 'Deck', url: 'nope' })
        .success,
    ).toBe(false)
  })

  it('parses the room upsert with dates coerced', () => {
    const parsed = UpsertCrmDealRoomSchema.parse({
      enabled: true,
      actions: [
        { title: 'Assinar', owner: 'CUSTOMER', dueDate: '2026-11-10' },
      ],
    })
    expect(parsed.actions?.[0]?.dueDate).toBeInstanceOf(Date)
    expect(
      UpsertCrmDealRoomSchema.safeParse({
        actions: [{ title: 'x', owner: 'OTHER' }],
      }).success,
    ).toBe(false)
  })

  it('normalizes the visitor e-mail and limits the public event kinds', () => {
    const visitor = IdentifyDealRoomVisitorSchema.parse({
      name: 'Ana',
      email: ' ANA@Example.com ',
    })
    expect(visitor.email).toBe('ana@example.com')
    expect(
      RecordDealRoomEventSchema.safeParse({
        visitorId: 'v1',
        kind: 'MESSAGE_SENT',
      }).success,
    ).toBe(false)
    expect(
      RecordDealRoomEventSchema.safeParse({
        visitorId: 'v1',
        kind: 'MATERIAL_OPENED',
        targetId: 'm1',
      }).success,
    ).toBe(true)
  })
})

describe('contract schemas', () => {
  const base = {
    name: 'Plano',
    companyId: 'c1',
    startDate: '2026-01-01',
    endDate: '2027-01-01',
  }

  it('requires the end after the start and defaults autoRenews', () => {
    const parsed = CreateCrmContractSchema.parse(base)
    expect(parsed.autoRenews).toBe(false)
    expect(
      CreateCrmContractSchema.safeParse({ ...base, endDate: '2026-01-01' })
        .success,
    ).toBe(false)
  })

  it('accepts partial updates and statuses', () => {
    expect(UpdateCrmContractSchema.safeParse({ status: 'CANCELED' }).success).toBe(
      true,
    )
    expect(UpdateCrmContractSchema.safeParse({ status: 'X' }).success).toBe(
      false,
    )
  })

  it('coerces the list query', () => {
    const parsed = ListCrmContractsQuerySchema.parse({ endsWithinDays: '30' })
    expect(parsed.endsWithinDays).toBe(30)
    expect(
      ListCrmContractsQuerySchema.safeParse({ endsWithinDays: '0' }).success,
    ).toBe(false)
  })
})
