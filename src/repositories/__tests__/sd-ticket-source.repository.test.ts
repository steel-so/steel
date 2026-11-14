import { createId } from '@paralleldrive/cuid2'
import type { ModuleKind } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import { seedCrmLead } from '@/src/__tests__/factories/crm-lead.factory'
import { seedCrmOpportunity } from '@/src/__tests__/factories/crm-opportunity.factory'
import { seedCrmPerson } from '@/src/__tests__/factories/crm-person.factory'
import {
  seedCrmPipeline,
  seedCrmPipelineStage,
} from '@/src/__tests__/factories/crm-pipeline.factory'
import { seedSdCustomer } from '@/src/__tests__/factories/sd-customer.factory'
import { seedSdTicket } from '@/src/__tests__/factories/sd-ticket.factory'
import { seedSdPhase } from '@/src/__tests__/factories/sd-ticket-context.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import {
  SdTicketSourceRepository,
  sourceTicketWhere,
} from '../sd-ticket-source.repository'

async function setup(module: ModuleKind = 'COMMUNICATION') {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  const connection = await prisma.whatsAppConnection.create({
    data: {
      workspaceId: workspace.id,
      module,
      provider: 'ZAPI',
      label: 'Linha',
      phoneNumber: '5511966665555',
      zapiInstanceId: `instance-${createId()}`,
      encryptedZapiToken: 'enc:token',
      createdById: user.id,
    },
  })
  const contact = await prisma.whatsAppContact.create({
    data: { workspaceId: workspace.id, waId: '5511988887777', name: 'Ana' },
  })
  const conversation = await prisma.whatsAppConversation.create({
    data: {
      workspaceId: workspace.id,
      connectionId: connection.id,
      contactId: contact.id,
      status: 'IN_PROGRESS',
    },
  })
  const phase = await seedSdPhase(workspace.id)
  return { workspace, user, connection, contact, conversation, phase }
}

const at = (minutes: number) => new Date(Date.UTC(2026, 10, 13, 12, minutes, 0))

describe('SdTicketSourceRepository.findConversation', () => {
  it('finds a conversation of any connection module, scoped to the workspace', async () => {
    for (const module of ['COMMUNICATION', 'SERVICE_DESK'] as const) {
      const { workspace, conversation } = await setup(module)
      const found = expectOk(
        await SdTicketSourceRepository.findConversation(
          workspace.id,
          conversation.id,
        ),
      )
      expect(found?.connection.module).toBe(module)
      expect(found?.contact.waId).toBe('5511988887777')
    }
    const { conversation } = await setup()
    const stranger = await seedWorkspace()
    expect(
      expectOk(
        await SdTicketSourceRepository.findConversation(
          stranger.id,
          conversation.id,
        ),
      ),
    ).toBeNull()
  })

  it('hides deleted conversations', async () => {
    const { workspace, conversation } = await setup()
    await prisma.whatsAppConversation.update({
      where: { id: conversation.id },
      data: { deletedAt: new Date() },
    })
    expect(
      expectOk(
        await SdTicketSourceRepository.findConversation(
          workspace.id,
          conversation.id,
        ),
      ),
    ).toBeNull()
  })
})

describe('SdTicketSourceRepository.listRecentMessages', () => {
  it('returns the last messages oldest first, skipping deleted and cleared ones', async () => {
    const { workspace, conversation } = await setup()
    const add = (
      text: string,
      minutes: number,
      deletedAt: Date | null = null,
    ) =>
      prisma.whatsAppMessage.create({
        data: {
          workspaceId: workspace.id,
          conversationId: conversation.id,
          direction: 'IN',
          type: 'TEXT',
          text,
          status: 'DELIVERED',
          createdAt: at(minutes),
          deletedAt,
        },
      })
    await add('um', 1)
    await add('dois', 2)
    await add('apagada', 3, at(4))
    await add('três', 5)
    await add('quatro', 6)

    const last3 = expectOk(
      await SdTicketSourceRepository.listRecentMessages(
        conversation.id,
        3,
        null,
      ),
    )
    expect(last3.map((m) => m.text)).toEqual(['dois', 'três', 'quatro'])

    const afterClear = expectOk(
      await SdTicketSourceRepository.listRecentMessages(
        conversation.id,
        10,
        at(2),
      ),
    )
    expect(afterClear.map((m) => m.text)).toEqual(['três', 'quatro'])
  })
})

describe('SdTicketSourceRepository CRM and ServiceDesk lookups', () => {
  it('finds the CRM company only inside the workspace', async () => {
    const { workspace, user } = await setup()
    const company = await prisma.crmCompany.create({
      data: {
        name: 'Acme SA',
        cnpj: '12345678000190',
        workspaceId: workspace.id,
        createdById: user.id,
      },
    })
    expect(
      expectOk(
        await SdTicketSourceRepository.findCrmCompany(workspace.id, company.id),
      ),
    ).toMatchObject({ name: 'Acme SA', cnpj: '12345678000190' })
    const stranger = await seedWorkspace()
    expect(
      expectOk(
        await SdTicketSourceRepository.findCrmCompany(stranger.id, company.id),
      ),
    ).toBeNull()
  })

  it('finds an active customer by exact name, ignoring case', async () => {
    const { workspace, user } = await setup()
    const customer = await seedSdCustomer(workspace.id, user.id, {
      name: 'Acme SA',
    })
    await seedSdCustomer(workspace.id, user.id, {
      name: 'Inativa',
      active: false,
    })
    expect(
      expectOk(
        await SdTicketSourceRepository.findCustomerByName(
          workspace.id,
          'acme sa',
        ),
      )?.id,
    ).toBe(customer.id)
    expect(
      expectOk(
        await SdTicketSourceRepository.findCustomerByName(
          workspace.id,
          'inativa',
        ),
      ),
    ).toBeNull()
    expect(
      expectOk(
        await SdTicketSourceRepository.findCustomerByName(workspace.id, 'Acme'),
      ),
    ).toBeNull()
  })

  it('reads the workspace slug', async () => {
    const { workspace } = await setup()
    expect(
      expectOk(await SdTicketSourceRepository.findWorkspaceMeta(workspace.id))
        ?.slug,
    ).toBe(workspace.slug)
    expect(
      expectOk(await SdTicketSourceRepository.findWorkspaceMeta('none')),
    ).toBeNull()
  })
})

describe('SdTicketSourceRepository links', () => {
  it('writes the links and lists the tickets of each kind of source', async () => {
    const { workspace, user, conversation, phase } = await setup()
    const lead = await seedCrmLead(workspace.id, user.id)
    const person = await seedCrmPerson(workspace.id, user.id)
    const opportunity = await createOpportunity(workspace.id, user.id)

    const ticket = await seedSdTicket(workspace.id, phase.id)
    const other = await seedSdTicket(workspace.id, phase.id)
    expectOk(
      await SdTicketSourceRepository.setLinks(ticket.id, {
        whatsappConversationId: conversation.id,
        crmLeadId: lead.id,
        crmPersonId: person.id,
        crmOpportunityId: opportunity.id,
      }),
    )

    const cases = [
      ['conversation', conversation.id],
      ['lead', lead.id],
      ['person', person.id],
      ['opportunity', opportunity.id],
    ] as const
    for (const [kind, id] of cases) {
      const rows = expectOk(
        await SdTicketSourceRepository.listBySource(workspace.id, kind, id),
      )
      expect(rows.map((r) => r.id)).toEqual([ticket.id])
      expect(rows[0]?.phase.category).toBe('NEW')
    }
    expect(
      expectOk(
        await SdTicketSourceRepository.listBySource(
          workspace.id,
          'lead',
          'none',
        ),
      ),
    ).toEqual([])
    expect(other.id).not.toBe(ticket.id)
  })

  it('skips deleted tickets and other workspaces', async () => {
    const { workspace, user, phase } = await setup()
    const lead = await seedCrmLead(workspace.id, user.id)
    const live = await seedSdTicket(workspace.id, phase.id, {
      crmLeadId: lead.id,
    })
    await seedSdTicket(workspace.id, phase.id, {
      crmLeadId: lead.id,
      deletedAt: new Date(),
    })
    const stranger = await seedWorkspace()
    expect(
      expectOk(
        await SdTicketSourceRepository.listBySource(
          stranger.id,
          'lead',
          lead.id,
        ),
      ),
    ).toEqual([])
    expect(
      expectOk(
        await SdTicketSourceRepository.listBySource(
          workspace.id,
          'lead',
          lead.id,
        ),
      ).map((r) => r.id),
    ).toEqual([live.id])
  })

  it('reads one linked ticket inside the workspace', async () => {
    const { workspace, phase } = await setup()
    const ticket = await seedSdTicket(workspace.id, phase.id)
    expect(
      expectOk(
        await SdTicketSourceRepository.findLinkedTicket(
          workspace.id,
          ticket.id,
        ),
      )?.number,
    ).toBe(ticket.number)
    const stranger = await seedWorkspace()
    expect(
      expectOk(
        await SdTicketSourceRepository.findLinkedTicket(stranger.id, ticket.id),
      ),
    ).toBeNull()
  })

  it('maps each kind to its ticket column', () => {
    expect(sourceTicketWhere('conversation', 'x')).toEqual({
      whatsappConversationId: 'x',
    })
    expect(sourceTicketWhere('lead', 'x')).toEqual({ crmLeadId: 'x' })
    expect(sourceTicketWhere('person', 'x')).toEqual({ crmPersonId: 'x' })
    expect(sourceTicketWhere('opportunity', 'x')).toEqual({
      crmOpportunityId: 'x',
    })
  })
})

describe('SdTicketSourceRepository database errors', () => {
  it('returns err instead of throwing', async () => {
    const spy = vi
      .spyOn(prisma.sdTicket, 'findMany')
      .mockRejectedValueOnce(new Error('boom'))
    expectErr(
      await SdTicketSourceRepository.listBySource('w', 'lead', 'x'),
      'DATABASE_ERROR',
    )
    spy.mockRestore()
  })
})

async function createOpportunity(workspaceId: string, userId: string) {
  const pipeline = await seedCrmPipeline(workspaceId, userId)
  const stage = await seedCrmPipelineStage(pipeline.id)
  return seedCrmOpportunity(workspaceId, userId, pipeline.id, stage.id)
}
