import { describe, expect, it } from 'vitest'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { WhatsAppSlaPolicyRepository } from '../whatsapp-sla-policy.repository'

async function seedTeam(workspaceId: string, name: string) {
  return prisma.whatsAppTeam.create({ data: { workspaceId, name } })
}

describe('WhatsAppSlaPolicyRepository', () => {
  describe('create() and findById()', () => {
    it('should persist a policy with the schema defaults (disabled)', async () => {
      const workspace = await seedWorkspace()

      const created = expectOk(
        await WhatsAppSlaPolicyRepository.create({ workspaceId: workspace.id }),
      )

      expect(created).toMatchObject({
        teamId: null,
        enabled: false,
        firstResponseMinutes: 15,
        resolutionMinutes: null,
        businessHoursOnly: true,
        warnAtPercent: 80,
        countAiAsResponse: false,
        supervisorIds: [],
        team: null,
      })
      const found = expectOk(
        await WhatsAppSlaPolicyRepository.findById(created.id, workspace.id),
      )
      expect(found?.id).toBe(created.id)
    })

    it('should not find a policy of another workspace', async () => {
      const [a, b] = await Promise.all([seedWorkspace(), seedWorkspace()])
      const created = expectOk(
        await WhatsAppSlaPolicyRepository.create({ workspaceId: a.id }),
      )
      expect(
        expectOk(await WhatsAppSlaPolicyRepository.findById(created.id, b.id)),
      ).toBeNull()
    })

    it('should allow only one default policy per workspace', async () => {
      const workspace = await seedWorkspace()
      expectOk(
        await WhatsAppSlaPolicyRepository.create({ workspaceId: workspace.id }),
      )
      const duplicate = await WhatsAppSlaPolicyRepository.create({
        workspaceId: workspace.id,
      })
      expect(duplicate.ok).toBe(false)
    })

    it('should allow only one override per team', async () => {
      const workspace = await seedWorkspace()
      const team = await seedTeam(workspace.id, 'Vendas')
      expectOk(
        await WhatsAppSlaPolicyRepository.create({
          workspaceId: workspace.id,
          teamId: team.id,
        }),
      )
      const duplicate = await WhatsAppSlaPolicyRepository.create({
        workspaceId: workspace.id,
        teamId: team.id,
      })
      expect(duplicate.ok).toBe(false)
    })
  })

  describe('listByWorkspace()', () => {
    it('should list the default first, then overrides by team name', async () => {
      const workspace = await seedWorkspace()
      const [suporte, vendas] = await Promise.all([
        seedTeam(workspace.id, 'Suporte'),
        seedTeam(workspace.id, 'Vendas'),
      ])
      for (const teamId of [vendas.id, suporte.id, null]) {
        expectOk(
          await WhatsAppSlaPolicyRepository.create({
            workspaceId: workspace.id,
            teamId,
          }),
        )
      }

      const list = expectOk(
        await WhatsAppSlaPolicyRepository.listByWorkspace(workspace.id),
      )

      expect(list.map((policy) => policy.team?.name ?? null)).toEqual([
        null,
        'Suporte',
        'Vendas',
      ])
    })
  })

  describe('findByScope() and resolveForTeam()', () => {
    it('should find the policy of exactly one scope', async () => {
      const workspace = await seedWorkspace()
      const team = await seedTeam(workspace.id, 'Vendas')
      const def = expectOk(
        await WhatsAppSlaPolicyRepository.create({ workspaceId: workspace.id }),
      )

      expect(
        expectOk(
          await WhatsAppSlaPolicyRepository.findByScope(workspace.id, null),
        )?.id,
      ).toBe(def.id)
      expect(
        expectOk(
          await WhatsAppSlaPolicyRepository.findByScope(workspace.id, team.id),
        ),
      ).toBeNull()
    })

    it('should prefer the team override and fall back to the default', async () => {
      const workspace = await seedWorkspace()
      const [withOverride, without] = await Promise.all([
        seedTeam(workspace.id, 'Vendas'),
        seedTeam(workspace.id, 'Suporte'),
      ])
      const def = expectOk(
        await WhatsAppSlaPolicyRepository.create({ workspaceId: workspace.id }),
      )
      const override = expectOk(
        await WhatsAppSlaPolicyRepository.create({
          workspaceId: workspace.id,
          teamId: withOverride.id,
        }),
      )

      const resolve = async (teamId: string | null) =>
        expectOk(
          await WhatsAppSlaPolicyRepository.resolveForTeam(
            workspace.id,
            teamId,
          ),
        )?.id

      expect(await resolve(withOverride.id)).toBe(override.id)
      expect(await resolve(without.id)).toBe(def.id)
      expect(await resolve(null)).toBe(def.id)
    })

    it('should resolve to null without any policy', async () => {
      const workspace = await seedWorkspace()
      expect(
        expectOk(
          await WhatsAppSlaPolicyRepository.resolveForTeam(workspace.id, null),
        ),
      ).toBeNull()
      expect(
        expectOk(
          await WhatsAppSlaPolicyRepository.resolveForTeam(workspace.id, 'x'),
        ),
      ).toBeNull()
    })
  })

  describe('update() and delete()', () => {
    it('should update fields and delete the policy', async () => {
      const workspace = await seedWorkspace()
      const created = expectOk(
        await WhatsAppSlaPolicyRepository.create({ workspaceId: workspace.id }),
      )

      const updated = expectOk(
        await WhatsAppSlaPolicyRepository.update(created.id, {
          enabled: true,
          resolutionMinutes: 120,
        }),
      )
      expect(updated).toMatchObject({ enabled: true, resolutionMinutes: 120 })

      expectOk(await WhatsAppSlaPolicyRepository.delete(created.id))
      expect(
        expectOk(
          await WhatsAppSlaPolicyRepository.findById(created.id, workspace.id),
        ),
      ).toBeNull()
    })

    it('should answer an error for a missing policy', async () => {
      expect(
        (await WhatsAppSlaPolicyRepository.update('missing', { enabled: true }))
          .ok,
      ).toBe(false)
      expect((await WhatsAppSlaPolicyRepository.delete('missing')).ok).toBe(
        false,
      )
    })

    it('should drop the team overrides together with the team', async () => {
      const workspace = await seedWorkspace()
      const team = await seedTeam(workspace.id, 'Vendas')
      const created = expectOk(
        await WhatsAppSlaPolicyRepository.create({
          workspaceId: workspace.id,
          teamId: team.id,
        }),
      )
      await prisma.whatsAppTeam.delete({ where: { id: team.id } })
      expect(
        expectOk(
          await WhatsAppSlaPolicyRepository.findById(created.id, workspace.id),
        ),
      ).toBeNull()
    })
  })
})
