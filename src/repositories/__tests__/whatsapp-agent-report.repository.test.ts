import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWhatsAppAgentReportSettings } from '@/src/__tests__/factories/whatsapp-agent-report.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { WhatsAppAgentReportRepository as Repo } from '../whatsapp-agent-report.repository'

const START = new Date('2026-11-01T03:00:00.000Z')
const END = new Date('2026-11-08T03:00:00.000Z')

async function setup() {
  const [workspace, ana, bruno] = await Promise.all([
    seedWorkspace(),
    seedUser(),
    seedUser(),
  ])
  const connection = await prisma.whatsAppConnection.create({
    data: {
      workspaceId: workspace.id,
      provider: 'ZAPI',
      label: 'Cobrança',
      phoneNumber: `5511${Math.floor(Math.random() * 1e9)}`,
      createdById: ana.id,
    },
  })
  const sale = await prisma.whatsAppCloseStatus.create({
    data: { workspaceId: workspace.id, label: 'Venda', outcome: 'SUCCESS' },
  })
  const refused = await prisma.whatsAppCloseStatus.create({
    data: {
      workspaceId: workspace.id,
      label: 'Sem interesse',
      outcome: 'FAILURE',
    },
  })
  return { workspace, ana, bruno, connection, sale, refused }
}

type Seed = Awaited<ReturnType<typeof setup>>

async function seedConversation(
  seed: Seed,
  data: {
    assignedUserId?: string | null
    status?: 'NEW' | 'IN_PROGRESS' | 'CLOSED'
    createdAt?: Date
    closedAt?: Date | null
    closeOutcome?: 'SUCCESS' | 'FAILURE' | null
    closeStatusIds?: string[]
    closeStatusLabels?: string[]
    teamId?: string | null
    connectionId?: string
    deletedAt?: Date | null
  },
) {
  const contact = await prisma.whatsAppContact.create({
    data: {
      workspaceId: seed.workspace.id,
      waId: `5511${Math.floor(Math.random() * 1e9)}`,
      name: 'Maria',
    },
  })
  return prisma.whatsAppConversation.create({
    data: {
      workspaceId: seed.workspace.id,
      connectionId: data.connectionId ?? seed.connection.id,
      contactId: contact.id,
      assignedUserId: data.assignedUserId ?? null,
      status: data.status ?? 'CLOSED',
      createdAt: data.createdAt ?? new Date('2026-11-02T12:00:00.000Z'),
      closedAt:
        data.closedAt === undefined
          ? new Date('2026-11-02T13:00:00.000Z')
          : data.closedAt,
      closeOutcome: data.closeOutcome ?? null,
      closeStatusIds: data.closeStatusIds ?? [],
      closeStatusLabels: data.closeStatusLabels ?? [],
      teamId: data.teamId ?? null,
      deletedAt: data.deletedAt ?? null,
    },
  })
}

describe('WhatsAppAgentReportRepository', () => {
  afterEach(() => vi.restoreAllMocks())

  describe('settings', () => {
    it('is null until saved, then upserts', async () => {
      const { workspace, ana } = await setup()
      expect(expectOk(await Repo.getSettings(workspace.id))).toBeNull()

      const created = expectOk(
        await Repo.upsertSettings(workspace.id, {
          enabled: true,
          updatedById: ana.id,
        }),
      )
      expect(created).toMatchObject({ enabled: true, updatedById: ana.id })

      const updated = expectOk(
        await Repo.upsertSettings(workspace.id, {
          enabled: false,
          updatedById: ana.id,
        }),
      )
      expect(updated.enabled).toBe(false)
      expect(expectOk(await Repo.getSettings(workspace.id))?.enabled).toBe(
        false,
      )
    })

    it('goes away with the workspace (cascade)', async () => {
      const { workspace } = await setup()
      await seedWhatsAppAgentReportSettings(workspace.id)
      await prisma.workspace.delete({ where: { id: workspace.id } })
      expect(await prisma.whatsAppAgentReportSettings.count()).toBe(0)
    })
  })

  describe('closedByAgent', () => {
    it('counts per assignee: outcome, untabulated and handling time', async () => {
      const seed = await setup()
      const { workspace, ana, bruno, sale, refused } = seed
      await seedConversation(seed, {
        assignedUserId: ana.id,
        closeOutcome: 'SUCCESS',
        closeStatusIds: [sale.id],
        closeStatusLabels: ['Venda'],
        // 1 h
      })
      await seedConversation(seed, {
        assignedUserId: ana.id,
        closeOutcome: 'FAILURE',
        closeStatusIds: [refused.id],
        closeStatusLabels: ['Sem interesse'],
        closedAt: new Date('2026-11-02T14:00:00.000Z'), // 2 h
      })
      await seedConversation(seed, { assignedUserId: ana.id }) // untabulated, 1 h
      await seedConversation(seed, {
        assignedUserId: bruno.id,
        closeOutcome: 'SUCCESS',
        closeStatusIds: [sale.id],
        closeStatusLabels: ['Venda'],
      })
      await seedConversation(seed, { assignedUserId: null }) // Sem atendente

      const rows = expectOk(
        await Repo.closedByAgent({
          workspaceId: workspace.id,
          start: START,
          endExclusive: END,
        }),
      )
      const byAgent = new Map(rows.map((row) => [row.agentId, row]))
      expect(byAgent.get(ana.id)).toEqual({
        agentId: ana.id,
        closed: 3,
        success: 1,
        failure: 1,
        untabulated: 1,
        handlingSeconds: 3600 + 7200 + 3600,
      })
      expect(byAgent.get(bruno.id)).toMatchObject({ closed: 1, success: 1 })
      expect(byAgent.get(null)).toMatchObject({ closed: 1, untabulated: 1 })
    })

    it('uses closedAt with an inclusive start and an exclusive end', async () => {
      const seed = await setup()
      await seedConversation(seed, {
        assignedUserId: seed.ana.id,
        createdAt: new Date('2026-10-30T12:00:00.000Z'),
        closedAt: START, // first instant: in
      })
      await seedConversation(seed, {
        assignedUserId: seed.ana.id,
        createdAt: new Date('2026-10-30T12:00:00.000Z'),
        closedAt: END, // exclusive: out
      })
      await seedConversation(seed, {
        assignedUserId: seed.ana.id,
        closedAt: new Date('2026-10-31T23:59:59.000Z'), // before: out
      })
      const rows = expectOk(
        await Repo.closedByAgent({
          workspaceId: seed.workspace.id,
          start: START,
          endExclusive: END,
        }),
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].closed).toBe(1)
    })

    it('ignores still-open, reopened, deleted and foreign-workspace conversations', async () => {
      const seed = await setup()
      const other = await setup()
      await seedConversation(seed, {
        assignedUserId: seed.ana.id,
        status: 'IN_PROGRESS',
        closedAt: null,
      })
      await seedConversation(seed, {
        assignedUserId: seed.ana.id,
        deletedAt: new Date('2026-11-03T00:00:00.000Z'),
      })
      await seedConversation(other, { assignedUserId: other.ana.id })
      expect(
        expectOk(
          await Repo.closedByAgent({
            workspaceId: seed.workspace.id,
            start: START,
            endExclusive: END,
          }),
        ),
      ).toEqual([])
    })

    it('filters by team and connection', async () => {
      const seed = await setup()
      const team = await prisma.whatsAppTeam.create({
        data: { workspaceId: seed.workspace.id, name: 'Cobrança' },
      })
      const second = await prisma.whatsAppConnection.create({
        data: {
          workspaceId: seed.workspace.id,
          provider: 'ZAPI',
          label: 'Vendas',
          phoneNumber: `5511${Math.floor(Math.random() * 1e9)}`,
          createdById: seed.ana.id,
        },
      })
      await seedConversation(seed, {
        assignedUserId: seed.ana.id,
        teamId: team.id,
      })
      await seedConversation(seed, {
        assignedUserId: seed.ana.id,
        connectionId: second.id,
      })
      const base = {
        workspaceId: seed.workspace.id,
        start: START,
        endExclusive: END,
      }
      expect(
        expectOk(await Repo.closedByAgent({ ...base, teamId: team.id }))[0]
          .closed,
      ).toBe(1)
      expect(
        expectOk(
          await Repo.closedByAgent({ ...base, connectionId: second.id }),
        )[0].closed,
      ).toBe(1)
    })

    it("restricts to the visible assignees and the led teams' queue", async () => {
      const seed = await setup()
      const team = await prisma.whatsAppTeam.create({
        data: { workspaceId: seed.workspace.id, name: 'Cobrança' },
      })
      await seedConversation(seed, { assignedUserId: seed.ana.id })
      await seedConversation(seed, { assignedUserId: seed.bruno.id })
      await seedConversation(seed, { assignedUserId: null, teamId: team.id })
      await seedConversation(seed, { assignedUserId: null }) // no team: hidden
      const rows = expectOk(
        await Repo.closedByAgent({
          workspaceId: seed.workspace.id,
          start: START,
          endExclusive: END,
          restriction: {
            agentIds: [seed.ana.id],
            unassignedTeamIds: [team.id],
          },
        }),
      )
      expect(rows.map((row) => row.agentId).sort()).toEqual(
        [seed.ana.id, null].sort(),
      )
    })

    it('restricting to nobody returns nothing', async () => {
      const seed = await setup()
      await seedConversation(seed, { assignedUserId: seed.ana.id })
      expect(
        expectOk(
          await Repo.closedByAgent({
            workspaceId: seed.workspace.id,
            start: START,
            endExclusive: END,
            restriction: { agentIds: [], unassignedTeamIds: [] },
          }),
        ),
      ).toEqual([])
    })
  })

  describe('openByAgent', () => {
    it('counts the conversations not closed right now, period-free', async () => {
      const seed = await setup()
      await seedConversation(seed, {
        assignedUserId: seed.ana.id,
        status: 'IN_PROGRESS',
        closedAt: null,
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
      })
      await seedConversation(seed, {
        assignedUserId: seed.ana.id,
        status: 'NEW',
        closedAt: null,
      })
      await seedConversation(seed, { assignedUserId: seed.ana.id }) // closed
      await seedConversation(seed, { status: 'NEW', closedAt: null })
      await seedConversation(seed, {
        assignedUserId: seed.ana.id,
        status: 'NEW',
        closedAt: null,
        deletedAt: new Date(),
      })
      const rows = expectOk(
        await Repo.openByAgent({ workspaceId: seed.workspace.id }),
      )
      const byAgent = new Map(rows.map((row) => [row.agentId, row.open]))
      expect(byAgent.get(seed.ana.id)).toBe(2)
      expect(byAgent.get(null)).toBe(1)
    })
  })

  describe('statusesByAgent', () => {
    it('counts a conversation once in each of its labels, with the outcome', async () => {
      const seed = await setup()
      const { ana, sale, refused } = seed
      await seedConversation(seed, {
        assignedUserId: ana.id,
        closeOutcome: 'FAILURE',
        closeStatusIds: [sale.id, refused.id],
        closeStatusLabels: ['Venda', 'Sem interesse'],
      })
      await seedConversation(seed, {
        assignedUserId: ana.id,
        closeOutcome: 'SUCCESS',
        closeStatusIds: [sale.id],
        closeStatusLabels: ['Venda'],
      })
      await seedConversation(seed, { assignedUserId: ana.id }) // untabulated
      const rows = expectOk(
        await Repo.statusesByAgent({
          workspaceId: seed.workspace.id,
          start: START,
          endExclusive: END,
        }),
      )
      const counts = new Map(
        rows.map((row) => [`${row.agentId}:${row.label}`, row]),
      )
      expect(counts.get(`${ana.id}:Venda`)).toMatchObject({
        outcome: 'SUCCESS',
        count: 2,
      })
      expect(counts.get(`${ana.id}:Sem interesse`)).toMatchObject({
        outcome: 'FAILURE',
        count: 1,
      })
      expect(rows).toHaveLength(2)
    })

    it('keeps the copied label with a null outcome when the status is gone', async () => {
      const seed = await setup()
      await seedConversation(seed, {
        assignedUserId: seed.ana.id,
        closeOutcome: 'SUCCESS',
        closeStatusIds: ['removed-status'],
        closeStatusLabels: ['Antigo'],
      })
      const rows = expectOk(
        await Repo.statusesByAgent({
          workspaceId: seed.workspace.id,
          start: START,
          endExclusive: END,
        }),
      )
      expect(rows).toEqual([
        { agentId: seed.ana.id, label: 'Antigo', outcome: null, count: 1 },
      ])
    })
  })
})
