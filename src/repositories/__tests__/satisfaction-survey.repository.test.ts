import { describe, expect, it, vi } from 'vitest'
import { seedSurvey } from '@/src/__tests__/factories/nov-t1-nps.factory'
import { seedSdTicket } from '@/src/__tests__/factories/sd-ticket.factory'
import { seedSdPhaseFlow } from '@/src/__tests__/factories/sd-ticket-context.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { SatisfactionSurveyRepository as Repo } from '../satisfaction-survey.repository'
import { SdTicketCsatRepository } from '../sd-ticket-csat.repository'

const DAY = 86_400_000

describe('SatisfactionSurveyRepository configs', () => {
  it('upserts one rule per trigger and lists them', async () => {
    const ws = await seedWorkspace()
    expect(expectOk(await Repo.findConfig(ws.id, 'TICKET_RESOLVED'))).toBeNull()
    const first = expectOk(
      await Repo.upsertConfig(ws.id, 'TICKET_RESOLVED', { enabled: true }),
    )
    const second = expectOk(
      await Repo.upsertConfig(ws.id, 'TICKET_RESOLVED', { kind: 'NPS' }),
    )
    expect(second.id).toBe(first.id)
    expect(second).toMatchObject({ enabled: true, kind: 'NPS' })
    expect(expectOk(await Repo.listConfigs(ws.id))).toHaveLength(1)
  })

  it('maps failures to DATABASE_ERROR', async () => {
    vi.spyOn(prisma.satisfactionSurveyConfig, 'findMany').mockRejectedValueOnce(
      new Error('x'),
    )
    expectErr(await Repo.listConfigs('ws'), 'DATABASE_ERROR')
    vi.spyOn(
      prisma.satisfactionSurveyConfig,
      'findUnique',
    ).mockRejectedValueOnce(new Error('x'))
    expectErr(await Repo.findConfig('ws', 'MANUAL'), 'DATABASE_ERROR')
    vi.spyOn(prisma.satisfactionSurveyConfig, 'upsert').mockRejectedValueOnce(
      new Error('x'),
    )
    expectErr(await Repo.upsertConfig('ws', 'MANUAL', {}), 'DATABASE_ERROR')
  })
})

describe('SatisfactionSurveyRepository surveys', () => {
  it('finds by id (scoped) and by token with the workspace name', async () => {
    const ws = await seedWorkspace()
    const survey = await seedSurvey(ws.id)
    expect(expectOk(await Repo.findById(survey.id, ws.id))?.id).toBe(survey.id)
    expect(expectOk(await Repo.findById(survey.id))?.id).toBe(survey.id)
    const other = await seedWorkspace()
    expect(expectOk(await Repo.findById(survey.id, other.id))).toBeNull()
    const byToken = expectOk(await Repo.findByToken(survey.token))
    expect(byToken?.workspaceName).toBe(ws.name)
    expect(expectOk(await Repo.findByToken('nope'))).toBeNull()
  })

  it('creates and updates', async () => {
    const ws = await seedWorkspace()
    const survey = await seedSurvey(ws.id)
    const created = expectOk(
      await Repo.create({
        workspaceId: ws.id,
        kind: 'NPS',
        trigger: 'MANUAL',
        channel: 'EMAIL',
        token: `tok-${Date.now()}-create-xxxxxxxx`,
        scheduledFor: new Date(),
        expiresAt: new Date(Date.now() + DAY),
      }),
    )
    expect(created.status).toBe('SCHEDULED')
    const updated = expectOk(await Repo.update(survey.id, { status: 'FAILED' }))
    expect(updated.status).toBe('FAILED')
  })

  it('finds the open survey of a phone, newest first, not expired', async () => {
    const ws = await seedWorkspace()
    await seedSurvey(ws.id, { sentAt: new Date(Date.now() - 2 * DAY) })
    const newest = await seedSurvey(ws.id, { sentAt: new Date() })
    await seedSurvey(ws.id, { expiresAt: new Date(Date.now() - 1000) })
    const found = expectOk(
      await Repo.findOpenByPhone(ws.id, '5511999990000', new Date()),
    )
    expect(found?.id).toBe(newest.id)
    expect(
      expectOk(await Repo.findOpenByPhone(ws.id, '5500', new Date())),
    ).toBeNull()
  })

  it('answers only once', async () => {
    const ws = await seedWorkspace()
    const survey = await seedSurvey(ws.id)
    expect(expectOk(await Repo.answer(survey.id, 5, new Date(), 'ótimo'))).toBe(
      true,
    )
    expect(expectOk(await Repo.answer(survey.id, 1, new Date()))).toBe(false)
    const row = await prisma.satisfactionSurvey.findUniqueOrThrow({
      where: { id: survey.id },
    })
    expect(row).toMatchObject({
      status: 'ANSWERED',
      score: 5,
      comment: 'ótimo',
    })
  })

  it('answers without a comment', async () => {
    const ws = await seedWorkspace()
    const survey = await seedSurvey(ws.id)
    expect(expectOk(await Repo.answer(survey.id, 3, new Date()))).toBe(true)
  })

  it('adds a comment once, inside the window', async () => {
    const ws = await seedWorkspace()
    const survey = await seedSurvey(ws.id)
    await Repo.answer(survey.id, 4, new Date())
    const awaiting = expectOk(
      await Repo.findAwaitingComment(
        ws.id,
        '5511999990000',
        new Date(Date.now() - 60_000),
      ),
    )
    expect(awaiting?.id).toBe(survey.id)
    expect(expectOk(await Repo.setComment(survey.id, 'legal'))).toBe(true)
    expect(expectOk(await Repo.setComment(survey.id, 'outro'))).toBe(false)
    expect(
      expectOk(
        await Repo.findAwaitingComment(
          ws.id,
          '5511999990000',
          new Date(Date.now() - 60_000),
        ),
      ),
    ).toBeNull()
  })

  it('detects recent surveys of the same recipient', async () => {
    const ws = await seedWorkspace()
    await seedSurvey(ws.id, {
      recipientPhone: '551',
      recipientEmail: 'a@b.com',
    })
    await seedSurvey(ws.id, { recipientPhone: '552', status: 'FAILED' })
    const since = new Date(Date.now() - DAY)
    expect(
      expectOk(
        await Repo.existsRecentForRecipient(ws.id, { phone: '551' }, since),
      ),
    ).toBe(true)
    expect(
      expectOk(
        await Repo.existsRecentForRecipient(ws.id, { email: 'a@b.com' }, since),
      ),
    ).toBe(true)
    expect(
      expectOk(
        await Repo.existsRecentForRecipient(ws.id, { phone: '552' }, since),
      ),
    ).toBe(false)
    expect(
      expectOk(await Repo.existsRecentForRecipient(ws.id, {}, since)),
    ).toBe(false)
    expect(
      expectOk(
        await Repo.existsRecentForRecipient(
          ws.id,
          { phone: '551' },
          new Date(Date.now() + DAY),
        ),
      ),
    ).toBe(false)
  })

  it('detects a survey for a ticket', async () => {
    const ws = await seedWorkspace()
    const flow = await seedSdPhaseFlow(ws.id)
    const ticket = await seedSdTicket(ws.id, flow.resolved.id)
    expect(expectOk(await Repo.existsForTicket(ticket.id))).toBe(false)
    await seedSurvey(ws.id, { ticketId: ticket.id })
    expect(expectOk(await Repo.existsForTicket(ticket.id))).toBe(true)
  })

  it('lists with filters and paginates', async () => {
    const ws = await seedWorkspace()
    await seedSurvey(ws.id, { kind: 'NPS' })
    await seedSurvey(ws.id, { kind: 'CSAT', status: 'ANSWERED' })
    await seedSurvey(ws.id, { kind: 'CSAT' })
    const all = expectOk(await Repo.list(ws.id, {}, 1, 2))
    expect(all.total).toBe(3)
    expect(all.items).toHaveLength(2)
    expect(expectOk(await Repo.list(ws.id, { kind: 'NPS' }, 1, 10)).total).toBe(
      1,
    )
    expect(
      expectOk(await Repo.list(ws.id, { status: 'ANSWERED' }, 1, 10)).total,
    ).toBe(1)
  })

  it('reads report rows of one kind, with a period', async () => {
    const ws = await seedWorkspace()
    await seedSurvey(ws.id, { kind: 'CSAT', status: 'ANSWERED', score: 5 })
    await seedSurvey(ws.id, { kind: 'CSAT', status: 'FAILED' })
    await seedSurvey(ws.id, { kind: 'NPS' })
    const rows = expectOk(await Repo.reportRows(ws.id, 'CSAT', null, null))
    expect(rows).toHaveLength(1)
    const future = new Date(Date.now() + DAY)
    expect(
      expectOk(await Repo.reportRows(ws.id, 'CSAT', future, null)),
    ).toHaveLength(0)
    expect(
      expectOk(await Repo.reportRows(ws.id, 'CSAT', null, future)),
    ).toHaveLength(1)
  })

  it('maps failures to DATABASE_ERROR', async () => {
    const s = prisma.satisfactionSurvey
    const boom = () => new Error('x')
    vi.spyOn(s, 'create').mockRejectedValueOnce(boom())
    expectErr(await Repo.create({} as never), 'DATABASE_ERROR')
    vi.spyOn(s, 'findFirst').mockRejectedValueOnce(boom())
    expectErr(await Repo.findById('x'), 'DATABASE_ERROR')
    vi.spyOn(s, 'findUnique').mockRejectedValueOnce(boom())
    expectErr(await Repo.findByToken('x'), 'DATABASE_ERROR')
    vi.spyOn(s, 'findFirst').mockRejectedValueOnce(boom())
    expectErr(
      await Repo.findOpenByPhone('w', 'p', new Date()),
      'DATABASE_ERROR',
    )
    vi.spyOn(s, 'findFirst').mockRejectedValueOnce(boom())
    expectErr(
      await Repo.findAwaitingComment('w', 'p', new Date()),
      'DATABASE_ERROR',
    )
    vi.spyOn(s, 'count').mockRejectedValueOnce(boom())
    expectErr(
      await Repo.existsRecentForRecipient('w', { phone: 'p' }, new Date()),
      'DATABASE_ERROR',
    )
    vi.spyOn(s, 'count').mockRejectedValueOnce(boom())
    expectErr(await Repo.existsForTicket('t'), 'DATABASE_ERROR')
    vi.spyOn(s, 'update').mockRejectedValueOnce(boom())
    expectErr(await Repo.update('x', {}), 'DATABASE_ERROR')
    vi.spyOn(s, 'updateMany').mockRejectedValueOnce(boom())
    expectErr(await Repo.answer('x', 1, new Date()), 'DATABASE_ERROR')
    vi.spyOn(s, 'updateMany').mockRejectedValueOnce(boom())
    expectErr(await Repo.setComment('x', 'c'), 'DATABASE_ERROR')
    vi.spyOn(s, 'findMany').mockRejectedValueOnce(boom())
    expectErr(await Repo.list('w', {}, 1, 1), 'DATABASE_ERROR')
    vi.spyOn(s, 'findMany').mockRejectedValueOnce(boom())
    expectErr(await Repo.reportRows('w', 'NPS', null, null), 'DATABASE_ERROR')
  })
})

describe('SdTicketCsatRepository survey helpers', () => {
  it('reads the score and sets the comment only on a rated ticket', async () => {
    const ws = await seedWorkspace()
    const flow = await seedSdPhaseFlow(ws.id)
    const ticket = await seedSdTicket(ws.id, flow.resolved.id)
    expect(
      expectOk(await SdTicketCsatRepository.findScore(ticket.id, ws.id)),
    ).toBeNull()
    expect(
      expectOk(await SdTicketCsatRepository.findScore('nope', ws.id)),
    ).toBeNull()
    expect(
      expectOk(await SdTicketCsatRepository.setComment(ticket.id, ws.id, 'x')),
    ).toBe(false)
    await SdTicketCsatRepository.submit(ticket.id, ws.id, 5, null)
    expect(
      expectOk(await SdTicketCsatRepository.findScore(ticket.id, ws.id)),
    ).toBe(5)
    expect(
      expectOk(await SdTicketCsatRepository.setComment(ticket.id, ws.id, 'x')),
    ).toBe(true)
    expect(
      expectOk(await SdTicketCsatRepository.setComment(ticket.id, ws.id, 'y')),
    ).toBe(false)
  })

  it('maps failures to DATABASE_ERROR', async () => {
    vi.spyOn(prisma.sdTicket, 'findFirst').mockRejectedValueOnce(new Error('x'))
    expectErr(
      await SdTicketCsatRepository.findScore('t', 'w'),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.sdTicket, 'updateMany').mockRejectedValueOnce(
      new Error('x'),
    )
    expectErr(
      await SdTicketCsatRepository.setComment('t', 'w', 'c'),
      'DATABASE_ERROR',
    )
  })
})
