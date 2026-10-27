import { describe, expect, it } from 'vitest'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { WhatsAppAiCampaignRepository } from '../whatsapp-ai-campaign.repository'

let counter = 0
function suffix() {
  counter += 1
  return counter
}

async function seedFixtures() {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  const connection = await prisma.whatsAppConnection.create({
    data: {
      workspaceId: workspace.id,
      provider: 'META',
      label: 'Principal',
      phoneNumber: `55119999${suffix()}`,
      createdById: user.id,
    },
  })
  const template = await prisma.whatsAppTemplate.create({
    data: {
      workspaceId: workspace.id,
      connectionId: connection.id,
      name: `cobranca-${suffix()}`,
      language: 'pt_BR',
      category: 'UTILITY',
      status: 'APPROVED',
      components: [{ type: 'BODY', text: 'Oi {{1}}' }],
    },
  })
  const campaign = expectOk(
    await WhatsAppAiCampaignRepository.create({
      workspaceId: workspace.id,
      name: 'Cobrança',
      connectionId: connection.id,
      templateId: template.id,
    }),
  )
  return { workspace, user, connection, template, campaign }
}

async function seedContact(workspaceId: string, optedOut = false) {
  return prisma.whatsAppContact.create({
    data: {
      workspaceId,
      waId: `551198888${String(suffix()).padStart(4, '0')}`,
      broadcastOptedOutAt: optedOut ? new Date() : null,
    },
  })
}

describe('WhatsAppAiCampaignRepository', () => {
  it('should create with the template and connection summaries and hide archived ones', async () => {
    const { workspace, campaign, template } = await seedFixtures()

    expect(campaign.template?.name).toBe(template.name)
    expect(campaign.connection?.provider).toBe('META')
    expect(campaign.status).toBe('DRAFT')

    await WhatsAppAiCampaignRepository.create({
      workspaceId: workspace.id,
      name: 'Antiga',
      status: 'ARCHIVED',
    })
    const listed = expectOk(
      await WhatsAppAiCampaignRepository.listByWorkspace(workspace.id),
    )
    expect(listed.map((c) => c.name)).toEqual(['Cobrança'])
  })

  it('should queue contacts once, skip opted-out ones and keep import values', async () => {
    const { workspace, campaign } = await seedFixtures()
    const active = await seedContact(workspace.id)
    await seedContact(workspace.id, true)

    const queueable = expectOk(
      await WhatsAppAiCampaignRepository.listQueueableContactIds(
        workspace.id,
        null,
        100,
      ),
    )
    expect(queueable).toEqual([active.id])

    expect(
      expectOk(
        await WhatsAppAiCampaignRepository.addRecipients(campaign.id, [
          { contactId: active.id, values: { valor: 'R$ 10' } },
        ]),
      ),
    ).toBe(1)
    expect(
      expectOk(
        await WhatsAppAiCampaignRepository.addRecipients(campaign.id, [
          { contactId: active.id },
        ]),
      ),
    ).toBe(0)

    const next = expectOk(
      await WhatsAppAiCampaignRepository.findNextPending(campaign.id),
    )
    expect(next?.contact.id).toBe(active.id)
    expect(next?.values).toEqual({ valor: 'R$ 10' })
  })

  it('should create the spreadsheet contacts and return the id of each phone', async () => {
    const { workspace } = await seedFixtures()
    const existing = await seedContact(workspace.id, true)

    const map = expectOk(
      await WhatsAppAiCampaignRepository.ensureContacts(workspace.id, [
        { waId: existing.waId, name: 'Ignorado' },
        { waId: '5511977776666', name: 'Nova' },
      ]),
    )

    expect(map.get(existing.waId)).toEqual({ id: existing.id, optedOut: true })
    const created = map.get('5511977776666')
    expect(created?.optedOut).toBe(false)
    const contact = await prisma.whatsAppContact.findUnique({
      where: { id: created?.id },
    })
    expect(contact?.name).toBe('Nova')
  })

  it('should compute the funnel from the queue, the replies and the closed conversations', async () => {
    const { workspace, connection, campaign } = await seedFixtures()
    const [a, b, c] = await Promise.all([
      seedContact(workspace.id),
      seedContact(workspace.id),
      seedContact(workspace.id),
    ])
    const won = await prisma.whatsAppConversation.create({
      data: {
        workspaceId: workspace.id,
        connectionId: connection.id,
        contactId: a.id,
        aiCampaignId: campaign.id,
        status: 'CLOSED',
        closeOutcome: 'SUCCESS',
      },
    })
    await prisma.whatsAppConversation.create({
      data: {
        workspaceId: workspace.id,
        connectionId: connection.id,
        contactId: b.id,
        aiCampaignId: campaign.id,
        status: 'IN_PROGRESS',
      },
    })
    await WhatsAppAiCampaignRepository.addRecipients(campaign.id, [
      { contactId: a.id },
      { contactId: b.id },
      { contactId: c.id },
    ])
    await prisma.whatsAppAiCampaignRecipient.updateMany({
      where: { campaignId: campaign.id, contactId: a.id },
      data: { status: 'SENT', conversationId: won.id },
    })
    expect(
      expectOk(
        await WhatsAppAiCampaignRepository.markReplied(won.id, new Date()),
      ),
    ).toBe(1)

    const stats = expectOk(
      await WhatsAppAiCampaignRepository.statsFor([campaign.id]),
    ).get(campaign.id)

    expect(stats).toEqual({
      total: 3,
      pending: 2,
      sent: 1,
      failed: 0,
      skipped: 0,
      replied: 1,
      success: 1,
      failure: 0,
      closedWithoutOutcome: 0,
      open: 1,
    })
  })

  it('should stop a run only while its token is current', async () => {
    const { campaign } = await seedFixtures()
    await WhatsAppAiCampaignRepository.update(campaign.id, {
      status: 'RUNNING',
      runToken: 'current',
    })

    expect(
      expectOk(
        await WhatsAppAiCampaignRepository.stopRun(campaign.id, 'stale', {
          status: 'DONE',
        }),
      ),
    ).toBe(false)
    expect(
      expectOk(
        await WhatsAppAiCampaignRepository.stopRun(campaign.id, 'current', {
          status: 'DONE',
          finishedAt: new Date(),
        }),
      ),
    ).toBe(true)
    const stored = expectOk(
      await WhatsAppAiCampaignRepository.findByIdRaw(campaign.id),
    )
    expect(stored?.status).toBe('DONE')
    expect(stored?.runToken).toBeNull()
  })

  it('should page the recipients with their conversation and list action runs', async () => {
    const { workspace, connection, campaign } = await seedFixtures()
    const contacts = await Promise.all(
      [1, 2, 3].map(() => seedContact(workspace.id)),
    )
    const conversation = await prisma.whatsAppConversation.create({
      data: {
        workspaceId: workspace.id,
        connectionId: connection.id,
        contactId: contacts[0].id,
        status: 'CLOSED',
        closeOutcome: 'FAILURE',
      },
    })
    await WhatsAppAiCampaignRepository.addRecipients(
      campaign.id,
      contacts.map((contact) => ({ contactId: contact.id })),
    )
    await prisma.whatsAppAiCampaignRecipient.updateMany({
      where: { campaignId: campaign.id, contactId: contacts[0].id },
      data: { status: 'SENT', conversationId: conversation.id },
    })

    const page = expectOk(
      await WhatsAppAiCampaignRepository.listRecipients(campaign.id, {
        limit: 2,
      }),
    )
    expect(page).toHaveLength(2)
    expect(page[0].contact.createdAt).toBeInstanceOf(Date)
    expect(page[0].conversation).toEqual({
      status: 'CLOSED',
      closeOutcome: 'FAILURE',
    })
    const rest = expectOk(
      await WhatsAppAiCampaignRepository.listRecipients(campaign.id, {
        limit: 2,
        cursor: page[1].id,
      }),
    )
    expect(rest).toHaveLength(1)

    await WhatsAppAiCampaignRepository.createActionRun({
      workspaceId: workspace.id,
      campaignId: campaign.id,
      conversationId: conversation.id,
      contactId: contacts[0].id,
      actionId: 'a1',
      kind: 'CLOSE',
      label: 'Pago',
      reason: 'Confirmou o pagamento',
      status: 'SUCCESS',
    })
    const runs = expectOk(
      await WhatsAppAiCampaignRepository.listActionRuns(campaign.id, 10),
    )
    expect(runs).toHaveLength(1)
    expect(runs[0].contactName).toBe(contacts[0].waId)
  })
})
