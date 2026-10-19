import { describe, expect, it, vi } from 'vitest'
import { seedWorkspaceAiSettings } from '@/src/__tests__/factories/ai-settings.factory'
import { seedMembership } from '@/src/__tests__/factories/membership.factory'
import { seedSdTicket } from '@/src/__tests__/factories/sd-ticket.factory'
import {
  seedSdDepartment,
  seedSdPhaseFlow,
  seedSdSettings,
} from '@/src/__tests__/factories/sd-ticket-context.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { seedWorkspaceModuleAccess } from '@/src/__tests__/factories/workspace-module-access.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { AiProactiveSignalRepository } from '../ai-proactive-signal.repository'

const NOW = new Date('2026-10-18T15:00:00.000Z')
const MIN = 60_000
const HOUR = 60 * MIN

describe('AiProactiveSignalRepository — workspaces and members', () => {
  it('lists active workspaces with their switches and enabled modules', async () => {
    const user = await seedUser()
    const [plain, off, suspended] = await Promise.all([
      seedWorkspace({ slug: 'plain-ws' }),
      seedWorkspace({ slug: 'off-ws' }),
      seedWorkspace({ slug: 'susp-ws', status: 'SUSPENDED' }),
    ])
    await seedWorkspaceAiSettings(off.id, { proactiveEnabled: false })
    await seedWorkspaceModuleAccess(plain.id, user.id, { module: 'CRM' })
    await seedWorkspaceModuleAccess(plain.id, user.id, {
      module: 'SERVICE_DESK',
      enabled: false,
    })
    await seedWorkspaceModuleAccess(suspended.id, user.id)

    const rows = expectOk(await AiProactiveSignalRepository.listWorkspaces())
    const byId = new Map(rows.map((row) => [row.id, row]))
    expect(byId.has(suspended.id)).toBe(false)
    expect(byId.get(plain.id)).toEqual({
      id: plain.id,
      slug: 'plain-ws',
      name: plain.name,
      aiEnabled: true,
      proactiveEnabled: true,
      modules: ['CRM'],
    })
    expect(byId.get(off.id)).toMatchObject({
      aiEnabled: true,
      proactiveEnabled: false,
      modules: [],
    })
  })

  it('lists members with their time zone, without accounts being deleted', async () => {
    const workspace = await seedWorkspace()
    const [withZone, noPrefs, leaving] = await Promise.all([
      seedUser({ name: 'Ana' }),
      seedUser({ name: 'Bia' }),
      seedUser({ name: 'Caio' }),
    ])
    await prisma.userPreference.create({
      data: { userId: withZone.id, timezone: 'Europe/Lisbon' },
    })
    await prisma.user.update({
      where: { id: leaving.id },
      data: { deletionScheduledAt: NOW },
    })
    for (const user of [withZone, noPrefs, leaving]) {
      await seedMembership({ userId: user.id, workspaceId: workspace.id })
    }

    const members = expectOk(
      await AiProactiveSignalRepository.listMembers(workspace.id),
    )
    expect(members).toEqual([
      {
        userId: withZone.id,
        name: 'Ana',
        email: withZone.email,
        timeZone: 'Europe/Lisbon',
      },
      { userId: noPrefs.id, name: 'Bia', email: noPrefs.email, timeZone: null },
    ])
  })
})

describe('AiProactiveSignalRepository — ServiceDesk forecast', () => {
  it('reads open tickets predicted to breach inside the window, soonest first', async () => {
    const workspace = await seedWorkspace()
    await seedSdSettings(workspace.id)
    const flow = await seedSdPhaseFlow(workspace.id)
    const department = await seedSdDepartment(workspace.id, { name: 'N1' })
    const agent = await seedUser()

    const soon = await seedSdTicket(workspace.id, flow.initial.id, {
      title: 'VPN fora',
      departmentId: department.id,
      assigneeId: agent.id,
    })
    const later = await seedSdTicket(workspace.id, flow.inProgress.id)
    const outside = await seedSdTicket(workspace.id, flow.initial.id)
    const closed = await seedSdTicket(workspace.id, flow.resolved.id)
    const deleted = await seedSdTicket(workspace.id, flow.initial.id, {
      deletedAt: NOW,
    })
    const predict = (ticketId: string, eta: Date, score = 70) =>
      prisma.sdTicketRiskPrediction.create({
        data: {
          workspaceId: workspace.id,
          ticketId,
          level: 'HIGH',
          score,
          breachEtaAt: eta,
        },
      })
    await predict(soon.id, new Date(NOW.getTime() + 30 * MIN), 90)
    await predict(later.id, new Date(NOW.getTime() + 3 * HOUR))
    await predict(outside.id, new Date(NOW.getTime() + 6 * HOUR))
    await predict(closed.id, new Date(NOW.getTime() + HOUR))
    await predict(deleted.id, new Date(NOW.getTime() + HOUR))

    const rows = expectOk(
      await AiProactiveSignalRepository.sdBreachForecast(
        workspace.id,
        NOW,
        new Date(NOW.getTime() + 4 * HOUR),
      ),
    )
    expect(rows).toEqual([
      {
        ticketId: soon.id,
        number: soon.number,
        type: 'INCIDENT',
        title: 'VPN fora',
        departmentId: department.id,
        departmentName: 'N1',
        assigneeId: agent.id,
        breachEtaAt: new Date(NOW.getTime() + 30 * MIN),
        score: 90,
      },
      expect.objectContaining({
        ticketId: later.id,
        departmentId: null,
        departmentName: null,
        assigneeId: null,
      }),
    ])
  })
})

describe('AiProactiveSignalRepository — Comunicação', () => {
  async function fixtures() {
    const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
    const connection = (module: 'COMMUNICATION' | 'SERVICE_DESK', n: number) =>
      prisma.whatsAppConnection.create({
        data: {
          workspaceId: workspace.id,
          provider: 'ZAPI',
          label: `Conexão ${n}`,
          phoneNumber: `551199999000${n}`,
          zapiInstanceId: `instance-${workspace.id}-${n}`,
          encryptedZapiToken: 'enc:token',
          createdById: user.id,
          module,
        },
      })
    const zap = await connection('COMMUNICATION', 1)
    const sd = await connection('SERVICE_DESK', 2)
    let contacts = 0
    const conversation = async (
      data: Partial<{
        connectionId: string
        status: 'NEW' | 'IN_PROGRESS' | 'CLOSED'
        assignedUserId: string | null
        avgSentimentScore: number | null
        lastMessageAt: Date | null
        createdAt: Date
        archivedAt: Date | null
        name: string | null
      }> = {},
    ) => {
      contacts += 1
      const { name = 'Maria', ...rest } = data
      const contact = await prisma.whatsAppContact.create({
        data: {
          workspaceId: workspace.id,
          waId: `55119888800${contacts}`,
          name,
        },
      })
      return prisma.whatsAppConversation.create({
        data: {
          workspaceId: workspace.id,
          connectionId: zap.id,
          contactId: contact.id,
          status: 'NEW',
          ...rest,
        },
      })
    }
    return { workspace, user, zap, sd, conversation }
  }

  it('reads the waiting queue: open, unassigned, zap only, since the cutoff', async () => {
    const { workspace, user, sd, conversation } = await fixtures()
    const before = new Date(NOW.getTime() - 30 * MIN)
    const oldest = await conversation({
      lastMessageAt: new Date(NOW.getTime() - 3 * HOUR),
    })
    const noMessage = await conversation({
      lastMessageAt: null,
      createdAt: new Date(NOW.getTime() - HOUR),
      name: null,
    })
    await conversation({ lastMessageAt: new Date(NOW.getTime() - 5 * MIN) })
    await conversation({
      lastMessageAt: new Date(NOW.getTime() - HOUR),
      assignedUserId: user.id,
    })
    await conversation({
      lastMessageAt: new Date(NOW.getTime() - HOUR),
      status: 'CLOSED',
    })
    await conversation({
      lastMessageAt: new Date(NOW.getTime() - HOUR),
      archivedAt: NOW,
    })
    await conversation({
      lastMessageAt: new Date(NOW.getTime() - HOUR),
      connectionId: sd.id,
    })

    const rows = expectOk(
      await AiProactiveSignalRepository.zapWaiting(workspace.id, before),
    )
    expect(rows.map((row) => row.id).sort()).toEqual(
      [oldest.id, noMessage.id].sort(),
    )
    expect(rows.find((row) => row.id === noMessage.id)).toMatchObject({
      contactName: null,
      lastMessageAt: null,
    })
  })

  it('reads the negative conversations of the window, worst first', async () => {
    const { workspace, user, conversation } = await fixtures()
    const since = new Date(NOW.getTime() - 24 * HOUR)
    const bad = await conversation({
      avgSentimentScore: -0.8,
      lastMessageAt: NOW,
      assignedUserId: user.id,
    })
    const mild = await conversation({
      avgSentimentScore: -0.4,
      lastMessageAt: NOW,
    })
    await conversation({ avgSentimentScore: 0.3, lastMessageAt: NOW })
    await conversation({ avgSentimentScore: null, lastMessageAt: NOW })
    await conversation({
      avgSentimentScore: -0.9,
      lastMessageAt: new Date(NOW.getTime() - 48 * HOUR),
    })

    const rows = expectOk(
      await AiProactiveSignalRepository.zapNegative(workspace.id, -0.3, since),
    )
    expect(rows.map((row) => row.id)).toEqual([bad.id, mild.id])
    expect(rows[0]).toMatchObject({
      assignedUserId: user.id,
      avgSentimentScore: -0.8,
      contactName: 'Maria',
    })
  })

  it('reads the sentiment alert rule, with the schema defaults', async () => {
    const workspace = await seedWorkspace()
    expect(
      expectOk(
        await AiProactiveSignalRepository.zapSentimentRule(workspace.id),
      ),
    ).toEqual({ enabled: true, threshold: -0.3 })
    await prisma.whatsAppSettings.create({
      data: {
        workspaceId: workspace.id,
        sentimentAlertEnabled: false,
        sentimentAlertThreshold: -0.5,
      },
    })
    expect(
      expectOk(
        await AiProactiveSignalRepository.zapSentimentRule(workspace.id),
      ),
    ).toEqual({ enabled: false, threshold: -0.5 })
  })
})

describe('AiProactiveSignalRepository — database errors', () => {
  it('returns DATABASE_ERROR instead of throwing', async () => {
    const boom = new Error('db down')
    vi.spyOn(prisma.workspace, 'findMany').mockRejectedValue(boom)
    vi.spyOn(prisma.membership, 'findMany').mockRejectedValue(boom)
    vi.spyOn(prisma.sdTicketRiskPrediction, 'findMany').mockRejectedValue(boom)
    vi.spyOn(prisma.whatsAppConversation, 'findMany').mockRejectedValue(boom)
    vi.spyOn(prisma.whatsAppSettings, 'findUnique').mockRejectedValue(boom)

    expectErr(
      await AiProactiveSignalRepository.listWorkspaces(),
      'DATABASE_ERROR',
    )
    expectErr(
      await AiProactiveSignalRepository.listMembers('ws'),
      'DATABASE_ERROR',
    )
    expectErr(
      await AiProactiveSignalRepository.sdBreachForecast('ws', NOW, NOW),
      'DATABASE_ERROR',
    )
    expectErr(
      await AiProactiveSignalRepository.zapWaiting('ws', NOW),
      'DATABASE_ERROR',
    )
    expectErr(
      await AiProactiveSignalRepository.zapNegative('ws', -0.3, NOW),
      'DATABASE_ERROR',
    )
    expectErr(
      await AiProactiveSignalRepository.zapSentimentRule('ws'),
      'DATABASE_ERROR',
    )
    vi.restoreAllMocks()
  })
})
