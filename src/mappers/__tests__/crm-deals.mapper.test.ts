import { Prisma } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import {
  createFakeCrmContract,
  createFakeCrmDealsSettings,
  createFakeCrmProposalCharge,
  createFakeCrmProposalSignature,
  createFakeDealRoom,
  createFakeDealRoomAction,
  createFakeDealRoomEvent,
  createFakeDealRoomMessage,
  createFakeDealRoomVisitor,
} from '@/src/__tests__/factories/nov-crm-deals.factory'
import {
  DEFAULT_CRM_DEALS_SETTINGS,
  toCrmContractDTO,
  toCrmDealRoomDTO,
  toCrmDealsSettingsDTO,
  toCrmProposalChargeDTO,
  toCrmProposalSignatureDTO,
  toDealRoomActionDTO,
  toDealRoomEventDTO,
  toDealRoomMessageDTO,
  toPublicChargeDTOs,
} from '../crm-deals.mapper'

const now = new Date('2026-10-30T12:00:00.000Z')

describe('toCrmDealsSettingsDTO', () => {
  it('falls back to the defaults (payment off) when nothing is saved', () => {
    expect(toCrmDealsSettingsDTO(null)).toEqual(DEFAULT_CRM_DEALS_SETTINGS)
    expect(DEFAULT_CRM_DEALS_SETTINGS.proposalPaymentEnabled).toBe(false)
  })

  it('maps a saved row', () => {
    expect(
      toCrmDealsSettingsDTO(
        createFakeCrmDealsSettings({
          proposalPaymentEnabled: true,
          renewalLeadDays: 30,
        }),
      ),
    ).toEqual({
      proposalPaymentEnabled: true,
      proposalSignatureEnabled: false,
      renewalLeadDays: 30,
      renewalAutoCreate: true,
    })
  })
})

describe('toCrmProposalChargeDTO', () => {
  it('reads pending charges as expired once the deadline passes', () => {
    const charge = createFakeCrmProposalCharge({
      expiresAt: new Date('2026-10-29T12:00:00.000Z'),
    })
    expect(toCrmProposalChargeDTO(charge, true, now).status).toBe('EXPIRED')
    const fresh = createFakeCrmProposalCharge({
      expiresAt: new Date('2026-11-05T12:00:00.000Z'),
    })
    expect(toCrmProposalChargeDTO(fresh, true, now).status).toBe('PENDING')
  })

  it('keeps a paid charge paid even after its deadline and converts decimals', () => {
    const paid = createFakeCrmProposalCharge({
      status: 'PAID',
      amount: new Prisma.Decimal('1500.50'),
      paidAmount: new Prisma.Decimal('1500.50'),
      paidAt: now,
      expiresAt: new Date('2026-10-01T00:00:00.000Z'),
      payerName: 'Ana',
    })
    const dto = toCrmProposalChargeDTO(paid, false, now)
    expect(dto).toMatchObject({
      status: 'PAID',
      amount: 1500.5,
      paidAmount: 1500.5,
      paidAt: now.toISOString(),
      payerName: 'Ana',
      isTest: false,
    })
  })

  it('maps an unpaid charge without paid fields', () => {
    const dto = toCrmProposalChargeDTO(createFakeCrmProposalCharge(), true, now)
    expect(dto.paidAt).toBeNull()
    expect(dto.paidAmount).toBeNull()
    expect(dto.isTest).toBe(true)
  })

  it('shows the customer only the charges that matter', () => {
    const list = [
      createFakeCrmProposalCharge({ status: 'PENDING' }),
      createFakeCrmProposalCharge({ status: 'PAID', paidAt: now }),
      createFakeCrmProposalCharge({ status: 'CANCELED' }),
      createFakeCrmProposalCharge({
        status: 'PENDING',
        expiresAt: new Date('2026-10-01T00:00:00.000Z'),
      }),
    ].map((charge) => toCrmProposalChargeDTO(charge, true, now))
    const visible = toPublicChargeDTOs(list)
    expect(visible.map((c) => c.status)).toEqual(['PENDING', 'PAID'])
    expect(visible[0]).not.toHaveProperty('provider')
  })
})

describe('toCrmProposalSignatureDTO', () => {
  it('drops the storage key and the IP hash', () => {
    const dto = toCrmProposalSignatureDTO(createFakeCrmProposalSignature())
    expect(dto).not.toHaveProperty('storageKey')
    expect(dto).not.toHaveProperty('ipHash')
    expect(dto.signedAt).toBe(now.toISOString())
  })
})

describe('deal room mappers', () => {
  it('flags a done action and keeps who finished it', () => {
    const open = toDealRoomActionDTO(createFakeDealRoomAction())
    expect(open).toMatchObject({ done: false, doneAt: null })
    const done = toDealRoomActionDTO(
      createFakeDealRoomAction({
        doneAt: now,
        doneByLabel: 'Ana',
        dueDate: now,
      }),
    )
    expect(done).toMatchObject({
      done: true,
      doneByLabel: 'Ana',
      dueDate: now.toISOString(),
    })
  })

  it('words the events in pt-BR and tolerates a removed visitor', () => {
    const event = toDealRoomEventDTO(createFakeDealRoomEvent())
    expect(event.label).toBe('abriu a proposta')
    expect(event.visitorName).toBe('Ana Souza')
    const orphan = toDealRoomEventDTO(
      createFakeDealRoomEvent({ visitor: null, kind: 'ROOM_OPENED' }),
    )
    expect(orphan.visitorName).toBeNull()
    expect(orphan.label).toBe('abriu a sala')
  })

  it('maps a message', () => {
    expect(toDealRoomMessageDTO(createFakeDealRoomMessage())).toMatchObject({
      authorKind: 'CUSTOMER',
      body: 'Podemos fechar na sexta?',
    })
  })

  it('builds the room with the public path and its activity', () => {
    const room = createFakeDealRoom({ token: 'abc' })
    const dto = toCrmDealRoomDTO(
      room,
      [createFakeDealRoomVisitor()],
      [createFakeDealRoomEvent()],
    )
    expect(dto.publicPath).toBe('/sala/abc')
    expect(dto.materials).toHaveLength(1)
    expect(dto.actions).toHaveLength(1)
    expect(dto.visitors[0]?.email).toBe('ana@example.com')
    expect(dto.events).toHaveLength(1)
  })
})

describe('toCrmContractDTO', () => {
  it('computes days left and the renewal state', () => {
    const expiring = toCrmContractDTO(
      createFakeCrmContract({ endDate: new Date('2026-11-14T12:00:00.000Z') }),
      60,
      now,
    )
    expect(expiring).toMatchObject({
      daysLeft: 15,
      renewalState: 'EXPIRING',
      renewalStateLabel: 'A vencer',
      value: 24000,
      companyName: 'Acme',
    })
    const overdue = toCrmContractDTO(
      createFakeCrmContract({ endDate: new Date('2026-10-20T12:00:00.000Z') }),
      60,
      now,
    )
    expect(overdue.renewalState).toBe('OVERDUE')
    const healthy = toCrmContractDTO(
      createFakeCrmContract({ endDate: new Date('2027-10-30T12:00:00.000Z') }),
      60,
      now,
    )
    expect(healthy.renewalState).toBe('HEALTHY')
  })

  it('keeps null values and renewal stamps', () => {
    const dto = toCrmContractDTO(
      createFakeCrmContract({
        value: null,
        alertedAt: now,
        renewalCreatedAt: now,
      }),
      60,
      now,
    )
    expect(dto.value).toBeNull()
    expect(dto.alertedAt).toBe(now.toISOString())
    expect(dto.renewalCreatedAt).toBe(now.toISOString())
  })

  it('defaults to the current time', () => {
    const dto = toCrmContractDTO(
      createFakeCrmContract({
        endDate: new Date(Date.now() + 5 * 86_400_000),
      }),
      60,
    )
    expect(dto.daysLeft).toBeGreaterThanOrEqual(4)
  })
})
