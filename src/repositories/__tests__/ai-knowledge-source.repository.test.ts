import { describe, expect, it, vi } from 'vitest'
import { seedCrmNote } from '@/src/__tests__/factories/crm-note.factory'
import {
  seedCrmProposal,
  seedCrmProposalSection,
} from '@/src/__tests__/factories/crm-proposal.factory'
import {
  seedSdKbArticle,
  seedSdTicket,
} from '@/src/__tests__/factories/sd-kb.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWhatsAppAiKnowledgeDocument } from '@/src/__tests__/factories/whatsapp-ai-knowledge-document.factory'
import { seedWikiPage } from '@/src/__tests__/factories/wiki-page.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { AiKnowledgeSourceRepository as repo } from '../ai-knowledge-source.repository'

const ALL = { take: 100 }

async function setup() {
  const ws = await seedWorkspace()
  const user = await seedUser()
  return { ws, user }
}

describe('AiKnowledgeSourceRepository', () => {
  it('should load only published, not archived KB articles', async () => {
    const { ws } = await setup()
    const published = await seedSdKbArticle(ws.id, {
      title: 'Publicado',
      status: 'PUBLISHED',
      visibility: 'PORTAL',
      plainText: 'texto',
      tags: ['vpn'],
    })
    await seedSdKbArticle(ws.id, { title: 'Rascunho', status: 'DRAFT' })
    await seedSdKbArticle(ws.id, {
      title: 'Arquivado',
      status: 'PUBLISHED',
      archivedAt: new Date(),
    })
    const rows = expectOk(await repo.kbArticles(ws.id, ALL))
    expect(rows.map((r) => r.id)).toEqual([published.id])
    expect(rows[0]).toMatchObject({ visibility: 'PORTAL', tags: ['vpn'] })
    expect(
      expectOk(await repo.kbArticles(ws.id, { ids: ['nope'], take: 1 })),
    ).toEqual([])
  })

  it('should load live wiki pages, paginated by id', async () => {
    const { ws, user } = await setup()
    const a = await seedWikiPage(ws.id, user.id, { title: 'A' })
    const b = await seedWikiPage(ws.id, user.id, { title: 'B' })
    await seedWikiPage(ws.id, user.id, { archivedAt: new Date() })
    const all = expectOk(await repo.wikiPages(ws.id, ALL))
    expect(all.map((p) => p.id).sort()).toEqual([a.id, b.id].sort())
    const [first] = [a.id, b.id].sort()
    const page2 = expectOk(
      await repo.wikiPages(ws.id, { afterId: first, take: 10 }),
    )
    expect(page2.map((p) => p.id)).toEqual([[a.id, b.id].sort()[1]])
  })

  it('should load only resolved tickets with a solution, with their parties', async () => {
    const { ws, user } = await setup()
    const participant = await seedUser()
    const resolved = await seedSdTicket(ws.id, {
      title: 'Impressora',
      requesterId: user.id,
    })
    await prisma.sdTicket.update({
      where: { id: resolved.id },
      data: { resolvedAt: new Date(), solution: '<p>Trocar o toner</p>' },
    })
    await prisma.sdTicketParticipant.create({
      data: { ticketId: resolved.id, userId: participant.id },
    })
    const open = await seedSdTicket(ws.id)
    await prisma.sdTicket.update({
      where: { id: open.id },
      data: { solution: 'parcial' },
    })
    const noSolution = await seedSdTicket(ws.id)
    await prisma.sdTicket.update({
      where: { id: noSolution.id },
      data: { resolvedAt: new Date(), solution: '' },
    })
    const deleted = await seedSdTicket(ws.id, { deletedAt: new Date() })
    await prisma.sdTicket.update({
      where: { id: deleted.id },
      data: { resolvedAt: new Date(), solution: 'x' },
    })

    const rows = expectOk(await repo.resolvedTickets(ws.id, ALL))
    expect(rows.map((r) => r.id)).toEqual([resolved.id])
    expect(rows[0].requesterId).toBe(user.id)
    expect(rows[0].participants).toEqual([{ userId: participant.id }])
    expect(expectOk(await repo.ticketPrefixes(ws.id))).toBeNull()
  })

  it('should load READY WhatsApp AI documents only', async () => {
    const { ws, user } = await setup()
    const ready = await seedWhatsAppAiKnowledgeDocument(ws.id, user.id)
    await seedWhatsAppAiKnowledgeDocument(ws.id, user.id, {
      status: 'PROCESSING',
      extractedText: null,
    })
    await seedWhatsAppAiKnowledgeDocument(ws.id, user.id, { status: 'FAILED' })
    const rows = expectOk(await repo.zapDocuments(ws.id, ALL))
    expect(rows.map((r) => r.id)).toEqual([ready.id])
  })

  it('should load live CRM notes and proposals with their enabled sections', async () => {
    const { ws, user } = await setup()
    const note = await seedCrmNote(ws.id, user.id, { title: 'Reunião' })
    await seedCrmNote(ws.id, user.id, { deletedAt: new Date() })
    expect(expectOk(await repo.crmNotes(ws.id, ALL)).map((n) => n.id)).toEqual([
      note.id,
    ])

    const proposal = await seedCrmProposal(ws.id, user.id, { name: 'P1' })
    await seedCrmProposalSection(proposal.id, { type: 'COVER', order: 0 })
    await seedCrmProposalSection(proposal.id, {
      type: 'SCOPE',
      order: 1,
      enabled: false,
    })
    await seedCrmProposal(ws.id, user.id, { deletedAt: new Date() })
    const proposals = expectOk(await repo.crmProposals(ws.id, ALL))
    expect(proposals.map((p) => p.id)).toEqual([proposal.id])
    expect(proposals[0].sections.map((s) => s.type)).toEqual(['COVER'])
  })

  it('should list the workspaces with Steel AI on (default on)', async () => {
    const on = await seedWorkspace()
    const off = await seedWorkspace()
    await prisma.workspaceAiSettings.create({
      data: {
        workspaceId: off.id,
        enabledModels: [],
        crmAssistantModel: 'openai:gpt-4o-mini',
        whatsappReplyModel: 'openai:gpt-4o-mini',
        whatsappSentimentModel: 'openai:gpt-4o-mini',
        aiEnabled: false,
      },
    })
    const ids = expectOk(await repo.aiEnabledWorkspaceIds(undefined, 100))
    expect(ids).toContain(on.id)
    expect(ids).not.toContain(off.id)
    const after = expectOk(await repo.aiEnabledWorkspaceIds(on.id, 100))
    expect(after).not.toContain(on.id)
  })

  it('should return DATABASE_ERROR when a load fails', async () => {
    const spy = vi
      .spyOn(prisma.wikiPage, 'findMany')
      .mockRejectedValue(new Error('down'))
    expectErr(await repo.wikiPages('ws', ALL), 'DATABASE_ERROR')
    spy.mockRestore()
  })
})
