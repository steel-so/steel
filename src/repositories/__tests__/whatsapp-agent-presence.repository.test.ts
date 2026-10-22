import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWhatsAppAgentPresence } from '@/src/__tests__/factories/whatsapp-agent-presence.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { WhatsAppAgentPresenceRepository } from '../whatsapp-agent-presence.repository'

afterEach(() => {
  vi.restoreAllMocks()
})

async function fixtures() {
  const [workspace, ana, bia] = await Promise.all([
    seedWorkspace(),
    seedUser(),
    seedUser(),
  ])
  return { workspace, ana, bia }
}

describe('WhatsAppAgentPresenceRepository', () => {
  describe('find()', () => {
    it('is null while the person never touched the toggle', async () => {
      const { workspace, ana } = await fixtures()
      expect(
        expectOk(
          await WhatsAppAgentPresenceRepository.find(workspace.id, ana.id),
        ),
      ).toBeNull()
    })

    it('reads the saved status of that workspace only', async () => {
      const { workspace, ana } = await fixtures()
      await seedWhatsAppAgentPresence({
        workspaceId: workspace.id,
        userId: ana.id,
        status: 'AWAY',
      })
      expect(
        expectOk(
          await WhatsAppAgentPresenceRepository.find(workspace.id, ana.id),
        )?.status,
      ).toBe('AWAY')
      expect(
        expectOk(
          await WhatsAppAgentPresenceRepository.find('other-ws', ana.id),
        ),
      ).toBeNull()
    })
  })

  describe('setStatus()', () => {
    it('keeps a single row per workspace and user', async () => {
      const { workspace, ana } = await fixtures()

      const away = expectOk(
        await WhatsAppAgentPresenceRepository.setStatus(
          workspace.id,
          ana.id,
          'AWAY',
        ),
      )
      const back = expectOk(
        await WhatsAppAgentPresenceRepository.setStatus(
          workspace.id,
          ana.id,
          'AVAILABLE',
        ),
      )

      expect(back.id).toBe(away.id)
      expect(back.status).toBe('AVAILABLE')
      expect(
        await prisma.whatsAppAgentPresence.count({
          where: { workspaceId: workspace.id, userId: ana.id },
        }),
      ).toBe(1)
    })

    it('survives two toggles arriving together', async () => {
      const { workspace, ana } = await fixtures()
      const results = await Promise.all([
        WhatsAppAgentPresenceRepository.setStatus(workspace.id, ana.id, 'AWAY'),
        WhatsAppAgentPresenceRepository.setStatus(
          workspace.id,
          ana.id,
          'AVAILABLE',
        ),
      ])
      for (const result of results) expectOk(result)
      expect(
        await prisma.whatsAppAgentPresence.count({
          where: { workspaceId: workspace.id, userId: ana.id },
        }),
      ).toBe(1)
    })

    it('reports a database failure', async () => {
      vi.spyOn(prisma.whatsAppAgentPresence, 'upsert').mockRejectedValueOnce(
        new Error('boom'),
      )
      expectErr(
        await WhatsAppAgentPresenceRepository.setStatus('w', 'u', 'AWAY'),
        'DATABASE_ERROR',
      )
    })
  })

  describe('list()', () => {
    it('lists everyone, or only the requested users', async () => {
      const { workspace, ana, bia } = await fixtures()
      await seedWhatsAppAgentPresence({
        workspaceId: workspace.id,
        userId: ana.id,
      })
      await seedWhatsAppAgentPresence({
        workspaceId: workspace.id,
        userId: bia.id,
        status: 'AWAY',
      })

      expect(
        expectOk(await WhatsAppAgentPresenceRepository.list(workspace.id)),
      ).toHaveLength(2)
      const only = expectOk(
        await WhatsAppAgentPresenceRepository.list(workspace.id, [bia.id]),
      )
      expect(only.map((row) => row.userId)).toEqual([bia.id])
    })

    it('reports a database failure', async () => {
      vi.spyOn(prisma.whatsAppAgentPresence, 'findMany').mockRejectedValueOnce(
        new Error('boom'),
      )
      expectErr(
        await WhatsAppAgentPresenceRepository.list('w'),
        'DATABASE_ERROR',
      )
    })
  })

  describe('touchLastAssigned()', () => {
    it('creates the row as available and then only moves the timestamp', async () => {
      const { workspace, ana } = await fixtures()
      const first = new Date('2026-10-22T10:00:00Z')
      const second = new Date('2026-10-22T11:00:00Z')

      expectOk(
        await WhatsAppAgentPresenceRepository.touchLastAssigned(
          workspace.id,
          ana.id,
          first,
        ),
      )
      const created = expectOk(
        await WhatsAppAgentPresenceRepository.find(workspace.id, ana.id),
      )
      expect(created?.status).toBe('AVAILABLE')
      expect(created?.lastAssignedAt).toEqual(first)

      await WhatsAppAgentPresenceRepository.setStatus(
        workspace.id,
        ana.id,
        'AWAY',
      )
      expectOk(
        await WhatsAppAgentPresenceRepository.touchLastAssigned(
          workspace.id,
          ana.id,
          second,
        ),
      )
      const updated = expectOk(
        await WhatsAppAgentPresenceRepository.find(workspace.id, ana.id),
      )
      expect(updated?.status).toBe('AWAY')
      expect(updated?.lastAssignedAt).toEqual(second)
    })

    it('reports a database failure', async () => {
      vi.spyOn(prisma.whatsAppAgentPresence, 'upsert').mockRejectedValueOnce(
        new Error('boom'),
      )
      expectErr(
        await WhatsAppAgentPresenceRepository.touchLastAssigned(
          'w',
          'u',
          new Date(),
        ),
        'DATABASE_ERROR',
      )
    })
  })

  it('removes a presence row when the user is deleted', async () => {
    const { workspace, ana } = await fixtures()
    await seedWhatsAppAgentPresence({
      workspaceId: workspace.id,
      userId: ana.id,
    })
    await prisma.user.delete({ where: { id: ana.id } })
    expect(
      await prisma.whatsAppAgentPresence.count({
        where: { workspaceId: workspace.id },
      }),
    ).toBe(0)
  })
})
