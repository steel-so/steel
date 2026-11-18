import { describe, expect, it, vi } from 'vitest'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { WhatsAppDashboardMessagingRepository } from '../whatsapp-dashboard-messaging.repository'

const SINCE = new Date('2026-11-01T00:00:00.000Z')
const OLD = new Date('2025-01-01T00:00:00.000Z')
const EARLY = new Date('2026-11-17T12:00:00.000Z')
const LATE = new Date('2026-11-17T12:30:00.000Z')

let counter = 0
function suffix() {
  counter += 1
  return String(counter).padStart(4, '0')
}

async function setup() {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
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

function seedContact(workspaceId: string) {
  return prisma.whatsAppContact.create({
    data: { workspaceId, waId: `55119${suffix()}7777` },
  })
}

async function seedConversation(
  workspaceId: string,
  connectionId: string,
  extra?: { teamId?: string; aiCampaignId?: string },
) {
  const contact = await seedContact(workspaceId)
  return prisma.whatsAppConversation.create({
    data: { workspaceId, connectionId, contactId: contact.id, ...extra },
  })
}

function seedBroadcastList(
  workspaceId: string,
  connectionId: string,
  createdById: string,
  templateId?: string,
) {
  return prisma.whatsAppBroadcastList.create({
    data: {
      workspaceId,
      connectionId,
      createdById,
      templateId,
      name: 'Black Friday',
      messageBody: 'Oferta',
      status: 'DONE',
    },
  })
}

function seedTemplate(
  workspaceId: string,
  connectionId: string,
  name: string,
  updatedAt: Date,
) {
  return prisma.whatsAppTemplate.create({
    data: {
      workspaceId,
      connectionId,
      name,
      language: 'pt_BR',
      category: 'MARKETING',
      status: 'APPROVED',
      quality: 'GREEN',
      headerFormat: 'IMAGE',
      components: [
        { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Sim' }] },
      ],
      updatedAt,
    },
  })
}

describe('WhatsAppDashboardMessagingRepository.messages()', () => {
  it('should read the messages of the window with their conversation', async () => {
    const { workspace, user, connection } = await setup()
    const other = await setup()
    const team = await prisma.whatsAppTeam.create({
      data: { workspaceId: workspace.id, name: 'Retenção' },
    })
    const campaign = await prisma.whatsAppAiCampaign.create({
      data: { workspaceId: workspace.id, name: 'Santander' },
    })
    const conversation = await seedConversation(workspace.id, connection.id, {
      teamId: team.id,
      aiCampaignId: campaign.id,
    })
    const plain = await seedConversation(workspace.id, connection.id)
    const foreign = await seedConversation(
      other.workspace.id,
      other.connection.id,
    )
    await prisma.whatsAppMessage.createMany({
      data: [
        {
          workspaceId: workspace.id,
          conversationId: conversation.id,
          direction: 'OUT',
          type: 'TEXT',
          status: 'FAILED',
          text: 'Olá, tudo bem?',
          senderUserId: user.id,
          failureReason: '131026: undeliverable',
          createdAt: LATE,
        },
        {
          workspaceId: workspace.id,
          conversationId: plain.id,
          direction: 'IN',
          type: 'AUDIO',
          status: 'DELIVERED',
          sentiment: 'NEGATIVE',
          sentimentScore: -0.5,
          createdAt: EARLY,
        },
        {
          workspaceId: workspace.id,
          conversationId: plain.id,
          direction: 'IN',
          type: 'TEXT',
          createdAt: LATE,
          deletedAt: LATE,
        },
        {
          workspaceId: workspace.id,
          conversationId: plain.id,
          direction: 'IN',
          type: 'TEXT',
          createdAt: OLD,
        },
        {
          workspaceId: other.workspace.id,
          conversationId: foreign.id,
          direction: 'IN',
          type: 'TEXT',
          createdAt: LATE,
        },
      ],
    })

    const messages = expectOk(
      await WhatsAppDashboardMessagingRepository.messages(
        workspace.id,
        SINCE,
        10,
      ),
    )

    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({
      direction: 'OUT',
      type: 'TEXT',
      status: 'FAILED',
      senderUserId: user.id,
      sentByAi: false,
      failureReason: '131026: undeliverable',
      createdAt: LATE,
      senderUser: { name: user.name },
      conversation: {
        connection: { label: 'Principal', provider: 'META' },
        team: { name: 'Retenção' },
        aiCampaign: { name: 'Santander' },
      },
    })
    expect(messages[0]).not.toHaveProperty('text')
    expect(messages[1]).toMatchObject({
      direction: 'IN',
      type: 'AUDIO',
      sentiment: 'NEGATIVE',
      sentimentScore: -0.5,
      senderUser: null,
      conversation: { team: null, aiCampaign: null },
    })
  })

  it('should respect the row limit, newest first', async () => {
    const { workspace, connection } = await setup()
    const conversation = await seedConversation(workspace.id, connection.id)
    await prisma.whatsAppMessage.createMany({
      data: [EARLY, LATE].map((createdAt) => ({
        workspaceId: workspace.id,
        conversationId: conversation.id,
        direction: 'IN' as const,
        type: 'TEXT' as const,
        createdAt,
      })),
    })

    const messages = expectOk(
      await WhatsAppDashboardMessagingRepository.messages(
        workspace.id,
        SINCE,
        1,
      ),
    )

    expect(messages).toHaveLength(1)
    expect(messages[0].createdAt).toEqual(LATE)
  })

  it('should map Prisma failures to DATABASE_ERROR', async () => {
    vi.spyOn(prisma.whatsAppMessage, 'findMany').mockRejectedValueOnce(
      new Error('boom'),
    )

    expectErr(
      await WhatsAppDashboardMessagingRepository.messages('ws1', SINCE, 10),
      'DATABASE_ERROR',
    )
  })
})

describe('WhatsAppDashboardMessagingRepository.broadcastRecipientData()', () => {
  it('should answer empty lists for a workspace without broadcasts', async () => {
    const { workspace } = await setup()

    expect(
      expectOk(
        await WhatsAppDashboardMessagingRepository.broadcastRecipientData(
          workspace.id,
          SINCE,
          10,
        ),
      ),
    ).toEqual({ recipients: [], deliveries: [] })
  })

  it('should read the recipients with the provider status of the sends', async () => {
    const { workspace, user, connection } = await setup()
    const other = await setup()
    const template = await seedTemplate(
      workspace.id,
      connection.id,
      'oferta_black_friday',
      EARLY,
    )
    const list = await seedBroadcastList(
      workspace.id,
      connection.id,
      user.id,
      template.id,
    )
    const foreignList = await seedBroadcastList(
      other.workspace.id,
      other.connection.id,
      other.user.id,
    )
    const conversation = await seedConversation(workspace.id, connection.id)
    const foreignConversation = await seedConversation(
      other.workspace.id,
      other.connection.id,
    )
    await prisma.whatsAppMessage.createMany({
      data: [
        {
          workspaceId: workspace.id,
          conversationId: conversation.id,
          direction: 'OUT',
          type: 'TEMPLATE',
          status: 'READ',
          providerMessageId: 'wamid.broadcast-read',
          createdAt: EARLY,
        },
        {
          workspaceId: other.workspace.id,
          conversationId: foreignConversation.id,
          direction: 'OUT',
          type: 'TEMPLATE',
          status: 'DELIVERED',
          providerMessageId: 'wamid.broadcast-foreign',
          createdAt: EARLY,
        },
      ],
    })
    const [sent, failed, old, foreign] = await Promise.all([
      seedContact(workspace.id),
      seedContact(workspace.id),
      seedContact(workspace.id),
      seedContact(other.workspace.id),
    ])
    await prisma.whatsAppBroadcastRecipient.createMany({
      data: [
        {
          broadcastListId: list.id,
          contactId: sent.id,
          status: 'SENT',
          providerMessageId: 'wamid.broadcast-read',
          sentAt: EARLY,
          scheduledAt: EARLY,
          viaMarketingLite: true,
          createdAt: EARLY,
        },
        {
          broadcastListId: list.id,
          contactId: failed.id,
          status: 'FAILED',
          errorMessage: 'Template não encontrado',
          createdAt: LATE,
        },
        {
          broadcastListId: list.id,
          contactId: old.id,
          status: 'SENT',
          createdAt: OLD,
        },
        {
          broadcastListId: foreignList.id,
          contactId: foreign.id,
          status: 'SENT',
          providerMessageId: 'wamid.broadcast-foreign',
          createdAt: LATE,
        },
      ],
    })

    const data = expectOk(
      await WhatsAppDashboardMessagingRepository.broadcastRecipientData(
        workspace.id,
        SINCE,
        10,
      ),
    )

    expect(data.recipients.map((r) => r.status)).toEqual(['FAILED', 'SENT'])
    expect(data.recipients[0]).toMatchObject({
      errorMessage: 'Template não encontrado',
      providerMessageId: null,
      sentAt: null,
      viaMarketingLite: false,
    })
    expect(data.recipients[1]).toMatchObject({
      providerMessageId: 'wamid.broadcast-read',
      sentAt: EARLY,
      scheduledAt: EARLY,
      viaMarketingLite: true,
      createdAt: EARLY,
      broadcastList: {
        name: 'Black Friday',
        status: 'DONE',
        template: { name: 'oferta_black_friday' },
        connection: { label: 'Principal' },
      },
    })
    expect(data.deliveries).toEqual([
      { providerMessageId: 'wamid.broadcast-read', status: 'READ' },
    ])
  })

  it('should respect the row limit, newest first', async () => {
    const { workspace, user, connection } = await setup()
    const list = await seedBroadcastList(workspace.id, connection.id, user.id)
    for (const createdAt of [EARLY, LATE]) {
      const contact = await seedContact(workspace.id)
      await prisma.whatsAppBroadcastRecipient.create({
        data: { broadcastListId: list.id, contactId: contact.id, createdAt },
      })
    }

    const data = expectOk(
      await WhatsAppDashboardMessagingRepository.broadcastRecipientData(
        workspace.id,
        SINCE,
        1,
      ),
    )

    expect(data.recipients).toHaveLength(1)
    expect(data.recipients[0]).toMatchObject({
      status: 'PENDING',
      createdAt: LATE,
      broadcastList: { template: null },
    })
    expect(data.deliveries).toEqual([])
  })

  it('should map Prisma failures to DATABASE_ERROR', async () => {
    vi.spyOn(
      prisma.whatsAppBroadcastRecipient,
      'findMany',
    ).mockRejectedValueOnce(new Error('boom'))

    expectErr(
      await WhatsAppDashboardMessagingRepository.broadcastRecipientData(
        'ws1',
        SINCE,
        10,
      ),
      'DATABASE_ERROR',
    )
  })
})

describe('WhatsAppDashboardMessagingRepository.templates()', () => {
  it('should read the templates of the workspace, last updated first', async () => {
    const { workspace, connection } = await setup()
    const other = await setup()
    await seedTemplate(workspace.id, connection.id, 'antigo', OLD)
    await seedTemplate(workspace.id, connection.id, 'recente', LATE)
    await seedTemplate(other.workspace.id, other.connection.id, 'alheio', LATE)

    const templates = expectOk(
      await WhatsAppDashboardMessagingRepository.templates(workspace.id, 10),
    )

    expect(templates.map((t) => t.name)).toEqual(['recente', 'antigo'])
    expect(templates[0]).toMatchObject({
      language: 'pt_BR',
      category: 'MARKETING',
      status: 'APPROVED',
      quality: 'GREEN',
      headerFormat: 'IMAGE',
      buttons: null,
      components: [
        { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Sim' }] },
      ],
      updatedAt: LATE,
      connection: { label: 'Principal' },
    })

    const limited = expectOk(
      await WhatsAppDashboardMessagingRepository.templates(workspace.id, 1),
    )
    expect(limited.map((t) => t.name)).toEqual(['recente'])
  })

  it('should map Prisma failures to DATABASE_ERROR', async () => {
    vi.spyOn(prisma.whatsAppTemplate, 'findMany').mockRejectedValueOnce(
      new Error('boom'),
    )

    expectErr(
      await WhatsAppDashboardMessagingRepository.templates('ws1', 10),
      'DATABASE_ERROR',
    )
  })
})

describe('WhatsAppDashboardMessagingRepository.costData()', () => {
  it('should answer empty lists for a workspace without costs', async () => {
    const { workspace } = await setup()

    expect(
      expectOk(
        await WhatsAppDashboardMessagingRepository.costData(
          workspace.id,
          SINCE,
          10,
        ),
      ),
    ).toEqual({ entries: [], broadcasts: [], aiCampaigns: [] })
  })

  it('should read the entries with the names of their origins', async () => {
    const { workspace, user, connection } = await setup()
    const other = await setup()
    const list = await seedBroadcastList(workspace.id, connection.id, user.id)
    const foreignList = await seedBroadcastList(
      other.workspace.id,
      other.connection.id,
      other.user.id,
    )
    const campaign = await prisma.whatsAppAiCampaign.create({
      data: { workspaceId: workspace.id, name: 'Santander' },
    })
    const base = {
      workspaceId: workspace.id,
      connectionId: connection.id,
      provider: 'META' as const,
      category: 'MARKETING' as const,
      kind: 'TEMPLATE' as const,
      unitPrice: '0.3625',
      estimatedCost: '0.3625',
    }
    await prisma.whatsAppCostEntry.createMany({
      data: [
        {
          ...base,
          source: 'BROADCAST',
          broadcastId: list.id,
          quantity: 2,
          estimatedCost: '0.725',
          viaMarketingLite: true,
          occurredAt: LATE,
        },
        {
          ...base,
          source: 'AI_CAMPAIGN',
          aiCampaignId: campaign.id,
          // A list of another workspace is never named here.
          broadcastId: foreignList.id,
          estimatedCost: '0',
          reversedAt: LATE,
          occurredAt: EARLY,
        },
        { ...base, source: 'BROADCAST', broadcastId: list.id, occurredAt: OLD },
        {
          ...base,
          workspaceId: other.workspace.id,
          connectionId: other.connection.id,
          source: 'AGENT',
          occurredAt: LATE,
        },
      ],
    })

    const data = expectOk(
      await WhatsAppDashboardMessagingRepository.costData(
        workspace.id,
        SINCE,
        10,
      ),
    )

    expect(data.entries).toHaveLength(2)
    expect(data.entries[0]).toMatchObject({
      provider: 'META',
      category: 'MARKETING',
      kind: 'TEMPLATE',
      source: 'BROADCAST',
      currency: 'BRL',
      broadcastId: list.id,
      aiCampaignId: null,
      quantity: 2,
      viaMarketingLite: true,
      reversedAt: null,
      occurredAt: LATE,
      connection: { label: 'Principal' },
    })
    expect(Number(data.entries[0].estimatedCost)).toBe(0.725)
    expect(Number(data.entries[0].unitPrice)).toBe(0.3625)
    expect(data.entries[1]).toMatchObject({
      source: 'AI_CAMPAIGN',
      aiCampaignId: campaign.id,
      reversedAt: LATE,
    })
    expect(Number(data.entries[1].estimatedCost)).toBe(0)
    expect(data.broadcasts).toEqual([{ id: list.id, name: 'Black Friday' }])
    expect(data.aiCampaigns).toEqual([{ id: campaign.id, name: 'Santander' }])
  })

  it('should respect the row limit, newest first', async () => {
    const { workspace, connection } = await setup()
    await prisma.whatsAppCostEntry.createMany({
      data: [EARLY, LATE].map((occurredAt) => ({
        workspaceId: workspace.id,
        connectionId: connection.id,
        provider: 'META' as const,
        category: 'SERVICE' as const,
        kind: 'SERVICE' as const,
        source: 'AGENT' as const,
        unitPrice: '0',
        estimatedCost: '0',
        occurredAt,
      })),
    })

    const data = expectOk(
      await WhatsAppDashboardMessagingRepository.costData(
        workspace.id,
        SINCE,
        1,
      ),
    )

    expect(data.entries).toHaveLength(1)
    expect(data.entries[0].occurredAt).toEqual(LATE)
  })

  it('should map Prisma failures to DATABASE_ERROR', async () => {
    vi.spyOn(prisma.whatsAppCostEntry, 'findMany').mockRejectedValueOnce(
      new Error('boom'),
    )

    expectErr(
      await WhatsAppDashboardMessagingRepository.costData('ws1', SINCE, 10),
      'DATABASE_ERROR',
    )
  })
})

describe('WhatsAppDashboardMessagingRepository.aiCampaignActionRuns()', () => {
  it('should read the action runs of the window with their campaign', async () => {
    const { workspace } = await setup()
    const other = await setup()
    const campaign = await prisma.whatsAppAiCampaign.create({
      data: { workspaceId: workspace.id, name: 'Santander' },
    })
    const foreignCampaign = await prisma.whatsAppAiCampaign.create({
      data: { workspaceId: other.workspace.id, name: 'Inter' },
    })
    const base = {
      workspaceId: workspace.id,
      campaignId: campaign.id,
      actionId: 'a1',
      kind: 'TRANSFER_TEAM',
      label: 'Passar para a Retenção',
    }
    await prisma.whatsAppAiCampaignActionRun.createMany({
      data: [
        { ...base, status: 'SUCCESS', reason: 'Pediu', createdAt: EARLY },
        {
          ...base,
          kind: 'WEBHOOK',
          label: 'Avisar o ERP',
          status: 'FAILED',
          error: 'HTTP 500',
          createdAt: LATE,
        },
        { ...base, status: 'SUCCESS', createdAt: OLD },
        {
          ...base,
          workspaceId: other.workspace.id,
          campaignId: foreignCampaign.id,
          status: 'SUCCESS',
          createdAt: LATE,
        },
      ],
    })

    const runs = expectOk(
      await WhatsAppDashboardMessagingRepository.aiCampaignActionRuns(
        workspace.id,
        SINCE,
        10,
      ),
    )

    expect(runs).toHaveLength(2)
    expect(runs[0]).toMatchObject({
      kind: 'WEBHOOK',
      label: 'Avisar o ERP',
      status: 'FAILED',
      error: 'HTTP 500',
      createdAt: LATE,
      campaign: { name: 'Santander' },
    })
    expect(runs[1]).toMatchObject({
      kind: 'TRANSFER_TEAM',
      status: 'SUCCESS',
      error: null,
    })
    expect(runs[1]).not.toHaveProperty('reason')

    const limited = expectOk(
      await WhatsAppDashboardMessagingRepository.aiCampaignActionRuns(
        workspace.id,
        SINCE,
        1,
      ),
    )
    expect(limited).toHaveLength(1)
    expect(limited[0].createdAt).toEqual(LATE)
  })

  it('should map Prisma failures to DATABASE_ERROR', async () => {
    vi.spyOn(
      prisma.whatsAppAiCampaignActionRun,
      'findMany',
    ).mockRejectedValueOnce(new Error('boom'))

    expectErr(
      await WhatsAppDashboardMessagingRepository.aiCampaignActionRuns(
        'ws1',
        SINCE,
        10,
      ),
      'DATABASE_ERROR',
    )
  })
})
