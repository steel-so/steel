import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWhatsAppTeam } from '@/src/__tests__/factories/whatsapp-team.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { prisma } from '@/src/lib/prisma'
import { err, ok } from '@/src/lib/result'
import { WhatsAppDistributionRepository } from '../whatsapp-distribution.repository'

afterEach(() => {
  vi.restoreAllMocks()
})

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('WhatsAppDistributionRepository', () => {
  describe('withLock()', () => {
    it('returns what the section returns', async () => {
      const result = await WhatsAppDistributionRepository.withLock(
        'test-lock-a',
        async () => ok('done'),
      )
      expect(expectOk(result)).toBe('done')
    })

    it('lets a failing section pass its error through', async () => {
      const result = await WhatsAppDistributionRepository.withLock(
        'test-lock-b',
        async () => err(databaseError()),
      )
      expectErr(result, 'DATABASE_ERROR')
    })

    it('never runs two sections of the same key at once', async () => {
      const key = `test-lock-${Date.now()}`
      const timeline: string[] = []
      const section = (name: string) =>
        WhatsAppDistributionRepository.withLock(key, async () => {
          timeline.push(`${name}:start`)
          await sleep(60)
          timeline.push(`${name}:end`)
          return ok(name)
        })

      await Promise.all([section('one'), section('two'), section('three')])

      // Each section ends before the next one starts.
      for (let i = 0; i < timeline.length; i += 2) {
        const [start, end] = [timeline[i], timeline[i + 1]]
        expect(start.endsWith(':start')).toBe(true)
        expect(end).toBe(start.replace(':start', ':end'))
      }
    })

    it('runs different keys side by side', async () => {
      const timeline: string[] = []
      const section = (key: string) =>
        WhatsAppDistributionRepository.withLock(key, async () => {
          timeline.push(`${key}:start`)
          await sleep(80)
          timeline.push(`${key}:end`)
          return ok(key)
        })
      await Promise.all([section('key-x'), section('key-y')])
      expect(timeline.slice(0, 2).every((e) => e.endsWith(':start'))).toBe(true)
    })

    it('reports a database failure', async () => {
      vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('boom'))
      expectErr(
        await WhatsAppDistributionRepository.withLock('k', async () =>
          ok(null),
        ),
        'DATABASE_ERROR',
      )
    })
  })

  describe('pointers', () => {
    it('moves the pointer of a team and reads it back', async () => {
      const workspace = await seedWorkspace()
      const team = await seedWhatsAppTeam({ workspaceId: workspace.id })

      expect(
        expectOk(await WhatsAppDistributionRepository.getTeamPointer(team.id)),
      ).toBeNull()
      expectOk(
        await WhatsAppDistributionRepository.setTeamPointer(team.id, 'u1'),
      )
      expect(
        expectOk(await WhatsAppDistributionRepository.getTeamPointer(team.id)),
      ).toBe('u1')
    })

    it('reads a deleted team as having no pointer', async () => {
      expect(
        expectOk(await WhatsAppDistributionRepository.getTeamPointer('ghost')),
      ).toBeNull()
    })

    it('moves the workspace pointer on the saved settings only', async () => {
      const workspace = await seedWorkspace()
      // No settings row yet: nothing to move, and no row is invented.
      expectOk(
        await WhatsAppDistributionRepository.setWorkspacePointer(
          workspace.id,
          'u1',
        ),
      )
      expect(
        await prisma.whatsAppSettings.count({
          where: { workspaceId: workspace.id },
        }),
      ).toBe(0)

      await prisma.whatsAppSettings.create({
        data: { workspaceId: workspace.id, distributionMode: 'ROUND_ROBIN' },
      })
      expectOk(
        await WhatsAppDistributionRepository.setWorkspacePointer(
          workspace.id,
          'u2',
        ),
      )
      const row = await prisma.whatsAppSettings.findUnique({
        where: { workspaceId: workspace.id },
      })
      expect(row?.distributionLastAssignedUserId).toBe('u2')
    })

    it('reports database failures', async () => {
      vi.spyOn(prisma.whatsAppSettings, 'updateMany').mockRejectedValueOnce(
        new Error('boom'),
      )
      expectErr(
        await WhatsAppDistributionRepository.setWorkspacePointer('w', 'u'),
        'DATABASE_ERROR',
      )
      vi.spyOn(prisma.whatsAppTeam, 'updateMany').mockRejectedValueOnce(
        new Error('boom'),
      )
      expectErr(
        await WhatsAppDistributionRepository.setTeamPointer('t', 'u'),
        'DATABASE_ERROR',
      )
      vi.spyOn(prisma.whatsAppTeam, 'findUnique').mockRejectedValueOnce(
        new Error('boom'),
      )
      expectErr(
        await WhatsAppDistributionRepository.getTeamPointer('t'),
        'DATABASE_ERROR',
      )
    })
  })

  describe('listEnabledWorkspaceIds()', () => {
    it('lists only the workspaces that turned the distribution on', async () => {
      const [on, off, none] = await Promise.all([
        seedWorkspace(),
        seedWorkspace(),
        seedWorkspace(),
      ])
      await prisma.whatsAppSettings.create({
        data: { workspaceId: on.id, distributionMode: 'LEAST_LOADED' },
      })
      await prisma.whatsAppSettings.create({
        data: { workspaceId: off.id, distributionMode: 'OFF' },
      })

      const ids = expectOk(
        await WhatsAppDistributionRepository.listEnabledWorkspaceIds(),
      )
      expect(ids).toContain(on.id)
      expect(ids).not.toContain(off.id)
      expect(ids).not.toContain(none.id)
    })

    it('reports a database failure', async () => {
      vi.spyOn(prisma.whatsAppSettings, 'findMany').mockRejectedValueOnce(
        new Error('boom'),
      )
      expectErr(
        await WhatsAppDistributionRepository.listEnabledWorkspaceIds(),
        'DATABASE_ERROR',
      )
    })
  })

  it('keeps a team usable after its pointer user is deleted', async () => {
    const workspace = await seedWorkspace()
    const user = await seedUser()
    const team = await seedWhatsAppTeam({ workspaceId: workspace.id })
    await WhatsAppDistributionRepository.setTeamPointer(team.id, user.id)
    await prisma.user.delete({ where: { id: user.id } })
    // The pointer is a plain id: a stale one just moves the rotation on.
    expect(
      expectOk(await WhatsAppDistributionRepository.getTeamPointer(team.id)),
    ).toBe(user.id)
  })
})
