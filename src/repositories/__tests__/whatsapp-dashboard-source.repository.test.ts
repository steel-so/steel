import { describe, expect, it, vi } from 'vitest'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { WhatsAppDashboardSourceRepository } from '../whatsapp-dashboard-source.repository'

const SINCE = new Date('2026-11-01T00:00:00.000Z')
const OLD = new Date('2025-01-01T00:00:00.000Z')
const SENT_AT = new Date('2026-11-17T12:00:00.000Z')
const AFTER = new Date('2026-11-17T12:30:00.000Z')

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
  const campaign = await prisma.whatsAppAiCampaign.create({
    data: { workspaceId: workspace.id, name: 'Santander', status: 'DONE' },
  })
  return { workspace, user, connection, campaign }
}

function seedContact(workspaceId: string, waId: string) {
  return prisma.whatsAppContact.create({ data: { workspaceId, waId } })
}

describe('WhatsAppDashboardSourceRepository.aiCampaignRecipientData()', () => {
  it('should answer empty lists for a workspace without recipients', async () => {
    const { workspace } = await setup()

    expect(
      expectOk(
        await WhatsAppDashboardSourceRepository.aiCampaignRecipientData(
          workspace.id,
          SINCE,
          10,
        ),
      ),
    ).toEqual({
      recipients: [],
      conversations: [],
      buttonReplies: [],
      humanReplies: [],
      deliveries: [],
    })
  })

  it('should read the recipients with the answers of the workspace', async () => {
    const { workspace, user, connection, campaign } = await setup()
    const contact = await seedContact(workspace.id, `55119${suffix()}7777`)
    const twin = await seedContact(workspace.id, `5511${suffix()}7777`)
    const silent = await seedContact(workspace.id, `55119${suffix()}6666`)
    const own = await prisma.whatsAppConversation.create({
      data: {
        workspaceId: workspace.id,
        connectionId: connection.id,
        contactId: contact.id,
        aiCampaignId: campaign.id,
      },
    })
    const answered = await prisma.whatsAppConversation.create({
      data: {
        workspaceId: workspace.id,
        connectionId: connection.id,
        contactId: twin.id,
        status: 'IN_PROGRESS',
        assignedUserId: user.id,
        lastInboundAt: AFTER,
      },
    })
    await prisma.whatsAppConversation.create({
      data: {
        workspaceId: workspace.id,
        connectionId: connection.id,
        contactId: silent.id,
        lastInboundAt: AFTER,
        deletedAt: AFTER,
      },
    })
    await prisma.whatsAppMessage.createMany({
      data: [
        {
          workspaceId: workspace.id,
          conversationId: own.id,
          direction: 'OUT',
          type: 'TEMPLATE',
          status: 'READ',
          sentByAi: true,
          providerMessageId: 'wamid.sent',
          createdAt: SENT_AT,
        },
        {
          workspaceId: workspace.id,
          conversationId: answered.id,
          direction: 'IN',
          type: 'BUTTON',
          text: 'SIM',
          createdAt: AFTER,
        },
        {
          workspaceId: workspace.id,
          conversationId: answered.id,
          direction: 'IN',
          type: 'BUTTON',
          text: 'NAO',
          createdAt: OLD,
        },
        {
          workspaceId: workspace.id,
          conversationId: answered.id,
          direction: 'OUT',
          type: 'TEXT',
          senderUserId: user.id,
          createdAt: AFTER,
        },
        {
          workspaceId: workspace.id,
          conversationId: answered.id,
          direction: 'OUT',
          type: 'TEXT',
          sentByAi: true,
          createdAt: AFTER,
        },
      ],
    })
    await prisma.whatsAppAiCampaignRecipient.createMany({
      data: [
        {
          campaignId: campaign.id,
          contactId: contact.id,
          status: 'SENT',
          conversationId: own.id,
          providerMessageId: 'wamid.sent',
          sentAt: SENT_AT,
          createdAt: SENT_AT,
        },
        {
          campaignId: campaign.id,
          contactId: silent.id,
          status: 'PENDING',
          createdAt: AFTER,
        },
        {
          campaignId: campaign.id,
          contactId: twin.id,
          status: 'FAILED',
          createdAt: OLD,
        },
      ],
    })

    const data = expectOk(
      await WhatsAppDashboardSourceRepository.aiCampaignRecipientData(
        workspace.id,
        SINCE,
        10,
      ),
    )

    expect(data.recipients.map((r) => r.status)).toEqual(['PENDING', 'SENT'])
    expect(data.recipients[1]).toMatchObject({
      conversationId: own.id,
      campaign: { name: 'Santander', status: 'DONE' },
      contact: { waId: contact.waId },
    })
    expect(data.conversations).toHaveLength(1)
    expect(data.conversations[0]).toMatchObject({
      id: answered.id,
      status: 'IN_PROGRESS',
      assignedUser: { name: user.name },
      team: null,
      contact: { waId: twin.waId },
    })
    expect(data.buttonReplies).toEqual([
      { conversationId: answered.id, text: 'SIM', createdAt: AFTER },
    ])
    expect(data.humanReplies).toEqual([
      { conversationId: answered.id, lastAt: AFTER },
    ])
    expect(data.deliveries).toEqual([
      { providerMessageId: 'wamid.sent', status: 'READ' },
    ])
  })

  it('should respect the row limit and the workspace', async () => {
    const { workspace, campaign } = await setup()
    const other = await setup()
    for (const createdAt of [SENT_AT, AFTER]) {
      const contact = await seedContact(workspace.id, `55119${suffix()}5555`)
      await prisma.whatsAppAiCampaignRecipient.create({
        data: { campaignId: campaign.id, contactId: contact.id, createdAt },
      })
    }
    const foreign = await seedContact(
      other.workspace.id,
      `55119${suffix()}4444`,
    )
    await prisma.whatsAppAiCampaignRecipient.create({
      data: { campaignId: other.campaign.id, contactId: foreign.id },
    })

    const data = expectOk(
      await WhatsAppDashboardSourceRepository.aiCampaignRecipientData(
        workspace.id,
        SINCE,
        1,
      ),
    )

    expect(data.recipients).toHaveLength(1)
    expect(data.recipients[0].createdAt).toEqual(AFTER)
  })

  it('should map Prisma failures to DATABASE_ERROR', async () => {
    vi.spyOn(
      prisma.whatsAppAiCampaignRecipient,
      'findMany',
    ).mockRejectedValueOnce(new Error('boom'))

    expectErr(
      await WhatsAppDashboardSourceRepository.aiCampaignRecipientData(
        'ws1',
        SINCE,
        10,
      ),
      'DATABASE_ERROR',
    )
  })
})
