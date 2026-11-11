import type { Prisma } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import {
  type SpendSnapshotInput,
  WhatsAppSpendCapRepository,
} from '../whatsapp-spend-cap.repository'

let counter = 0

async function seedFixtures() {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  counter += 1
  const meta = await prisma.whatsAppConnection.create({
    data: {
      workspaceId: workspace.id,
      provider: 'META',
      label: 'Oficial',
      phoneNumber: `55117777${String(counter).padStart(5, '0')}`,
      metaPhoneNumberId: `pn-cap-${counter}`,
      createdById: user.id,
    },
  })
  const zapi = await prisma.whatsAppConnection.create({
    data: {
      workspaceId: workspace.id,
      provider: 'ZAPI',
      label: 'Z-API',
      phoneNumber: `55116666${String(counter).padStart(5, '0')}`,
      zapiInstanceId: `inst-cap-${counter}`,
      encryptedZapiToken: 'enc:token',
      createdById: user.id,
    },
  })
  return { workspace, user, meta, zapi }
}

function snapshot(
  base: { workspaceId: string; connectionId: string },
  overrides: Partial<SpendSnapshotInput> = {},
): SpendSnapshotInput {
  return {
    ...base,
    month: '2026-11',
    cost: 159.5632,
    currency: 'BRL',
    source: 'META_VOLUME',
    byCategory: [{ category: 'MARKETING', volume: 496 }],
    periodStart: new Date('2026-11-01T00:00:00Z'),
    periodEnd: new Date('2026-11-11T00:00:00Z'),
    fetchedAt: new Date('2026-11-11T15:00:00Z'),
    ...overrides,
  }
}

async function entry(
  workspaceId: string,
  connectionId: string,
  overrides: Partial<Prisma.WhatsAppCostEntryUncheckedCreateInput> = {},
) {
  return prisma.whatsAppCostEntry.create({
    data: {
      workspaceId,
      connectionId,
      provider: 'META',
      occurredAt: new Date('2026-11-11T12:00:00Z'),
      category: 'MARKETING',
      kind: 'TEMPLATE',
      source: 'BROADCAST',
      unitPrice: 0.3217,
      estimatedCost: 0.3217,
      ...overrides,
    },
  })
}

describe('WhatsAppSpendCapRepository', () => {
  describe('caps', () => {
    it('creates, updates, lists and deletes a cap per number', async () => {
      const { workspace, user, meta } = await seedFixtures()
      expect(
        expectOk(await WhatsAppSpendCapRepository.findCap(meta.id)),
      ).toBeNull()

      const created = expectOk(
        await WhatsAppSpendCapRepository.upsertCap({
          workspaceId: workspace.id,
          connectionId: meta.id,
          monthlyCapAmount: 1500,
          capMode: 'BLOCK',
          updatedById: user.id,
        }),
      )
      expect(Number(created.monthlyCapAmount)).toBe(1500)

      const updated = expectOk(
        await WhatsAppSpendCapRepository.upsertCap({
          workspaceId: workspace.id,
          connectionId: meta.id,
          monthlyCapAmount: 2000,
          capMode: 'WARN',
          updatedById: null,
        }),
      )
      expect(updated.id).toBe(created.id)
      expect(updated.capMode).toBe('WARN')

      const listed = expectOk(
        await WhatsAppSpendCapRepository.listCaps(workspace.id),
      )
      expect(listed.map((cap) => Number(cap.monthlyCapAmount))).toEqual([2000])

      expect(
        expectOk(
          await WhatsAppSpendCapRepository.deleteCap('other-ws', meta.id),
        ),
      ).toBe(false)
      expect(
        expectOk(
          await WhatsAppSpendCapRepository.deleteCap(workspace.id, meta.id),
        ),
      ).toBe(true)
      expect(
        expectOk(await WhatsAppSpendCapRepository.findCap(meta.id)),
      ).toBeNull()
    })

    it('lists Meta numbers per workspace and the capped ones globally', async () => {
      const { workspace, user, meta } = await seedFixtures()
      const metas = expectOk(
        await WhatsAppSpendCapRepository.listMetaConnections(workspace.id),
      )
      expect(metas.map((c) => c.id)).toEqual([meta.id])

      const before = expectOk(
        await WhatsAppSpendCapRepository.listCappedConnections(),
      )
      expect(before.some((c) => c.id === meta.id)).toBe(false)

      expectOk(
        await WhatsAppSpendCapRepository.upsertCap({
          workspaceId: workspace.id,
          connectionId: meta.id,
          monthlyCapAmount: 1500,
          capMode: 'BLOCK',
          updatedById: user.id,
        }),
      )
      const after = expectOk(
        await WhatsAppSpendCapRepository.listCappedConnections(),
      )
      expect(after.some((c) => c.id === meta.id)).toBe(true)
    })
  })

  describe('snapshots', () => {
    it('upserts one snapshot per number and month and finds the latest', async () => {
      const { workspace, meta } = await seedFixtures()
      const base = { workspaceId: workspace.id, connectionId: meta.id }

      expectOk(
        await WhatsAppSpendCapRepository.upsertSnapshot(
          snapshot(base, {
            month: '2026-10',
            source: 'META_COST',
            fetchedAt: new Date('2026-10-31T20:00:00Z'),
          }),
        ),
      )
      const first = expectOk(
        await WhatsAppSpendCapRepository.upsertSnapshot(snapshot(base)),
      )
      const second = expectOk(
        await WhatsAppSpendCapRepository.upsertSnapshot(
          snapshot(base, {
            cost: 170,
            fetchedAt: new Date('2026-11-11T16:00:00Z'),
          }),
        ),
      )
      expect(second.id).toBe(first.id)
      expect(Number(second.cost)).toBe(170)

      const found = expectOk(
        await WhatsAppSpendCapRepository.findSnapshot(meta.id, '2026-11'),
      )
      expect(found?.source).toBe('META_VOLUME')
      expect(
        expectOk(
          await WhatsAppSpendCapRepository.findSnapshot(meta.id, '2026-09'),
        ),
      ).toBeNull()

      const latest = expectOk(
        await WhatsAppSpendCapRepository.findLatestSnapshot(meta.id),
      )
      expect(latest?.month).toBe('2026-11')
    })
  })

  describe('ledger', () => {
    it('sums paid, non-reversed entries since an instant', async () => {
      const { workspace, meta, zapi } = await seedFixtures()
      await entry(workspace.id, meta.id)
      await entry(workspace.id, meta.id, { estimatedCost: 0.035 })
      await entry(workspace.id, meta.id, {
        occurredAt: new Date('2026-11-10T12:00:00Z'),
      })
      await entry(workspace.id, meta.id, {
        kind: 'SERVICE',
        category: 'SERVICE',
        estimatedCost: 9,
      })
      await entry(workspace.id, zapi.id, { provider: 'ZAPI' })

      const sum = expectOk(
        await WhatsAppSpendCapRepository.sumLedgerSince(
          meta.id,
          new Date('2026-11-11T00:00:00Z'),
        ),
      )
      expect(sum).toBeCloseTo(0.3567, 6)
    })

    it('reverses a failed message once', async () => {
      const { workspace, meta } = await seedFixtures()
      const paid = await entry(workspace.id, meta.id, {
        providerMessageId: 'wamid.failed',
      })
      const at = new Date('2026-11-11T13:00:00Z')

      expect(
        expectOk(
          await WhatsAppSpendCapRepository.reverseFailedEntries(
            'wamid.failed',
            at,
          ),
        ),
      ).toBe(1)
      expect(
        expectOk(
          await WhatsAppSpendCapRepository.reverseFailedEntries(
            'wamid.failed',
            new Date(),
          ),
        ),
      ).toBe(0)
      const stored = await prisma.whatsAppCostEntry.findUniqueOrThrow({
        where: { id: paid.id },
      })
      expect(Number(stored.estimatedCost)).toBe(0)
      expect(stored.reversedAt?.toISOString()).toBe(at.toISOString())
      expect(
        expectOk(
          await WhatsAppSpendCapRepository.sumLedgerSince(
            meta.id,
            new Date('2026-11-01T00:00:00Z'),
          ),
        ),
      ).toBe(0)
    })
  })

  describe('database failures', () => {
    it.each([
      [
        'findCap',
        () => WhatsAppSpendCapRepository.findCap('c'),
        () => vi.spyOn(prisma.whatsAppSpendCap, 'findUnique'),
      ],
      [
        'listCaps',
        () => WhatsAppSpendCapRepository.listCaps('w'),
        () => vi.spyOn(prisma.whatsAppSpendCap, 'findMany'),
      ],
      [
        'upsertCap',
        () =>
          WhatsAppSpendCapRepository.upsertCap({
            workspaceId: 'w',
            connectionId: 'c',
            monthlyCapAmount: 1,
            capMode: 'WARN',
            updatedById: null,
          }),
        () => vi.spyOn(prisma.whatsAppSpendCap, 'upsert'),
      ],
      [
        'deleteCap',
        () => WhatsAppSpendCapRepository.deleteCap('w', 'c'),
        () => vi.spyOn(prisma.whatsAppSpendCap, 'deleteMany'),
      ],
      [
        'findSnapshot',
        () => WhatsAppSpendCapRepository.findSnapshot('c', '2026-11'),
        () => vi.spyOn(prisma.whatsAppMetaSpendSnapshot, 'findUnique'),
      ],
      [
        'findLatestSnapshot',
        () => WhatsAppSpendCapRepository.findLatestSnapshot('c'),
        () => vi.spyOn(prisma.whatsAppMetaSpendSnapshot, 'findFirst'),
      ],
      [
        'upsertSnapshot',
        () =>
          WhatsAppSpendCapRepository.upsertSnapshot(
            snapshot({ workspaceId: 'w', connectionId: 'c' }),
          ),
        () => vi.spyOn(prisma.whatsAppMetaSpendSnapshot, 'upsert'),
      ],
      [
        'sumLedgerSince',
        () => WhatsAppSpendCapRepository.sumLedgerSince('c', new Date()),
        () => vi.spyOn(prisma.whatsAppCostEntry, 'aggregate'),
      ],
      [
        'reverseFailedEntries',
        () => WhatsAppSpendCapRepository.reverseFailedEntries('m', new Date()),
        () => vi.spyOn(prisma.whatsAppCostEntry, 'updateMany'),
      ],
      [
        'listMetaConnections',
        () => WhatsAppSpendCapRepository.listMetaConnections('w'),
        () => vi.spyOn(prisma.whatsAppConnection, 'findMany'),
      ],
      [
        'listCappedConnections',
        () => WhatsAppSpendCapRepository.listCappedConnections(),
        () => vi.spyOn(prisma.whatsAppConnection, 'findMany'),
      ],
    ] as const)(
      '%s maps a thrown error to DATABASE_ERROR',
      async (_name, run, spy) => {
        ;(
          spy() as unknown as { mockRejectedValueOnce: (e: Error) => void }
        ).mockRejectedValueOnce(new Error('boom'))
        expectErr(await run(), 'DATABASE_ERROR')
      },
    )
  })
})
