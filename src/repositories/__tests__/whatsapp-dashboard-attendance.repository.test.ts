import type { Prisma } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { WhatsAppDashboardAttendanceRepository } from '../whatsapp-dashboard-attendance.repository'

const SINCE = new Date('2026-11-01T00:00:00.000Z')
const OLD = new Date('2025-01-01T00:00:00.000Z')
const T1 = new Date('2026-11-17T12:00:00.000Z')
const T2 = new Date('2026-11-17T12:30:00.000Z')
const T3 = new Date('2026-11-17T13:00:00.000Z')

let counter = 0
function suffix() {
  counter += 1
  return String(counter).padStart(4, '0')
}

async function setup() {
  const [workspace, user] = await Promise.all([
    seedWorkspace(),
    seedUser({ name: 'Ana' }),
  ])
  const connection = await prisma.whatsAppConnection.create({
    data: {
      workspaceId: workspace.id,
      provider: 'META',
      label: 'Principal',
      phoneNumber: `551130${suffix()}`,
      createdById: user.id,
    },
  })
  return { workspace, user, connection }
}

type ConversationOverrides = Omit<
  Prisma.WhatsAppConversationUncheckedCreateInput,
  'workspaceId' | 'connectionId' | 'contactId'
>

/** A conversation with a contact of its own, created at `T1` by default. */
async function seedConversation(
  workspaceId: string,
  connectionId: string,
  overrides: ConversationOverrides = {},
) {
  const contact = await prisma.whatsAppContact.create({
    data: { workspaceId, waId: `55119${suffix()}7777` },
  })
  return prisma.whatsAppConversation.create({
    data: {
      workspaceId,
      connectionId,
      contactId: contact.id,
      createdAt: T1,
      ...overrides,
    },
  })
}

function seedServiceDeskConnection(workspaceId: string, userId: string) {
  return prisma.whatsAppConnection.create({
    data: {
      workspaceId,
      provider: 'ZAPI',
      module: 'SERVICE_DESK',
      label: 'Chamados',
      phoneNumber: `551140${suffix()}`,
      createdById: userId,
    },
  })
}

describe('WhatsAppDashboardAttendanceRepository.attendances()', () => {
  it('should answer an empty list for a workspace without conversations', async () => {
    const { workspace } = await setup()

    expect(
      expectOk(
        await WhatsAppDashboardAttendanceRepository.attendances(
          workspace.id,
          SINCE,
          10,
        ),
      ),
    ).toEqual([])
  })

  it('should read the conversations of the window and the open ones', async () => {
    const { workspace, user, connection } = await setup()
    const other = await setup()
    const sdConnection = await seedServiceDeskConnection(workspace.id, user.id)
    const team = await prisma.whatsAppTeam.create({
      data: { workspaceId: workspace.id, name: 'Retenção' },
    })
    const campaign = await prisma.whatsAppAiCampaign.create({
      data: { workspaceId: workspace.id, name: 'Santander' },
    })

    const recent = await seedConversation(workspace.id, connection.id, {
      status: 'CLOSED',
      assignedUserId: user.id,
      teamId: team.id,
      aiCampaignId: campaign.id,
      aiHandoff: true,
      unreadCount: 2,
      avgSentimentScore: 0.5,
      lastMessageAt: T3,
      lastInboundAt: T2,
      firstInboundAt: T1,
      firstResponseAt: T2,
      closedAt: T3,
      closeReason: 'Venda',
      closeOutcome: 'SUCCESS',
      closeStatusLabels: ['Venda realizada'],
    })
    // Old and closed, but with a message inside the window.
    const reactivated = await seedConversation(workspace.id, connection.id, {
      status: 'CLOSED',
      createdAt: OLD,
      lastMessageAt: T2,
    })
    // Old and without activity, but still open.
    const stillOpen = await seedConversation(workspace.id, connection.id, {
      status: 'NEW',
      createdAt: OLD,
      lastMessageAt: OLD,
    })
    // Created inside the window, never had a message.
    const silent = await seedConversation(workspace.id, connection.id, {
      status: 'CLOSED',
      createdAt: T2,
    })
    // Out: old and closed, deleted, ServiceDesk number, another workspace.
    await seedConversation(workspace.id, connection.id, {
      status: 'CLOSED',
      createdAt: OLD,
      lastMessageAt: OLD,
    })
    await seedConversation(workspace.id, connection.id, {
      lastMessageAt: T3,
      deletedAt: T3,
    })
    await seedConversation(workspace.id, sdConnection.id, {
      lastMessageAt: T3,
    })
    await seedConversation(other.workspace.id, other.connection.id, {
      lastMessageAt: T3,
    })

    const rows = expectOk(
      await WhatsAppDashboardAttendanceRepository.attendances(
        workspace.id,
        SINCE,
        10,
      ),
    )

    // Most recent activity first; the ones without a message go last.
    expect(rows.map((row) => row.id)).toEqual([
      recent.id,
      reactivated.id,
      stillOpen.id,
      silent.id,
    ])
    expect(rows[0]).toEqual({
      id: recent.id,
      status: 'CLOSED',
      assignedUserId: user.id,
      aiActive: false,
      aiHandoff: true,
      unreadCount: 2,
      avgSentimentScore: 0.5,
      lastMessageAt: T3,
      lastInboundAt: T2,
      archivedAt: null,
      closedAt: T3,
      closeReason: 'Venda',
      closeOutcome: 'SUCCESS',
      closeStatusLabels: ['Venda realizada'],
      firstInboundAt: T1,
      firstResponseAt: T2,
      createdAt: T1,
      assignedUser: { name: 'Ana' },
      team: { name: 'Retenção' },
      aiCampaign: { name: 'Santander' },
      connection: { label: 'Principal', provider: 'META' },
    })
    expect(rows[3]).toMatchObject({
      assignedUser: null,
      team: null,
      aiCampaign: null,
      lastMessageAt: null,
    })
  })

  it('should respect the row limit', async () => {
    const { workspace, connection } = await setup()
    await seedConversation(workspace.id, connection.id, { lastMessageAt: T1 })
    const newest = await seedConversation(workspace.id, connection.id, {
      lastMessageAt: T3,
    })

    const rows = expectOk(
      await WhatsAppDashboardAttendanceRepository.attendances(
        workspace.id,
        SINCE,
        1,
      ),
    )

    expect(rows.map((row) => row.id)).toEqual([newest.id])
  })

  it('should map Prisma failures to DATABASE_ERROR', async () => {
    vi.spyOn(prisma.whatsAppConversation, 'findMany').mockRejectedValueOnce(
      new Error('boom'),
    )

    expectErr(
      await WhatsAppDashboardAttendanceRepository.attendances('ws1', SINCE, 10),
      'DATABASE_ERROR',
    )
  })
})

describe('WhatsAppDashboardAttendanceRepository.conversationEvents()', () => {
  it('should read the events of the window with the conversation context', async () => {
    const { workspace, user, connection } = await setup()
    const other = await setup()
    const sdConnection = await seedServiceDeskConnection(workspace.id, user.id)
    const team = await prisma.whatsAppTeam.create({
      data: { workspaceId: workspace.id, name: 'Retenção' },
    })
    const campaign = await prisma.whatsAppAiCampaign.create({
      data: { workspaceId: workspace.id, name: 'Santander' },
    })
    const conversation = await seedConversation(workspace.id, connection.id, {
      assignedUserId: user.id,
      teamId: team.id,
      aiCampaignId: campaign.id,
    })
    const bare = await seedConversation(workspace.id, connection.id)
    const deleted = await seedConversation(workspace.id, connection.id, {
      deletedAt: T3,
    })
    const sdConversation = await seedConversation(workspace.id, sdConnection.id)
    const foreign = await seedConversation(
      other.workspace.id,
      other.connection.id,
    )

    const closed = await prisma.whatsAppConversationEvent.create({
      data: {
        workspaceId: workspace.id,
        conversationId: conversation.id,
        kind: 'CLOSED',
        source: 'AGENT',
        actorUserId: user.id,
        reason: 'Venda',
        closeOutcome: 'SUCCESS',
        closeStatusLabels: ['Venda realizada'],
        createdAt: T3,
      },
    })
    const reopened = await prisma.whatsAppConversationEvent.create({
      data: {
        workspaceId: workspace.id,
        conversationId: bare.id,
        kind: 'REOPENED',
        source: 'CONTACT',
        createdAt: T2,
      },
    })
    await prisma.whatsAppConversationEvent.createMany({
      data: [
        // Out: before the window, deleted conversation, ServiceDesk
        // number, another workspace.
        {
          workspaceId: workspace.id,
          conversationId: conversation.id,
          kind: 'ASSIGNED',
          source: 'DISTRIBUTION',
          createdAt: OLD,
        },
        {
          workspaceId: workspace.id,
          conversationId: deleted.id,
          kind: 'CLOSED',
          source: 'INACTIVITY',
          createdAt: T3,
        },
        {
          workspaceId: workspace.id,
          conversationId: sdConversation.id,
          kind: 'CLOSED',
          source: 'AGENT',
          createdAt: T3,
        },
        {
          workspaceId: other.workspace.id,
          conversationId: foreign.id,
          kind: 'CLOSED',
          source: 'AGENT',
          createdAt: T3,
        },
      ],
    })

    const rows = expectOk(
      await WhatsAppDashboardAttendanceRepository.conversationEvents(
        workspace.id,
        SINCE,
        10,
      ),
    )

    expect(rows).toEqual([
      {
        id: closed.id,
        kind: 'CLOSED',
        source: 'AGENT',
        reason: 'Venda',
        closeOutcome: 'SUCCESS',
        closeStatusLabels: ['Venda realizada'],
        createdAt: T3,
        actorUser: { name: 'Ana' },
        conversation: {
          assignedUser: { name: 'Ana' },
          team: { name: 'Retenção' },
          aiCampaign: { name: 'Santander' },
          connection: { label: 'Principal' },
        },
      },
      {
        id: reopened.id,
        kind: 'REOPENED',
        source: 'CONTACT',
        reason: null,
        closeOutcome: null,
        closeStatusLabels: [],
        createdAt: T2,
        actorUser: null,
        conversation: {
          assignedUser: null,
          team: null,
          aiCampaign: null,
          connection: { label: 'Principal' },
        },
      },
    ])

    const limited = expectOk(
      await WhatsAppDashboardAttendanceRepository.conversationEvents(
        workspace.id,
        SINCE,
        1,
      ),
    )
    expect(limited.map((row) => row.id)).toEqual([closed.id])
  })

  it('should map Prisma failures to DATABASE_ERROR', async () => {
    vi.spyOn(
      prisma.whatsAppConversationEvent,
      'findMany',
    ).mockRejectedValueOnce(new Error('boom'))

    expectErr(
      await WhatsAppDashboardAttendanceRepository.conversationEvents(
        'ws1',
        SINCE,
        10,
      ),
      'DATABASE_ERROR',
    )
  })
})

describe('WhatsAppDashboardAttendanceRepository.slaCycleData()', () => {
  function cycleData(
    workspaceId: string,
    conversationId: string,
    overrides: Partial<Prisma.WhatsAppSlaCycleUncheckedCreateInput> = {},
  ): Prisma.WhatsAppSlaCycleUncheckedCreateInput {
    return {
      workspaceId,
      conversationId,
      firstResponseMinutes: 15,
      startedAt: T1,
      firstResponseDueAt: T2,
      firstResponseWarnAt: T1,
      createdAt: T1,
      ...overrides,
    }
  }

  it('should answer empty lists for a workspace without cycles', async () => {
    const { workspace } = await setup()

    expect(
      expectOk(
        await WhatsAppDashboardAttendanceRepository.slaCycleData(
          workspace.id,
          SINCE,
          10,
        ),
      ),
    ).toEqual({ cycles: [], policies: [], teams: [], agents: [] })
  })

  it('should read the cycles with the policies, teams and agents', async () => {
    const { workspace, user, connection } = await setup()
    const other = await setup()
    const sdConnection = await seedServiceDeskConnection(workspace.id, user.id)
    const team = await prisma.whatsAppTeam.create({
      data: { workspaceId: workspace.id, name: 'Retenção' },
    })
    const campaign = await prisma.whatsAppAiCampaign.create({
      data: { workspaceId: workspace.id, name: 'Santander' },
    })
    const defaultPolicy = await prisma.whatsAppSlaPolicy.create({
      data: { workspaceId: workspace.id },
    })
    const teamPolicy = await prisma.whatsAppSlaPolicy.create({
      data: { workspaceId: workspace.id, teamId: team.id },
    })
    await prisma.whatsAppSlaPolicy.create({
      data: { workspaceId: other.workspace.id },
    })
    await prisma.whatsAppTeam.create({
      data: { workspaceId: other.workspace.id, name: 'Outra' },
    })

    const conversation = await seedConversation(workspace.id, connection.id, {
      aiCampaignId: campaign.id,
    })
    const second = await seedConversation(workspace.id, connection.id)
    const sdConversation = await seedConversation(workspace.id, sdConnection.id)
    const foreign = await seedConversation(
      other.workspace.id,
      other.connection.id,
    )

    const resolved = await prisma.whatsAppSlaCycle.create({
      data: cycleData(workspace.id, conversation.id, {
        policyId: teamPolicy.id,
        teamId: team.id,
        agentUserId: user.id,
        businessHoursOnly: true,
        resolutionMinutes: 60,
        startedAt: T2,
        firstResponseDueAt: T3,
        firstResponseWarnAt: T2,
        resolutionDueAt: T3,
        resolutionWarnAt: T2,
        firstResponseAt: T2,
        firstResponseSeconds: 120,
        resolvedAt: T3,
      }),
    })
    // Started before the window, but still open.
    const stillOpen = await prisma.whatsAppSlaCycle.create({
      data: cycleData(workspace.id, second.id, {
        policyId: defaultPolicy.id,
        startedAt: OLD,
        firstResponseDueAt: OLD,
        firstResponseWarnAt: OLD,
      }),
    })
    await prisma.whatsAppSlaCycle.createMany({
      data: [
        // Out: resolved before the window, ServiceDesk number, another
        // workspace.
        cycleData(workspace.id, conversation.id, {
          startedAt: OLD,
          firstResponseDueAt: OLD,
          firstResponseWarnAt: OLD,
          resolvedAt: OLD,
        }),
        cycleData(workspace.id, sdConversation.id),
        cycleData(other.workspace.id, foreign.id),
      ],
    })

    const data = expectOk(
      await WhatsAppDashboardAttendanceRepository.slaCycleData(
        workspace.id,
        SINCE,
        10,
      ),
    )

    expect(data.cycles).toEqual([
      {
        id: resolved.id,
        policyId: teamPolicy.id,
        teamId: team.id,
        agentUserId: user.id,
        businessHoursOnly: true,
        firstResponseMinutes: 15,
        resolutionMinutes: 60,
        startedAt: T2,
        firstResponseDueAt: T3,
        firstResponseWarnAt: T2,
        resolutionDueAt: T3,
        resolutionWarnAt: T2,
        firstResponseAt: T2,
        firstResponseSeconds: 120,
        resolvedAt: T3,
        createdAt: T1,
        conversation: {
          aiCampaign: { name: 'Santander' },
          connection: { label: 'Principal' },
        },
      },
      expect.objectContaining({
        id: stillOpen.id,
        policyId: defaultPolicy.id,
        teamId: null,
        agentUserId: null,
        resolutionDueAt: null,
        resolvedAt: null,
        conversation: {
          aiCampaign: null,
          connection: { label: 'Principal' },
        },
      }),
    ])
    expect(data.policies).toHaveLength(2)
    expect(data.policies).toEqual(
      expect.arrayContaining([
        { id: defaultPolicy.id, teamId: null },
        { id: teamPolicy.id, teamId: team.id },
      ]),
    )
    expect(data.teams).toEqual([{ id: team.id, name: 'Retenção' }])
    expect(data.agents).toEqual([{ id: user.id, name: 'Ana' }])

    const limited = expectOk(
      await WhatsAppDashboardAttendanceRepository.slaCycleData(
        workspace.id,
        SINCE,
        1,
      ),
    )
    expect(limited.cycles.map((cycle) => cycle.id)).toEqual([resolved.id])
  })

  it('should map Prisma failures to DATABASE_ERROR', async () => {
    vi.spyOn(prisma.whatsAppSlaCycle, 'findMany').mockRejectedValueOnce(
      new Error('boom'),
    )

    expectErr(
      await WhatsAppDashboardAttendanceRepository.slaCycleData(
        'ws1',
        SINCE,
        10,
      ),
      'DATABASE_ERROR',
    )
  })
})

describe('WhatsAppDashboardAttendanceRepository.teamMemberData()', () => {
  it('should answer empty lists for a workspace without teams', async () => {
    const { workspace } = await setup()

    expect(
      expectOk(
        await WhatsAppDashboardAttendanceRepository.teamMemberData(
          workspace.id,
          10,
        ),
      ),
    ).toEqual({ members: [], presences: [], openCounts: [] })
  })

  it('should read the members with presence and open conversations', async () => {
    const { workspace, user, connection } = await setup()
    const other = await setup()
    const bia = await seedUser({ name: 'Bia' })
    const sdConnection = await seedServiceDeskConnection(workspace.id, user.id)
    const [sales, retention, foreignTeam] = await Promise.all([
      prisma.whatsAppTeam.create({
        data: { workspaceId: workspace.id, name: 'Vendas' },
      }),
      prisma.whatsAppTeam.create({
        data: { workspaceId: workspace.id, name: 'Retenção' },
      }),
      prisma.whatsAppTeam.create({
        data: { workspaceId: other.workspace.id, name: 'Outra' },
      }),
    ])
    const anaInSales = await prisma.whatsAppTeamMember.create({
      data: {
        teamId: sales.id,
        userId: user.id,
        role: 'LEADER',
        createdAt: T1,
      },
    })
    const biaInRetention = await prisma.whatsAppTeamMember.create({
      data: { teamId: retention.id, userId: bia.id, createdAt: T2 },
    })
    const anaInRetention = await prisma.whatsAppTeamMember.create({
      data: { teamId: retention.id, userId: user.id, createdAt: T1 },
    })
    await prisma.whatsAppTeamMember.create({
      data: { teamId: foreignTeam.id, userId: other.user.id },
    })
    await prisma.whatsAppAgentPresence.createMany({
      data: [
        {
          workspaceId: workspace.id,
          userId: user.id,
          status: 'AWAY',
          lastAssignedAt: T2,
        },
        // Presence of the same person in another workspace stays out.
        { workspaceId: other.workspace.id, userId: user.id },
      ],
    })

    const assigned = { assignedUserId: user.id, teamId: sales.id }
    await seedConversation(workspace.id, connection.id, assigned)
    await seedConversation(workspace.id, connection.id, {
      ...assigned,
      status: 'IN_PROGRESS',
    })
    await seedConversation(workspace.id, connection.id, {
      assignedUserId: bia.id,
      teamId: retention.id,
    })
    // Out: closed, deleted, ServiceDesk number, without a team, without
    // an assignee.
    await seedConversation(workspace.id, connection.id, {
      ...assigned,
      status: 'CLOSED',
    })
    await seedConversation(workspace.id, connection.id, {
      ...assigned,
      deletedAt: T3,
    })
    await seedConversation(workspace.id, sdConnection.id, assigned)
    await seedConversation(workspace.id, connection.id, {
      assignedUserId: user.id,
    })
    await seedConversation(workspace.id, connection.id, { teamId: sales.id })

    const data = expectOk(
      await WhatsAppDashboardAttendanceRepository.teamMemberData(
        workspace.id,
        10,
      ),
    )

    // By team name, then by who joined first.
    expect(data.members).toEqual([
      {
        id: anaInRetention.id,
        teamId: retention.id,
        userId: user.id,
        role: 'AGENT',
        createdAt: T1,
        team: { name: 'Retenção' },
        user: { name: 'Ana' },
      },
      {
        id: biaInRetention.id,
        teamId: retention.id,
        userId: bia.id,
        role: 'AGENT',
        createdAt: T2,
        team: { name: 'Retenção' },
        user: { name: 'Bia' },
      },
      {
        id: anaInSales.id,
        teamId: sales.id,
        userId: user.id,
        role: 'LEADER',
        createdAt: T1,
        team: { name: 'Vendas' },
        user: { name: 'Ana' },
      },
    ])
    expect(data.presences).toEqual([
      {
        userId: user.id,
        status: 'AWAY',
        lastAssignedAt: T2,
        updatedAt: expect.any(Date),
      },
    ])
    expect(data.openCounts).toHaveLength(2)
    expect(data.openCounts).toEqual(
      expect.arrayContaining([
        { teamId: sales.id, userId: user.id, count: 2 },
        { teamId: retention.id, userId: bia.id, count: 1 },
      ]),
    )

    const limited = expectOk(
      await WhatsAppDashboardAttendanceRepository.teamMemberData(
        workspace.id,
        1,
      ),
    )
    expect(limited.members.map((member) => member.id)).toEqual([
      anaInRetention.id,
    ])
  })

  it('should map Prisma failures to DATABASE_ERROR', async () => {
    vi.spyOn(prisma.whatsAppTeamMember, 'findMany').mockRejectedValueOnce(
      new Error('boom'),
    )

    expectErr(
      await WhatsAppDashboardAttendanceRepository.teamMemberData('ws1', 10),
      'DATABASE_ERROR',
    )
  })
})
