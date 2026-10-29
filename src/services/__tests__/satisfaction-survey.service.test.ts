import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeSurvey,
  createFakeSurveyConfig,
} from '@/src/__tests__/factories/nov-t1-nps.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, forbidden } from '@/src/errors'
import { sendSurveyInvitationEmail } from '@/src/lib/mail/survey/send-survey-invitation'
import { getSatisfactionSurveyQueue } from '@/src/lib/queue/queues'
import { err, ok } from '@/src/lib/result'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { SatisfactionSurveyRepository as Repo } from '@/src/repositories/satisfaction-survey.repository'
import { SdTicketCsatRepository } from '@/src/repositories/sd-ticket-csat.repository'
import { UserRepository } from '@/src/repositories/user.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppTeamRepository } from '@/src/repositories/whatsapp-team.repository'
import { WorkspaceRepository } from '@/src/repositories/workspace.repository'
import { assertModuleMember, assertModulePrivileged } from '../authz'
import { SatisfactionSurveyService as Service } from '../satisfaction-survey.service'

vi.mock('@/src/repositories/satisfaction-survey.repository')
vi.mock('@/src/repositories/sd-ticket-csat.repository')
vi.mock('@/src/repositories/sd-ticket.repository', () => ({}))
vi.mock('@/src/repositories/user.repository')
vi.mock('@/src/repositories/whatsapp-connection.repository')
vi.mock('@/src/repositories/whatsapp-contact.repository')
vi.mock('@/src/repositories/whatsapp-conversation.repository')
vi.mock('@/src/repositories/whatsapp-team.repository')
vi.mock('@/src/repositories/workspace.repository')
vi.mock('@/src/lib/whatsapp/send', () => ({
  WhatsAppSend: { text: vi.fn(), buttons: vi.fn() },
}))
vi.mock('@/src/lib/mail/survey/send-survey-invitation', () => ({
  sendSurveyInvitationEmail: vi.fn(),
}))
vi.mock('@/src/lib/queue/queues', () => ({
  getSatisfactionSurveyQueue: vi.fn(),
}))
vi.mock('../authz', () => ({
  assertModuleMember: vi.fn(),
  assertModulePrivileged: vi.fn(),
}))
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))
vi.mock('@/lib/base-email-url', () => ({ baseEmailUrl: 'https://steel.test' }))

const add = vi.fn()
const connection = {
  id: 'conn-1',
  module: 'COMMUNICATION',
  status: 'CONNECTED',
} as never
const contact = {
  id: 'c1',
  waId: '5511999990000',
  name: 'Ana',
  broadcastOptedOutAt: null,
} as never
const dbErr = () => err(databaseError('x'))

beforeEach(() => {
  vi.resetAllMocks()
  add.mockResolvedValue(undefined)
  vi.mocked(getSatisfactionSurveyQueue).mockReturnValue({ add } as never)
  vi.mocked(assertModuleMember).mockResolvedValue(ok({}) as never)
  vi.mocked(assertModulePrivileged).mockResolvedValue(ok({}) as never)
  vi.mocked(Repo.existsRecentForRecipient).mockResolvedValue(ok(false))
  vi.mocked(Repo.create).mockImplementation(async (data) =>
    ok(createFakeSurvey({ ...(data as object), id: 's-new' } as never)),
  )
  vi.mocked(Repo.update).mockResolvedValue(ok(createFakeSurvey()))
  vi.mocked(UserRepository.findById).mockResolvedValue(
    ok({ name: 'Carlos' } as never),
  )
  vi.mocked(WhatsAppTeamRepository.findById).mockResolvedValue(
    ok({ name: 'Suporte' } as never),
  )
  vi.mocked(WorkspaceRepository.findById).mockResolvedValue(
    ok({ name: 'Acme' } as never),
  )
  vi.mocked(WhatsAppSend.buttons).mockResolvedValue(
    ok({ providerMessageId: 'wamid' }) as never,
  )
  vi.mocked(WhatsAppSend.text).mockResolvedValue(
    ok({ providerMessageId: 'wamid2' }) as never,
  )
})

describe('SatisfactionSurveyService admin', () => {
  it('lists both triggers, defaulting the unsaved one', async () => {
    vi.mocked(Repo.listConfigs).mockResolvedValue(
      ok([createFakeSurveyConfig({ trigger: 'TICKET_RESOLVED', kind: 'NPS' })]),
    )
    const list = expectOk(await Service.listConfigs('u', 'ws'))
    expect(list.map((c) => c.trigger)).toEqual([
      'CONVERSATION_CLOSED',
      'TICKET_RESOLVED',
    ])
    expect(list[0].enabled).toBe(false)
    expect(list[1].kind).toBe('NPS')
  })

  it('propagates authz and database errors on every read', async () => {
    vi.mocked(assertModuleMember).mockResolvedValue(err(forbidden()))
    expectErr(await Service.listConfigs('u', 'ws'), 'FORBIDDEN')
    expectErr(
      await Service.list('u', 'ws', { page: 1, pageSize: 5 }),
      'FORBIDDEN',
    )
    expectErr(
      await Service.report('u', 'ws', { kind: 'CSAT', groupBy: 'agent' }),
      'FORBIDDEN',
    )
    expectErr(
      await Service.sendManual('u', 'ws', { kind: 'CSAT', email: 'a@b.com' }),
      'FORBIDDEN',
    )
    vi.mocked(assertModuleMember).mockResolvedValue(ok({}) as never)
    vi.mocked(Repo.listConfigs).mockResolvedValue(dbErr())
    expectErr(await Service.listConfigs('u', 'ws'), 'DATABASE_ERROR')
    vi.mocked(Repo.list).mockResolvedValue(dbErr())
    expectErr(
      await Service.list('u', 'ws', { page: 1, pageSize: 5 }),
      'DATABASE_ERROR',
    )
    vi.mocked(Repo.reportRows).mockResolvedValue(dbErr())
    expectErr(
      await Service.report('u', 'ws', { kind: 'CSAT', groupBy: 'agent' }),
      'DATABASE_ERROR',
    )
  })

  it('only admins save a rule, and only the given fields are written', async () => {
    vi.mocked(Repo.upsertConfig).mockResolvedValue(
      ok(createFakeSurveyConfig({ enabled: true, kind: 'NPS' })),
    )
    const dto = expectOk(
      await Service.updateConfig('u', 'ws', 'CONVERSATION_CLOSED', {
        kind: 'NPS',
        enabled: true,
        delayMinutes: 0,
        expiresInHours: 10,
        cooldownDays: 0,
        emailFallback: false,
        questionText: '',
        thankYouText: 'Valeu',
      }),
    )
    expect(dto.enabled).toBe(true)
    expect(Repo.upsertConfig).toHaveBeenCalledWith(
      'ws',
      'CONVERSATION_CLOSED',
      {
        kind: 'NPS',
        enabled: true,
        delayMinutes: 0,
        expiresInHours: 10,
        cooldownDays: 0,
        emailFallback: false,
        questionText: null,
        thankYouText: 'Valeu',
      },
    )
    await Service.updateConfig('u', 'ws', 'TICKET_RESOLVED', {})
    expect(Repo.upsertConfig).toHaveBeenLastCalledWith(
      'ws',
      'TICKET_RESOLVED',
      {},
    )
  })

  it('rejects a non-admin and surfaces a save failure', async () => {
    vi.mocked(assertModulePrivileged).mockResolvedValue(err(forbidden()))
    expectErr(
      await Service.updateConfig('u', 'ws', 'TICKET_RESOLVED', {}),
      'FORBIDDEN',
    )
    expect(Repo.upsertConfig).not.toHaveBeenCalled()
    vi.mocked(assertModulePrivileged).mockResolvedValue(ok({}) as never)
    vi.mocked(Repo.upsertConfig).mockResolvedValue(dbErr())
    expectErr(
      await Service.updateConfig('u', 'ws', 'TICKET_RESOLVED', {}),
      'DATABASE_ERROR',
    )
  })

  it('lists and builds the report', async () => {
    vi.mocked(Repo.list).mockResolvedValue(
      ok({ items: [createFakeSurvey()], total: 1 }),
    )
    const page = expectOk(
      await Service.list('u', 'ws', { page: 1, pageSize: 5 }),
    )
    expect(page.total).toBe(1)
    vi.mocked(Repo.reportRows).mockResolvedValue(ok([]))
    const report = expectOk(
      await Service.report('u', 'ws', {
        kind: 'NPS',
        groupBy: 'team',
        from: new Date('2026-11-01T00:00:00Z'),
      }),
    )
    expect(report.rows).toEqual([])
    expect(report.from).toBe('2026-11-01T00:00:00.000Z')
  })
})

describe('SatisfactionSurveyService.sendManual', () => {
  it('sends to an e-mail address', async () => {
    vi.mocked(Repo.findConfig).mockResolvedValue(ok(null))
    const dto = expectOk(
      await Service.sendManual('u', 'ws', {
        kind: 'NPS',
        email: 'ana@acme.com',
        recipientName: 'Ana',
      }),
    )
    expect(dto.channel).toBe('EMAIL')
    expect(dto.assigneeName).toBe('Carlos')
    expect(add).toHaveBeenCalledWith(
      'deliver-survey',
      { surveyId: 's-new' },
      expect.objectContaining({ jobId: 'survey-s-new' }),
    )
  })

  it('sends to a WhatsApp contact through a connected connection', async () => {
    vi.mocked(WhatsAppContactRepository.findById).mockResolvedValue(ok(contact))
    vi.mocked(WhatsAppConnectionRepository.listByWorkspace).mockResolvedValue(
      ok([
        { id: 'off', status: 'DISCONNECTED' },
        { id: 'conn-1', status: 'CONNECTED' },
      ] as never),
    )
    vi.mocked(Repo.findConfig).mockResolvedValue(ok(createFakeSurveyConfig()))
    const dto = expectOk(
      await Service.sendManual('u', 'ws', {
        kind: 'CSAT',
        whatsappContactId: 'c1',
      }),
    )
    expect(dto.channel).toBe('WHATSAPP')
    expect(Repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: 'conn-1',
        recipientPhone: '5511999990000',
        customerKey: 'contact:c1',
      }),
    )
  })

  it('has no recipient when the contact opted out and no e-mail is given', async () => {
    vi.mocked(WhatsAppContactRepository.findById).mockResolvedValue(
      ok({ ...(contact as object), broadcastOptedOutAt: new Date() } as never),
    )
    vi.mocked(WhatsAppConnectionRepository.listByWorkspace).mockResolvedValue(
      ok([{ id: 'conn-1', status: 'CONNECTED' }] as never),
    )
    vi.mocked(Repo.findConfig).mockResolvedValue(ok(null))
    expectErr(
      await Service.sendManual('u', 'ws', {
        kind: 'CSAT',
        whatsappContactId: 'c1',
      }),
      'SURVEY_NO_RECIPIENT',
    )
  })

  it('fails on an unknown contact and on repository errors', async () => {
    vi.mocked(WhatsAppContactRepository.findById).mockResolvedValue(ok(null))
    expectErr(
      await Service.sendManual('u', 'ws', {
        kind: 'CSAT',
        whatsappContactId: 'x',
      }),
      'SURVEY_NOT_FOUND',
    )
    vi.mocked(WhatsAppContactRepository.findById).mockResolvedValue(dbErr())
    expectErr(
      await Service.sendManual('u', 'ws', {
        kind: 'CSAT',
        whatsappContactId: 'x',
      }),
      'DATABASE_ERROR',
    )
    vi.mocked(WhatsAppContactRepository.findById).mockResolvedValue(ok(contact))
    vi.mocked(WhatsAppConnectionRepository.listByWorkspace).mockResolvedValue(
      dbErr(),
    )
    expectErr(
      await Service.sendManual('u', 'ws', {
        kind: 'CSAT',
        whatsappContactId: 'x',
      }),
      'DATABASE_ERROR',
    )
    vi.mocked(Repo.findConfig).mockResolvedValue(ok(null))
    vi.mocked(Repo.create).mockResolvedValue(dbErr())
    expectErr(
      await Service.sendManual('u', 'ws', { kind: 'CSAT', email: 'a@b.com' }),
      'DATABASE_ERROR',
    )
  })

  it('marks the survey FAILED when the queue is down', async () => {
    vi.mocked(Repo.findConfig).mockResolvedValue(ok(null))
    add.mockRejectedValue(new Error('redis'))
    expectErr(
      await Service.sendManual('u', 'ws', { kind: 'CSAT', email: 'a@b.com' }),
      'SURVEY_NO_RECIPIENT',
    )
    expect(Repo.update).toHaveBeenCalledWith('s-new', {
      status: 'FAILED',
      failureReason: 'queue_unavailable',
    })
  })
})

const conversation = {
  id: 'cv1',
  workspaceId: 'ws',
  connectionId: 'conn-1',
  contactId: 'c1',
  assignedUserId: 'u1',
  teamId: 't1',
  firstInboundAt: new Date(),
}

describe('SatisfactionSurveyService.onConversationClosed', () => {
  beforeEach(() => {
    vi.mocked(Repo.findConfig).mockResolvedValue(ok(createFakeSurveyConfig()))
    vi.mocked(WhatsAppConnectionRepository.findById).mockResolvedValue(
      ok(connection),
    )
    vi.mocked(WhatsAppContactRepository.findById).mockResolvedValue(ok(contact))
  })

  it('schedules a WhatsApp survey with agent and team snapshots', async () => {
    const survey = expectOk(await Service.onConversationClosed(conversation))
    expect(survey?.id).toBe('s-new')
    expect(Repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: 'CONVERSATION_CLOSED',
        channel: 'WHATSAPP',
        assigneeName: 'Carlos',
        teamName: 'Suporte',
        conversationId: 'cv1',
      }),
    )
    expect(add.mock.calls[0][2].delay).toBeGreaterThan(0)
  })

  it('does nothing when the rule is off or missing', async () => {
    vi.mocked(Repo.findConfig).mockResolvedValue(ok(null))
    expect(
      expectOk(await Service.onConversationClosed(conversation)),
    ).toBeNull()
    vi.mocked(Repo.findConfig).mockResolvedValue(
      ok(createFakeSurveyConfig({ enabled: false })),
    )
    expect(
      expectOk(await Service.onConversationClosed(conversation)),
    ).toBeNull()
  })

  it('skips conversations the contact never wrote in, opted-out contacts and ServiceDesk chats', async () => {
    expect(
      expectOk(
        await Service.onConversationClosed({
          ...conversation,
          firstInboundAt: null,
        }),
      ),
    ).toBeNull()
    vi.mocked(WhatsAppConnectionRepository.findById).mockResolvedValue(
      ok({ module: 'SERVICE_DESK' } as never),
    )
    expect(
      expectOk(await Service.onConversationClosed(conversation)),
    ).toBeNull()
    vi.mocked(WhatsAppConnectionRepository.findById).mockResolvedValue(ok(null))
    expect(
      expectOk(await Service.onConversationClosed(conversation)),
    ).toBeNull()
    vi.mocked(WhatsAppConnectionRepository.findById).mockResolvedValue(
      ok(connection),
    )
    vi.mocked(WhatsAppContactRepository.findById).mockResolvedValue(
      ok({ ...(contact as object), broadcastOptedOutAt: new Date() } as never),
    )
    expect(
      expectOk(await Service.onConversationClosed(conversation)),
    ).toBeNull()
    vi.mocked(WhatsAppContactRepository.findById).mockResolvedValue(ok(null))
    expect(
      expectOk(await Service.onConversationClosed(conversation)),
    ).toBeNull()
  })

  it('respects the cooldown', async () => {
    vi.mocked(Repo.existsRecentForRecipient).mockResolvedValue(ok(true))
    expect(
      expectOk(await Service.onConversationClosed(conversation)),
    ).toBeNull()
    expect(Repo.create).not.toHaveBeenCalled()
  })

  it('skips the cooldown check when it is 0', async () => {
    vi.mocked(Repo.findConfig).mockResolvedValue(
      ok(createFakeSurveyConfig({ cooldownDays: 0 })),
    )
    await Service.onConversationClosed(conversation)
    expect(Repo.existsRecentForRecipient).not.toHaveBeenCalled()
  })

  it('propagates database errors', async () => {
    vi.mocked(Repo.findConfig).mockResolvedValue(dbErr())
    expectErr(
      await Service.onConversationClosed(conversation),
      'DATABASE_ERROR',
    )
    vi.mocked(Repo.findConfig).mockResolvedValue(ok(createFakeSurveyConfig()))
    vi.mocked(WhatsAppConnectionRepository.findById).mockResolvedValue(dbErr())
    expectErr(
      await Service.onConversationClosed(conversation),
      'DATABASE_ERROR',
    )
    vi.mocked(WhatsAppConnectionRepository.findById).mockResolvedValue(
      ok(connection),
    )
    vi.mocked(WhatsAppContactRepository.findById).mockResolvedValue(dbErr())
    expectErr(
      await Service.onConversationClosed(conversation),
      'DATABASE_ERROR',
    )
    vi.mocked(WhatsAppContactRepository.findById).mockResolvedValue(ok(contact))
    vi.mocked(Repo.existsRecentForRecipient).mockResolvedValue(dbErr())
    expectErr(
      await Service.onConversationClosed(conversation),
      'DATABASE_ERROR',
    )
  })

  it('tolerates unknown agent and team lookups', async () => {
    vi.mocked(UserRepository.findById).mockResolvedValue(
      err(databaseError('x')),
    )
    vi.mocked(WhatsAppTeamRepository.findById).mockResolvedValue(ok(null))
    await Service.onConversationClosed(conversation)
    expect(Repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ assigneeName: null, teamName: null }),
    )
    await Service.onConversationClosed({
      ...conversation,
      assignedUserId: null,
      teamId: null,
    })
    expect(UserRepository.findById).toHaveBeenCalledTimes(1)
  })
})

const ticket = (o: Record<string, unknown> = {}) =>
  ({
    id: 'tk1',
    workspaceId: 'ws',
    csatScore: null,
    whatsappConversationId: null,
    contact: { id: 'ct1', name: 'Bia', email: 'bia@acme.com' },
    requester: { email: 'req@acme.com', name: 'Req' },
    company: { id: 'co1', name: 'Acme SA', tradeName: 'Acme' },
    customer: null,
    assignee: { id: 'u1', name: 'Carlos' },
    department: { id: 'd1', name: 'Infra' },
    ...o,
  }) as never

describe('SatisfactionSurveyService.onTicketResolved', () => {
  beforeEach(() => {
    vi.mocked(Repo.findConfig).mockResolvedValue(
      ok(createFakeSurveyConfig({ trigger: 'TICKET_RESOLVED' })),
    )
    vi.mocked(Repo.existsForTicket).mockResolvedValue(ok(false))
  })

  it('invites by e-mail when the ticket has no WhatsApp chat', async () => {
    expectOk(await Service.onTicketResolved(ticket()))
    expect(Repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'EMAIL',
        recipientEmail: 'bia@acme.com',
        customerKey: 'customer:co1',
        customerName: 'Acme',
        teamName: 'Infra',
        ticketId: 'tk1',
      }),
    )
  })

  it('uses the requester e-mail and the contact as customer when needed', async () => {
    await Service.onTicketResolved(
      ticket({
        contact: null,
        company: null,
        customer: { id: 'cu', name: 'Cli', tradeName: null },
      }),
    )
    expect(Repo.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        recipientEmail: 'req@acme.com',
        customerKey: 'customer:cu',
        customerName: 'Cli',
      }),
    )
    await Service.onTicketResolved(
      ticket({
        company: null,
        requester: null,
        assignee: null,
        department: null,
      }),
    )
    expect(Repo.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        customerKey: 'contact:ct1',
        assigneeUserId: null,
      }),
    )
    await Service.onTicketResolved(ticket({ company: null, contact: null }))
    expect(Repo.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ customerKey: null }),
    )
  })

  it('prefers the ticket WhatsApp chat', async () => {
    vi.mocked(
      WhatsAppConversationRepository.findByIdWithConnection,
    ).mockResolvedValue(
      ok({
        workspaceId: 'ws',
        contactId: 'c1',
        connectionId: 'conn-sd',
      } as never),
    )
    vi.mocked(WhatsAppContactRepository.findById).mockResolvedValue(ok(contact))
    await Service.onTicketResolved(ticket({ whatsappConversationId: 'cv9' }))
    expect(Repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'WHATSAPP',
        connectionId: 'conn-sd',
        recipientEmail: 'bia@acme.com',
      }),
    )
  })

  it('drops the e-mail when fallback is off and WhatsApp is available', async () => {
    vi.mocked(Repo.findConfig).mockResolvedValue(
      ok(
        createFakeSurveyConfig({
          trigger: 'TICKET_RESOLVED',
          emailFallback: false,
        }),
      ),
    )
    vi.mocked(
      WhatsAppConversationRepository.findByIdWithConnection,
    ).mockResolvedValue(
      ok({
        workspaceId: 'ws',
        contactId: 'c1',
        connectionId: 'conn-sd',
      } as never),
    )
    vi.mocked(WhatsAppContactRepository.findById).mockResolvedValue(ok(contact))
    await Service.onTicketResolved(ticket({ whatsappConversationId: 'cv9' }))
    expect(Repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ recipientEmail: null }),
    )
    await Service.onTicketResolved(ticket())
    expect(Repo.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        recipientEmail: 'bia@acme.com',
        channel: 'EMAIL',
      }),
    )
  })

  it('ignores chats of another workspace, opted-out contacts and missing chats', async () => {
    vi.mocked(
      WhatsAppConversationRepository.findByIdWithConnection,
    ).mockResolvedValue(
      ok({ workspaceId: 'other', contactId: 'c1', connectionId: 'x' } as never),
    )
    await Service.onTicketResolved(ticket({ whatsappConversationId: 'cv9' }))
    expect(Repo.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ channel: 'EMAIL' }),
    )
    vi.mocked(
      WhatsAppConversationRepository.findByIdWithConnection,
    ).mockResolvedValue(
      ok({ workspaceId: 'ws', contactId: 'c1', connectionId: 'x' } as never),
    )
    vi.mocked(WhatsAppContactRepository.findById).mockResolvedValue(
      ok({ ...(contact as object), broadcastOptedOutAt: new Date() } as never),
    )
    await Service.onTicketResolved(ticket({ whatsappConversationId: 'cv9' }))
    expect(Repo.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ channel: 'EMAIL' }),
    )
    vi.mocked(
      WhatsAppConversationRepository.findByIdWithConnection,
    ).mockResolvedValue(ok(null))
    await Service.onTicketResolved(ticket({ whatsappConversationId: 'cv9' }))
    expect(Repo.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ channel: 'EMAIL' }),
    )
  })

  it('skips disabled rules, rated tickets and tickets already surveyed', async () => {
    vi.mocked(Repo.findConfig).mockResolvedValue(ok(null))
    expect(expectOk(await Service.onTicketResolved(ticket()))).toBeNull()
    vi.mocked(Repo.findConfig).mockResolvedValue(
      ok(createFakeSurveyConfig({ enabled: false })),
    )
    expect(expectOk(await Service.onTicketResolved(ticket()))).toBeNull()
    vi.mocked(Repo.findConfig).mockResolvedValue(ok(createFakeSurveyConfig()))
    expect(
      expectOk(await Service.onTicketResolved(ticket({ csatScore: 5 }))),
    ).toBeNull()
    vi.mocked(Repo.existsForTicket).mockResolvedValue(ok(true))
    expect(expectOk(await Service.onTicketResolved(ticket()))).toBeNull()
    vi.mocked(Repo.existsForTicket).mockResolvedValue(ok(false))
    expect(
      expectOk(
        await Service.onTicketResolved(
          ticket({ contact: null, requester: null }),
        ),
      ),
    ).toBeNull()
  })

  it('propagates database errors', async () => {
    vi.mocked(Repo.findConfig).mockResolvedValue(dbErr())
    expectErr(await Service.onTicketResolved(ticket()), 'DATABASE_ERROR')
    vi.mocked(Repo.findConfig).mockResolvedValue(ok(createFakeSurveyConfig()))
    vi.mocked(Repo.existsForTicket).mockResolvedValue(dbErr())
    expectErr(await Service.onTicketResolved(ticket()), 'DATABASE_ERROR')
    vi.mocked(Repo.existsForTicket).mockResolvedValue(ok(false))
    vi.mocked(
      WhatsAppConversationRepository.findByIdWithConnection,
    ).mockResolvedValue(dbErr())
    expectErr(
      await Service.onTicketResolved(ticket({ whatsappConversationId: 'cv9' })),
      'DATABASE_ERROR',
    )
    vi.mocked(
      WhatsAppConversationRepository.findByIdWithConnection,
    ).mockResolvedValue(
      ok({ workspaceId: 'ws', contactId: 'c1', connectionId: 'x' } as never),
    )
    vi.mocked(WhatsAppContactRepository.findById).mockResolvedValue(dbErr())
    expectErr(
      await Service.onTicketResolved(ticket({ whatsappConversationId: 'cv9' })),
      'DATABASE_ERROR',
    )
  })
})

describe('SatisfactionSurveyService.deliver', () => {
  const scheduled = (o = {}) => createFakeSurvey({ status: 'SCHEDULED', ...o })
  beforeEach(() => {
    vi.mocked(Repo.findConfig).mockResolvedValue(ok(createFakeSurveyConfig()))
    vi.mocked(WhatsAppConnectionRepository.findById).mockResolvedValue(
      ok(connection),
    )
    vi.mocked(SdTicketCsatRepository.findScore).mockResolvedValue(ok(null))
  })

  it('skips missing and already handled surveys', async () => {
    vi.mocked(Repo.findById).mockResolvedValue(ok(null))
    expect(expectOk(await Service.deliver('x'))).toBe('skipped')
    vi.mocked(Repo.findById).mockResolvedValue(
      ok(createFakeSurvey({ status: 'SENT' })),
    )
    expect(expectOk(await Service.deliver('x'))).toBe('skipped')
    vi.mocked(Repo.findById).mockResolvedValue(dbErr())
    expectErr(await Service.deliver('x'), 'DATABASE_ERROR')
  })

  it('skips an expired invitation', async () => {
    vi.mocked(Repo.findById).mockResolvedValue(
      ok(scheduled({ expiresAt: new Date(Date.now() - 1000) })),
    )
    expect(expectOk(await Service.deliver('x'))).toBe('skipped')
    expect(Repo.update).toHaveBeenCalledWith(expect.any(String), {
      status: 'SKIPPED',
      failureReason: 'expired',
    })
  })

  it('skips a ticket that got a portal rating meanwhile', async () => {
    vi.mocked(Repo.findById).mockResolvedValue(
      ok(scheduled({ ticketId: 'tk1' })),
    )
    vi.mocked(SdTicketCsatRepository.findScore).mockResolvedValue(ok(4))
    expect(expectOk(await Service.deliver('x'))).toBe('skipped')
    vi.mocked(SdTicketCsatRepository.findScore).mockResolvedValue(dbErr())
    expectErr(await Service.deliver('x'), 'DATABASE_ERROR')
  })

  it('reports a failure to mark the skip', async () => {
    vi.mocked(Repo.findById).mockResolvedValue(
      ok(scheduled({ expiresAt: new Date(Date.now() - 1000) })),
    )
    vi.mocked(Repo.update).mockResolvedValue(dbErr())
    expectErr(await Service.deliver('x'), 'DATABASE_ERROR')
  })

  it('sends CSAT as three reply buttons', async () => {
    vi.mocked(Repo.findById).mockResolvedValue(ok(scheduled()))
    expect(expectOk(await Service.deliver('x'))).toBe('sent')
    const input = vi.mocked(WhatsAppSend.buttons).mock.calls[0][1]
    expect(input.buttons.map((b) => b.id)).toEqual([
      expect.stringMatching(/:1$/),
      expect.stringMatching(/:3$/),
      expect.stringMatching(/:5$/),
    ])
    expect(Repo.update).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: 'SENT', providerMessageId: 'wamid' }),
    )
  })

  it('sends NPS as plain text with the custom question', async () => {
    vi.mocked(Repo.findById).mockResolvedValue(ok(scheduled({ kind: 'NPS' })))
    vi.mocked(Repo.findConfig).mockResolvedValue(
      ok(createFakeSurveyConfig({ questionText: 'Recomendaria?' })),
    )
    expect(expectOk(await Service.deliver('x'))).toBe('sent')
    expect(WhatsAppSend.text).toHaveBeenCalledWith(connection, {
      to: '5511999990000',
      text: 'Recomendaria?',
    })
  })

  it('falls back to e-mail when WhatsApp fails', async () => {
    vi.mocked(Repo.findById).mockResolvedValue(
      ok(scheduled({ recipientEmail: 'a@b.com' })),
    )
    vi.mocked(WhatsAppSend.buttons).mockResolvedValue(err(forbidden()) as never)
    expect(expectOk(await Service.deliver('x'))).toBe('fallback_email')
    expect(sendSurveyInvitationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'a@b.com',
        workspaceName: 'Acme',
        options: expect.arrayContaining([
          { label: '5', url: expect.stringContaining('/pesquisa/') },
        ]),
      }),
    )
    expect(Repo.update).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ channel: 'EMAIL', status: 'SENT' }),
    )
  })

  it('fails when WhatsApp fails and there is no fallback', async () => {
    vi.mocked(Repo.findById).mockResolvedValue(ok(scheduled()))
    vi.mocked(WhatsAppSend.buttons).mockResolvedValue(err(forbidden()) as never)
    expect(expectOk(await Service.deliver('x'))).toBe('failed')
    expect(Repo.update).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: 'FAILED', failureReason: 'FORBIDDEN' }),
    )
  })

  it('does not fall back when the rule disables it', async () => {
    vi.mocked(Repo.findById).mockResolvedValue(
      ok(scheduled({ recipientEmail: 'a@b.com' })),
    )
    vi.mocked(Repo.findConfig).mockResolvedValue(
      ok(createFakeSurveyConfig({ emailFallback: false })),
    )
    vi.mocked(WhatsAppConnectionRepository.findById).mockResolvedValue(
      ok({ ...(connection as object), status: 'DISCONNECTED' } as never),
    )
    expect(expectOk(await Service.deliver('x'))).toBe('failed')
    expect(Repo.update).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ failureReason: 'connection_unavailable' }),
    )
  })

  it('treats a missing connection as unavailable', async () => {
    vi.mocked(Repo.findById).mockResolvedValue(
      ok(scheduled({ connectionId: null })),
    )
    expect(expectOk(await Service.deliver('x'))).toBe('failed')
  })

  it('sends e-mail surveys and fails on mail errors or a missing address', async () => {
    vi.mocked(Repo.findById).mockResolvedValue(
      ok(
        scheduled({ channel: 'EMAIL', recipientEmail: 'a@b.com', kind: 'NPS' }),
      ),
    )
    expect(expectOk(await Service.deliver('x'))).toBe('sent')
    vi.mocked(sendSurveyInvitationEmail).mockRejectedValue(new Error('resend'))
    expect(expectOk(await Service.deliver('x'))).toBe('failed')
    vi.mocked(Repo.findById).mockResolvedValue(
      ok(scheduled({ channel: 'EMAIL', recipientEmail: null })),
    )
    expect(expectOk(await Service.deliver('x'))).toBe('failed')
  })

  it('uses a default workspace name when it cannot be read and propagates write errors', async () => {
    vi.mocked(Repo.findById).mockResolvedValue(
      ok(scheduled({ channel: 'EMAIL', recipientEmail: 'a@b.com' })),
    )
    vi.mocked(WorkspaceRepository.findById).mockResolvedValue(dbErr())
    await Service.deliver('x')
    expect(sendSurveyInvitationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceName: 'Steel' }),
    )
    vi.mocked(Repo.update).mockResolvedValue(dbErr())
    expectErr(await Service.deliver('x'), 'DATABASE_ERROR')
    vi.mocked(Repo.findById).mockResolvedValue(ok(scheduled()))
    expectErr(await Service.deliver('x'), 'DATABASE_ERROR')
    vi.mocked(WhatsAppSend.buttons).mockResolvedValue(err(forbidden()) as never)
    expectErr(await Service.deliver('x'), 'DATABASE_ERROR')
    vi.mocked(Repo.findConfig).mockResolvedValue(dbErr())
    expectErr(await Service.deliver('x'), 'DATABASE_ERROR')
  })

  it('reports a database failure when the e-mail step cannot be recorded', async () => {
    vi.mocked(Repo.findById).mockResolvedValue(
      ok(scheduled({ channel: 'EMAIL', recipientEmail: 'a@b.com' })),
    )
    vi.mocked(Repo.update).mockResolvedValue(dbErr())
    expectErr(await Service.deliver('x'), 'DATABASE_ERROR')
  })
})

describe('SatisfactionSurveyService.handleInbound', () => {
  const base = { workspaceId: 'ws', waId: '5511999990000' }
  beforeEach(() => {
    vi.mocked(Repo.answer).mockResolvedValue(ok(true))
    vi.mocked(Repo.findConfig).mockResolvedValue(ok(null))
    vi.mocked(WhatsAppConnectionRepository.findById).mockResolvedValue(
      ok(connection),
    )
  })

  it('records a button answer, thanks the contact and mirrors the ticket CSAT', async () => {
    const survey = createFakeSurvey({ id: 's1', ticketId: 'tk1', kind: 'CSAT' })
    vi.mocked(Repo.findById).mockResolvedValue(ok(survey))
    vi.mocked(SdTicketCsatRepository.submit).mockResolvedValue(ok(true))
    vi.mocked(Repo.findConfig).mockResolvedValue(
      ok(createFakeSurveyConfig({ thankYouText: 'Valeu!' })),
    )
    const result = expectOk(
      await Service.handleInbound({
        ...base,
        type: 'BUTTON',
        buttonPayload: 'stl:s:s1:5',
      }),
    )
    expect(result.handled).toBe(true)
    expect(Repo.answer).toHaveBeenCalledWith(
      's1',
      5,
      expect.any(Date),
      undefined,
    )
    expect(SdTicketCsatRepository.submit).toHaveBeenCalledWith(
      'tk1',
      'ws-1',
      5,
      null,
    )
    expect(WhatsAppSend.text).toHaveBeenCalledWith(
      connection,
      { to: '5511999990000', text: 'Valeu!' },
      { unmetered: true },
    )
  })

  it('survives a failing CSAT mirror and a failing thank-you', async () => {
    vi.mocked(Repo.findById).mockResolvedValue(
      ok(createFakeSurvey({ id: 's1', ticketId: 'tk1' })),
    )
    vi.mocked(SdTicketCsatRepository.submit).mockResolvedValue(dbErr())
    vi.mocked(WhatsAppSend.text).mockResolvedValue(err(forbidden()) as never)
    const result = expectOk(
      await Service.handleInbound({
        ...base,
        type: 'BUTTON',
        buttonPayload: 'stl:s:s1:3',
      }),
    )
    expect(result.handled).toBe(true)
  })

  it('ignores a payload of someone else or an unknown survey', async () => {
    vi.mocked(Repo.findById).mockResolvedValue(
      ok(createFakeSurvey({ recipientPhone: '999' })),
    )
    expect(
      expectOk(
        await Service.handleInbound({
          ...base,
          type: 'BUTTON',
          buttonPayload: 'stl:s:s1:5',
        }),
      ).handled,
    ).toBe(false)
    vi.mocked(Repo.findById).mockResolvedValue(ok(null))
    expect(
      expectOk(
        await Service.handleInbound({
          ...base,
          type: 'BUTTON',
          buttonPayload: 'stl:s:s1:5',
        }),
      ).handled,
    ).toBe(false)
    vi.mocked(Repo.findById).mockResolvedValue(dbErr())
    expectErr(
      await Service.handleInbound({
        ...base,
        type: 'BUTTON',
        buttonPayload: 'stl:s:s1:5',
      }),
      'DATABASE_ERROR',
    )
  })

  it('swallows a stale click without recording', async () => {
    vi.mocked(Repo.findById).mockResolvedValue(
      ok(createFakeSurvey({ id: 's1', status: 'ANSWERED' })),
    )
    const result = expectOk(
      await Service.handleInbound({
        ...base,
        type: 'BUTTON',
        buttonPayload: 'stl:s:s1:5',
      }),
    )
    expect(result.handled).toBe(true)
    expect(Repo.answer).not.toHaveBeenCalled()
    vi.mocked(Repo.findById).mockResolvedValue(
      ok(createFakeSurvey({ id: 's1' })),
    )
    await Service.handleInbound({
      ...base,
      type: 'BUTTON',
      buttonPayload: 'stl:s:s1:9',
    })
    expect(Repo.answer).not.toHaveBeenCalled()
  })

  it('does not thank or mirror when the answer lost the race', async () => {
    vi.mocked(Repo.findById).mockResolvedValue(
      ok(createFakeSurvey({ id: 's1' })),
    )
    vi.mocked(Repo.answer).mockResolvedValue(ok(false))
    await Service.handleInbound({
      ...base,
      type: 'BUTTON',
      buttonPayload: 'stl:s:s1:5',
    })
    expect(WhatsAppSend.text).not.toHaveBeenCalled()
    vi.mocked(Repo.answer).mockResolvedValue(dbErr())
    expectErr(
      await Service.handleInbound({
        ...base,
        type: 'BUTTON',
        buttonPayload: 'stl:s:s1:5',
      }),
      'DATABASE_ERROR',
    )
  })

  it('accepts a typed number for the open survey', async () => {
    vi.mocked(Repo.findOpenByPhone).mockResolvedValue(
      ok(createFakeSurvey({ id: 's2', kind: 'NPS' })),
    )
    const result = expectOk(
      await Service.handleInbound({ ...base, type: 'TEXT', text: ' 9 ' }),
    )
    expect(result.handled).toBe(true)
    expect(Repo.answer).toHaveBeenCalledWith(
      's2',
      9,
      expect.any(Date),
      undefined,
    )
  })

  it('leaves normal text and out-of-scale numbers to the conversation', async () => {
    vi.mocked(Repo.findOpenByPhone).mockResolvedValue(
      ok(createFakeSurvey({ kind: 'CSAT' })),
    )
    expect(
      expectOk(
        await Service.handleInbound({ ...base, type: 'TEXT', text: 'olá' }),
      ).handled,
    ).toBe(false)
    expect(
      expectOk(
        await Service.handleInbound({ ...base, type: 'TEXT', text: '9' }),
      ).handled,
    ).toBe(false)
    expect(
      expectOk(await Service.handleInbound({ ...base, type: 'IMAGE' })).handled,
    ).toBe(false)
    expect(
      expectOk(
        await Service.handleInbound({ ...base, type: 'TEXT', text: '  ' }),
      ).handled,
    ).toBe(false)
    vi.mocked(Repo.findOpenByPhone).mockResolvedValue(dbErr())
    expectErr(
      await Service.handleInbound({ ...base, type: 'TEXT', text: '4' }),
      'DATABASE_ERROR',
    )
  })

  it('stores the follow-up comment and copies it to the ticket', async () => {
    vi.mocked(Repo.findOpenByPhone).mockResolvedValue(ok(null))
    vi.mocked(Repo.findAwaitingComment).mockResolvedValue(
      ok(createFakeSurvey({ id: 's3', status: 'ANSWERED', ticketId: 'tk1' })),
    )
    vi.mocked(Repo.setComment).mockResolvedValue(ok(true))
    vi.mocked(SdTicketCsatRepository.setComment).mockResolvedValue(ok(true))
    const result = expectOk(
      await Service.handleInbound({
        ...base,
        type: 'TEXT',
        text: 'Atendimento rápido',
      }),
    )
    expect(result.handled).toBe(true)
    expect(Repo.setComment).toHaveBeenCalledWith('s3', 'Atendimento rápido')
    expect(SdTicketCsatRepository.setComment).toHaveBeenCalledWith(
      'tk1',
      'ws-1',
      'Atendimento rápido',
    )
  })

  it('lets the text through when no survey awaits a comment', async () => {
    vi.mocked(Repo.findOpenByPhone).mockResolvedValue(ok(null))
    vi.mocked(Repo.findAwaitingComment).mockResolvedValue(ok(null))
    expect(
      expectOk(
        await Service.handleInbound({ ...base, type: 'TEXT', text: 'oi' }),
      ).handled,
    ).toBe(false)
    vi.mocked(Repo.findAwaitingComment).mockResolvedValue(dbErr())
    expectErr(
      await Service.handleInbound({ ...base, type: 'TEXT', text: 'oi' }),
      'DATABASE_ERROR',
    )
    vi.mocked(Repo.findAwaitingComment).mockResolvedValue(
      ok(createFakeSurvey({ status: 'ANSWERED' })),
    )
    vi.mocked(Repo.setComment).mockResolvedValue(ok(false))
    expect(
      expectOk(
        await Service.handleInbound({ ...base, type: 'TEXT', text: 'oi' }),
      ).handled,
    ).toBe(false)
    vi.mocked(Repo.setComment).mockResolvedValue(dbErr())
    expectErr(
      await Service.handleInbound({ ...base, type: 'TEXT', text: 'oi' }),
      'DATABASE_ERROR',
    )
  })
})

describe('SatisfactionSurveyService public e-mail flow', () => {
  const emailSurvey = (o = {}) => ({
    ...createFakeSurvey({
      channel: 'EMAIL',
      status: 'SENT',
      kind: 'NPS',
      ...o,
    }),
    workspaceName: 'Acme',
  })
  beforeEach(() => {
    vi.mocked(Repo.findConfig).mockResolvedValue(ok(null))
  })

  it('shows an open survey with its scale', async () => {
    vi.mocked(Repo.findByToken).mockResolvedValue(ok(emailSurvey()))
    const dto = expectOk(await Service.getPublic('t'))
    expect(dto).toMatchObject({
      state: 'OPEN',
      scaleMin: 0,
      scaleMax: 10,
      workspaceName: 'Acme',
    })
  })

  it('reports answered and expired states', async () => {
    vi.mocked(Repo.findByToken).mockResolvedValue(
      ok(emailSurvey({ status: 'ANSWERED' })),
    )
    expect(expectOk(await Service.getPublic('t')).state).toBe('ANSWERED')
    vi.mocked(Repo.findByToken).mockResolvedValue(
      ok(emailSurvey({ expiresAt: new Date(Date.now() - 1) })),
    )
    expect(expectOk(await Service.getPublic('t')).state).toBe('EXPIRED')
    vi.mocked(Repo.findByToken).mockResolvedValue(
      ok(emailSurvey({ status: 'FAILED' })),
    )
    expect(expectOk(await Service.getPublic('t')).state).toBe('EXPIRED')
  })

  it('hides unknown, WhatsApp-only and unsent surveys', async () => {
    vi.mocked(Repo.findByToken).mockResolvedValue(ok(null))
    expectErr(await Service.getPublic('t'), 'SURVEY_NOT_FOUND')
    vi.mocked(Repo.findByToken).mockResolvedValue(
      ok(emailSurvey({ channel: 'WHATSAPP' })),
    )
    expectErr(await Service.getPublic('t'), 'SURVEY_NOT_FOUND')
    vi.mocked(Repo.findByToken).mockResolvedValue(
      ok(emailSurvey({ status: 'SCHEDULED' })),
    )
    expectErr(await Service.getPublic('t'), 'SURVEY_NOT_FOUND')
    vi.mocked(Repo.findByToken).mockResolvedValue(dbErr())
    expectErr(await Service.getPublic('t'), 'DATABASE_ERROR')
    vi.mocked(Repo.findByToken).mockResolvedValue(ok(emailSurvey()))
    vi.mocked(Repo.findConfig).mockResolvedValue(dbErr())
    expectErr(await Service.getPublic('t'), 'DATABASE_ERROR')
  })

  it('records a public answer with its comment', async () => {
    vi.mocked(Repo.findByToken).mockResolvedValue(ok(emailSurvey({ id: 's9' })))
    vi.mocked(Repo.answer).mockResolvedValue(ok(true))
    expect(
      expectOk(await Service.answerPublic('t', { score: 10, comment: 'top' }))
        .answered,
    ).toBe(true)
    expect(Repo.answer).toHaveBeenCalledWith('s9', 10, expect.any(Date), 'top')
    expect(WhatsAppSend.text).not.toHaveBeenCalled()
  })

  it('rejects invalid, repeated and late answers', async () => {
    vi.mocked(Repo.findByToken).mockResolvedValue(
      ok(emailSurvey({ kind: 'CSAT' })),
    )
    expectErr(
      await Service.answerPublic('t', { score: 9 }),
      'SURVEY_INVALID_SCORE',
    )
    vi.mocked(Repo.findByToken).mockResolvedValue(
      ok(emailSurvey({ status: 'ANSWERED' })),
    )
    expectErr(
      await Service.answerPublic('t', { score: 9 }),
      'SURVEY_ALREADY_ANSWERED',
    )
    vi.mocked(Repo.findByToken).mockResolvedValue(
      ok(emailSurvey({ expiresAt: new Date(Date.now() - 1) })),
    )
    expectErr(await Service.answerPublic('t', { score: 9 }), 'SURVEY_EXPIRED')
    vi.mocked(Repo.findByToken).mockResolvedValue(ok(null))
    expectErr(await Service.answerPublic('t', { score: 9 }), 'SURVEY_NOT_FOUND')
    vi.mocked(Repo.findByToken).mockResolvedValue(dbErr())
    expectErr(await Service.answerPublic('t', { score: 9 }), 'DATABASE_ERROR')
  })

  it('reports a lost race as already answered and propagates write errors', async () => {
    vi.mocked(Repo.findByToken).mockResolvedValue(ok(emailSurvey()))
    vi.mocked(Repo.answer).mockResolvedValue(ok(false))
    expectErr(
      await Service.answerPublic('t', { score: 9 }),
      'SURVEY_ALREADY_ANSWERED',
    )
    vi.mocked(Repo.answer).mockResolvedValue(dbErr())
    expectErr(await Service.answerPublic('t', { score: 9 }), 'DATABASE_ERROR')
  })
})
