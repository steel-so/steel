import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedFlowFixtures } from '@/src/__tests__/factories/nov-z3-whatsapp-flows.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { flowFromPreset } from '@/src/lib/whatsapp/flows/templates'
import { WhatsAppFlowRepository } from '../whatsapp-flow.repository'
import { WhatsAppFlowResponseRepository } from '../whatsapp-flow-response.repository'

afterEach(() => {
  vi.restoreAllMocks()
})

async function seed() {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  const fixtures = await seedFlowFixtures(workspace.id, user.id)
  return { workspace, user, ...fixtures }
}

const preset = flowFromPreset('BLANK')

describe('WhatsAppFlowRepository', () => {
  it('creates, finds, lists, counts, updates and deletes flows per workspace', async () => {
    const { workspace, user, connection, flow } = await seed()
    const other = await seedWorkspace()

    const created = expectOk(
      await WhatsAppFlowRepository.create({
        workspaceId: workspace.id,
        connectionId: connection.id,
        name: 'Pesquisa',
        category: 'SURVEY',
        definition: preset.definition as never,
        bodyText: preset.bodyText,
        ctaLabel: preset.ctaLabel,
        confirmationText: null,
        crmAction: 'NONE',
        createdByUserId: user.id,
      }),
    )
    expect(created.status).toBe('DRAFT')
    expect(created.publishedVersion).toBe(0)

    const found = expectOk(
      await WhatsAppFlowRepository.findById(created.id, workspace.id),
    )
    expect(found?.name).toBe('Pesquisa')
    expect(
      expectOk(await WhatsAppFlowRepository.findById(created.id, other.id)),
    ).toBeNull()

    const list = expectOk(
      await WhatsAppFlowRepository.listByWorkspace(workspace.id),
    )
    expect(list.map((f) => f.id).sort()).toEqual([created.id, flow.id].sort())
    expect(expectOk(await WhatsAppFlowRepository.count(workspace.id))).toBe(2)
    expect(expectOk(await WhatsAppFlowRepository.count(other.id))).toBe(0)

    const updated = expectOk(
      await WhatsAppFlowRepository.update(created.id, {
        status: 'PUBLISHED',
        metaFlowId: 'meta-1',
        publishedVersion: { increment: 1 },
      }),
    )
    expect(updated).toMatchObject({
      status: 'PUBLISHED',
      metaFlowId: 'meta-1',
      publishedVersion: 1,
    })

    expectOk(await WhatsAppFlowRepository.delete(created.id))
    expect(
      expectOk(await WhatsAppFlowRepository.findById(created.id, workspace.id)),
    ).toBeNull()
  })

  it('finds flows by the id Meta knows them under', async () => {
    const { workspace, connection, flow } = await seed()
    await prisma.whatsAppFlow.update({
      where: { id: flow.id },
      data: { metaFlowId: 'meta-77' },
    })
    const other = await seedWorkspace()

    const byConnection = expectOk(
      await WhatsAppFlowRepository.listByMetaFlowId('meta-77', [connection.id]),
    )
    expect(byConnection.map((f) => f.id)).toEqual([flow.id])
    expect(
      expectOk(
        await WhatsAppFlowRepository.listByMetaFlowId('meta-77', ['other']),
      ),
    ).toEqual([])

    expect(
      expectOk(
        await WhatsAppFlowRepository.findByMetaFlowId(workspace.id, 'meta-77'),
      )?.id,
    ).toBe(flow.id)
    expect(
      expectOk(
        await WhatsAppFlowRepository.findByMetaFlowId(other.id, 'meta-77'),
      ),
    ).toBeNull()
  })

  it('turns database failures into errors', async () => {
    const boom = new Error('x')
    vi.spyOn(prisma.whatsAppFlow, 'findMany').mockRejectedValue(boom)
    vi.spyOn(prisma.whatsAppFlow, 'count').mockRejectedValue(boom)
    vi.spyOn(prisma.whatsAppFlow, 'findFirst').mockRejectedValue(boom)
    vi.spyOn(prisma.whatsAppFlow, 'create').mockRejectedValue(boom)
    vi.spyOn(prisma.whatsAppFlow, 'update').mockRejectedValue(boom)
    vi.spyOn(prisma.whatsAppFlow, 'delete').mockRejectedValue(boom)

    expectErr(
      await WhatsAppFlowRepository.listByWorkspace('w'),
      'DATABASE_ERROR',
    )
    expectErr(await WhatsAppFlowRepository.count('w'), 'DATABASE_ERROR')
    expectErr(
      await WhatsAppFlowRepository.listByMetaFlowId('m', ['c']),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppFlowRepository.findByMetaFlowId('w', 'm'),
      'DATABASE_ERROR',
    )
    expectErr(await WhatsAppFlowRepository.findById('i', 'w'), 'DATABASE_ERROR')
    expectErr(
      await WhatsAppFlowRepository.create({
        workspaceId: 'w',
        connectionId: 'c',
        name: 'n',
        category: 'OTHER',
        definition: {},
        bodyText: 'b',
        ctaLabel: 'c',
        confirmationText: null,
        crmAction: 'NONE',
        createdByUserId: 'u',
      }),
      'DATABASE_ERROR',
    )
    expectErr(await WhatsAppFlowRepository.update('i', {}), 'DATABASE_ERROR')
    expectErr(await WhatsAppFlowRepository.delete('i'), 'DATABASE_ERROR')
  })
})

describe('WhatsAppFlowResponseRepository', () => {
  async function send(
    s: Awaited<ReturnType<typeof seed>>,
    flowToken: string,
    extra: { conversationId?: string | null } = {},
  ) {
    return expectOk(
      await WhatsAppFlowResponseRepository.create({
        workspaceId: s.workspace.id,
        flowId: s.flow.id,
        contactId: s.contact.id,
        conversationId: extra.conversationId ?? s.conversation.id,
        flowToken,
        sentByUserId: s.user.id,
      }),
    )
  }

  it('creates a pending send and finds it by token inside the workspace', async () => {
    const s = await seed()
    const row = await send(s, 'stlf.a.1')
    expect(row.status).toBe('SENT')
    expect(
      expectOk(
        await WhatsAppFlowResponseRepository.findByToken(
          s.workspace.id,
          'stlf.a.1',
        ),
      )?.id,
    ).toBe(row.id)
    expect(
      expectOk(
        await WhatsAppFlowResponseRepository.findByToken('other', 'stlf.a.1'),
      ),
    ).toBeNull()
  })

  it('finds the newest pending send of a conversation', async () => {
    const s = await seed()
    await send(s, 'stlf.a.1')
    const newer = await send(s, 'stlf.a.2')
    const open = expectOk(
      await WhatsAppFlowResponseRepository.findLatestOpenByConversation(
        s.workspace.id,
        s.conversation.id,
      ),
    )
    expect(open?.id).toBe(newer.id)
    expectOk(
      await WhatsAppFlowResponseRepository.complete(newer.id, { answers: {} }),
    )
    const next = expectOk(
      await WhatsAppFlowResponseRepository.findLatestOpenByConversation(
        s.workspace.id,
        s.conversation.id,
      ),
    )
    expect(next?.flowToken).toBe('stlf.a.1')
  })

  it('stores an answer once', async () => {
    const s = await seed()
    const row = await send(s, 'stlf.a.1')
    const first = expectOk(
      await WhatsAppFlowResponseRepository.complete(row.id, {
        answers: { nome: 'Ana' },
        conversationId: s.conversation.id,
      }),
    )
    expect(first).toMatchObject({
      status: 'COMPLETED',
      answers: { nome: 'Ana' },
    })
    expect(first?.respondedAt).toBeInstanceOf(Date)
    // A webhook retry finds it already completed.
    expect(
      expectOk(
        await WhatsAppFlowResponseRepository.complete(row.id, {
          answers: { nome: 'Outra' },
        }),
      ),
    ).toBeNull()
  })

  it('records the CRM outcome', async () => {
    const s = await seed()
    const row = await send(s, 'stlf.a.1')
    const updated = expectOk(
      await WhatsAppFlowResponseRepository.setMapping(row.id, {
        createdLeadId: 'lead1',
        mappingNote: null,
      }),
    )
    expect(updated.createdLeadId).toBe('lead1')
  })

  it('lists newest first with a cursor, with the contact', async () => {
    const s = await seed()
    await send(s, 'stlf.a.1')
    await send(s, 'stlf.a.2')
    await send(s, 'stlf.a.3')
    const page = expectOk(
      await WhatsAppFlowResponseRepository.listByFlow(
        s.workspace.id,
        s.flow.id,
        {
          limit: 2,
        },
      ),
    )
    // One extra row tells there is a next page.
    expect(page).toHaveLength(3)
    expect(page[0].contact).toEqual({
      name: 'Maria',
      waId: s.contact.waId,
    })
    const next = expectOk(
      await WhatsAppFlowResponseRepository.listByFlow(
        s.workspace.id,
        s.flow.id,
        {
          limit: 2,
          cursor: page[1].id,
        },
      ),
    )
    expect(next.map((r) => r.id)).toEqual([page[2].id])
    expect(
      expectOk(
        await WhatsAppFlowResponseRepository.listByFlow('other', s.flow.id, {
          limit: 2,
        }),
      ),
    ).toEqual([])
  })

  it('counts per flow and per status', async () => {
    const s = await seed()
    const a = await send(s, 'stlf.a.1')
    await send(s, 'stlf.a.2')
    expectOk(
      await WhatsAppFlowResponseRepository.complete(a.id, { answers: {} }),
    )

    expect(
      expectOk(await WhatsAppFlowResponseRepository.countByFlow(s.flow.id)),
    ).toBe(2)
    const counts = expectOk(
      await WhatsAppFlowResponseRepository.countsByFlow(s.workspace.id),
    )
    const byStatus = Object.fromEntries(counts.map((c) => [c.status, c.count]))
    expect(byStatus).toEqual({ SENT: 1, COMPLETED: 1 })
  })

  it('goes away with the contact (LGPD) and with the flow', async () => {
    const s = await seed()
    await send(s, 'stlf.a.1')
    await prisma.whatsAppContact.delete({ where: { id: s.contact.id } })
    expect(
      expectOk(await WhatsAppFlowResponseRepository.countByFlow(s.flow.id)),
    ).toBe(0)
  })

  it('turns database failures into errors', async () => {
    const boom = new Error('x')
    vi.spyOn(prisma.whatsAppFlowResponse, 'create').mockRejectedValue(boom)
    vi.spyOn(prisma.whatsAppFlowResponse, 'findFirst').mockRejectedValue(boom)
    vi.spyOn(prisma.whatsAppFlowResponse, 'updateMany').mockRejectedValue(boom)
    vi.spyOn(prisma.whatsAppFlowResponse, 'update').mockRejectedValue(boom)
    vi.spyOn(prisma.whatsAppFlowResponse, 'findMany').mockRejectedValue(boom)
    vi.spyOn(prisma.whatsAppFlowResponse, 'groupBy').mockRejectedValue(boom)
    vi.spyOn(prisma.whatsAppFlowResponse, 'count').mockRejectedValue(boom)

    expectErr(
      await WhatsAppFlowResponseRepository.create({
        workspaceId: 'w',
        flowId: 'f',
        contactId: 'c',
        flowToken: 't',
      }),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppFlowResponseRepository.findByToken('w', 't'),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppFlowResponseRepository.findLatestOpenByConversation(
        'w',
        'c',
      ),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppFlowResponseRepository.complete('i', { answers: {} }),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppFlowResponseRepository.setMapping('i', {}),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppFlowResponseRepository.listByFlow('w', 'f', { limit: 1 }),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppFlowResponseRepository.countsByFlow('w'),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppFlowResponseRepository.countByFlow('f'),
      'DATABASE_ERROR',
    )
  })
})
