import { describe, expect, it, vi } from 'vitest'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import {
  type WhatsAppAdReferralInput,
  WhatsAppAdRepository,
} from '../whatsapp-ad.repository'

let counter = 0

async function seedFixtures() {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  counter += 1
  const contact = await prisma.whatsAppContact.create({
    data: { workspaceId: workspace.id, waId: `55119888${counter}` },
  })
  return { workspace, user, contact }
}

function referral(
  base: Pick<WhatsAppAdReferralInput, 'workspaceId' | 'contactId'>,
  overrides: Partial<WhatsAppAdReferralInput> = {},
): WhatsAppAdReferralInput {
  counter += 1
  return {
    ...base,
    conversationId: `conv-${counter}`,
    providerMessageId: `wamid.${counter}`,
    sourceType: 'ad',
    sourceId: 'ad1',
    ...overrides,
  }
}

describe('WhatsAppAdRepository settings', () => {
  it('is null before the first save, then upserts', async () => {
    const { workspace, user } = await seedFixtures()
    expect(
      expectOk(await WhatsAppAdRepository.findSettings(workspace.id)),
    ).toBeNull()

    await WhatsAppAdRepository.upsertSettings(workspace.id, {
      enabled: true,
      updatedById: user.id,
    })
    const saved = expectOk(
      await WhatsAppAdRepository.upsertSettings(workspace.id, {
        createLeads: true,
      }),
    )
    expect(saved).toMatchObject({
      enabled: true,
      createLeads: true,
      leadSource: 'Anúncio Click-to-WhatsApp',
    })
    expect(
      expectOk(await WhatsAppAdRepository.findSettings(workspace.id)),
    ).toMatchObject({ createLeads: true })
  })
})

describe('WhatsAppAdRepository referrals', () => {
  it('is idempotent on the provider message id', async () => {
    const { workspace, contact } = await seedFixtures()
    const data = referral({ workspaceId: workspace.id, contactId: contact.id })

    const first = expectOk(await WhatsAppAdRepository.createReferral(data))
    expect(first?.sourceId).toBe('ad1')
    expect(expectOk(await WhatsAppAdRepository.createReferral(data))).toBeNull()
    expect(await prisma.whatsAppAdReferral.count()).toBe(1)
  })

  it('finds the latest referral of a conversation, scoped to the workspace', async () => {
    const { workspace, contact } = await seedFixtures()
    const base = { workspaceId: workspace.id, contactId: contact.id }
    await WhatsAppAdRepository.createReferral(
      referral(base, {
        conversationId: 'cv-x',
        headline: 'Antigo',
        receivedAt: new Date('2026-10-01T00:00:00Z'),
      }),
    )
    await WhatsAppAdRepository.createReferral(
      referral(base, {
        conversationId: 'cv-x',
        headline: 'Novo',
        receivedAt: new Date('2026-10-02T00:00:00Z'),
      }),
    )

    expect(
      expectOk(
        await WhatsAppAdRepository.findLatestByConversation(
          workspace.id,
          'cv-x',
        ),
      )?.headline,
    ).toBe('Novo')
    expect(
      expectOk(
        await WhatsAppAdRepository.findLatestByConversation('other', 'cv-x'),
      ),
    ).toBeNull()
  })

  it('links a lead and answers first-touch questions', async () => {
    const { workspace, contact } = await seedFixtures()
    const created = expectOk(
      await WhatsAppAdRepository.createReferral(
        referral({ workspaceId: workspace.id, contactId: contact.id }),
      ),
    )
    expect(
      expectOk(
        await WhatsAppAdRepository.leadHasReferral(workspace.id, 'lead1'),
      ),
    ).toBe(false)

    const linked = expectOk(
      await WhatsAppAdRepository.linkLead(created?.id ?? '', 'lead1'),
    )
    expect(linked.leadId).toBe('lead1')
    expect(
      expectOk(
        await WhatsAppAdRepository.leadHasReferral(workspace.id, 'lead1'),
      ),
    ).toBe(true)
  })

  it('lists the referrals of a range, oldest first', async () => {
    const { workspace, contact } = await seedFixtures()
    const base = { workspaceId: workspace.id, contactId: contact.id }
    await WhatsAppAdRepository.createReferral(
      referral(base, { receivedAt: new Date('2026-10-05T12:00:00Z') }),
    )
    await WhatsAppAdRepository.createReferral(
      referral(base, { receivedAt: new Date('2026-10-02T12:00:00Z') }),
    )
    await WhatsAppAdRepository.createReferral(
      referral(base, { receivedAt: new Date('2026-11-02T12:00:00Z') }),
    )

    const rows = expectOk(
      await WhatsAppAdRepository.listReferralsInRange(
        workspace.id,
        new Date('2026-10-01T00:00:00Z'),
        new Date('2026-11-01T00:00:00Z'),
      ),
    )
    expect(rows.map((row) => row.receivedAt.toISOString())).toEqual([
      '2026-10-02T12:00:00.000Z',
      '2026-10-05T12:00:00.000Z',
    ])
  })
})

describe('WhatsAppAdRepository lead outcomes', () => {
  it('returns nothing for no ids and skips deleted or foreign leads', async () => {
    const { workspace, user } = await seedFixtures()
    const other = await seedWorkspace()
    expect(
      expectOk(await WhatsAppAdRepository.listLeadOutcomes(workspace.id, [])),
    ).toEqual([])

    const make = (workspaceId: string, extra = {}) =>
      prisma.crmLead.create({
        data: {
          workspaceId,
          name: 'Lead',
          phones: ['5511900000000'],
          createdById: user.id,
          ...extra,
        },
      })
    const won = await make(workspace.id, {
      closeResult: 'WON',
      closedAmount: 1500.5,
    })
    const open = await make(workspace.id)
    const deleted = await make(workspace.id, { deletedAt: new Date() })
    const foreign = await make(other.id)

    const rows = expectOk(
      await WhatsAppAdRepository.listLeadOutcomes(workspace.id, [
        won.id,
        open.id,
        deleted.id,
        foreign.id,
      ]),
    )
    expect(rows.sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      [
        { id: won.id, closeResult: 'WON', closedAmount: 1500.5 },
        { id: open.id, closeResult: null, closedAmount: null },
      ].sort((a, b) => a.id.localeCompare(b.id)),
    )
  })
})

describe('WhatsAppAdRepository spends', () => {
  const day = (value: string) => new Date(`${value}T00:00:00Z`)

  it('creates, lists, filters by overlap and deletes inside the workspace', async () => {
    const { workspace, user } = await seedFixtures()
    const other = await seedWorkspace()
    const base = { workspaceId: workspace.id, createdById: user.id }

    const october = expectOk(
      await WhatsAppAdRepository.createSpend({
        ...base,
        sourceId: 'ad1',
        periodStart: day('2026-10-01'),
        periodEnd: day('2026-10-10'),
        amount: 1000,
      }),
    )
    await WhatsAppAdRepository.createSpend({
      ...base,
      sourceId: 'ad2',
      periodStart: day('2026-01-01'),
      periodEnd: day('2026-01-10'),
      amount: 50,
    })

    const all = expectOk(await WhatsAppAdRepository.listSpends(workspace.id))
    expect(all.map((row) => row.sourceId)).toEqual(['ad1', 'ad2'])
    expect(Number(all[0].amount)).toBe(1000)

    const overlap = expectOk(
      await WhatsAppAdRepository.listSpendsOverlapping(
        workspace.id,
        day('2026-10-10'),
        day('2026-10-31'),
      ),
    )
    expect(overlap.map((row) => row.sourceId)).toEqual(['ad1'])

    expect(
      expectOk(await WhatsAppAdRepository.deleteSpend(other.id, october.id)),
    ).toBe(false)
    expect(
      expectOk(
        await WhatsAppAdRepository.deleteSpend(workspace.id, october.id),
      ),
    ).toBe(true)
  })
})

describe('WhatsAppAdRepository database failures', () => {
  it('wraps every Prisma failure in a Result', async () => {
    const boom = new Error('boom')
    const spies = [
      vi.spyOn(prisma.whatsAppAdSettings, 'findUnique'),
      vi.spyOn(prisma.whatsAppAdSettings, 'upsert'),
      vi.spyOn(prisma.whatsAppAdReferral, 'findUnique'),
      vi.spyOn(prisma.whatsAppAdReferral, 'findFirst'),
      vi.spyOn(prisma.whatsAppAdReferral, 'count'),
      vi.spyOn(prisma.whatsAppAdReferral, 'update'),
      vi.spyOn(prisma.whatsAppAdReferral, 'findMany'),
      vi.spyOn(prisma.crmLead, 'findMany'),
      vi.spyOn(prisma.whatsAppAdSpend, 'findMany'),
      vi.spyOn(prisma.whatsAppAdSpend, 'create'),
      vi.spyOn(prisma.whatsAppAdSpend, 'deleteMany'),
    ]
    for (const spy of spies) spy.mockRejectedValue(boom)

    try {
      const day = new Date('2026-10-01T00:00:00Z')
      const results = await Promise.all([
        WhatsAppAdRepository.findSettings('w'),
        WhatsAppAdRepository.upsertSettings('w', {}),
        WhatsAppAdRepository.createReferral(
          referral({ workspaceId: 'w', contactId: 'c' }),
        ),
        WhatsAppAdRepository.findLatestByConversation('w', 'c'),
        WhatsAppAdRepository.leadHasReferral('w', 'l'),
        WhatsAppAdRepository.linkLead('r', 'l'),
        WhatsAppAdRepository.listReferralsInRange('w', day, day),
        WhatsAppAdRepository.listLeadOutcomes('w', ['l']),
        WhatsAppAdRepository.listSpends('w'),
        WhatsAppAdRepository.listSpendsOverlapping('w', day, day),
        WhatsAppAdRepository.createSpend({
          workspaceId: 'w',
          sourceId: 's',
          periodStart: day,
          periodEnd: day,
          amount: 1,
          createdById: 'u',
        }),
        WhatsAppAdRepository.deleteSpend('w', 's'),
      ])
      for (const result of results) {
        expect(expectErr(result).code).toBe('DATABASE_ERROR')
      }
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })
})
