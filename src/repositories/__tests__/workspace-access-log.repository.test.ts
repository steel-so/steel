import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { seedWorkspaceAccessLog } from '@/src/__tests__/factories/workspace-access-log.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import {
  type WorkspaceAccessLogFilter,
  WorkspaceAccessLogRepository,
} from '../workspace-access-log.repository'

const FROM = new Date('2026-10-01T03:00:00.000Z')
const TO = new Date('2026-11-01T03:00:00.000Z')
const at = (iso: string) => new Date(iso)

function filter(
  workspaceId: string,
  extra?: Partial<WorkspaceAccessLogFilter>,
): WorkspaceAccessLogFilter {
  return { workspaceId, from: FROM, to: TO, ...extra }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('WorkspaceAccessLogRepository', () => {
  describe('create()', () => {
    it('stores the attempt with the user snapshot', async () => {
      const workspace = await seedWorkspace()
      const row = expectOk(
        await WorkspaceAccessLogRepository.create({
          workspaceId: workspace.id,
          userId: 'u_gone',
          userEmail: 'ana@acme.com.br',
          userName: 'Ana',
          ip: '200.1.2.3',
          userAgent: 'Mozilla/5.0',
          outcome: 'BLOCKED',
          surface: 'API',
          path: '/api/x',
        }),
      )
      // No foreign key on the user: the row outlives the account.
      expect(row).toMatchObject({ userId: 'u_gone', outcome: 'BLOCKED' })
    })

    it('returns DATABASE_ERROR for a missing workspace', async () => {
      expectErr(
        await WorkspaceAccessLogRepository.create({
          workspaceId: 'missing',
          userId: null,
          userEmail: null,
          userName: null,
          ip: null,
          userAgent: null,
          outcome: 'ALLOWED',
          surface: 'APP',
          path: null,
        }),
        'DATABASE_ERROR',
      )
    })
  })

  describe('listPage()', () => {
    it('pages the range most recent first and counts the total', async () => {
      const [workspace, other] = await Promise.all([
        seedWorkspace(),
        seedWorkspace(),
      ])
      const old = await seedWorkspaceAccessLog(workspace.id, {
        createdAt: at('2026-10-02T12:00:00.000Z'),
      })
      const recent = await seedWorkspaceAccessLog(workspace.id, {
        createdAt: at('2026-10-20T12:00:00.000Z'),
      })
      await seedWorkspaceAccessLog(workspace.id, {
        createdAt: at('2026-09-30T12:00:00.000Z'),
      })
      await seedWorkspaceAccessLog(workspace.id, { createdAt: TO })
      await seedWorkspaceAccessLog(other.id, {
        createdAt: at('2026-10-10T12:00:00.000Z'),
      })

      const first = expectOk(
        await WorkspaceAccessLogRepository.listPage(filter(workspace.id), {
          skip: 0,
          take: 1,
        }),
      )
      expect(first.total).toBe(2)
      expect(first.rows.map((r) => r.id)).toEqual([recent.id])

      const second = expectOk(
        await WorkspaceAccessLogRepository.listPage(filter(workspace.id), {
          skip: 1,
          take: 1,
        }),
      )
      expect(second.rows.map((r) => r.id)).toEqual([old.id])
    })

    it('filters by outcome, surface and user (id, e-mail or name)', async () => {
      const workspace = await seedWorkspace()
      const createdAt = at('2026-10-10T12:00:00.000Z')
      const blocked = await seedWorkspaceAccessLog(workspace.id, {
        createdAt,
        outcome: 'BLOCKED',
        surface: 'API',
        userId: 'u_bruno',
        userEmail: 'bruno@acme.com.br',
        userName: 'Bruno Lima',
      })
      const allowed = await seedWorkspaceAccessLog(workspace.id, {
        createdAt,
        outcome: 'ALLOWED',
        surface: 'APP',
        userId: 'u_ana',
        userEmail: 'ana@acme.com.br',
        userName: 'Ana Souza',
      })

      const ids = async (extra: Partial<WorkspaceAccessLogFilter>) =>
        expectOk(
          await WorkspaceAccessLogRepository.listPage(
            filter(workspace.id, extra),
            { skip: 0, take: 10 },
          ),
        ).rows.map((r) => r.id)

      expect(await ids({ outcome: 'BLOCKED' })).toEqual([blocked.id])
      expect(await ids({ surface: 'APP' })).toEqual([allowed.id])
      expect(await ids({ user: 'u_ana' })).toEqual([allowed.id])
      expect(await ids({ user: 'BRUNO@' })).toEqual([blocked.id])
      expect(await ids({ user: 'souza' })).toEqual([allowed.id])
      expect(await ids({ user: 'nobody' })).toEqual([])
    })

    it('returns DATABASE_ERROR when the query fails', async () => {
      vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('down'))
      expectErr(
        await WorkspaceAccessLogRepository.listPage(filter('ws'), {
          skip: 0,
          take: 1,
        }),
        'DATABASE_ERROR',
      )
    })
  })

  describe('count()', () => {
    it('counts the filtered rows', async () => {
      const workspace = await seedWorkspace()
      await seedWorkspaceAccessLog(workspace.id, {
        createdAt: at('2026-10-10T12:00:00.000Z'),
        outcome: 'BLOCKED',
      })
      await seedWorkspaceAccessLog(workspace.id, {
        createdAt: at('2026-10-11T12:00:00.000Z'),
      })
      expect(
        expectOk(
          await WorkspaceAccessLogRepository.count(filter(workspace.id)),
        ),
      ).toBe(2)
      expect(
        expectOk(
          await WorkspaceAccessLogRepository.count(
            filter(workspace.id, { outcome: 'BLOCKED' }),
          ),
        ),
      ).toBe(1)
    })

    it('returns DATABASE_ERROR when the query fails', async () => {
      vi.spyOn(prisma.workspaceAccessLog, 'count').mockRejectedValueOnce(
        new Error('down'),
      )
      expectErr(
        await WorkspaceAccessLogRepository.count(filter('ws')),
        'DATABASE_ERROR',
      )
    })
  })

  describe('listBatch()', () => {
    it('walks the range chronologically with a keyset cursor', async () => {
      const workspace = await seedWorkspace()
      const same = at('2026-10-10T12:00:00.000Z')
      const a = await seedWorkspaceAccessLog(workspace.id, {
        createdAt: at('2026-10-05T12:00:00.000Z'),
      })
      const b = await seedWorkspaceAccessLog(workspace.id, { createdAt: same })
      const c = await seedWorkspaceAccessLog(workspace.id, { createdAt: same })
      const d = await seedWorkspaceAccessLog(workspace.id, {
        createdAt: at('2026-10-20T12:00:00.000Z'),
      })
      const [tieFirst, tieSecond] = [b, c].sort((x, y) =>
        x.id < y.id ? -1 : 1,
      )

      const seen: string[] = []
      let cursor: { createdAt: Date; id: string } | undefined
      while (true) {
        const batch = expectOk(
          await WorkspaceAccessLogRepository.listBatch(
            filter(workspace.id),
            2,
            cursor,
          ),
        )
        seen.push(...batch.map((r) => r.id))
        if (batch.length < 2) break
        const last = batch[batch.length - 1]
        cursor = { createdAt: last.createdAt, id: last.id }
      }
      expect(seen).toEqual([a.id, tieFirst.id, tieSecond.id, d.id])
    })

    it('returns DATABASE_ERROR when the query fails', async () => {
      vi.spyOn(prisma.workspaceAccessLog, 'findMany').mockRejectedValueOnce(
        new Error('down'),
      )
      expectErr(
        await WorkspaceAccessLogRepository.listBatch(filter('ws'), 10),
        'DATABASE_ERROR',
      )
    })
  })

  describe('deleteOlderThan()', () => {
    it('removes only rows before the cutoff, in every workspace', async () => {
      const [a, b] = await Promise.all([seedWorkspace(), seedWorkspace()])
      const cutoff = at('2021-10-27T03:00:00.000Z')
      await seedWorkspaceAccessLog(a.id, {
        createdAt: at('2021-10-26T12:00:00.000Z'),
      })
      await seedWorkspaceAccessLog(b.id, {
        createdAt: at('2020-01-01T12:00:00.000Z'),
      })
      const kept = await seedWorkspaceAccessLog(a.id, { createdAt: cutoff })

      expect(
        expectOk(await WorkspaceAccessLogRepository.deleteOlderThan(cutoff)),
      ).toBe(2)
      const left = await prisma.workspaceAccessLog.findMany()
      expect(left.map((r) => r.id)).toEqual([kept.id])
    })

    it('returns DATABASE_ERROR when the delete fails', async () => {
      vi.spyOn(prisma.workspaceAccessLog, 'deleteMany').mockRejectedValueOnce(
        new Error('down'),
      )
      expectErr(
        await WorkspaceAccessLogRepository.deleteOlderThan(new Date()),
        'DATABASE_ERROR',
      )
    })
  })
})
