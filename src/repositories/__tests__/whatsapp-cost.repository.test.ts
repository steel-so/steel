import { describe, expect, it, vi } from 'vitest'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import {
  type CostRangeFilter,
  type WhatsAppCostEntryInput,
  WhatsAppCostRepository,
} from '../whatsapp-cost.repository'

let counter = 0

async function seedFixtures() {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  counter += 1
  const connection = await prisma.whatsAppConnection.create({
    data: {
      workspaceId: workspace.id,
      provider: 'META',
      label: 'Oficial',
      phoneNumber: `55119999${String(counter).padStart(5, '0')}`,
      metaPhoneNumberId: `pn-${counter}`,
      createdById: user.id,
    },
  })
  const zapi = await prisma.whatsAppConnection.create({
    data: {
      workspaceId: workspace.id,
      provider: 'ZAPI',
      label: 'Z-API',
      phoneNumber: `55118888${String(counter).padStart(5, '0')}`,
      zapiInstanceId: `inst-${counter}`,
      encryptedZapiToken: 'enc:token',
      createdById: user.id,
    },
  })
  const contact = await prisma.whatsAppContact.create({
    data: { workspaceId: workspace.id, waId: '5511988887777', name: 'Maria' },
  })
  return { workspace, user, connection, zapi, contact }
}

function entry(
  base: Pick<WhatsAppCostEntryInput, 'workspaceId' | 'connectionId'>,
  overrides: Partial<WhatsAppCostEntryInput> = {},
): WhatsAppCostEntryInput {
  return {
    ...base,
    provider: 'META',
    occurredAt: new Date('2026-10-10T15:00:00Z'),
    category: 'MARKETING',
    kind: 'TEMPLATE',
    source: 'BROADCAST',
    quantity: 1,
    unitPrice: 0.4,
    estimatedCost: 0.4,
    ...overrides,
  }
}

function range(workspaceId: string, connectionId?: string): CostRangeFilter {
  return {
    workspaceId,
    connectionId,
    start: new Date('2026-10-01T03:00:00Z'),
    endExclusive: new Date('2026-11-01T03:00:00Z'),
  }
}

describe('WhatsAppCostRepository', () => {
  describe('prices', () => {
    it('seeds idempotently, lists newest first and upserts a validFrom', async () => {
      const { workspace } = await seedFixtures()
      const rows = [
        {
          workspaceId: workspace.id,
          category: 'MARKETING' as const,
          unitPrice: 0.36,
          validFrom: new Date('2000-01-01T00:00:00Z'),
          reference: true,
        },
      ]
      expect(expectOk(await WhatsAppCostRepository.seedPrices(rows))).toBe(1)
      expect(expectOk(await WhatsAppCostRepository.seedPrices(rows))).toBe(0)

      const saved = expectOk(
        await WhatsAppCostRepository.upsertPrice({
          workspaceId: workspace.id,
          category: 'MARKETING',
          country: 'BR',
          unitPrice: 0.5,
          validFrom: new Date('2026-07-01T00:00:00Z'),
        }),
      )
      const corrected = expectOk(
        await WhatsAppCostRepository.upsertPrice({
          workspaceId: workspace.id,
          category: 'MARKETING',
          country: 'BR',
          unitPrice: 0.55,
          validFrom: new Date('2026-07-01T00:00:00Z'),
        }),
      )
      expect(corrected.id).toBe(saved.id)

      const list = expectOk(
        await WhatsAppCostRepository.listPrices(workspace.id),
      )
      expect(list.map((p) => Number(p.unitPrice))).toEqual([0.55, 0.36])
    })

    it('deletes only inside the workspace', async () => {
      const a = await seedFixtures()
      const b = await seedFixtures()
      const price = expectOk(
        await WhatsAppCostRepository.upsertPrice({
          workspaceId: a.workspace.id,
          category: 'UTILITY',
          country: 'BR',
          unitPrice: 0.04,
          validFrom: new Date('2026-01-01T00:00:00Z'),
        }),
      )
      expect(
        expectOk(
          await WhatsAppCostRepository.deletePrice(b.workspace.id, price.id),
        ),
      ).toBe(false)
      expect(
        expectOk(
          await WhatsAppCostRepository.deletePrice(a.workspace.id, price.id),
        ),
      ).toBe(true)
    })
  })

  describe('entries and aggregation', () => {
    it('sums, groups, totals and builds the daily trend in São Paulo time', async () => {
      const { workspace, user, connection, zapi } = await seedFixtures()
      const base = { workspaceId: workspace.id, connectionId: connection.id }
      const conversation = await prisma.whatsAppConversation.create({
        data: {
          workspaceId: workspace.id,
          connectionId: connection.id,
          contactId: (
            await prisma.whatsAppContact.findFirstOrThrow({
              where: { workspaceId: workspace.id },
            })
          ).id,
          status: 'CLOSED',
          closeOutcome: 'SUCCESS',
        },
      })

      for (const data of [
        entry(base, {
          broadcastId: 'b1',
          estimatedCost: 0.4,
          occurredAt: new Date('2026-10-02T02:30:00Z'), // 1 Oct 23:30 in SP
        }),
        entry(base, {
          broadcastId: 'b1',
          estimatedCost: 0.4,
          occurredAt: new Date('2026-10-02T15:00:00Z'),
        }),
        entry(base, {
          source: 'AGENT',
          category: 'UTILITY',
          userId: user.id,
          conversationId: conversation.id,
          quantity: 2,
          unitPrice: 0.05,
          estimatedCost: 0.1,
        }),
        entry(
          { workspaceId: workspace.id, connectionId: zapi.id },
          {
            provider: 'ZAPI',
            category: 'SERVICE',
            kind: 'SERVICE',
            source: 'AGENT',
            unitPrice: 0,
            estimatedCost: 0,
            conversationId: conversation.id,
          },
        ),
        // Outside the range.
        entry(base, { occurredAt: new Date('2026-09-30T12:00:00Z') }),
      ]) {
        expectOk(await WhatsAppCostRepository.createEntry(data))
      }

      expect(
        expectOk(await WhatsAppCostRepository.sumCost(range(workspace.id))),
      ).toBeCloseTo(0.9)
      expect(
        expectOk(
          await WhatsAppCostRepository.sumCost(
            range(workspace.id, connection.id),
          ),
        ),
      ).toBeCloseTo(0.9)

      expect(
        expectOk(await WhatsAppCostRepository.totals(range(workspace.id))),
      ).toEqual({ messages: 5, templateMessages: 4, cost: 0.9 })

      const byBroadcast = expectOk(
        await WhatsAppCostRepository.groupBy(
          range(workspace.id),
          'broadcastId',
        ),
      )
      expect(byBroadcast.find((r) => r.key === 'b1')).toMatchObject({
        messages: 2,
      })
      const byConnection = expectOk(
        await WhatsAppCostRepository.groupBy(
          range(workspace.id),
          'connectionId',
        ),
      )
      expect(byConnection).toHaveLength(2)

      const trend = expectOk(
        await WhatsAppCostRepository.trend(range(workspace.id)),
      )
      expect(trend[0]).toMatchObject({ date: '2026-10-01', messages: 1 })
      expect(trend[1].date).toBe('2026-10-02')
      const filtered = expectOk(
        await WhatsAppCostRepository.trend(range(workspace.id, zapi.id)),
      )
      expect(filtered).toHaveLength(1)

      const counts = expectOk(
        await WhatsAppCostRepository.conversationCounts(range(workspace.id)),
      )
      expect(counts).toHaveLength(2)
      expect(
        counts.every((c) => c.conversations === 1 && c.resolved === 1),
      ).toBe(true)
    })

    it('keeps workspaces apart', async () => {
      const a = await seedFixtures()
      const b = await seedFixtures()
      expectOk(
        await WhatsAppCostRepository.createEntry(
          entry({ workspaceId: a.workspace.id, connectionId: a.connection.id }),
        ),
      )
      expect(
        expectOk(await WhatsAppCostRepository.sumCost(range(b.workspace.id))),
      ).toBe(0)
    })

    it('counts a FAILURE outcome as unresolved', async () => {
      const { workspace, connection, contact } = await seedFixtures()
      const failed = await prisma.whatsAppConversation.create({
        data: {
          workspaceId: workspace.id,
          connectionId: connection.id,
          contactId: contact.id,
          status: 'CLOSED',
          closeOutcome: 'FAILURE',
        },
      })
      expectOk(
        await WhatsAppCostRepository.createEntry(
          entry(
            { workspaceId: workspace.id, connectionId: connection.id },
            { conversationId: failed.id },
          ),
        ),
      )
      const counts = expectOk(
        await WhatsAppCostRepository.conversationCounts(range(workspace.id)),
      )
      expect(counts[0]).toMatchObject({ conversations: 1, resolved: 0 })
    })
  })

  describe('connections and names', () => {
    it('lists Comunicação lines with their fee and updates it per workspace', async () => {
      const a = await seedFixtures()
      const b = await seedFixtures()
      expect(
        expectOk(
          await WhatsAppCostRepository.setConnectionFee(
            a.workspace.id,
            a.zapi.id,
            199.9,
          ),
        ),
      ).toBe(true)
      expect(
        expectOk(
          await WhatsAppCostRepository.setConnectionFee(
            b.workspace.id,
            a.zapi.id,
            1,
          ),
        ),
      ).toBe(false)

      const list = expectOk(
        await WhatsAppCostRepository.listConnections(a.workspace.id),
      )
      expect(list).toHaveLength(2)
      expect(list.find((c) => c.id === a.zapi.id)?.monthlyFee).toBe(199.9)
      expect(list.find((c) => c.id === a.connection.id)?.monthlyFee).toBeNull()

      expect(
        expectOk(
          await WhatsAppCostRepository.setConnectionFee(
            a.workspace.id,
            a.zapi.id,
            null,
          ),
        ),
      ).toBe(true)
    })

    it('resolves broadcast, campaign and user names', async () => {
      const { workspace, user, connection } = await seedFixtures()
      const broadcast = await prisma.whatsAppBroadcastList.create({
        data: {
          workspaceId: workspace.id,
          connectionId: connection.id,
          name: 'Black Friday',
          messageBody: 'oi',
          createdById: user.id,
        },
      })
      const campaign = await prisma.whatsAppAiCampaign.create({
        data: { workspaceId: workspace.id, name: 'Reativação' },
      })

      expect(
        expectOk(
          await WhatsAppCostRepository.broadcastNames(workspace.id, [
            broadcast.id,
          ]),
        ).get(broadcast.id),
      ).toBe('Black Friday')
      expect(
        expectOk(
          await WhatsAppCostRepository.aiCampaignNames(workspace.id, [
            campaign.id,
          ]),
        ).get(campaign.id),
      ).toBe('Reativação')
      expect(
        expectOk(await WhatsAppCostRepository.userNames([user.id])).get(
          user.id,
        ),
      ).toBeTruthy()
    })
  })

  describe('database failures', () => {
    it.each([
      [
        'listPrices',
        () => WhatsAppCostRepository.listPrices('w'),
        () => vi.spyOn(prisma.whatsAppPrice, 'findMany'),
      ],
      [
        'seedPrices',
        () => WhatsAppCostRepository.seedPrices([]),
        () => vi.spyOn(prisma.whatsAppPrice, 'createMany'),
      ],
      [
        'upsertPrice',
        () =>
          WhatsAppCostRepository.upsertPrice({
            workspaceId: 'w',
            category: 'UTILITY',
            unitPrice: 1,
            validFrom: new Date(),
          }),
        () => vi.spyOn(prisma.whatsAppPrice, 'upsert'),
      ],
      [
        'deletePrice',
        () => WhatsAppCostRepository.deletePrice('w', 'p'),
        () => vi.spyOn(prisma.whatsAppPrice, 'deleteMany'),
      ],
      [
        'createEntry',
        () =>
          WhatsAppCostRepository.createEntry(
            entry({ workspaceId: 'w', connectionId: 'c' }),
          ),
        () => vi.spyOn(prisma.whatsAppCostEntry, 'create'),
      ],
      [
        'sumCost',
        () => WhatsAppCostRepository.sumCost(range('w')),
        () => vi.spyOn(prisma.whatsAppCostEntry, 'aggregate'),
      ],
      [
        'totals',
        () => WhatsAppCostRepository.totals(range('w')),
        () => vi.spyOn(prisma.whatsAppCostEntry, 'aggregate'),
      ],
      [
        'groupBy',
        () => WhatsAppCostRepository.groupBy(range('w'), 'source'),
        () => vi.spyOn(prisma.whatsAppCostEntry, 'groupBy'),
      ],
      [
        'trend',
        () => WhatsAppCostRepository.trend(range('w')),
        () => vi.spyOn(prisma, '$queryRaw'),
      ],
      [
        'conversationCounts',
        () => WhatsAppCostRepository.conversationCounts(range('w')),
        () => vi.spyOn(prisma, '$queryRaw'),
      ],
      [
        'listConnections',
        () => WhatsAppCostRepository.listConnections('w'),
        () => vi.spyOn(prisma.whatsAppConnection, 'findMany'),
      ],
      [
        'setConnectionFee',
        () => WhatsAppCostRepository.setConnectionFee('w', 'c', 1),
        () => vi.spyOn(prisma.whatsAppConnection, 'updateMany'),
      ],
      [
        'broadcastNames',
        () => WhatsAppCostRepository.broadcastNames('w', ['x']),
        () => vi.spyOn(prisma.whatsAppBroadcastList, 'findMany'),
      ],
      [
        'aiCampaignNames',
        () => WhatsAppCostRepository.aiCampaignNames('w', ['x']),
        () => vi.spyOn(prisma.whatsAppAiCampaign, 'findMany'),
      ],
      [
        'userNames',
        () => WhatsAppCostRepository.userNames(['x']),
        () => vi.spyOn(prisma.user, 'findMany'),
      ],
    ] as const)(
      '%s returns DATABASE_ERROR when the query throws',
      async (_name, call, spy) => {
        ;(
          spy() as unknown as { mockRejectedValueOnce: (e: Error) => void }
        ).mockRejectedValueOnce(new Error('boom'))
        expectErr(await call(), 'DATABASE_ERROR')
      },
    )

    it('totals fails when the template aggregate throws', async () => {
      const aggregate = vi.spyOn(prisma.whatsAppCostEntry, 'aggregate')
      aggregate.mockResolvedValueOnce({
        _sum: { quantity: 1, estimatedCost: 1 },
      } as never)
      aggregate.mockRejectedValueOnce(new Error('boom'))
      expectErr(
        await WhatsAppCostRepository.totals(range('w')),
        'DATABASE_ERROR',
      )
    })
  })
})
