import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSdTicket } from '@/src/__tests__/factories/sd-ticket.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { createFakeWhatsAppTemplate } from '@/src/__tests__/factories/whatsapp-template.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, moduleDisabled } from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import { DEFAULT_SD_TICKET_PREFIXES } from '@/src/lib/servicedesk/ticket-code'

vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/lib/whatsapp/send', () => ({
  WhatsAppSend: { template: vi.fn(), text: vi.fn() },
}))
vi.mock('@/src/repositories/crm-retention.repository')
vi.mock('@/src/repositories/crm-task.repository')
vi.mock('@/src/repositories/cross-engine-whatsapp.repository')
vi.mock('@/src/repositories/sd-whatsapp.repository')
vi.mock('../authz', () => ({ assertModuleEnabled: vi.fn() }))
vi.mock('../crm-lead.service', () => ({ CrmLeadService: { intake: vi.fn() } }))
vi.mock('../sd-automation-engine', () => ({ fireSdAutomations: vi.fn() }))
vi.mock('../sd-contact.service', () => ({
  SdContactService: { findByChannel: vi.fn() },
}))
vi.mock('../sd-ticket-engine', async (orig) => ({
  ...(await orig<typeof import('../sd-ticket-engine')>()),
  SdTicketEngine: { loadConfig: vi.fn(), create: vi.fn() },
}))
vi.mock('../whatsapp-opt-out', async (orig) => ({
  ...(await orig<typeof import('../whatsapp-opt-out')>()),
  checkWhatsAppOptOut: vi.fn(),
}))

import { auditMutation } from '@/lib/axiom/audit'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { CrmRetentionRepository } from '@/src/repositories/crm-retention.repository'
import { CrmTaskRepository } from '@/src/repositories/crm-task.repository'
import { CrossEngineWhatsappRepository } from '@/src/repositories/cross-engine-whatsapp.repository'
import { SdWhatsappRepository } from '@/src/repositories/sd-whatsapp.repository'
import { assertModuleEnabled } from '../authz'
import { CrmLeadService } from '../crm-lead.service'
import { CrossEngineActions } from '../cross-engine-actions.service'
import { fireSdAutomations } from '../sd-automation-engine'
import { SdContactService } from '../sd-contact.service'
import { SdTicketEngine } from '../sd-ticket-engine'
import { checkWhatsAppOptOut } from '../whatsapp-opt-out'

const repo = vi.mocked(CrossEngineWhatsappRepository)
const retention = vi.mocked(CrmRetentionRepository)
const taskRepo = vi.mocked(CrmTaskRepository)
const sdWhatsapp = vi.mocked(SdWhatsappRepository)
const sendTemplate = vi.mocked(WhatsAppSend.template)
const sendText = vi.mocked(WhatsAppSend.text)
const optOut = vi.mocked(checkWhatsAppOptOut)
const moduleEnabled = vi.mocked(assertModuleEnabled)
const intake = vi.mocked(CrmLeadService.intake)
const findContact = vi.mocked(SdContactService.findByChannel)
const engine = vi.mocked(SdTicketEngine)
const fire = vi.mocked(fireSdAutomations)

const WS = 'ws1'
const metaConnection = createFakeWhatsAppConnection({
  id: 'c1',
  provider: 'META',
  status: 'CONNECTED',
})
const zapiConnection = createFakeWhatsAppConnection({
  id: 'c2',
  provider: 'ZAPI',
  status: 'CONNECTED',
})
const approved = createFakeWhatsAppTemplate({
  id: 'tpl1',
  name: 'aviso',
  language: 'pt_BR',
  category: 'UTILITY',
  status: 'APPROVED',
  components: [],
  buttons: null,
  headerFormat: null,
  headerMediaUrl: null,
})
const config = {
  settings: {} as never,
  prefixes: DEFAULT_SD_TICKET_PREFIXES,
}

function send(overrides = {}) {
  return CrossEngineActions.sendWhatsApp({
    workspaceId: WS,
    source: 'crm_workflow',
    refId: 'run1',
    connectionId: 'c1',
    phone: '(11) 91234-5678',
    templateId: 'tpl1',
    variables: ['Ana'],
    ...overrides,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  repo.findConnection.mockResolvedValue(ok(metaConnection))
  repo.findTemplate.mockResolvedValue(ok(approved))
  repo.lastInboundAt.mockResolvedValue(ok(null))
  optOut.mockResolvedValue('allowed')
  sendTemplate.mockResolvedValue(ok({ providerMessageId: 'wamid.1' } as never))
  sendText.mockResolvedValue(ok({ providerMessageId: 'wamid.2' } as never))
  moduleEnabled.mockResolvedValue(ok(true))
  engine.loadConfig.mockResolvedValue(ok(config))
  findContact.mockResolvedValue(ok(null))
  retention.findFallbackUserId.mockResolvedValue(ok('admin1'))
})

describe('CrossEngineActions.sendWhatsApp', () => {
  it('sends an approved template with the body variables', async () => {
    const outcome = expectOk(await send())
    expect(outcome).toEqual({
      status: 'sent',
      providerMessageId: 'wamid.1',
      mode: 'template',
    })
    expect(optOut).toHaveBeenCalledWith(WS, '5511912345678')
    expect(sendTemplate).toHaveBeenCalledWith(
      metaConnection,
      expect.objectContaining({
        to: '5511912345678',
        templateName: 'aviso',
        language: 'pt_BR',
        components: [
          { type: 'body', parameters: [{ type: 'text', text: 'Ana' }] },
        ],
      }),
      expect.anything(),
    )
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'whatsapp_message', actorId: null }),
    )
  })

  it('rejects an invalid phone before touching the database', async () => {
    expectErr(await send({ phone: '123' }), 'VALIDATION_ERROR')
    expect(repo.findConnection).not.toHaveBeenCalled()
  })

  it('fails when the connection is missing, disconnected or unreadable', async () => {
    repo.findConnection.mockResolvedValueOnce(ok(null))
    expectErr(await send(), 'WHATSAPP_CONNECTION_NOT_FOUND')
    repo.findConnection.mockResolvedValueOnce(
      ok({ ...metaConnection, status: 'DISCONNECTED' }),
    )
    expectErr(await send(), 'VALIDATION_ERROR')
    repo.findConnection.mockResolvedValueOnce(err(databaseError()))
    expectErr(await send(), 'DATABASE_ERROR')
  })

  it('skips a contact that opted out without sending', async () => {
    optOut.mockResolvedValue('opted_out')
    const outcome = expectOk(await send())
    expect(outcome).toMatchObject({ status: 'skipped', reason: 'opted_out' })
    expect(sendTemplate).not.toHaveBeenCalled()
    expect(sendText).not.toHaveBeenCalled()
  })

  it('skips when the opt-out could not be verified', async () => {
    optOut.mockResolvedValue('unverified')
    expect(expectOk(await send())).toMatchObject({
      status: 'skipped',
      reason: 'opt_out_unverified',
    })
  })

  it('skips when the template is not approved and the window is closed', async () => {
    repo.findTemplate.mockResolvedValue(
      ok({ ...approved, status: 'PENDING' } as never),
    )
    expect(expectOk(await send())).toMatchObject({
      status: 'skipped',
      reason: 'template_unavailable',
    })
  })

  it('sends free text on Meta only inside the 24 h window', async () => {
    const base = { templateId: null, text: 'Olá!' }
    repo.lastInboundAt.mockResolvedValueOnce(ok(new Date()))
    expect(expectOk(await send(base))).toMatchObject({
      status: 'sent',
      mode: 'text',
    })
    expect(sendText).toHaveBeenCalledWith(
      metaConnection,
      { to: '5511912345678', text: 'Olá!' },
      expect.anything(),
    )
    repo.lastInboundAt.mockResolvedValueOnce(ok(null))
    expect(expectOk(await send(base))).toMatchObject({
      status: 'skipped',
      reason: 'window_closed',
    })
    repo.lastInboundAt.mockResolvedValueOnce(err(databaseError()))
    expectErr(await send(base), 'DATABASE_ERROR')
  })

  it('sends text on Z-API without looking at templates or the window', async () => {
    repo.findConnection.mockResolvedValue(ok(zapiConnection))
    const outcome = expectOk(
      await send({ connectionId: 'c2', templateId: null, text: ' Oi ' }),
    )
    expect(outcome).toMatchObject({ status: 'sent', mode: 'text' })
    expect(repo.findTemplate).not.toHaveBeenCalled()
    expect(repo.lastInboundAt).not.toHaveBeenCalled()
  })

  it('propagates template lookup and provider failures', async () => {
    repo.findTemplate.mockResolvedValueOnce(err(databaseError()))
    expectErr(await send(), 'DATABASE_ERROR')
    sendTemplate.mockResolvedValueOnce(err(databaseError()))
    expectErr(await send(), 'DATABASE_ERROR')
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failure' }),
    )
  })
})

describe('CrossEngineActions.openTicket', () => {
  const base = {
    workspaceId: WS,
    source: 'chatbot' as const,
    refId: 'bot1',
    type: 'INCIDENT' as const,
    title: 'Sem internet',
    description: 'Linha 1\n\nLinha 2',
    phone: '11 91234-5678',
  }
  const ticket = createFakeSdTicket({ id: 't1', number: 7, type: 'INCIDENT' })

  beforeEach(() => {
    engine.create.mockResolvedValue(ok(ticket))
    sdWhatsapp.findOpenTicket.mockResolvedValue(ok(null))
    sdWhatsapp.setTicketConversation.mockResolvedValue(ok(undefined))
  })

  it('opens the ticket as the system, links the conversation and fires automations', async () => {
    findContact.mockResolvedValue(
      ok({
        id: 'ct1',
        userId: 'u9',
        customers: [{ kind: 'CLIENT', id: 'cu1' }],
      } as never),
    )
    const outcome = expectOk(
      await CrossEngineActions.openTicket({
        ...base,
        whatsappConversationId: 'conv1',
      }),
    )
    expect(outcome).toEqual({
      ticketId: 't1',
      code: 'INC-000007',
      reused: false,
    })
    expect(engine.create).toHaveBeenCalledWith(
      WS,
      expect.objectContaining({
        type: 'INCIDENT',
        channel: 'WHATSAPP',
        contactId: 'ct1',
        customerId: 'cu1',
        requesterId: 'u9',
        description: '<p>Linha 1</p><p>Linha 2</p>',
      }),
      { kind: 'system', source: 'cross-engine:chatbot' },
      config,
    )
    expect(sdWhatsapp.setTicketConversation).toHaveBeenCalledWith('t1', 'conv1')
    expect(fire).toHaveBeenCalledWith('TICKET_CREATED', 't1')
  })

  it('attaches a company contact and uses the API channel outside the chatbot', async () => {
    findContact.mockResolvedValue(
      ok({
        id: 'ct1',
        userId: null,
        customers: [{ kind: 'COMPANY', id: 'co1' }],
      } as never),
    )
    expectOk(
      await CrossEngineActions.openTicket({
        ...base,
        source: 'crm_workflow',
        description: null,
        phone: null,
        email: 'ana@acme.com.br',
      }),
    )
    expect(engine.create).toHaveBeenCalledWith(
      WS,
      expect.objectContaining({
        channel: 'API',
        companyId: 'co1',
        description: undefined,
      }),
      expect.anything(),
      config,
    )
  })

  it('opens without a contact when the lookup fails or finds nobody', async () => {
    findContact.mockResolvedValueOnce(err(databaseError()))
    expectOk(await CrossEngineActions.openTicket(base))
    expect(engine.create).toHaveBeenCalledWith(
      WS,
      expect.objectContaining({ contactId: undefined }),
      expect.anything(),
      config,
    )
    findContact.mockResolvedValueOnce(ok(null))
    expectOk(
      await CrossEngineActions.openTicket({
        ...base,
        phone: null,
        email: null,
      }),
    )
    expect(findContact).toHaveBeenCalledTimes(1)
  })

  it('reuses the open ticket of the conversation (retried bot step)', async () => {
    sdWhatsapp.findOpenTicket.mockResolvedValue(
      ok({ id: 't0', number: 3, type: 'INCIDENT' } as never),
    )
    const outcome = expectOk(
      await CrossEngineActions.openTicket({
        ...base,
        whatsappConversationId: 'conv1',
      }),
    )
    expect(outcome).toEqual({
      ticketId: 't0',
      code: 'INC-000003',
      reused: true,
    })
    expect(engine.create).not.toHaveBeenCalled()
  })

  it('propagates module, config, lookup, create and link failures', async () => {
    moduleEnabled.mockResolvedValueOnce(err(moduleDisabled()))
    expectErr(await CrossEngineActions.openTicket(base), 'MODULE_DISABLED')
    engine.loadConfig.mockResolvedValueOnce(err(databaseError()))
    expectErr(await CrossEngineActions.openTicket(base), 'DATABASE_ERROR')
    sdWhatsapp.findOpenTicket.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await CrossEngineActions.openTicket({
        ...base,
        whatsappConversationId: 'conv1',
      }),
      'DATABASE_ERROR',
    )
    engine.create.mockResolvedValueOnce(err(databaseError()))
    expectErr(await CrossEngineActions.openTicket(base), 'DATABASE_ERROR')
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failure' }),
    )
    sdWhatsapp.setTicketConversation.mockResolvedValueOnce(err(databaseError()))
    expectOk(
      await CrossEngineActions.openTicket({
        ...base,
        whatsappConversationId: 'conv1',
      }),
    )
  })
})

describe('CrossEngineActions.createLead', () => {
  const base = {
    workspaceId: WS,
    source: 'sd_automation' as const,
    refId: 'rule1',
    name: 'Ana',
    phone: '11 91234-5678',
    email: ' ana@acme.com.br ',
    company: ' Acme ',
    origin: 'ServiceDesk',
  }

  beforeEach(() => {
    intake.mockResolvedValue(ok({ lead: { id: 'l1' } as never, created: true }))
  })

  it('creates the lead through the CRM intake as a system actor', async () => {
    const outcome = expectOk(
      await CrossEngineActions.createLead({ ...base, authorId: 'u1' }),
    )
    expect(outcome).toEqual({ leadId: 'l1', created: true })
    expect(intake).toHaveBeenCalledWith(
      WS,
      {
        kind: 'system',
        createdById: 'u1',
        via: 'sd_automation',
        refId: 'rule1',
      },
      expect.objectContaining({
        name: 'Ana',
        phones: ['5511912345678'],
        emails: ['ana@acme.com.br'],
        company: 'Acme',
        source: 'ServiceDesk',
      }),
    )
  })

  it('falls back to an admin, tags the chatbot channel and reports a reused lead', async () => {
    intake.mockResolvedValue(
      ok({ lead: { id: 'l9' } as never, created: false }),
    )
    const outcome = expectOk(
      await CrossEngineActions.createLead({
        ...base,
        source: 'chatbot',
        name: ' ',
        email: null,
        company: null,
      }),
    )
    expect(outcome).toEqual({ leadId: 'l9', created: false })
    expect(intake).toHaveBeenCalledWith(
      WS,
      expect.objectContaining({
        createdById: 'admin1',
        via: 'whatsapp_chatbot',
      }),
      expect.objectContaining({
        name: '5511912345678',
        emails: [],
        channel: 'WhatsApp',
      }),
    )
  })

  it('needs a valid phone or e-mail and an author', async () => {
    expectErr(
      await CrossEngineActions.createLead({
        ...base,
        phone: 'abc',
        email: null,
      }),
      'VALIDATION_ERROR',
    )
    retention.findFallbackUserId.mockResolvedValueOnce(ok(null))
    expectErr(await CrossEngineActions.createLead(base), 'VALIDATION_ERROR')
    retention.findFallbackUserId.mockResolvedValueOnce(err(databaseError()))
    expectErr(await CrossEngineActions.createLead(base), 'DATABASE_ERROR')
    intake.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await CrossEngineActions.createLead({ ...base, authorId: 'u1' }),
      'DATABASE_ERROR',
    )
  })
})

describe('CrossEngineActions.createCrmTask', () => {
  const base = {
    workspaceId: WS,
    source: 'sd_automation' as const,
    refId: 'rule1',
    title: 'Ligar',
  }

  beforeEach(() => {
    taskRepo.create.mockResolvedValue(ok({ id: 'task1' } as never))
  })

  it('creates the task without firing CRM workflows', async () => {
    const outcome = expectOk(
      await CrossEngineActions.createCrmTask({
        ...base,
        authorId: 'u1',
        body: 'corpo',
        assigneeId: 'u2',
        dueInMinutes: 60,
        personId: 'p1',
        companyId: 'co1',
        opportunityId: 'o1',
      }),
    )
    expect(outcome).toEqual({ taskId: 'task1' })
    const call = taskRepo.create.mock.calls[0][0]
    expect(call).toMatchObject({
      workspaceId: WS,
      createdById: 'u1',
      assigneeId: 'u2',
      personId: 'p1',
      companyId: 'co1',
      opportunityId: 'o1',
    })
    expect(call.dueDate).toBeInstanceOf(Date)
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'crm_task', targetId: 'task1' }),
    )
  })

  it('uses the admin fallback and leaves optional fields empty', async () => {
    expectOk(await CrossEngineActions.createCrmTask(base))
    expect(taskRepo.create.mock.calls[0][0]).toMatchObject({
      createdById: 'admin1',
      body: undefined,
      dueDate: undefined,
      assigneeId: undefined,
    })
  })

  it('propagates module, author and database failures', async () => {
    moduleEnabled.mockResolvedValueOnce(err(moduleDisabled()))
    expectErr(await CrossEngineActions.createCrmTask(base), 'MODULE_DISABLED')
    retention.findFallbackUserId.mockResolvedValueOnce(ok(null))
    expectErr(await CrossEngineActions.createCrmTask(base), 'VALIDATION_ERROR')
    retention.findFallbackUserId.mockResolvedValueOnce(err(databaseError()))
    expectErr(await CrossEngineActions.createCrmTask(base), 'DATABASE_ERROR')
    taskRepo.create.mockResolvedValueOnce(err(databaseError()))
    expectErr(await CrossEngineActions.createCrmTask(base), 'DATABASE_ERROR')
  })
})
