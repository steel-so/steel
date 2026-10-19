import { describe, expect, it, vi } from 'vitest'
import { seedSdTicket } from '@/src/__tests__/factories/sd-kb.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { phoneMatchKey } from '@/src/lib/pabx/recording'
import { prisma } from '@/src/lib/prisma'
import { PhoneCallLinkRepository } from '../phone-call-link.repository'

let counter = 0

async function seedConversation(workspaceId: string, userId: string) {
  counter += 1
  const connection = await prisma.whatsAppConnection.create({
    data: {
      workspaceId,
      provider: 'ZAPI',
      label: 'Suporte',
      phoneNumber: `55119999900${String(counter).padStart(2, '0')}`,
      zapiInstanceId: `link-instance-${counter}`,
      encryptedZapiToken: 'enc:token',
      createdById: userId,
    },
  })
  const contact = await prisma.whatsAppContact.create({
    data: { workspaceId, waId: `55119888877${counter}`.slice(0, 13) },
  })
  return prisma.whatsAppConversation.create({
    data: { workspaceId, connectionId: connection.id, contactId: contact.id },
  })
}

async function seedPipeline(workspaceId: string, userId: string) {
  const pipeline = await prisma.crmPipeline.create({
    data: { workspaceId, name: 'Vendas', createdById: userId },
  })
  const [open, won] = await Promise.all([
    prisma.crmPipelineStage.create({
      data: { pipelineId: pipeline.id, name: 'Proposta', category: 'OPEN' },
    }),
    prisma.crmPipelineStage.create({
      data: { pipelineId: pipeline.id, name: 'Ganho', category: 'WON' },
    }),
  ])
  return { pipeline, open, won }
}

describe('PhoneCallLinkRepository', () => {
  it('finds the ticket of the conversation, open ones first', async () => {
    const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
    const conversation = await seedConversation(workspace.id, user.id)
    const other = await seedConversation(workspace.id, user.id)

    expect(
      expectOk(
        await PhoneCallLinkRepository.findTicketForConversation(
          workspace.id,
          conversation.id,
        ),
      ),
    ).toBeNull()

    const closed = await seedSdTicket(workspace.id, { number: 1 })
    await prisma.sdTicket.update({
      where: { id: closed.id },
      data: { whatsappConversationId: conversation.id, closedAt: new Date() },
    })
    const open = await seedSdTicket(workspace.id, { number: 2 })
    await prisma.sdTicket.update({
      where: { id: open.id },
      data: { whatsappConversationId: conversation.id },
    })
    const deleted = await seedSdTicket(workspace.id, {
      number: 3,
      deletedAt: new Date(),
    })
    await prisma.sdTicket.update({
      where: { id: deleted.id },
      data: { whatsappConversationId: conversation.id },
    })
    const elsewhere = await seedSdTicket(workspace.id, { number: 4 })
    await prisma.sdTicket.update({
      where: { id: elsewhere.id },
      data: { whatsappConversationId: other.id },
    })

    expect(
      expectOk(
        await PhoneCallLinkRepository.findTicketForConversation(
          workspace.id,
          conversation.id,
        ),
      ),
    ).toBe(open.id)

    await prisma.sdTicket.update({
      where: { id: open.id },
      data: { deletedAt: new Date() },
    })
    expect(
      expectOk(
        await PhoneCallLinkRepository.findTicketForConversation(
          workspace.id,
          conversation.id,
        ),
      ),
    ).toBe(closed.id)
  })

  it('matches a person by phone in any format, with or without the ninth digit', async () => {
    const [workspace, other, user] = await Promise.all([
      seedWorkspace(),
      seedWorkspace(),
      seedUser(),
    ])
    const person = await prisma.crmPerson.create({
      data: {
        workspaceId: workspace.id,
        name: 'Maria',
        phones: ['+55 (11) 9 9999-8888'],
        createdById: user.id,
      },
    })
    await prisma.crmPerson.create({
      data: {
        workspaceId: workspace.id,
        name: 'Removida',
        phones: ['11999998888'],
        createdById: user.id,
        deletedAt: new Date(),
      },
    })
    await prisma.crmPerson.create({
      data: {
        workspaceId: other.id,
        name: 'Outro workspace',
        phones: ['11999998888'],
        createdById: user.id,
      },
    })

    for (const dialed of ['11999998888', '1199998888', '5511999998888']) {
      const key = phoneMatchKey(dialed) as string
      expect(
        expectOk(
          await PhoneCallLinkRepository.findPersonByPhoneKey(workspace.id, key),
        ),
      ).toBe(person.id)
    }
    expect(
      expectOk(
        await PhoneCallLinkRepository.findPersonByPhoneKey(
          workspace.id,
          '2133334444',
        ),
      ),
    ).toBeNull()
  })

  it('finds the open opportunity where the person is the contact', async () => {
    const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
    const { pipeline, open, won } = await seedPipeline(workspace.id, user.id)
    const person = await prisma.crmPerson.create({
      data: { workspaceId: workspace.id, name: 'Maria', createdById: user.id },
    })
    const base = {
      workspaceId: workspace.id,
      createdById: user.id,
      pipelineId: pipeline.id,
      pointOfContactId: person.id,
    }

    expect(
      expectOk(
        await PhoneCallLinkRepository.findOpenOpportunityForPerson(
          workspace.id,
          person.id,
        ),
      ),
    ).toBeNull()

    await prisma.crmOpportunity.create({
      data: { ...base, name: 'Ganha', stageId: won.id },
    })
    await prisma.crmOpportunity.create({
      data: { ...base, name: 'Apagada', stageId: open.id, deletedAt: new Date() },
    })
    const target = await prisma.crmOpportunity.create({
      data: { ...base, name: 'Aberta', stageId: open.id },
    })

    expect(
      expectOk(
        await PhoneCallLinkRepository.findOpenOpportunityForPerson(
          workspace.id,
          person.id,
        ),
      ),
    ).toBe(target.id)
  })

  it('returns DATABASE_ERROR when a query fails', async () => {
    vi.spyOn(prisma.sdTicket, 'findFirst').mockRejectedValueOnce(new Error('x'))
    expectErr(
      await PhoneCallLinkRepository.findTicketForConversation('w', 'c'),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error('x'))
    expectErr(
      await PhoneCallLinkRepository.findPersonByPhoneKey('w', '1199998888'),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.crmOpportunity, 'findFirst').mockRejectedValueOnce(
      new Error('x'),
    )
    expectErr(
      await PhoneCallLinkRepository.findOpenOpportunityForPerson('w', 'p'),
      'DATABASE_ERROR',
    )
  })
})
