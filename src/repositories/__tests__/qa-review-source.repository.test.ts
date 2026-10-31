import { describe, expect, it, vi } from 'vitest'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { QaReviewSourceRepository as Repo } from '../qa-review-source.repository'

const closedAt = new Date('2026-11-03T12:00:00.000Z')
const lastMessageAt = new Date('2026-11-03T11:00:00.000Z')

describe('QaReviewSourceRepository.loadConversation', () => {
  const conversation = (overrides: object = {}) => ({
    id: 'c1',
    assignedUserId: 'u1',
    closedAt,
    lastMessageAt,
    assignedUser: { name: 'Carlos' },
    contact: { name: 'Ana', waId: '5511999990000' },
    ...overrides,
  })

  it('returns the conversation with its messages oldest first', async () => {
    vi.spyOn(prisma.whatsAppConversation, 'findFirst').mockResolvedValueOnce(
      conversation() as never,
    )
    vi.spyOn(prisma.whatsAppMessage, 'findMany').mockResolvedValueOnce([
      { direction: 'OUT', text: 'Segunda', senderUserId: 'u1', sentByAi: false },
      { direction: 'IN', text: '   ', senderUserId: null, sentByAi: false },
      { direction: 'IN', text: 'Primeira', senderUserId: null, sentByAi: false },
    ] as never)
    const source = expectOk(await Repo.loadConversation('ws', 'c1'))
    expect(source).toMatchObject({
      id: 'c1',
      assignedUserId: 'u1',
      assignedUserName: 'Carlos',
      customerName: 'Ana',
      endedAt: closedAt,
    })
    expect(source?.messages.map((m) => m.text)).toEqual(['Primeira', 'Segunda'])
  })

  it('falls back to the phone, the last message and no assignee', async () => {
    vi.spyOn(prisma.whatsAppConversation, 'findFirst').mockResolvedValueOnce(
      conversation({
        assignedUser: null,
        assignedUserId: null,
        closedAt: null,
        contact: { name: null, waId: '5511' },
      }) as never,
    )
    vi.spyOn(prisma.whatsAppMessage, 'findMany').mockResolvedValueOnce([])
    const source = expectOk(await Repo.loadConversation('ws', 'c1'))
    expect(source).toMatchObject({
      assignedUserName: null,
      customerName: '5511',
      endedAt: lastMessageAt,
    })
  })

  it('returns null for an unknown conversation and maps failures', async () => {
    vi.spyOn(prisma.whatsAppConversation, 'findFirst').mockResolvedValueOnce(
      null,
    )
    expect(expectOk(await Repo.loadConversation('ws', 'x'))).toBeNull()
    vi.spyOn(prisma.whatsAppConversation, 'findFirst').mockRejectedValueOnce(
      new Error('x'),
    )
    expectErr(await Repo.loadConversation('ws', 'x'), 'DATABASE_ERROR')
  })
})

describe('QaReviewSourceRepository.loadTicket', () => {
  const ticket = (overrides: object = {}) => ({
    id: 't1',
    number: 7,
    title: 'Erro',
    description: '<p>Não liga</p>',
    assigneeId: 'u1',
    resolvedAt: lastMessageAt,
    closedAt,
    assignee: { name: 'Carlos' },
    company: { name: 'Acme Ltda', tradeName: 'Acme' },
    customer: null,
    contact: { name: 'Ana' },
    ...overrides,
  })

  it('returns the ticket label, customer and messages oldest first', async () => {
    vi.spyOn(prisma.sdTicket, 'findFirst').mockResolvedValueOnce(
      ticket() as never,
    )
    vi.spyOn(prisma.sdTicketMessage, 'findMany').mockResolvedValueOnce([
      { authorKind: 'AGENT', visibility: 'PUBLIC', body: 'b', authorUserId: 'u1' },
      { authorKind: 'REQUESTER', visibility: 'PUBLIC', body: 'a', authorUserId: null },
    ] as never)
    const source = expectOk(await Repo.loadTicket('ws', 't1'))
    expect(source).toMatchObject({
      label: '#7 Erro',
      assigneeName: 'Carlos',
      customerName: 'Acme',
      endedAt: closedAt,
    })
    expect(source?.messages.map((m) => m.body)).toEqual(['a', 'b'])
  })

  it('falls back across the customer sources', async () => {
    const find = vi.spyOn(prisma.sdTicket, 'findFirst')
    vi.spyOn(prisma.sdTicketMessage, 'findMany').mockResolvedValue([])
    find.mockResolvedValueOnce(
      ticket({
        company: null,
        customer: { name: 'Beta SA', tradeName: null },
        assignee: null,
        closedAt: null,
      }) as never,
    )
    expect(expectOk(await Repo.loadTicket('ws', 't1'))).toMatchObject({
      customerName: 'Beta SA',
      assigneeName: null,
      endedAt: lastMessageAt,
    })
    find.mockResolvedValueOnce(
      ticket({ company: null, customer: null }) as never,
    )
    expect(expectOk(await Repo.loadTicket('ws', 't1'))?.customerName).toBe('Ana')
    find.mockResolvedValueOnce(
      ticket({ company: null, customer: null, contact: null }) as never,
    )
    expect(expectOk(await Repo.loadTicket('ws', 't1'))?.customerName).toBeNull()
  })

  it('returns null for an unknown ticket and maps failures', async () => {
    vi.spyOn(prisma.sdTicket, 'findFirst').mockResolvedValueOnce(null)
    expect(expectOk(await Repo.loadTicket('ws', 'x'))).toBeNull()
    vi.spyOn(prisma.sdTicket, 'findFirst').mockRejectedValueOnce(new Error('x'))
    expectErr(await Repo.loadTicket('ws', 'x'), 'DATABASE_ERROR')
  })
})
