import { describe, expect, it, vi } from 'vitest'
import { seedCrmCompany } from '@/src/__tests__/factories/crm-company.factory'
import { seedCrmOpportunity } from '@/src/__tests__/factories/crm-opportunity.factory'
import { seedCrmPerson } from '@/src/__tests__/factories/crm-person.factory'
import { seedCrmProposal } from '@/src/__tests__/factories/crm-proposal.factory'
import { seedHealthWorkspace } from '@/src/__tests__/factories/nov-health-scores.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import type { UpsertCrmDealRoomDTO } from '@/src/schemas/crm-deals.schema'
import { CrmContractRepository } from '../crm-contract.repository'
import { CrmDealRoomRepository } from '../crm-deal-room.repository'
import { CrmDealsSettingsRepository } from '../crm-deals-settings.repository'
import {
  CrmProposalChargeRepository,
  CrmProposalSignatureRepository,
} from '../crm-proposal-payment.repository'

const DAY = 86_400_000
const now = new Date('2026-10-30T12:00:00.000Z')
const inDays = (n: number) => new Date(now.getTime() + n * DAY)

async function seed() {
  const ctx = await seedHealthWorkspace()
  const company = await seedCrmCompany(ctx.workspace.id, ctx.user.id, {
    name: 'Acme',
  })
  const deal = await seedCrmOpportunity(
    ctx.workspace.id,
    ctx.user.id,
    ctx.pipeline.id,
    ctx.open.id,
    { name: 'Negócio', companyId: company.id },
  )
  const proposal = await seedCrmProposal(ctx.workspace.id, ctx.user.id, {
    status: 'SENT',
    opportunityId: deal.id,
  })
  return { ...ctx, company, deal, proposal }
}

describe('CrmDealsSettingsRepository', () => {
  it('reads nothing, then upserts and updates in place', async () => {
    const { workspace, user } = await seedHealthWorkspace()
    expect(expectOk(await CrmDealsSettingsRepository.findByWorkspace(workspace.id))).toBeNull()

    const created = expectOk(
      await CrmDealsSettingsRepository.upsert(workspace.id, user.id, {
        proposalPaymentEnabled: true,
      }),
    )
    expect(created).toMatchObject({
      proposalPaymentEnabled: true,
      proposalSignatureEnabled: false,
      renewalLeadDays: 60,
    })

    const updated = expectOk(
      await CrmDealsSettingsRepository.upsert(workspace.id, user.id, {
        renewalLeadDays: 30,
      }),
    )
    expect(updated.id).toBe(created.id)
    expect(updated.proposalPaymentEnabled).toBe(true)
    expect(updated.renewalLeadDays).toBe(30)
  })

  it('wraps a database failure', async () => {
    vi.spyOn(prisma.crmDealsSettings, 'findUnique').mockRejectedValueOnce(new Error('x'))
    expectErr(await CrmDealsSettingsRepository.findByWorkspace('w'), 'DATABASE_ERROR')
    vi.spyOn(prisma.crmDealsSettings, 'upsert').mockRejectedValueOnce(new Error('x'))
    expectErr(await CrmDealsSettingsRepository.upsert('w', 'u', {}), 'DATABASE_ERROR')
  })
})

describe('CrmProposalChargeRepository', () => {
  async function charge(overrides = {}) {
    const ctx = await seed()
    const created = expectOk(
      await CrmProposalChargeRepository.create({
        workspaceId: ctx.workspace.id,
        proposalId: ctx.proposal.id,
        opportunityId: ctx.deal.id,
        createdById: ctx.user.id,
        method: 'PIX',
        provider: 'mock',
        providerChargeId: `tx-${Math.random()}`,
        amount: 1500.5,
        description: 'Proposta',
        paymentCode: 'BR',
        expiresAt: inDays(7),
        ...overrides,
      }),
    )
    return { ctx, created }
  }

  it('creates, finds by id and by provider id, and scopes by workspace', async () => {
    const { ctx, created } = await charge()
    expect(Number(created.amount)).toBe(1500.5)
    expect(created.status).toBe('PENDING')

    const found = expectOk(
      await CrmProposalChargeRepository.findById(created.id, ctx.workspace.id),
    )
    expect(found.id).toBe(created.id)
    expectErr(
      await CrmProposalChargeRepository.findById(created.id, 'other'),
      'CRM_PROPOSAL_CHARGE_NOT_FOUND',
    )

    const byProvider = expectOk(
      await CrmProposalChargeRepository.findByProviderCharge('mock', created.providerChargeId),
    )
    expect(byProvider?.id).toBe(created.id)
    expect(
      expectOk(await CrmProposalChargeRepository.findByProviderCharge('mock', 'nope')),
    ).toBeNull()

    const list = expectOk(
      await CrmProposalChargeRepository.listByProposal(ctx.proposal.id, ctx.workspace.id),
    )
    expect(list.map((c) => c.id)).toEqual([created.id])
  })

  it('settles once: the second payment notice finds nothing to do', async () => {
    const { created } = await charge()
    const paid = expectOk(
      await CrmProposalChargeRepository.markPaid(created.id, {
        paidAt: now,
        paidAmount: 1500.5,
        endToEndId: 'E2E',
        payerName: 'Ana',
      }),
    )
    expect(paid).toMatchObject({ status: 'PAID', payerName: 'Ana', endToEndId: 'E2E' })
    expect(Number(paid?.paidAmount)).toBe(1500.5)
    expect(
      expectOk(
        await CrmProposalChargeRepository.markPaid(created.id, {
          paidAt: now,
          paidAmount: 1,
          endToEndId: null,
          payerName: null,
        }),
      ),
    ).toBeNull()
  })

  it('cancels only a pending charge', async () => {
    const { created } = await charge()
    const canceled = expectOk(await CrmProposalChargeRepository.markCanceled(created.id))
    expect(canceled?.status).toBe('CANCELED')
    expect(canceled?.canceledAt).toBeInstanceOf(Date)
    expect(expectOk(await CrmProposalChargeRepository.markCanceled(created.id))).toBeNull()
  })

  it('detaches the charge from a deal that is deleted', async () => {
    const { ctx, created } = await charge()
    await prisma.crmOpportunity.delete({ where: { id: ctx.deal.id } })
    const found = expectOk(
      await CrmProposalChargeRepository.findById(created.id, ctx.workspace.id),
    )
    expect(found.opportunityId).toBeNull()
  })

  it('wraps database failures', async () => {
    vi.spyOn(prisma.crmProposalCharge, 'create').mockRejectedValueOnce(new Error('x'))
    expectErr(
      await CrmProposalChargeRepository.create({
        workspaceId: 'w',
        proposalId: 'p',
        opportunityId: null,
        createdById: null,
        method: 'PIX',
        provider: 'mock',
        providerChargeId: 'x',
        amount: 1,
        description: 'x',
        paymentCode: 'x',
        expiresAt: now,
      }),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.crmProposalCharge, 'findMany').mockRejectedValueOnce(new Error('x'))
    expectErr(await CrmProposalChargeRepository.listByProposal('p', 'w'), 'DATABASE_ERROR')
    vi.spyOn(prisma.crmProposalCharge, 'findFirst').mockRejectedValueOnce(new Error('x'))
    expectErr(await CrmProposalChargeRepository.findById('i', 'w'), 'DATABASE_ERROR')
    vi.spyOn(prisma.crmProposalCharge, 'findUnique').mockRejectedValueOnce(new Error('x'))
    expectErr(
      await CrmProposalChargeRepository.findByProviderCharge('m', 'x'),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.crmProposalCharge, 'updateMany').mockRejectedValueOnce(new Error('x'))
    expectErr(
      await CrmProposalChargeRepository.markPaid('i', {
        paidAt: now,
        paidAmount: 1,
        endToEndId: null,
        payerName: null,
      }),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.crmProposalCharge, 'updateMany').mockRejectedValueOnce(new Error('x'))
    expectErr(await CrmProposalChargeRepository.markCanceled('i'), 'DATABASE_ERROR')
  })
})

describe('CrmProposalSignatureRepository', () => {
  it('stores signatures and finds the latest', async () => {
    const ctx = await seed()
    const base = {
      workspaceId: ctx.workspace.id,
      proposalId: ctx.proposal.id,
      signerName: 'Carlos',
      signerDocument: null,
      signerEmail: null,
      storageKey: 'k',
      imageSha256: 'a',
      proposalSha256: 'b',
      ipHash: 'c',
    }
    expect(
      expectOk(await CrmProposalSignatureRepository.latestByProposal(ctx.proposal.id)),
    ).toBeNull()
    const first = expectOk(
      await CrmProposalSignatureRepository.create({ ...base, id: 's1', signedAt: inDays(-2) }),
    )
    const second = expectOk(
      await CrmProposalSignatureRepository.create({ ...base, id: 's2', signedAt: inDays(-1) }),
    )
    expect(
      expectOk(await CrmProposalSignatureRepository.latestByProposal(ctx.proposal.id))?.id,
    ).toBe(second.id)
    expect(
      expectOk(
        await CrmProposalSignatureRepository.listByProposal(ctx.proposal.id, ctx.workspace.id),
      ).map((s) => s.id),
    ).toEqual(['s2', first.id])
    expect(
      expectOk(
        await CrmProposalSignatureRepository.findById('s1', ctx.proposal.id, ctx.workspace.id),
      ).signerName,
    ).toBe('Carlos')
    expectErr(
      await CrmProposalSignatureRepository.findById('s1', 'other', ctx.workspace.id),
      'CRM_PROPOSAL_SIGNATURE_NOT_FOUND',
    )
  })

  it('wraps database failures', async () => {
    vi.spyOn(prisma.crmProposalSignature, 'create').mockRejectedValueOnce(new Error('x'))
    expectErr(
      await CrmProposalSignatureRepository.create({
        id: 'i',
        workspaceId: 'w',
        proposalId: 'p',
        signerName: 'x',
        signerDocument: null,
        signerEmail: null,
        storageKey: 'k',
        imageSha256: 'a',
        proposalSha256: 'b',
        ipHash: 'c',
        signedAt: now,
      }),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.crmProposalSignature, 'findMany').mockRejectedValueOnce(new Error('x'))
    expectErr(await CrmProposalSignatureRepository.listByProposal('p', 'w'), 'DATABASE_ERROR')
    vi.spyOn(prisma.crmProposalSignature, 'findFirst').mockRejectedValueOnce(new Error('x'))
    expectErr(await CrmProposalSignatureRepository.findById('i', 'p', 'w'), 'DATABASE_ERROR')
    vi.spyOn(prisma.crmProposalSignature, 'findFirst').mockRejectedValueOnce(new Error('x'))
    expectErr(await CrmProposalSignatureRepository.latestByProposal('p'), 'DATABASE_ERROR')
  })
})

describe('CrmDealRoomRepository', () => {
  it('creates a room, then replaces materials and actions by id', async () => {
    const ctx = await seed()
    const input = (data: UpsertCrmDealRoomDTO) => ({
      workspaceId: ctx.workspace.id,
      opportunityId: ctx.deal.id,
      actorId: ctx.user.id,
      actorName: 'Equipe',
      now,
      data,
    })

    expect(
      expectOk(await CrmDealRoomRepository.findByOpportunity(ctx.deal.id, ctx.workspace.id)),
    ).toBeNull()

    const room = expectOk(
      await CrmDealRoomRepository.upsert(
        input({
          enabled: true,
          title: 'Sala',
          welcomeMessage: 'Oi',
          materials: [
            { title: 'A', url: 'https://a.example' },
            { title: 'B', url: 'https://b.example' },
          ],
          actions: [
            { title: 'Cliente', owner: 'CUSTOMER', dueDate: inDays(3) },
            { title: 'Vendedor', owner: 'SELLER', done: true },
          ],
        }),
      ),
    )
    expect(room.token.length).toBeGreaterThan(20)
    expect(room.materials.map((m) => m.title)).toEqual(['A', 'B'])
    expect(room.actions.map((a) => [a.title, a.doneAt !== null])).toEqual([
      ['Cliente', false],
      ['Vendedor', true],
    ])
    expect(room.actions[1]?.doneByLabel).toBe('Equipe')

    const [materialA] = room.materials
    const [customerAction, sellerAction] = room.actions
    const doneAt = sellerAction?.doneAt

    const edited = expectOk(
      await CrmDealRoomRepository.upsert(
        input({
          welcomeMessage: null,
          materials: [{ id: materialA?.id, title: 'A2', url: 'https://a2.example' }],
          actions: [
            { id: sellerAction?.id, title: 'Vendedor 2', owner: 'SELLER', done: true },
            { id: customerAction?.id, title: 'Cliente', owner: 'CUSTOMER', done: false },
            { title: 'Nova', owner: 'CUSTOMER' },
          ],
        }),
      ),
    )
    expect(edited.id).toBe(room.id)
    expect(edited.token).toBe(room.token)
    expect(edited.welcomeMessage).toBeNull()
    expect(edited.materials.map((m) => m.title)).toEqual(['A2'])
    expect(edited.actions.map((a) => a.title)).toEqual(['Vendedor 2', 'Cliente', 'Nova'])
    // The first check is kept: a later save does not rewrite when it was done.
    expect(edited.actions[0]?.doneAt?.toISOString()).toBe(doneAt?.toISOString())

    const unchecked = expectOk(
      await CrmDealRoomRepository.upsert(
        input({
          actions: [{ id: sellerAction?.id, title: 'Vendedor 2', owner: 'SELLER', done: false }],
        }),
      ),
    )
    expect(unchecked.actions).toHaveLength(1)
    expect(unchecked.actions[0]?.doneAt).toBeNull()

    const rotated = expectOk(
      await CrmDealRoomRepository.upsert(input({ rotateToken: true, enabled: false })),
    )
    expect(rotated.token).not.toBe(room.token)
    expect(rotated.enabled).toBe(false)
  })

  it('serves only enabled rooms by token, with the public details', async () => {
    const ctx = await seed()
    const room = expectOk(
      await CrmDealRoomRepository.upsert({
        workspaceId: ctx.workspace.id,
        opportunityId: ctx.deal.id,
        actorId: ctx.user.id,
        actorName: 'Equipe',
        now,
        data: { enabled: true, proposalId: ctx.proposal.id },
      }),
    )
    const pub = expectOk(await CrmDealRoomRepository.findPublicByToken(room.token))
    expect(pub.opportunity.company?.name).toBe('Acme')
    expect(pub.proposal?.id).toBe(ctx.proposal.id)
    expectErr(await CrmDealRoomRepository.findPublicByToken('nope'), 'CRM_DEAL_ROOM_NOT_FOUND')
    await prisma.crmDealRoom.update({ where: { id: room.id }, data: { enabled: false } })
    expectErr(await CrmDealRoomRepository.findPublicByToken(room.token), 'CRM_DEAL_ROOM_NOT_FOUND')
  })

  it('tracks visitors, events, messages and the customer plan', async () => {
    const ctx = await seed()
    const room = expectOk(
      await CrmDealRoomRepository.upsert({
        workspaceId: ctx.workspace.id,
        opportunityId: ctx.deal.id,
        actorId: ctx.user.id,
        actorName: 'Equipe',
        now,
        data: {
          actions: [
            { title: 'Cliente', owner: 'CUSTOMER' },
            { title: 'Vendedor', owner: 'SELLER' },
          ],
        },
      }),
    )

    const visitor = expectOk(
      await CrmDealRoomRepository.upsertVisitor({
        roomId: room.id,
        name: 'Ana',
        email: 'ana@example.com',
        ipHash: 'h1',
      }),
    )
    const again = expectOk(
      await CrmDealRoomRepository.upsertVisitor({
        roomId: room.id,
        name: 'Ana Souza',
        email: 'ana@example.com',
        ipHash: 'h2',
      }),
    )
    expect(again.id).toBe(visitor.id)
    expect(again.name).toBe('Ana Souza')
    expect(
      expectOk(await CrmDealRoomRepository.findVisitor(room.id, visitor.id))?.ipHash,
    ).toBe('h2')
    expect(expectOk(await CrmDealRoomRepository.findVisitor(room.id, 'nope'))).toBeNull()
    expect(expectOk(await CrmDealRoomRepository.listVisitors(room.id))).toHaveLength(1)

    expectOk(
      await CrmDealRoomRepository.createEvent({
        roomId: room.id,
        visitorId: visitor.id,
        kind: 'PROPOSAL_VIEWED',
        targetLabel: 'Proposta',
      }),
    )
    expectOk(
      await CrmDealRoomRepository.createEvent({
        roomId: room.id,
        visitorId: null,
        kind: 'ROOM_OPENED',
      }),
    )
    const events = expectOk(await CrmDealRoomRepository.listEvents(room.id, 10))
    expect(events).toHaveLength(2)
    expect(events.find((e) => e.visitor)?.visitor?.name).toBe('Ana Souza')

    await CrmDealRoomRepository.createMessage({
      roomId: room.id,
      authorKind: 'CUSTOMER',
      authorUserId: null,
      authorName: 'Ana',
      visitorId: visitor.id,
      body: 'primeira',
    })
    await CrmDealRoomRepository.createMessage({
      roomId: room.id,
      authorKind: 'SELLER',
      authorUserId: ctx.user.id,
      authorName: 'Vendedor',
      visitorId: null,
      body: 'segunda',
    })
    const messages = expectOk(await CrmDealRoomRepository.listMessages(room.id, 10))
    expect(messages.map((m) => m.body)).toEqual(['primeira', 'segunda'])
    expect(
      expectOk(await CrmDealRoomRepository.listMessages(room.id, 1)).map((m) => m.body),
    ).toEqual(['segunda'])

    const [customerAction, sellerAction] = room.actions
    expect(
      expectOk(
        await CrmDealRoomRepository.setActionDone(
          room.id,
          sellerAction?.id ?? '',
          true,
          'Ana',
          now,
          'CUSTOMER',
        ),
      ),
    ).toBeNull()
    expect(
      expectOk(
        await CrmDealRoomRepository.setActionDone(
          room.id,
          customerAction?.id ?? '',
          true,
          'Ana',
          now,
          'CUSTOMER',
        ),
      ),
    ).toEqual({ id: customerAction?.id, title: 'Cliente' })
    const checked = await prisma.crmDealRoomAction.findUnique({
      where: { id: customerAction?.id ?? '' },
    })
    expect(checked?.doneByLabel).toBe('Ana')
    expectOk(
      await CrmDealRoomRepository.setActionDone(room.id, customerAction?.id ?? '', false, 'Ana', now),
    )
    expect(
      (await prisma.crmDealRoomAction.findUnique({ where: { id: customerAction?.id ?? '' } }))
        ?.doneAt,
    ).toBeNull()
  })

  it('wraps database failures', async () => {
    vi.spyOn(prisma.crmDealRoom, 'findFirst').mockRejectedValueOnce(new Error('x'))
    expectErr(await CrmDealRoomRepository.findByOpportunity('o', 'w'), 'DATABASE_ERROR')
    vi.spyOn(prisma.crmDealRoom, 'findFirst').mockRejectedValueOnce(new Error('x'))
    expectErr(await CrmDealRoomRepository.findPublicByToken('t'), 'DATABASE_ERROR')
    vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('x'))
    expectErr(
      await CrmDealRoomRepository.upsert({
        workspaceId: 'w',
        opportunityId: 'o',
        actorId: 'u',
        actorName: 'x',
        now,
        data: {},
      }),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.crmDealRoomVisitor, 'findMany').mockRejectedValueOnce(new Error('x'))
    expectErr(await CrmDealRoomRepository.listVisitors('r'), 'DATABASE_ERROR')
    vi.spyOn(prisma.crmDealRoomEvent, 'findMany').mockRejectedValueOnce(new Error('x'))
    expectErr(await CrmDealRoomRepository.listEvents('r', 5), 'DATABASE_ERROR')
    vi.spyOn(prisma.crmDealRoomMessage, 'findMany').mockRejectedValueOnce(new Error('x'))
    expectErr(await CrmDealRoomRepository.listMessages('r', 5), 'DATABASE_ERROR')
    vi.spyOn(prisma.crmDealRoomMessage, 'create').mockRejectedValueOnce(new Error('x'))
    expectErr(
      await CrmDealRoomRepository.createMessage({
        roomId: 'r',
        authorKind: 'SELLER',
        authorUserId: null,
        authorName: 'x',
        visitorId: null,
        body: 'x',
      }),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.crmDealRoomVisitor, 'upsert').mockRejectedValueOnce(new Error('x'))
    expectErr(
      await CrmDealRoomRepository.upsertVisitor({
        roomId: 'r',
        name: 'x',
        email: 'x@x.com',
        ipHash: null,
      }),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.crmDealRoomVisitor, 'findFirst').mockRejectedValueOnce(new Error('x'))
    expectErr(await CrmDealRoomRepository.findVisitor('r', 'v'), 'DATABASE_ERROR')
    vi.spyOn(prisma.crmDealRoomEvent, 'create').mockRejectedValueOnce(new Error('x'))
    expectErr(
      await CrmDealRoomRepository.createEvent({ roomId: 'r', visitorId: null, kind: 'ROOM_OPENED' }),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.crmDealRoomAction, 'findFirst').mockRejectedValueOnce(new Error('x'))
    expectErr(
      await CrmDealRoomRepository.setActionDone('r', 'a', true, 'x', now),
      'DATABASE_ERROR',
    )
  })
})

describe('CrmContractRepository', () => {
  async function contract(
    ctx: Awaited<ReturnType<typeof seed>>,
    overrides: Partial<Parameters<typeof CrmContractRepository.create>[0]> = {},
  ) {
    return expectOk(
      await CrmContractRepository.create({
        workspaceId: ctx.workspace.id,
        companyId: ctx.company.id,
        opportunityId: null,
        ownerId: null,
        createdById: ctx.user.id,
        name: 'Plano',
        value: 1000,
        startDate: inDays(-300),
        endDate: inDays(30),
        autoRenews: false,
        notes: null,
        ...overrides,
      }),
    )
  }

  it('creates, lists with filters, updates and soft-deletes', async () => {
    const ctx = await seed()
    const soon = await contract(ctx, { name: 'Perto', endDate: inDays(10) })
    const far = await contract(ctx, { name: 'Longe', endDate: inDays(300) })
    expect(Number(soon.value)).toBe(1000)
    expect(soon.company.name).toBe('Acme')

    expect(
      expectOk(await CrmContractRepository.list(ctx.workspace.id, {})).map((c) => c.name),
    ).toEqual(['Perto', 'Longe'])
    expect(
      expectOk(
        await CrmContractRepository.list(ctx.workspace.id, { endsBefore: inDays(60) }),
      ).map((c) => c.name),
    ).toEqual(['Perto'])
    expect(
      expectOk(
        await CrmContractRepository.list(ctx.workspace.id, {
          status: 'CANCELED',
          companyId: ctx.company.id,
        }),
      ),
    ).toEqual([])

    const updated = expectOk(
      await CrmContractRepository.update(far.id, { status: 'CANCELED', alertedAt: now }),
    )
    expect(updated.status).toBe('CANCELED')

    expect(
      expectOk(await CrmContractRepository.findById(soon.id, ctx.workspace.id)).name,
    ).toBe('Perto')
    expectErr(
      await CrmContractRepository.findById(soon.id, 'other'),
      'CRM_CONTRACT_NOT_FOUND',
    )
    expectOk(await CrmContractRepository.softDelete(soon.id))
    expectErr(
      await CrmContractRepository.findById(soon.id, ctx.workspace.id),
      'CRM_CONTRACT_NOT_FOUND',
    )
  })

  it('finds the contracts to alert, to renew, to roll and to expire', async () => {
    const ctx = await seed()
    const fresh = await contract(ctx, { name: 'Novo', endDate: inDays(20) })
    await contract(ctx, { name: 'Já avisado', endDate: inDays(20) }).then((c) =>
      CrmContractRepository.update(c.id, { alertedAt: now, renewalOpportunityId: ctx.deal.id }),
    )
    await contract(ctx, { name: 'Longe', endDate: inDays(400) })
    await contract(ctx, { name: 'Vencido', endDate: inDays(-3) })
    const auto = await contract(ctx, {
      name: 'Automático',
      endDate: inDays(-2),
      autoRenews: true,
    })
    const window = inDays(60)

    expect(
      expectOk(await CrmContractRepository.listToAlert(ctx.workspace.id, window))
        .map((c) => c.name)
        .sort(),
    ).toEqual(['Automático', 'Novo', 'Vencido'])
    expect(
      expectOk(await CrmContractRepository.listToRenew(ctx.workspace.id, window))
        .map((c) => c.name)
        .sort(),
    ).toEqual(['Automático', 'Novo', 'Vencido'])
    expect(
      expectOk(await CrmContractRepository.listAutoRenewDue(ctx.workspace.id, now)).map(
        (c) => c.id,
      ),
    ).toEqual([auto.id])

    expect(expectOk(await CrmContractRepository.expireEnded(ctx.workspace.id, now))).toBe(1)
    expect(
      expectOk(
        await CrmContractRepository.list(ctx.workspace.id, { status: 'EXPIRED' }),
      ).map((c) => c.name),
    ).toEqual(['Vencido'])
    expect(fresh.status).toBe('ACTIVE')
  })

  it('reads the products sold to customers, the latest survey and the health', async () => {
    const ctx = await seed()
    const won = await seedCrmOpportunity(
      ctx.workspace.id,
      ctx.user.id,
      ctx.pipeline.id,
      ctx.won.id,
      { name: 'Ganho', companyId: ctx.company.id },
    )
    const product = await prisma.crmProduct.create({
      data: {
        workspaceId: ctx.workspace.id,
        createdById: ctx.user.id,
        name: 'CRM',
      },
    })
    await prisma.crmOpportunityLineItem.createMany({
      data: [
        { opportunityId: won.id, productId: product.id, name: 'CRM', unitPrice: 99 },
        { opportunityId: won.id, name: 'Sem produto', unitPrice: 5 },
        { opportunityId: ctx.deal.id, productId: product.id, name: 'Aberto', unitPrice: 1 },
      ],
    })
    expect(expectOk(await CrmContractRepository.wonProductRows(ctx.workspace.id))).toEqual([
      { productId: product.id, name: 'CRM', unitPrice: 99, companyId: ctx.company.id },
    ])

    expect(
      expectOk(await CrmContractRepository.latestSatisfaction(ctx.workspace.id, ctx.company.id)),
    ).toBeNull()
    await seedCrmPerson(ctx.workspace.id, ctx.user.id, {
      companyId: ctx.company.id,
      emails: ['Ana@Example.com'],
      phones: ['(11) 99999-0000'],
    })
    const survey = (overrides: object) =>
      prisma.satisfactionSurvey.create({
        data: {
          workspaceId: ctx.workspace.id,
          kind: 'NPS',
          trigger: 'TICKET_RESOLVED',
          channel: 'EMAIL',
          status: 'ANSWERED',
          token: `t-${Math.random()}`,
          scheduledFor: now,
          expiresAt: inDays(3),
          ...overrides,
        },
      })
    await survey({ recipientEmail: 'ana@example.com', score: 6, answeredAt: inDays(-10) })
    await survey({ recipientPhone: '5511999990000', score: 10, answeredAt: inDays(-1) })
    await survey({ recipientEmail: 'outra@example.com', score: 1, answeredAt: now })
    const latest = expectOk(
      await CrmContractRepository.latestSatisfaction(ctx.workspace.id, ctx.company.id),
    )
    expect(latest?.score).toBe(10)
    expect(latest?.kind).toBe('NPS')

    expect(
      expectOk(await CrmContractRepository.customerHealthLevel(ctx.workspace.id, ctx.company.id)),
    ).toBeNull()
    await prisma.crmCustomerHealth.create({
      data: {
        workspaceId: ctx.workspace.id,
        companyId: ctx.company.id,
        riskScore: 80,
        level: 'HIGH',
        nextAction: { key: 'k', label: 'l', detail: 'd' },
      },
    })
    expect(
      expectOk(await CrmContractRepository.customerHealthLevel(ctx.workspace.id, ctx.company.id)),
    ).toBe('HIGH')
  })

  it('has no survey for a company whose people have no contact data', async () => {
    const ctx = await seed()
    await seedCrmPerson(ctx.workspace.id, ctx.user.id, {
      companyId: ctx.company.id,
      emails: [],
      phones: [],
    })
    expect(
      expectOk(await CrmContractRepository.latestSatisfaction(ctx.workspace.id, ctx.company.id)),
    ).toBeNull()
  })

  it('wraps database failures', async () => {
    const fail = new Error('x')
    vi.spyOn(prisma.crmContract, 'findMany').mockRejectedValueOnce(fail)
    expectErr(await CrmContractRepository.list('w', {}), 'DATABASE_ERROR')
    vi.spyOn(prisma.crmContract, 'findFirst').mockRejectedValueOnce(fail)
    expectErr(await CrmContractRepository.findById('i', 'w'), 'DATABASE_ERROR')
    vi.spyOn(prisma.crmContract, 'create').mockRejectedValueOnce(fail)
    expectErr(
      await CrmContractRepository.create({
        workspaceId: 'w',
        companyId: 'c',
        opportunityId: null,
        ownerId: null,
        createdById: 'u',
        name: 'x',
        value: null,
        startDate: now,
        endDate: inDays(1),
        autoRenews: false,
        notes: null,
      }),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.crmContract, 'update').mockRejectedValueOnce(fail)
    expectErr(await CrmContractRepository.update('i', {}), 'DATABASE_ERROR')
    vi.spyOn(prisma.crmContract, 'update').mockRejectedValueOnce(fail)
    expectErr(await CrmContractRepository.softDelete('i'), 'DATABASE_ERROR')
    vi.spyOn(prisma.crmContract, 'findMany').mockRejectedValueOnce(fail)
    expectErr(await CrmContractRepository.listToAlert('w', now), 'DATABASE_ERROR')
    vi.spyOn(prisma.crmContract, 'findMany').mockRejectedValueOnce(fail)
    expectErr(await CrmContractRepository.listToRenew('w', now), 'DATABASE_ERROR')
    vi.spyOn(prisma.crmContract, 'updateMany').mockRejectedValueOnce(fail)
    expectErr(await CrmContractRepository.expireEnded('w', now), 'DATABASE_ERROR')
    vi.spyOn(prisma.crmContract, 'findMany').mockRejectedValueOnce(fail)
    expectErr(await CrmContractRepository.listAutoRenewDue('w', now), 'DATABASE_ERROR')
    vi.spyOn(prisma.crmOpportunityLineItem, 'findMany').mockRejectedValueOnce(fail)
    expectErr(await CrmContractRepository.wonProductRows('w'), 'DATABASE_ERROR')
    vi.spyOn(prisma.crmPerson, 'findMany').mockRejectedValueOnce(fail)
    expectErr(await CrmContractRepository.latestSatisfaction('w', 'c'), 'DATABASE_ERROR')
    vi.spyOn(prisma.crmCustomerHealth, 'findFirst').mockRejectedValueOnce(fail)
    expectErr(await CrmContractRepository.customerHealthLevel('w', 'c'), 'DATABASE_ERROR')
  })
})
