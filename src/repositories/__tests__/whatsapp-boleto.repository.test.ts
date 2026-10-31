import { describe, expect, it, vi } from 'vitest'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import {
  BOLETO_CHARGE_LIST_LIMIT,
  WhatsAppBoletoChargeRepository,
  WhatsAppBoletoSettingsRepository,
} from '../whatsapp-boleto.repository'

let counter = 0

async function seedConversation() {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  counter += 1
  const connection = await prisma.whatsAppConnection.create({
    data: {
      workspaceId: workspace.id,
      provider: 'ZAPI',
      label: 'Suporte',
      phoneNumber: '5511999999999',
      zapiInstanceId: `boleto-instance-${counter}`,
      encryptedZapiToken: 'enc:token',
      createdById: user.id,
    },
  })
  const contact = await prisma.whatsAppContact.create({
    data: { workspaceId: workspace.id, waId: '5511988887777', name: 'Maria' },
  })
  const conversation = await prisma.whatsAppConversation.create({
    data: {
      workspaceId: workspace.id,
      connectionId: connection.id,
      contactId: contact.id,
    },
  })
  return { workspace, user, conversation }
}

function chargeData(
  ctx: Awaited<ReturnType<typeof seedConversation>>,
  providerChargeId: string,
) {
  return {
    workspaceId: ctx.workspace.id,
    conversationId: ctx.conversation.id,
    createdById: ctx.user.id,
    provider: 'mock',
    providerChargeId,
    amount: 250,
    description: 'Mensalidade',
    payerName: 'Maria da Silva',
    payerTaxId: '11144477735',
    barCode: '00000.00000 00000.000000 00000.000000 0 00000000000000',
    dueAt: new Date(Date.now() + 3 * 86_400_000),
  }
}

describe('WhatsAppBoletoSettingsRepository', () => {
  it('should return null, then create and update the same row', async () => {
    const workspace = await seedWorkspace()
    expect(
      expectOk(
        await WhatsAppBoletoSettingsRepository.findByWorkspace(workspace.id),
      ),
    ).toBeNull()

    const created = expectOk(
      await WhatsAppBoletoSettingsRepository.upsert(workspace.id, {
        enabled: true,
      }),
    )
    expect(created.enabled).toBe(true)

    const updated = expectOk(
      await WhatsAppBoletoSettingsRepository.upsert(workspace.id, {
        enabled: false,
      }),
    )
    expect(updated.id).toBe(created.id)
    expect(updated.enabled).toBe(false)
  })
})

describe('WhatsAppBoletoChargeRepository', () => {
  it('should create, find and list charges of a conversation', async () => {
    const ctx = await seedConversation()
    const first = expectOk(
      await WhatsAppBoletoChargeRepository.create(chargeData(ctx, 'bol_1')),
    )
    expect(first.status).toBe('PENDING')

    const byId = expectOk(
      await WhatsAppBoletoChargeRepository.findById(first.id, ctx.workspace.id),
    )
    expect(byId?.id).toBe(first.id)
    expect(
      expectOk(
        await WhatsAppBoletoChargeRepository.findById(first.id, 'other'),
      ),
    ).toBeNull()

    const byProvider = expectOk(
      await WhatsAppBoletoChargeRepository.findByProviderCharge('mock', 'bol_1'),
    )
    expect(byProvider?.id).toBe(first.id)

    const list = expectOk(
      await WhatsAppBoletoChargeRepository.listByConversation(
        ctx.conversation.id,
        ctx.workspace.id,
      ),
    )
    expect(list).toHaveLength(1)
    expect(BOLETO_CHARGE_LIST_LIMIT).toBe(50)
  })

  it('should settle once and ignore a repeated payment', async () => {
    const ctx = await seedConversation()
    const charge = expectOk(
      await WhatsAppBoletoChargeRepository.create(chargeData(ctx, 'bol_2')),
    )
    const paid = expectOk(
      await WhatsAppBoletoChargeRepository.markPaid(charge.id, {
        paidAt: new Date(),
        paidAmount: 250,
      }),
    )
    expect(paid?.status).toBe('PAID')
    expect(
      expectOk(
        await WhatsAppBoletoChargeRepository.markPaid(charge.id, {
          paidAt: new Date(),
          paidAmount: 250,
        }),
      ),
    ).toBeNull()

    const refunded = expectOk(
      await WhatsAppBoletoChargeRepository.markRefunded(charge.id),
    )
    expect(refunded?.status).toBe('REFUNDED')
  })

  it('should cancel and expire only pending charges', async () => {
    const ctx = await seedConversation()
    const a = expectOk(
      await WhatsAppBoletoChargeRepository.create(chargeData(ctx, 'bol_3')),
    )
    const b = expectOk(
      await WhatsAppBoletoChargeRepository.create(chargeData(ctx, 'bol_4')),
    )
    const canceled = expectOk(
      await WhatsAppBoletoChargeRepository.markCanceled(a.id),
    )
    expect(canceled?.status).toBe('CANCELED')
    expect(canceled?.canceledAt).not.toBeNull()
    expect(
      expectOk(await WhatsAppBoletoChargeRepository.markCanceled(a.id)),
    ).toBeNull()
    expect(
      expectOk(await WhatsAppBoletoChargeRepository.markRefunded(b.id)),
    ).toBeNull()

    const expired = expectOk(
      await WhatsAppBoletoChargeRepository.markExpired(b.id),
    )
    expect(expired?.status).toBe('EXPIRED')
    expect(
      expectOk(await WhatsAppBoletoChargeRepository.markExpired(b.id)),
    ).toBeNull()
  })

  it('should return DATABASE_ERROR when a query throws', async () => {
    const boom = new Error('boom')
    vi.spyOn(prisma.whatsAppBoletoSettings, 'findUnique').mockRejectedValueOnce(
      boom,
    )
    vi.spyOn(prisma.whatsAppBoletoSettings, 'upsert').mockRejectedValueOnce(boom)
    vi.spyOn(prisma.whatsAppBoletoCharge, 'create').mockRejectedValueOnce(boom)
    vi.spyOn(prisma.whatsAppBoletoCharge, 'findFirst').mockRejectedValueOnce(boom)
    vi.spyOn(prisma.whatsAppBoletoCharge, 'findUnique').mockRejectedValueOnce(
      boom,
    )
    vi.spyOn(prisma.whatsAppBoletoCharge, 'findMany').mockRejectedValueOnce(boom)
    vi.spyOn(prisma.whatsAppBoletoCharge, 'updateMany').mockRejectedValueOnce(
      boom,
    )

    expectErr(
      await WhatsAppBoletoSettingsRepository.findByWorkspace('w'),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppBoletoSettingsRepository.upsert('w', { enabled: true }),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppBoletoChargeRepository.create({} as never),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppBoletoChargeRepository.findById('x', 'w'),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppBoletoChargeRepository.findByProviderCharge('mock', 'x'),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppBoletoChargeRepository.listByConversation('c', 'w'),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppBoletoChargeRepository.markCanceled('x'),
      'DATABASE_ERROR',
    )
  })
})
