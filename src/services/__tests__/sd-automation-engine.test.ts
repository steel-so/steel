import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeSdEscalation,
  createFakeSdTicket,
} from '@/src/__tests__/factories/sd-ticket.factory'
import {
  createFakeSdAutomationRule,
  createFakeSdSettings,
  createFakeSdTemplate,
} from '@/src/__tests__/factories/sd-ticket-context.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, validationError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import { DEFAULT_SD_TICKET_PREFIXES } from '@/src/lib/servicedesk/ticket-code'
import type { SdTicketWithRelations } from '@/src/repositories/sd-ticket.repository'

vi.mock('@/src/repositories/sd-ticket.repository')
vi.mock('@/src/repositories/sd-ticket-context.repository')
vi.mock('@/src/repositories/sd-automation.repository')
vi.mock('@/src/repositories/cross-engine-whatsapp.repository')
const { crossEngine } = vi.hoisted(() => ({
  crossEngine: {
    sendWhatsApp: vi.fn(),
    createCrmTask: vi.fn(),
    createLead: vi.fn(),
  },
}))
vi.mock('@/src/services/cross-engine-actions.service', () => ({
  CrossEngineActions: crossEngine,
}))
vi.mock('@/src/lib/servicedesk/realtime')
vi.mock('@/src/services/sd-notification.service', () => ({
  notifySdEvent: vi.fn(async () => ({ ok: true, value: {} })),
}))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/services/sd-ticket-event-recorder', async (orig) => ({
  ...(await orig<typeof import('../sd-ticket-event-recorder')>()),
  recordSdTicketEvent: vi.fn(async () => ({ ok: true, value: 1 })),
}))
vi.mock('@/src/services/sd-ticket-engine', async (orig) => ({
  ...(await orig<typeof import('../sd-ticket-engine')>()),
  SdTicketEngine: {
    update: vi.fn(),
    changePhase: vi.fn(),
    roundRobin: vi.fn(),
    loadConfig: vi.fn(),
  },
}))
vi.mock('@/src/services/sd-ticket-escalator', () => ({
  escalateSdTicket: vi.fn(),
}))
vi.mock('@/src/services/sd-ticket-participant.service', () => ({
  addSdTicketParticipant: vi.fn(),
}))

import type { SdAutomationEvent, SdAutomationRule } from '@prisma/client'
import { logger } from '@/lib/axiom/logger'
import { createFakeSdNotifyOutcome } from '@/src/__tests__/factories/sd-notification.factory'
import { publishSdTicketEvent } from '@/src/lib/servicedesk/realtime'
import { CrossEngineWhatsappRepository } from '@/src/repositories/cross-engine-whatsapp.repository'
import { SdAutomationRepository } from '@/src/repositories/sd-automation.repository'
import { SdTicketRepository } from '@/src/repositories/sd-ticket.repository'
import { SdTicketContextRepository } from '@/src/repositories/sd-ticket-context.repository'
import { fireSdAutomations, runSdAutomations } from '../sd-automation-engine'
import { notifySdEvent } from '../sd-notification.service'
import { SdTicketEngine } from '../sd-ticket-engine'
import { escalateSdTicket } from '../sd-ticket-escalator'
import { recordSdTicketEvent } from '../sd-ticket-event-recorder'
import { addSdTicketParticipant } from '../sd-ticket-participant.service'

const ticketRepo = vi.mocked(SdTicketRepository)
const ctxRepo = vi.mocked(SdTicketContextRepository)
const autoRepo = vi.mocked(SdAutomationRepository)
const crossRepo = vi.mocked(CrossEngineWhatsappRepository)
const engine = vi.mocked(SdTicketEngine)
const escalate = vi.mocked(escalateSdTicket)
const addParticipant = vi.mocked(addSdTicketParticipant)
const notify = vi.mocked(notifySdEvent)
const record = vi.mocked(recordSdTicketEvent)
const publish = vi.mocked(publishSdTicketEvent)

const NOW = new Date('2026-09-21T12:00:00.000Z')
const config = {
  settings: createFakeSdSettings(),
  prefixes: DEFAULT_SD_TICKET_PREFIXES,
}

let current: SdTicketWithRelations

function rules(...list: SdAutomationRule[]) {
  autoRepo.listActiveRules.mockResolvedValue(ok(list))
}

function rule(actions: unknown[], overrides: Partial<SdAutomationRule> = {}) {
  return createFakeSdAutomationRule({
    id: 'r1',
    name: 'R1',
    actions: actions as never,
    ...overrides,
  })
}

async function run(
  event: SdAutomationEvent = 'TICKET_CREATED',
  actorId?: string,
) {
  return runSdAutomations(event, current.id, { actorId })
}

const applied = () =>
  record.mock.calls
    .map((c) => c[0] as { action: string; meta?: Record<string, unknown> })
    .filter((e) => e.action.startsWith('automation.'))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  current = createFakeSdTicket({
    id: 't1',
    departmentId: 'd1',
    assigneeId: 'a1',
    requesterId: 'r1',
  })
  ticketRepo.findByIdUnscoped.mockImplementation(async () => ok(current))
  ticketRepo.findById.mockImplementation(async () => ok(current))
  engine.loadConfig.mockResolvedValue(ok(config))
  const apply = async (t: SdTicketWithRelations, changes: object) =>
    ok(createFakeSdTicket({ ...t, ...changes }))
  engine.update.mockImplementation(apply as never)
  engine.changePhase.mockImplementation(async (t, phaseId) =>
    ok(createFakeSdTicket({ ...t, phaseId })),
  )
  engine.roundRobin.mockImplementation(async (t) => ok(t))
  addParticipant.mockImplementation(async (t) => ok(t))
  escalate.mockImplementation(async (t) =>
    ok({
      ticket: createFakeSdTicket({ ...t, escalationLevel: 1 }),
      escalation: createFakeSdEscalation(),
    }),
  )
  autoRepo.markRun.mockResolvedValue(ok(undefined))
  autoRepo.insertSystemMessage.mockResolvedValue(ok({ id: 'm1' }))
  autoRepo.insertTasks.mockResolvedValue(ok(1))
  ctxRepo.listDepartmentLeadIds.mockResolvedValue(ok(['lead']))
  ctxRepo.findWorkspaceOwnerId.mockResolvedValue(ok('owner'))
  notify.mockResolvedValue(ok(createFakeSdNotifyOutcome()))
  record.mockResolvedValue(ok(1))
  publish.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('runSdAutomations — orchestration', () => {
  it('returns early without rules and propagates load errors', async () => {
    rules()
    expect(expectOk(await run())).toEqual({ matched: 0, rules: [] })
    expect(engine.loadConfig).not.toHaveBeenCalled()
    ticketRepo.findByIdUnscoped.mockResolvedValueOnce(err(databaseError()))
    expectErr(await run(), 'DATABASE_ERROR')
    autoRepo.listActiveRules.mockResolvedValueOnce(err(databaseError()))
    expectErr(await run(), 'DATABASE_ERROR')
    rules(rule([{ type: 'add_tag', params: { tag: 'x' } }]))
    engine.loadConfig.mockResolvedValueOnce(err(databaseError()))
    expectErr(await run(), 'DATABASE_ERROR')
  })

  it('skips invalid rules and non-matching conditions', async () => {
    rules(
      rule([], { id: 'bad-actions' }),
      rule([{ type: 'add_tag', params: { tag: 'x' } }], {
        id: 'bad-cond',
        conditions: 'x' as never,
      }),
      rule([{ type: 'add_tag', params: { tag: 'x' } }], {
        id: 'nomatch',
        conditions: [{ field: 'type', operator: 'equals', value: 'CHANGE' }],
      }),
    )
    expect(expectOk(await run())).toEqual({ matched: 0, rules: [] })
    expect(logger.warn).toHaveBeenCalledTimes(2)
    expect(autoRepo.markRun).not.toHaveBeenCalled()
    expect(logger.info).not.toHaveBeenCalled()
  })

  it('runs matching rules in order, marks runs, records events and honours stopProcessing', async () => {
    rules(
      rule([{ type: 'add_tag', params: { tag: 'a' } }], {
        id: 'r1',
        conditions: [{ field: 'type', operator: 'equals', value: 'INCIDENT' }],
      }),
      rule([{ type: 'add_tag', params: { tag: 'b' } }], {
        id: 'r2',
        stopProcessing: true,
      }),
      rule([{ type: 'add_tag', params: { tag: 'c' } }], { id: 'r3' }),
    )
    const result = expectOk(await run('TICKET_UPDATED', 'u1'))
    expect(result).toEqual({
      matched: 2,
      rules: [
        { ruleId: 'r1', executed: ['add_tag'], failed: [] },
        { ruleId: 'r2', executed: ['add_tag'], failed: [] },
      ],
    })
    expect(autoRepo.markRun).toHaveBeenCalledTimes(2)
    expect(autoRepo.markRun).toHaveBeenCalledWith('r1', NOW)
    expect(applied()[0]).toMatchObject({
      action: 'automation.applied',
      meta: {
        ruleId: 'r1',
        ruleName: 'R1',
        event: 'TICKET_UPDATED',
        triggeredBy: 'u1',
      },
    })
    expect(logger.info).toHaveBeenCalledWith(
      'servicedesk.automation.run',
      expect.objectContaining({ matched: 2 }),
    )
  })

  it('records failed actions and keeps the previous state when reload fails', async () => {
    engine.update.mockResolvedValueOnce(err(validationError('x')))
    ticketRepo.findById.mockResolvedValueOnce(err(databaseError()))
    rules(
      rule([
        { type: 'assign_user', params: { userId: 'u9' } },
        { type: 'add_tag', params: { tag: 'ok' } },
      ]),
    )
    const result = expectOk(await run())
    expect(result.rules[0]).toEqual({
      ruleId: 'r1',
      executed: ['add_tag'],
      failed: ['assign_user:VALIDATION_ERROR'],
    })
    expect(applied()[0].action).toBe('automation.failed')
    expect(applied()[0].meta).not.toHaveProperty('triggeredBy')
  })

  it('does not re-enter for the same ticket and event', async () => {
    let nested: unknown
    engine.update.mockImplementationOnce(async (t) => {
      nested = await runSdAutomations('TICKET_CREATED', 't1')
      return ok(t)
    })
    rules(rule([{ type: 'assign_user', params: { userId: 'u9' } }]))
    expectOk(await run())
    expect(nested).toEqual({ ok: true, value: { matched: 0, rules: [] } })
    expect(ticketRepo.findByIdUnscoped).toHaveBeenCalledTimes(1)
    // liberou a trava ao terminar
    rules()
    expectOk(await run())
    expect(ticketRepo.findByIdUnscoped).toHaveBeenCalledTimes(2)
  })
})

describe('runSdAutomations — actions', () => {
  const meta = {
    eventMeta: { via: 'automation', ruleId: 'r1' },
    allowClosed: true,
  }

  it('assign_department / assign_user / round_robin / add_participant', async () => {
    rules(
      rule([
        { type: 'assign_department', params: { departmentId: 'd2' } },
        { type: 'assign_user', params: { userId: 'u2' } },
        { type: 'round_robin', params: { departmentId: 'd3' } },
        { type: 'add_participant', params: { userId: 'u4' } },
      ]),
    )
    expectOk(await run())
    expect(engine.update).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      { departmentId: 'd2' },
      expect.objectContaining({ kind: 'system' }),
      config,
      meta,
    )
    expect(engine.update).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      { assigneeId: 'u2' },
      expect.anything(),
      config,
      meta,
    )
    expect(engine.roundRobin).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      config,
      'd3',
    )
    expect(addParticipant).toHaveBeenCalledWith(
      expect.anything(),
      'u4',
      expect.anything(),
      config,
    )
  })

  it('add_tag skips existing tags', async () => {
    current = createFakeSdTicket({ id: 't1', tags: ['vip'] })
    rules(
      rule([
        { type: 'add_tag', params: { tag: 'vip' } },
        { type: 'add_tag', params: { tag: 'novo' } },
      ]),
    )
    expectOk(await run())
    expect(engine.update).toHaveBeenCalledTimes(1)
    expect(engine.update.mock.calls[0][1]).toEqual({ tags: ['vip', 'novo'] })
  })

  describe('set_field', () => {
    it.each([
      ['priorityId', 'p1', { priorityId: 'p1' }],
      ['assigneeId', null, { assigneeId: null }],
      ['departmentId', ['d1', 'd2'], { departmentId: 'd1' }],
      ['classificationId', [], { classificationId: null }],
      ['title', 42, { title: '42' }],
      ['tags', ['a', 1], { tags: ['a', '1'] }],
      ['tags', 'solo', { tags: ['solo'] }],
      ['tags', null, { tags: [] }],
      ['escalationLevel', '2', { escalationLevel: 2 }],
      ['customFields.contrato', 'GOLD', { customFields: { contrato: 'GOLD' } }],
    ])('%s = %j', async (field, value, expected) => {
      rules(rule([{ type: 'set_field', params: { field, value } }]))
      const result = expectOk(await run())
      expect(result.rules[0].failed).toEqual([])
      expect(engine.update.mock.calls[0][1]).toEqual(expected)
    })

    it('changes the phase through the engine', async () => {
      rules(
        rule([
          { type: 'set_field', params: { field: 'phaseId', value: 'ph2' } },
        ]),
      )
      expectOk(await run())
      expect(engine.changePhase).toHaveBeenCalledWith(
        expect.anything(),
        'ph2',
        expect.anything(),
        config,
        {
          reason: 'automation:r1',
        },
      )
    })

    it.each([
      ['phaseId', ''],
      ['escalationLevel', -1],
      ['escalationLevel', 'x'],
      ['title', ''],
      ['channel', null],
      ['type', 'CHANGE'],
      ['priorityLevel', 3],
    ])('fails for %s = %j', async (field, value) => {
      rules(rule([{ type: 'set_field', params: { field, value } }]))
      const result = expectOk(await run())
      expect(result.rules[0].failed).toEqual(['set_field:VALIDATION_ERROR'])
    })
  })

  describe('notify', () => {
    it.each([
      ['TICKET_CREATED', 'ticket.created_in_department'],
      ['APPROVAL_RESPONDED', 'approval.responded'],
      ['SLA_AT_RISK', 'sla.at_risk'],
      ['SLA_BREACHED', 'sla.breached'],
    ] as const)(
      'maps %s to %s and gathers recipients',
      async (event, notifyEvent) => {
        rules(
          rule(
            [
              {
                type: 'notify',
                params: {
                  userIds: ['x'],
                  assignee: true,
                  requester: true,
                  departmentLeads: true,
                  email: true,
                  title: 'Olha',
                  message: '',
                },
              },
            ],
            { event },
          ),
        )
        expectOk(await run(event))
        expect(notify).toHaveBeenCalledWith({
          workspaceId: 'ws1',
          event: notifyEvent,
          audience: 'payload',
          ticket: expect.objectContaining({ code: 'INC-000001' }),
          payload: {
            title: 'Olha',
            body: current.title,
            userIds: ['x', 'a1', 'r1', 'lead'],
            meta: { via: 'automation', ruleEmail: true },
          },
        })
      },
    )

    it('uses defaults, skips leads without department and propagates lead errors', async () => {
      current = createFakeSdTicket({ id: 't1', departmentId: null })
      rules(
        rule([
          {
            type: 'notify',
            params: { title: 'T', message: 'corpo', departmentLeads: true },
          },
        ]),
      )
      expectOk(await run())
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            userIds: [],
            body: 'corpo',
            meta: { via: 'automation', ruleEmail: false },
          }),
        }),
      )
      expect(ctxRepo.listDepartmentLeadIds).not.toHaveBeenCalled()
      current = createFakeSdTicket({ id: 't1', departmentId: 'd1' })
      ctxRepo.listDepartmentLeadIds.mockResolvedValueOnce(err(databaseError()))
      const result = expectOk(await run())
      expect(result.rules[0].failed).toEqual(['notify:DATABASE_ERROR'])
    })
  })

  describe('post_message', () => {
    it('inserts a system message, records and publishes it', async () => {
      current = createFakeSdTicket({
        id: 't1',
        participants: [
          {
            userId: 'p1',
            user: { id: 'p1', name: 'P', email: 'p@x.io', image: null },
          },
        ],
        contact: { id: 'c', name: 'C', email: null, phone: null, userId: 'cu' },
      })
      rules(rule([{ type: 'post_message', params: { body: 'Olá' } }]))
      expectOk(await run())
      expect(autoRepo.insertSystemMessage).toHaveBeenCalledWith({
        workspaceId: 'ws1',
        ticketId: 't1',
        body: 'Olá',
        visibility: 'INTERNAL',
      })
      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'message.posted',
          meta: expect.objectContaining({ messageId: 'm1' }),
        }),
      )
      expect(publish).toHaveBeenCalledWith(
        'ws1',
        expect.objectContaining({
          type: 'ticket.message',
          internal: true,
          actorId: null,
        }),
        { requesterId: null, participantIds: ['p1'], contactUserId: 'cu' },
      )
    })

    it('publishes public messages to requesters and propagates insert errors', async () => {
      rules(
        rule([
          {
            type: 'post_message',
            params: { body: 'Oi', visibility: 'PUBLIC' },
          },
        ]),
      )
      expectOk(await run())
      expect(publish).toHaveBeenCalledWith(
        'ws1',
        expect.objectContaining({ internal: false }),
        expect.objectContaining({ contactUserId: null }),
      )
      autoRepo.insertSystemMessage.mockResolvedValueOnce(err(databaseError()))
      expect(expectOk(await run()).rules[0].failed).toEqual([
        'post_message:DATABASE_ERROR',
      ])
    })
  })

  describe('create_task', () => {
    it('creates the task with a due date authored by the workspace owner', async () => {
      rules(
        rule([
          {
            type: 'create_task',
            params: {
              title: 'Ligar',
              description: 'd',
              assigneeId: 'u5',
              dueInMinutes: 60,
            },
          },
        ]),
      )
      expectOk(await run())
      expect(autoRepo.insertTasks).toHaveBeenCalledWith('ws1', 't1', 'owner', [
        {
          title: 'Ligar',
          description: 'd',
          assigneeId: 'u5',
          dueDate: new Date('2026-09-21T13:00:00.000Z'),
        },
      ])
      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'task.created', toValue: 'Ligar' }),
      )
    })

    it('defaults optional fields, fails without author and on insert errors', async () => {
      rules(rule([{ type: 'create_task', params: { title: 'T' } }]))
      expectOk(await run())
      expect(autoRepo.insertTasks.mock.calls[0][3]).toEqual([
        { title: 'T', description: null, assigneeId: null, dueDate: null },
      ])
      ctxRepo.findWorkspaceOwnerId.mockResolvedValueOnce(ok(null))
      expect(expectOk(await run()).rules[0].failed).toEqual([
        'create_task:VALIDATION_ERROR',
      ])
      autoRepo.insertTasks.mockResolvedValueOnce(err(databaseError()))
      expect(expectOk(await run()).rules[0].failed).toEqual([
        'create_task:DATABASE_ERROR',
      ])
    })
  })

  describe('apply_template', () => {
    it('fills only empty fields and missing custom fields, then adds tasks', async () => {
      current = createFakeSdTicket({
        id: 't1',
        categoryId: 'keep',
        description: undefined as never,
        customFields: { a: 'ticket' },
      })
      ctxRepo.findTemplate.mockResolvedValue(
        ok(
          createFakeSdTemplate({
            defaults: {
              title: 'nope',
              categoryId: 'tpl-cat',
              severityId: 's1',
              description: '<p>desc</p>',
              customFields: { a: 'tpl', b: 'tpl' },
            },
            tasks: [{ title: 'Passo 1' }],
          }),
        ),
      )
      rules(rule([{ type: 'apply_template', params: { templateId: 'tpl' } }]))
      expectOk(await run())
      expect(engine.update.mock.calls[0][1]).toEqual({
        severityId: 's1',
        description: '<p>desc</p>',
        customFields: { b: 'tpl' },
      })
      expect(autoRepo.insertTasks).toHaveBeenCalledWith('ws1', 't1', 'owner', [
        { title: 'Passo 1', description: null },
      ])
    })

    it('skips tasks without author or template tasks', async () => {
      ctxRepo.findTemplate.mockResolvedValue(
        ok(createFakeSdTemplate({ tasks: [{ title: 'x' }] })),
      )
      ctxRepo.findWorkspaceOwnerId.mockResolvedValueOnce(ok(null))
      rules(rule([{ type: 'apply_template', params: { templateId: 'tpl' } }]))
      expectOk(await run())
      ctxRepo.findTemplate.mockResolvedValue(ok(createFakeSdTemplate()))
      expectOk(await run())
      expect(autoRepo.insertTasks).not.toHaveBeenCalled()
      expect(engine.update.mock.calls[1][1]).toEqual({})
    })

    it.each([
      ['missing', ok(null), 'SD_CONFIG_NOT_FOUND'],
      [
        'inactive',
        ok(createFakeSdTemplate({ active: false })),
        'SD_CONFIG_NOT_FOUND',
      ],
      [
        'other type',
        ok(createFakeSdTemplate({ ticketType: 'CHANGE' })),
        'SD_CONFIG_NOT_FOUND',
      ],
      ['error', err(databaseError()), 'DATABASE_ERROR'],
    ] as const)('fails for a %s template', async (_l, found, code) => {
      ctxRepo.findTemplate.mockResolvedValue(found as never)
      rules(rule([{ type: 'apply_template', params: { templateId: 'tpl' } }]))
      expect(expectOk(await run()).rules[0].failed).toEqual([
        `apply_template:${code}`,
      ])
    })

    it('propagates update and task errors', async () => {
      ctxRepo.findTemplate.mockResolvedValue(
        ok(createFakeSdTemplate({ tasks: [{ title: 'x' }] })),
      )
      rules(rule([{ type: 'apply_template', params: { templateId: 'tpl' } }]))
      engine.update.mockResolvedValueOnce(err(databaseError()))
      expect(expectOk(await run()).rules[0].failed).toEqual([
        'apply_template:DATABASE_ERROR',
      ])
      autoRepo.insertTasks.mockResolvedValueOnce(err(databaseError()))
      expect(expectOk(await run()).rules[0].failed).toEqual([
        'apply_template:DATABASE_ERROR',
      ])
    })
  })

  describe('escalate', () => {
    it('escalates automatically and continues with the escalated ticket', async () => {
      rules(
        rule([
          {
            type: 'escalate',
            params: { kind: 'HIERARCHICAL', reason: 'Demorou' },
          },
          {
            type: 'escalate',
            params: {
              kind: 'FUNCTIONAL',
              toDepartmentId: 'd2',
              reason: 'Rede',
            },
          },
        ]),
      )
      expectOk(await run())
      expect(escalate).toHaveBeenNthCalledWith(
        1,
        expect.anything(),
        {
          kind: 'HIERARCHICAL',
          toDepartmentId: undefined,
          toUserId: undefined,
          reason: 'Demorou',
          notifyDepartmentLeads: true,
          automatic: true,
          ruleId: null,
        },
        expect.anything(),
        config,
      )
      expect(escalate.mock.calls[1][0].escalationLevel).toBe(1)
      expect(escalate.mock.calls[1][1]).toMatchObject({
        notifyDepartmentLeads: false,
      })
    })

    it('reports escalation failures', async () => {
      escalate.mockResolvedValueOnce(err(databaseError()))
      rules(
        rule([
          { type: 'escalate', params: { kind: 'HIERARCHICAL', reason: 'x' } },
        ]),
      )
      expect(expectOk(await run()).rules[0].failed).toEqual([
        'escalate:DATABASE_ERROR',
      ])
    })
  })
})

describe('cross-engine actions', () => {
  const recipient = {
    name: 'Ana',
    phone: '5511912345678',
    email: 'ana@acme.com.br',
    company: 'Acme',
  }
  const skipped = () =>
    record.mock.calls
      .map((c) => c[0] as { action: string; meta?: Record<string, unknown> })
      .filter((e) => e.action === 'automation.skipped')

  beforeEach(() => {
    current = createFakeSdTicket({
      id: 't1',
      number: 12,
      title: 'Sem acesso',
      assigneeId: 'a1',
      requester: { id: 'r1', name: 'Rita', email: 'r@x', image: null },
    })
    crossRepo.ticketRecipient.mockResolvedValue(ok(recipient))
    crossEngine.sendWhatsApp.mockResolvedValue(
      ok({ status: 'sent', providerMessageId: 'w1', mode: 'template' }),
    )
    crossEngine.createCrmTask.mockResolvedValue(ok({ taskId: 'task1' }))
    crossEngine.createLead.mockResolvedValue(
      ok({ leadId: 'lead1', created: true }),
    )
  })

  describe('send_whatsapp_template', () => {
    const action = (params: object = {}) => ({
      type: 'send_whatsapp_template',
      params: {
        connectionId: 'c1',
        templateId: 'tpl1',
        variables: ['code', 'title', 'requester', 'phase'],
        text: 'Chamado {{code}}: {{title}}',
        ...params,
      },
    })

    it('sends to the ticket contact with the ticket values', async () => {
      rules(rule([action()]))
      const result = expectOk(await run())
      expect(result.rules[0].executed).toEqual(['send_whatsapp_template'])
      expect(crossEngine.sendWhatsApp).toHaveBeenCalledWith({
        workspaceId: 'ws1',
        source: 'sd_automation',
        refId: 'r1',
        connectionId: 'c1',
        phone: '5511912345678',
        templateId: 'tpl1',
        variables: ['INC-000012', 'Sem acesso', 'Rita', current.phase.name],
        text: 'Chamado INC-000012: Sem acesso',
      })
      expect(skipped()).toHaveLength(0)
    })

    it('sends no text when none is configured and falls back to the contact name', async () => {
      current = createFakeSdTicket({
        id: 't1',
        contact: {
          id: 'c',
          name: 'Caio',
          email: null,
          phone: null,
          userId: null,
        },
      })
      rules(rule([action({ text: undefined, variables: ['requester'] })]))
      expectOk(await run())
      expect(crossEngine.sendWhatsApp).toHaveBeenCalledWith(
        expect.objectContaining({ text: null, variables: ['Caio'] }),
      )
    })

    it('records the skip when the contact opted out', async () => {
      crossEngine.sendWhatsApp.mockResolvedValue(
        ok({ status: 'skipped', reason: 'opted_out', message: 'LGPD' }),
      )
      rules(rule([action()]))
      expect(expectOk(await run()).rules[0].executed).toEqual([
        'send_whatsapp_template',
      ])
      expect(skipped()[0]).toMatchObject({
        meta: { action: 'send_whatsapp_template', reason: 'opted_out' },
      })
    })

    it('skips and records when the ticket has no phone', async () => {
      crossRepo.ticketRecipient.mockResolvedValueOnce(ok(null))
      rules(rule([action()]))
      expectOk(await run())
      expect(crossEngine.sendWhatsApp).not.toHaveBeenCalled()
      expect(skipped()[0].meta).toMatchObject({ reason: 'no_phone' })
    })

    it('fails the action on lookup and send errors', async () => {
      rules(rule([action()]))
      crossRepo.ticketRecipient.mockResolvedValueOnce(err(databaseError()))
      expect(expectOk(await run()).rules[0].failed).toEqual([
        'send_whatsapp_template:DATABASE_ERROR',
      ])
      crossEngine.sendWhatsApp.mockResolvedValueOnce(err(validationError('x')))
      expect(expectOk(await run()).rules[0].failed).toEqual([
        'send_whatsapp_template:VALIDATION_ERROR',
      ])
    })
  })

  describe('create_crm_task', () => {
    it('creates the task with the rendered title and a ticket reference', async () => {
      rules(
        rule([
          {
            type: 'create_crm_task',
            params: {
              title: 'Ligar para {{requester}} ({{code}})',
              description: 'Ver {{title}}',
              assigneeId: 'u5',
              dueInMinutes: 30,
            },
          },
        ]),
      )
      expect(expectOk(await run()).rules[0].executed).toEqual([
        'create_crm_task',
      ])
      expect(crossEngine.createCrmTask).toHaveBeenCalledWith({
        workspaceId: 'ws1',
        source: 'sd_automation',
        refId: 'r1',
        authorId: 'a1',
        title: 'Ligar para Rita (INC-000012)',
        body: 'Ver Sem acesso\n\nChamado INC-000012: Sem acesso',
        assigneeId: 'u5',
        dueInMinutes: 30,
      })
      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'crm_task.created',
          meta: expect.objectContaining({ crmTaskId: 'task1' }),
        }),
      )
    })

    it('works without description and drops unknown placeholders', async () => {
      rules(
        rule([{ type: 'create_crm_task', params: { title: 'X {{nope}}' } }]),
      )
      expectOk(await run())
      expect(crossEngine.createCrmTask).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'X ',
          body: 'Chamado INC-000012: Sem acesso',
        }),
      )
    })

    it('fails the action when the CRM task cannot be created', async () => {
      crossEngine.createCrmTask.mockResolvedValue(err(databaseError()))
      rules(rule([{ type: 'create_crm_task', params: { title: 'T' } }]))
      expect(expectOk(await run()).rules[0].failed).toEqual([
        'create_crm_task:DATABASE_ERROR',
      ])
    })
  })

  describe('create_crm_lead', () => {
    const action = { type: 'create_crm_lead', params: { origin: 'Suporte' } }

    it('creates the lead from the ticket contact and records it', async () => {
      rules(rule([action]))
      expectOk(await run())
      expect(crossEngine.createLead).toHaveBeenCalledWith({
        workspaceId: 'ws1',
        source: 'sd_automation',
        refId: 'r1',
        authorId: 'a1',
        name: 'Ana',
        phone: '5511912345678',
        email: 'ana@acme.com.br',
        company: 'Acme',
        origin: 'Suporte',
      })
      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'crm_lead.created' }),
      )
    })

    it('records when an existing lead was reused', async () => {
      crossEngine.createLead.mockResolvedValue(
        ok({ leadId: 'lead9', created: false }),
      )
      rules(rule([action]))
      expectOk(await run())
      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'crm_lead.reused' }),
      )
    })

    it('skips a ticket without phone or e-mail and fails on errors', async () => {
      crossRepo.ticketRecipient.mockResolvedValueOnce(
        ok({ ...recipient, phone: null, email: null }),
      )
      rules(rule([action]))
      expectOk(await run())
      expect(crossEngine.createLead).not.toHaveBeenCalled()
      expect(skipped()[0].meta).toMatchObject({ reason: 'no_contact' })

      crossRepo.ticketRecipient.mockResolvedValueOnce(err(databaseError()))
      expect(expectOk(await run()).rules[0].failed).toEqual([
        'create_crm_lead:DATABASE_ERROR',
      ])
      crossEngine.createLead.mockResolvedValueOnce(err(databaseError()))
      expect(expectOk(await run()).rules[0].failed).toEqual([
        'create_crm_lead:DATABASE_ERROR',
      ])
    })
  })
})

describe('fireSdAutomations', () => {
  it('resolves quietly on success', async () => {
    rules()
    await fireSdAutomations('TICKET_CREATED', 't1')
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('logs result errors and thrown errors', async () => {
    ticketRepo.findByIdUnscoped.mockResolvedValueOnce(err(databaseError()))
    await fireSdAutomations('TICKET_CREATED', 't1', { actorId: 'u1' })
    expect(logger.error).toHaveBeenCalledWith(
      'servicedesk.automation.failed',
      expect.objectContaining({ reason: 'DATABASE_ERROR' }),
    )
    ticketRepo.findByIdUnscoped.mockRejectedValueOnce(new Error('boom'))
    await fireSdAutomations('TICKET_UPDATED', 't1')
    ticketRepo.findByIdUnscoped.mockRejectedValueOnce('str')
    await fireSdAutomations('PHASE_CHANGED', 't1')
    expect(logger.error).toHaveBeenCalledWith(
      'servicedesk.automation.crashed',
      expect.objectContaining({ message: 'boom' }),
    )
    expect(logger.error).toHaveBeenCalledWith(
      'servicedesk.automation.crashed',
      expect.objectContaining({ message: 'str' }),
    )
  })
})
