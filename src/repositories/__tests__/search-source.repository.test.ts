import { describe, expect, it, vi } from 'vitest'
import { seedCrmCompany } from '@/src/__tests__/factories/crm-company.factory'
import { seedCrmLead } from '@/src/__tests__/factories/crm-lead.factory'
import { seedCrmOpportunity } from '@/src/__tests__/factories/crm-opportunity.factory'
import { seedCrmPerson } from '@/src/__tests__/factories/crm-person.factory'
import {
  seedCrmPipeline,
  seedCrmPipelineStage,
} from '@/src/__tests__/factories/crm-pipeline.factory'
import { seedCrmProposal } from '@/src/__tests__/factories/crm-proposal.factory'
import { seedCrmTask } from '@/src/__tests__/factories/crm-task.factory'
import { seedDocument } from '@/src/__tests__/factories/document-migration.factory'
import { seedMembership } from '@/src/__tests__/factories/membership.factory'
import { seedSdConfigItem } from '@/src/__tests__/factories/sd-config-item.factory'
import { seedSdContact } from '@/src/__tests__/factories/sd-contact.factory'
import { seedSdCustomer } from '@/src/__tests__/factories/sd-customer.factory'
import {
  seedSdKbArticle,
  seedSdTicket,
} from '@/src/__tests__/factories/sd-kb.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWhiteboard } from '@/src/__tests__/factories/whiteboard.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { parseSearchQuery } from '@/src/lib/search/search-query'
import { SearchIndexService } from '@/src/services/search-index.service'
import { SearchDocumentRepository } from '../search-document.repository'
import { SearchSourceRepository } from '../search-source.repository'

const GONE = new Date()

async function seedWhatsApp(workspaceId: string, userId: string) {
  const connection = await prisma.whatsAppConnection.create({
    data: {
      workspaceId,
      provider: 'ZAPI',
      label: 'Suporte',
      phoneNumber: '5511999999999',
      zapiInstanceId: `instance-${workspaceId}`,
      encryptedZapiToken: 'enc:token',
      createdById: userId,
    },
  })
  const contact = await prisma.whatsAppContact.create({
    data: { workspaceId, waId: '5511988887777', name: 'Zé da Fazenda' },
  })
  const conversation = await prisma.whatsAppConversation.create({
    data: { workspaceId, connectionId: connection.id, contactId: contact.id },
  })
  await prisma.whatsAppConversation.create({
    data: {
      workspaceId,
      connectionId: connection.id,
      contactId: contact.id,
      deletedAt: GONE,
    },
  })
  await prisma.whatsAppMessage.create({
    data: {
      workspaceId,
      conversationId: conversation.id,
      direction: 'IN',
      type: 'TEXT',
      text: 'Meu boleto venceu',
    },
  })
  return { contact, conversation }
}

describe('SearchSourceRepository', () => {
  it('should load live records of every type and skip soft-deleted ones', async () => {
    const [ws, user] = await Promise.all([
      seedWorkspace({ slug: `src-${Date.now()}` }),
      seedUser(),
    ])
    await seedMembership({ userId: user.id, workspaceId: ws.id })
    const pipeline = await seedCrmPipeline(ws.id, user.id)
    const stage = await seedCrmPipelineStage(pipeline.id)

    const live = {
      ticket: await seedSdTicket(ws.id, {
        title: 'Impressora parada',
        number: 7,
      }),
      article: await seedSdKbArticle(ws.id, { title: 'VPN' }),
      customer: await seedSdCustomer(ws.id, user.id, { name: 'Agro' }),
      contact: await seedSdContact(ws.id, user.id, { name: 'João' }),
      item: await seedSdConfigItem(ws.id, user.id, { name: 'Servidor' }),
      lead: await seedCrmLead(ws.id, user.id),
      opportunity: await seedCrmOpportunity(
        ws.id,
        user.id,
        pipeline.id,
        stage.id,
      ),
      person: await seedCrmPerson(ws.id, user.id),
      company: await seedCrmCompany(ws.id, user.id),
      task: await seedCrmTask(ws.id, user.id),
      proposal: await seedCrmProposal(ws.id, user.id),
    }
    await Promise.all([
      seedSdTicket(ws.id, { deletedAt: GONE, number: 8 }),
      seedSdKbArticle(ws.id, { archivedAt: GONE }),
      seedSdCustomer(ws.id, user.id, { deletedAt: GONE }),
      seedSdContact(ws.id, user.id, { deletedAt: GONE }),
      seedSdConfigItem(ws.id, user.id, { deletedAt: GONE }),
      seedCrmLead(ws.id, user.id, { deletedAt: GONE }),
      seedCrmOpportunity(ws.id, user.id, pipeline.id, stage.id, {
        deletedAt: GONE,
      }),
      seedCrmPerson(ws.id, user.id, { deletedAt: GONE }),
      seedCrmCompany(ws.id, user.id, { deletedAt: GONE }),
      seedCrmTask(ws.id, user.id, { deletedAt: GONE }),
      seedCrmProposal(ws.id, user.id, { deletedAt: GONE }),
    ])
    const zap = await seedWhatsApp(ws.id, user.id)

    const all = { take: 50 }
    const pick = <T extends { id: string }>(rows: T[]) => rows.map((r) => r.id)
    const R = SearchSourceRepository
    expect(pick(expectOk(await R.sdTickets(ws.id, all)))).toEqual([
      live.ticket.id,
    ])
    expect(pick(expectOk(await R.sdKbArticles(ws.id, all)))).toEqual([
      live.article.id,
    ])
    expect(pick(expectOk(await R.sdCustomers(ws.id, all)))).toEqual([
      live.customer.id,
    ])
    expect(pick(expectOk(await R.sdContacts(ws.id, all)))).toEqual([
      live.contact.id,
    ])
    expect(pick(expectOk(await R.sdConfigItems(ws.id, all)))).toEqual([
      live.item.id,
    ])
    expect(pick(expectOk(await R.crmLeads(ws.id, all)))).toEqual([live.lead.id])
    expect(pick(expectOk(await R.crmOpportunities(ws.id, all)))).toEqual([
      live.opportunity.id,
    ])
    expect(pick(expectOk(await R.crmPeople(ws.id, all)))).toEqual([
      live.person.id,
    ])
    expect(pick(expectOk(await R.crmCompanies(ws.id, all)))).toEqual([
      live.company.id,
    ])
    expect(pick(expectOk(await R.crmTasks(ws.id, all)))).toEqual([live.task.id])
    expect(pick(expectOk(await R.crmProposals(ws.id, all)))).toEqual([
      live.proposal.id,
    ])
    expect(pick(expectOk(await R.zapContacts(ws.id, all)))).toEqual([
      zap.contact.id,
    ])
    const conversations = expectOk(await R.zapConversations(ws.id, all))
    expect(pick(conversations)).toEqual([zap.conversation.id])
    expect(conversations[0].messages[0].text).toBe('Meu boleto venceu')
    expect(expectOk(await R.members(ws.id, all)).map((m) => m.userId)).toEqual([
      user.id,
    ])
    expect(expectOk(await R.sdTicketPrefixes(ws.id))).toBeNull()

    // ids / keyset filters.
    expect(
      pick(expectOk(await R.crmLeads(ws.id, { ids: [live.lead.id], take: 1 }))),
    ).toEqual([live.lead.id])
    expect(
      expectOk(await R.crmLeads(ws.id, { afterId: live.lead.id, take: 5 })),
    ).toEqual([])

    // End to end: rebuild the index and search it.
    const stats = expectOk(await SearchIndexService.reindexWorkspace(ws.id))
    expect(stats.indexed).toBe(14)
    const parsed = parseSearchQuery('impresora')
    const hits = expectOk(
      await SearchDocumentRepository.search({
        workspaceId: ws.id,
        userId: user.id,
        ...parsed,
        types: ['sd-ticket'],
        isSdAgent: true,
        candidateLimit: 10,
      }),
    )
    expect(hits.map((h) => h.entityId)).toEqual([live.ticket.id])

    // A soft delete leaves the index on the next refresh.
    await prisma.crmLead.update({
      where: { id: live.lead.id },
      data: { deletedAt: GONE },
    })
    expect(
      expectOk(
        await SearchIndexService.refresh('crm-lead', ws.id, [live.lead.id]),
      ),
    ).toEqual({ indexed: 0, removed: 1 })
  })

  it('should load live documents and drop proposals already migrated', async () => {
    const [ws, user] = await Promise.all([seedWorkspace(), seedUser()])
    const company = await seedCrmCompany(ws.id, user.id)
    const pending = await seedCrmProposal(ws.id, user.id)
    const migrated = await seedCrmProposal(ws.id, user.id)
    const doc = await seedDocument(ws.id, user.id, {
      legacyProposalId: migrated.id,
      companyId: company.id,
    })
    await seedDocument(ws.id, user.id, { deletedAt: GONE })

    const R = SearchSourceRepository
    const proposals = expectOk(await R.crmProposals(ws.id, { take: 50 }))
    expect(proposals.map((p) => p.id)).toEqual([pending.id])
    const byId = expectOk(
      await R.crmProposals(ws.id, { ids: [migrated.id], take: 1 }),
    )
    expect(byId).toEqual([])

    const docs = expectOk(await R.crmDocuments(ws.id, { take: 50 }))
    expect(docs.map((d) => d.id)).toEqual([doc.id])
    expect(docs[0]?.company?.name).toBe(company.name)
  })

  it('should page workspace ids', async () => {
    const [a, b] = await Promise.all([seedWorkspace(), seedWorkspace()])
    const first = expectOk(
      await SearchSourceRepository.workspaceIds(undefined, 1),
    )
    expect(first).toHaveLength(1)
    const rest = expectOk(
      await SearchSourceRepository.workspaceIds(first[0], 10),
    )
    expect([...first, ...rest].sort()).toEqual([a.id, b.id].sort())
  })

  it('should return DATABASE_ERROR when a query fails', async () => {
    vi.spyOn(prisma.crmLead, 'findMany').mockRejectedValueOnce(new Error('x'))
    expectErr(
      await SearchSourceRepository.crmLeads('ws', { take: 1 }),
      'DATABASE_ERROR',
    )
  })
})

describe('SearchSourceRepository.whiteboards()', () => {
  it('loads live boards with their author, skipping archived ones', async () => {
    const ws = await seedWorkspace()
    const user = await seedUser({ name: 'Ana' })
    const live = await seedWhiteboard(ws.id, user.id, { title: 'Retro' })
    await seedWhiteboard(ws.id, user.id, { archivedAt: GONE })

    const rows = expectOk(
      await SearchSourceRepository.whiteboards(ws.id, { take: 10 }),
    )

    expect(rows.map((r) => r.id)).toEqual([live.id])
    expect(rows[0].createdBy?.name).toBe('Ana')
  })
})
