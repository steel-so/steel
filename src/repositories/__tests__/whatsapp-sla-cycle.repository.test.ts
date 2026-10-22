import { describe, expect, it } from 'vitest'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { WhatsAppSlaCycleRepository } from '../whatsapp-sla-cycle.repository'

let counter = 0

async function seedConversation() {
  counter += 1
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  const connection = await prisma.whatsAppConnection.create({
    data: {
      workspaceId: workspace.id,
      provider: 'ZAPI',
      label: 'Suporte',
      phoneNumber: '5511999999999',
      zapiInstanceId: `sla-instance-${counter}`,
      encryptedZapiToken: 'enc:token',
      createdById: user.id,
    },
  })
  const contact = await prisma.whatsAppContact.create({
    data: {
      workspaceId: workspace.id,
      waId: `55119888${counter}`,
      name: 'Maria',
    },
  })
  const conversation = await prisma.whatsAppConversation.create({
    data: {
      workspaceId: workspace.id,
      connectionId: connection.id,
      contactId: contact.id,
      status: 'NEW',
    },
  })
  return { workspace, user, conversation }
}

const minute = 60_000
const startedAt = new Date('2026-10-22T12:00:00Z')
const at = (minutes: number) => new Date(startedAt.getTime() + minutes * minute)

function cycleData(
  fixture: { workspace: { id: string }; conversation: { id: string } },
  overrides: Record<string, unknown> = {},
) {
  return {
    workspaceId: fixture.workspace.id,
    conversationId: fixture.conversation.id,
    firstResponseMinutes: 15,
    resolutionMinutes: 120,
    startedAt,
    firstResponseDueAt: at(15),
    firstResponseWarnAt: at(12),
    resolutionDueAt: at(120),
    resolutionWarnAt: at(96),
    ...overrides,
  }
}

describe('WhatsAppSlaCycleRepository', () => {
  describe('create() and the open-cycle guard', () => {
    it('should open a cycle and find it as the open one', async () => {
      const fixture = await seedConversation()
      const created = expectOk(
        await WhatsAppSlaCycleRepository.create(cycleData(fixture)),
      )
      expect(created?.resolvedAt).toBeNull()

      const open = expectOk(
        await WhatsAppSlaCycleRepository.findOpenByConversation(
          fixture.conversation.id,
        ),
      )
      expect(open?.id).toBe(created?.id)
    })

    it('should answer null instead of failing when a cycle is already open', async () => {
      const fixture = await seedConversation()
      expectOk(await WhatsAppSlaCycleRepository.create(cycleData(fixture)))

      const second = expectOk(
        await WhatsAppSlaCycleRepository.create(cycleData(fixture)),
      )
      expect(second).toBeNull()
    })

    it('should allow a new cycle once the previous one ended', async () => {
      const fixture = await seedConversation()
      expectOk(await WhatsAppSlaCycleRepository.create(cycleData(fixture)))
      expectOk(
        await WhatsAppSlaCycleRepository.resolveOpen(fixture.conversation.id, {
          at: at(30),
          agentUserId: null,
        }),
      )

      const next = expectOk(
        await WhatsAppSlaCycleRepository.create(
          cycleData(fixture, { startedAt: at(60) }),
        ),
      )
      expect(next).not.toBeNull()

      const latest = expectOk(
        await WhatsAppSlaCycleRepository.findLatestByConversation(
          fixture.conversation.id,
        ),
      )
      expect(latest?.id).toBe(next?.id)
    })

    it('should return null from the finders when there is no cycle', async () => {
      const fixture = await seedConversation()
      expect(
        expectOk(
          await WhatsAppSlaCycleRepository.findOpenByConversation(
            fixture.conversation.id,
          ),
        ),
      ).toBeNull()
      expect(
        expectOk(
          await WhatsAppSlaCycleRepository.findLatestByConversation(
            fixture.conversation.id,
          ),
        ),
      ).toBeNull()
    })

    it('should fail for a conversation that does not exist', async () => {
      const fixture = await seedConversation()
      const result = await WhatsAppSlaCycleRepository.create(
        cycleData({ ...fixture, conversation: { id: 'missing' } }),
      )
      expect(result.ok).toBe(false)
    })
  })

  describe('recordFirstResponse()', () => {
    it('should record only the first answer', async () => {
      const fixture = await seedConversation()
      const cycle = expectOk(
        await WhatsAppSlaCycleRepository.create(cycleData(fixture)),
      )

      const first = expectOk(
        await WhatsAppSlaCycleRepository.recordFirstResponse(cycle?.id ?? '', {
          at: at(5),
          seconds: 300,
          agentUserId: fixture.user.id,
        }),
      )
      const second = expectOk(
        await WhatsAppSlaCycleRepository.recordFirstResponse(cycle?.id ?? '', {
          at: at(8),
          seconds: 480,
          agentUserId: null,
        }),
      )

      expect(first).toBe(true)
      expect(second).toBe(false)
      const stored = await prisma.whatsAppSlaCycle.findUniqueOrThrow({
        where: { id: cycle?.id },
      })
      expect(stored).toMatchObject({
        firstResponseSeconds: 300,
        agentUserId: fixture.user.id,
      })
      expect(stored.firstResponseAt).toEqual(at(5))
    })

    it('should keep the snapshot agent when the answer has no sender (AI)', async () => {
      const fixture = await seedConversation()
      const cycle = expectOk(
        await WhatsAppSlaCycleRepository.create(
          cycleData(fixture, { agentUserId: fixture.user.id }),
        ),
      )
      await WhatsAppSlaCycleRepository.recordFirstResponse(cycle?.id ?? '', {
        at: at(1),
        seconds: 60,
        agentUserId: null,
      })
      const stored = await prisma.whatsAppSlaCycle.findUniqueOrThrow({
        where: { id: cycle?.id },
      })
      expect(stored.agentUserId).toBe(fixture.user.id)
    })
  })

  describe('resolveOpen()', () => {
    it('should end the open cycle once and report how many changed', async () => {
      const fixture = await seedConversation()
      expectOk(await WhatsAppSlaCycleRepository.create(cycleData(fixture)))

      const first = expectOk(
        await WhatsAppSlaCycleRepository.resolveOpen(fixture.conversation.id, {
          at: at(30),
          agentUserId: fixture.user.id,
        }),
      )
      const again = expectOk(
        await WhatsAppSlaCycleRepository.resolveOpen(fixture.conversation.id, {
          at: at(31),
          agentUserId: null,
        }),
      )

      expect([first, again]).toEqual([1, 0])
      const latest = expectOk(
        await WhatsAppSlaCycleRepository.findLatestByConversation(
          fixture.conversation.id,
        ),
      )
      expect(latest).toMatchObject({ agentUserId: fixture.user.id })
      expect(latest?.resolvedAt).toEqual(at(30))
    })
  })

  describe('listDue() and claim()', () => {
    it('should list cycles by pending transition, oldest deadline first', async () => {
      const a = await seedConversation()
      const b = await seedConversation()
      await WhatsAppSlaCycleRepository.create(cycleData(a))
      await WhatsAppSlaCycleRepository.create(
        cycleData(b, {
          firstResponseDueAt: at(10),
          firstResponseWarnAt: at(8),
        }),
      )

      const none = expectOk(
        await WhatsAppSlaCycleRepository.listDue(
          'firstResponse',
          'warn',
          at(5),
          10,
        ),
      )
      expect(none).toEqual([])

      const warn = expectOk(
        await WhatsAppSlaCycleRepository.listDue(
          'firstResponse',
          'warn',
          at(13),
          10,
        ),
      )
      // b is already past its deadline (10): breach, not warn.
      expect(warn.map((row) => row.conversationId)).toEqual([a.conversation.id])

      const breach = expectOk(
        await WhatsAppSlaCycleRepository.listDue(
          'firstResponse',
          'breach',
          at(16),
          10,
        ),
      )
      expect(breach.map((row) => row.conversationId)).toEqual([
        b.conversation.id,
        a.conversation.id,
      ])
      expect(breach[0].conversation.contact.waId).toBeTruthy()

      const limited = expectOk(
        await WhatsAppSlaCycleRepository.listDue(
          'firstResponse',
          'breach',
          at(16),
          1,
        ),
      )
      expect(limited).toHaveLength(1)
    })

    it('should not list answered, resolved or already-notified cycles', async () => {
      const answered = await seedConversation()
      const notified = await seedConversation()
      const closed = await seedConversation()
      await WhatsAppSlaCycleRepository.create(
        cycleData(answered, { firstResponseAt: at(2) }),
      )
      await WhatsAppSlaCycleRepository.create(
        cycleData(notified, { firstResponseBreachedAt: at(16) }),
      )
      await WhatsAppSlaCycleRepository.create(
        cycleData(closed, { resolvedAt: at(14) }),
      )

      const breach = expectOk(
        await WhatsAppSlaCycleRepository.listDue(
          'firstResponse',
          'breach',
          at(20),
          10,
        ),
      )
      expect(breach).toEqual([])
    })

    it('should list the resolution transitions only for cycles that track it', async () => {
      const tracked = await seedConversation()
      const untracked = await seedConversation()
      await WhatsAppSlaCycleRepository.create(cycleData(tracked))
      await WhatsAppSlaCycleRepository.create(
        cycleData(untracked, {
          resolutionMinutes: null,
          resolutionDueAt: null,
          resolutionWarnAt: null,
        }),
      )

      const warn = expectOk(
        await WhatsAppSlaCycleRepository.listDue(
          'resolution',
          'warn',
          at(100),
          10,
        ),
      )
      expect(warn.map((row) => row.conversationId)).toEqual([
        tracked.conversation.id,
      ])
      const breach = expectOk(
        await WhatsAppSlaCycleRepository.listDue(
          'resolution',
          'breach',
          at(121),
          10,
        ),
      )
      expect(breach.map((row) => row.conversationId)).toEqual([
        tracked.conversation.id,
      ])
    })

    it('should reserve each notice exactly once', async () => {
      const fixture = await seedConversation()
      const cycle = expectOk(
        await WhatsAppSlaCycleRepository.create(cycleData(fixture)),
      )
      const id = cycle?.id ?? ''

      const claim = async (
        kind: 'firstResponse' | 'resolution',
        transition: 'warn' | 'breach',
        when: Date,
      ) =>
        expectOk(
          await WhatsAppSlaCycleRepository.claim(
            id,
            kind,
            transition,
            when,
            fixture.user.id,
          ),
        )

      // Not due yet.
      expect(await claim('firstResponse', 'warn', at(5))).toBe(false)
      expect(await claim('firstResponse', 'warn', at(13))).toBe(true)
      expect(await claim('firstResponse', 'warn', at(13))).toBe(false)
      expect(await claim('firstResponse', 'breach', at(16))).toBe(true)
      expect(await claim('firstResponse', 'breach', at(17))).toBe(false)
      // A breach also marks the warning as sent.
      const stored = await prisma.whatsAppSlaCycle.findUniqueOrThrow({
        where: { id },
      })
      expect(stored.firstResponseWarnedAt).not.toBeNull()
      expect(stored.agentUserId).toBe(fixture.user.id)

      expect(await claim('resolution', 'warn', at(100))).toBe(true)
      expect(await claim('resolution', 'warn', at(101))).toBe(false)
      expect(await claim('resolution', 'breach', at(121))).toBe(true)
      expect(await claim('resolution', 'breach', at(122))).toBe(false)
    })

    it('should not reserve a notice for a cycle that already ended', async () => {
      const fixture = await seedConversation()
      const cycle = expectOk(
        await WhatsAppSlaCycleRepository.create(cycleData(fixture)),
      )
      await WhatsAppSlaCycleRepository.resolveOpen(fixture.conversation.id, {
        at: at(14),
        agentUserId: null,
      })
      expect(
        expectOk(
          await WhatsAppSlaCycleRepository.claim(
            cycle?.id ?? '',
            'firstResponse',
            'breach',
            at(20),
            null,
          ),
        ),
      ).toBe(false)
    })
  })

  describe('listOpenByWorkspace()', () => {
    it('should list only the open cycles of the workspace with the owner fields', async () => {
      const open = await seedConversation()
      const done = await seedConversation()
      await WhatsAppSlaCycleRepository.create(cycleData(open))
      await WhatsAppSlaCycleRepository.create(
        cycleData(done, { resolvedAt: at(20) }),
      )

      const rows = expectOk(
        await WhatsAppSlaCycleRepository.listOpenByWorkspace(open.workspace.id),
      )

      expect(rows).toHaveLength(1)
      expect(rows[0].conversation).toEqual({
        id: open.conversation.id,
        assignedUserId: null,
        teamId: null,
      })
      expect(
        expectOk(
          await WhatsAppSlaCycleRepository.listOpenByWorkspace(
            done.workspace.id,
          ),
        ),
      ).toEqual([])
    })
  })

  describe('listForReport()', () => {
    it('should select the cycles started in the period, optionally by team', async () => {
      const fixture = await seedConversation()
      const team = await prisma.whatsAppTeam.create({
        data: { workspaceId: fixture.workspace.id, name: 'Vendas' },
      })
      await WhatsAppSlaCycleRepository.create(
        cycleData(fixture, { teamId: team.id, resolvedAt: at(30) }),
      )
      await WhatsAppSlaCycleRepository.create(
        cycleData(fixture, { startedAt: at(24 * 60 * 10) }),
      )

      const inPeriod = expectOk(
        await WhatsAppSlaCycleRepository.listForReport({
          workspaceId: fixture.workspace.id,
          from: at(-60),
          to: at(60),
        }),
      )
      expect(inPeriod).toHaveLength(1)
      expect(inPeriod[0]).toMatchObject({ teamId: team.id })

      const all = expectOk(
        await WhatsAppSlaCycleRepository.listForReport({
          workspaceId: fixture.workspace.id,
          from: at(-60),
          to: at(24 * 60 * 11),
        }),
      )
      expect(all).toHaveLength(2)

      const byTeam = expectOk(
        await WhatsAppSlaCycleRepository.listForReport({
          workspaceId: fixture.workspace.id,
          from: at(-60),
          to: at(24 * 60 * 11),
          teamId: team.id,
        }),
      )
      expect(byTeam).toHaveLength(1)
    })
  })
})
