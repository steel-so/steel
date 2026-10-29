import { describe, expect, it, vi } from 'vitest'
import { seedCrmOpportunity } from '@/src/__tests__/factories/crm-opportunity.factory'
import {
  seedCrmPipeline,
  seedCrmPipelineStage,
} from '@/src/__tests__/factories/crm-pipeline.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import {
  PIX_CHARGE_LIST_LIMIT,
  WhatsAppPixChargeRepository,
  WhatsAppPixSettingsRepository,
} from '../whatsapp-pix.repository'

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
      zapiInstanceId: `pix-instance-${counter}`,
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
    amount: 150,
    description: 'Mensalidade',
    brCode: '000201',
    expiresAt: new Date(Date.now() + 3_600_000),
  }
}

describe('WhatsAppPixSettingsRepository', () => {
  it('should return null, then create and update the same row', async () => {
    const workspace = await seedWorkspace()
    expect(
      expectOk(
        await WhatsAppPixSettingsRepository.findByWorkspace(workspace.id),
      ),
    ).toBeNull()

    const created = expectOk(
      await WhatsAppPixSettingsRepository.upsert(workspace.id, {
        enabled: true,
      }),
    )
    expect(created.enabled).toBe(true)
    expect(created.defaultExpiresMinutes).toBe(60)

    const updated = expectOk(
      await WhatsAppPixSettingsRepository.upsert(workspace.id, {
        defaultExpiresMinutes: 30,
      }),
    )
    expect(updated.id).toBe(created.id)
    expect(updated.defaultExpiresMinutes).toBe(30)
  })

  it('should return DATABASE_ERROR when a query throws', async () => {
    vi.spyOn(prisma.whatsAppPixSettings, 'findUnique').mockRejectedValueOnce(
      new Error('boom'),
    )
    expectErr(
      await WhatsAppPixSettingsRepository.findByWorkspace('w'),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppPixSettingsRepository.upsert('missing', {}),
      'DATABASE_ERROR',
    )
  })
})

describe('WhatsAppPixChargeRepository', () => {
  it('should create and find a charge scoped by workspace', async () => {
    const ctx = await seedConversation()
    const created = expectOk(
      await WhatsAppPixChargeRepository.create(chargeData(ctx, 'tx-1')),
    )
    expect(created.status).toBe('PENDING')
    expect(Number(created.amount)).toBe(150)

    const found = expectOk(
      await WhatsAppPixChargeRepository.findById(created.id, ctx.workspace.id),
    )
    expect(found?.id).toBe(created.id)
    expect(
      expectOk(
        await WhatsAppPixChargeRepository.findById(created.id, 'other-ws'),
      ),
    ).toBeNull()

    const byProvider = expectOk(
      await WhatsAppPixChargeRepository.findByProviderCharge('mock', 'tx-1'),
    )
    expect(byProvider?.id).toBe(created.id)
    expect(
      expectOk(
        await WhatsAppPixChargeRepository.findByProviderCharge('mock', 'nope'),
      ),
    ).toBeNull()
  })

  it('should refuse a duplicated provider charge id', async () => {
    const ctx = await seedConversation()
    expectOk(await WhatsAppPixChargeRepository.create(chargeData(ctx, 'dup')))
    expectErr(
      await WhatsAppPixChargeRepository.create(chargeData(ctx, 'dup')),
      'DATABASE_ERROR',
    )
  })

  it('should list by conversation and by opportunity, newest first', async () => {
    const ctx = await seedConversation()
    const pipeline = await seedCrmPipeline(ctx.workspace.id, ctx.user.id)
    const stage = await seedCrmPipelineStage(pipeline.id)
    const opportunity = await seedCrmOpportunity(
      ctx.workspace.id,
      ctx.user.id,
      pipeline.id,
      stage.id,
    )
    const first = expectOk(
      await WhatsAppPixChargeRepository.create(chargeData(ctx, 'l-1')),
    )
    const second = expectOk(
      await WhatsAppPixChargeRepository.create({
        ...chargeData(ctx, 'l-2'),
        opportunityId: opportunity.id,
      }),
    )

    const byConversation = expectOk(
      await WhatsAppPixChargeRepository.listByConversation(
        ctx.conversation.id,
        ctx.workspace.id,
      ),
    )
    expect(byConversation.map((c) => c.id)).toEqual([second.id, first.id])
    expect(PIX_CHARGE_LIST_LIMIT).toBeGreaterThan(0)

    const byOpportunity = expectOk(
      await WhatsAppPixChargeRepository.listByOpportunity(
        opportunity.id,
        ctx.workspace.id,
      ),
    )
    expect(byOpportunity.map((c) => c.id)).toEqual([second.id])
  })

  it('should mark a charge paid once and ignore a repeated notice', async () => {
    const ctx = await seedConversation()
    const charge = expectOk(
      await WhatsAppPixChargeRepository.create(chargeData(ctx, 'paid-1')),
    )
    const paidAt = new Date()
    const paid = expectOk(
      await WhatsAppPixChargeRepository.markPaid(charge.id, {
        paidAt,
        paidAmount: 150,
        endToEndId: 'E123',
        payerName: 'Maria',
      }),
    )
    expect(paid?.status).toBe('PAID')
    expect(paid?.endToEndId).toBe('E123')

    expect(
      expectOk(
        await WhatsAppPixChargeRepository.markPaid(charge.id, {
          paidAt,
          paidAmount: 150,
          endToEndId: null,
          payerName: null,
        }),
      ),
    ).toBeNull()
  })

  it('should cancel only a pending charge', async () => {
    const ctx = await seedConversation()
    const charge = expectOk(
      await WhatsAppPixChargeRepository.create(chargeData(ctx, 'cancel-1')),
    )
    const canceled = expectOk(
      await WhatsAppPixChargeRepository.markCanceled(charge.id),
    )
    expect(canceled?.status).toBe('CANCELED')
    expect(canceled?.canceledAt).toBeInstanceOf(Date)
    expect(
      expectOk(await WhatsAppPixChargeRepository.markCanceled(charge.id)),
    ).toBeNull()
  })

  it('should return DATABASE_ERROR when a query throws', async () => {
    const boom = new Error('boom')
    vi.spyOn(prisma.whatsAppPixCharge, 'findFirst').mockRejectedValueOnce(boom)
    vi.spyOn(prisma.whatsAppPixCharge, 'findUnique').mockRejectedValueOnce(boom)
    vi.spyOn(prisma.whatsAppPixCharge, 'findMany')
      .mockRejectedValueOnce(boom)
      .mockRejectedValueOnce(boom)
    vi.spyOn(prisma.whatsAppPixCharge, 'updateMany')
      .mockRejectedValueOnce(boom)
      .mockRejectedValueOnce(boom)

    expectErr(
      await WhatsAppPixChargeRepository.findById('i', 'w'),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppPixChargeRepository.findByProviderCharge('mock', 'x'),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppPixChargeRepository.listByConversation('c', 'w'),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppPixChargeRepository.listByOpportunity('o', 'w'),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppPixChargeRepository.markPaid('i', {
        paidAt: new Date(),
        paidAmount: 1,
        endToEndId: null,
        payerName: null,
      }),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppPixChargeRepository.markCanceled('i'),
      'DATABASE_ERROR',
    )
  })
})
