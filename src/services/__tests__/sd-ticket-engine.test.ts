import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSdTicket } from '@/src/__tests__/factories/sd-ticket.factory'
import {
  createFakeSdCustomField,
  createFakeSdPhase,
  createFakeSdSettings,
  createFakeSdSlaPolicy,
  createFakeSdTemplate,
} from '@/src/__tests__/factories/sd-ticket-context.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import { DEFAULT_SD_TICKET_PREFIXES } from '@/src/lib/servicedesk/ticket-code'
import type { SdTicketWithRelations } from '@/src/repositories/sd-ticket.repository'
import type { SdCategoryNode } from '@/src/repositories/sd-ticket-context.repository'

vi.mock('@/src/repositories/sd-ticket.repository')
vi.mock('@/src/repositories/sd-ticket-context.repository')
vi.mock('@/src/repositories/sd-automation.repository')
vi.mock('@/src/repositories/sd-approval-round.repository')
vi.mock('@/src/repositories/sd-change-window.repository')
vi.mock('@/src/repositories/sd-change-schedule.repository')
vi.mock('@/src/lib/servicedesk/realtime')
vi.mock('@/src/services/steel-agent-dispatcher', () => ({
  dispatchSteelAgentEvent: vi.fn(),
}))
vi.mock('@/src/services/sd-notification.service', () => ({
  notifySdEvent: vi.fn(async () => ({ ok: true, value: {} })),
}))
vi.mock('@/src/services/qa-review.service', () => ({
  QaReviewService: {
    onConversationClosed: vi.fn(async () => ({ ok: true, value: null })),
    onTicketResolved: vi.fn(async () => ({ ok: true, value: null })),
  },
}))
vi.mock('@/src/services/satisfaction-survey.service', () => ({
  SatisfactionSurveyService: {
    onTicketResolved: vi.fn(async () => ({ ok: true, value: null })),
  },
}))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/services/sd-ticket-event-recorder', async (orig) => ({
  ...(await orig<typeof import('../sd-ticket-event-recorder')>()),
  recordSdTicketEvent: vi.fn(async () => ({ ok: true, value: 1 })),
}))

import { createFakeSdChangeWindow } from '@/src/__tests__/factories/sd-change.factory'
import { createFakeSdNotifyOutcome } from '@/src/__tests__/factories/sd-notification.factory'
import { publishSdTicketEvent } from '@/src/lib/servicedesk/realtime'
import { SdApprovalRoundRepository } from '@/src/repositories/sd-approval-round.repository'
import { SdAutomationRepository } from '@/src/repositories/sd-automation.repository'
import { SdChangeScheduleRepository } from '@/src/repositories/sd-change-schedule.repository'
import { SdChangeWindowRepository } from '@/src/repositories/sd-change-window.repository'
import { SdTicketRepository } from '@/src/repositories/sd-ticket.repository'
import { SdTicketContextRepository } from '@/src/repositories/sd-ticket-context.repository'
import { QaReviewService } from '../qa-review.service'
import { SatisfactionSurveyService } from '../satisfaction-survey.service'
import { notifySdEvent } from '../sd-notification.service'
import {
  type SdActor,
  type SdEngineCreateInput,
  SdTicketEngine,
  sdActorUserId,
  sdRecordAuthorId,
  sdSystemActor,
  sdTicketCode,
  sdUserActor,
  selectSdSlaPolicy,
} from '../sd-ticket-engine'
import { recordSdTicketEvent } from '../sd-ticket-event-recorder'
import { dispatchSteelAgentEvent } from '../steel-agent-dispatcher'
import { emitWebhookEvent } from '../webhook-emitter'

const ctxRepo = vi.mocked(SdTicketContextRepository)
const ticketRepo = vi.mocked(SdTicketRepository)
const autoRepo = vi.mocked(SdAutomationRepository)
const roundRepo = vi.mocked(SdApprovalRoundRepository)
const windowRepo = vi.mocked(SdChangeWindowRepository)
const scheduleRepo = vi.mocked(SdChangeScheduleRepository)
const recordMock = vi.mocked(recordSdTicketEvent)
const notifyMock = vi.mocked(notifySdEvent)
const publishMock = vi.mocked(publishSdTicketEvent)

const NOW = new Date('2026-09-21T12:00:00.000Z')
const WALL = { timezone: 'UTC', schedule: {}, holidays: [], is24x7: true }

const agent: SdActor = {
  kind: 'user',
  userId: 'u1',
  isAgent: true,
  isAdmin: false,
  departmentIds: ['d1'],
}
const admin: SdActor = { ...agent, isAdmin: true, departmentIds: [] } as SdActor
const system = sdSystemActor('test')

let settings = createFakeSdSettings()
const config = () => ({ settings, prefixes: DEFAULT_SD_TICKET_PREFIXES })

const initial = createFakeSdPhase({ id: 'ph-new', isInitial: true })

const store = new Map<string, SdTicketWithRelations>()
function ticket(overrides: Partial<SdTicketWithRelations> = {}) {
  const t = createFakeSdTicket({ id: `t-${store.size + 1}`, ...overrides })
  store.set(t.id, t)
  return t
}

function node(overrides: Partial<SdCategoryNode>): SdCategoryNode {
  return {
    id: 'n',
    level: 'CATEGORY',
    parentId: null,
    departmentId: null,
    slaPolicyId: null,
    ticketTypes: [],
    active: true,
    portalVisible: true,
    name: 'N',
    ...overrides,
  }
}

function catalog(nodes: SdCategoryNode[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  ctxRepo.findCategory.mockImplementation(async (_ws, id) =>
    ok(byId.get(id) ?? null),
  )
}

const baseInput = (
  overrides: Partial<SdEngineCreateInput> = {},
): SdEngineCreateInput => ({
  type: 'INCIDENT',
  title: 'Servidor caiu',
  channel: 'AGENT',
  ...overrides,
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  settings = createFakeSdSettings()
  store.clear()
  ctxRepo.ensureSettings.mockResolvedValue(ok(settings))
  ctxRepo.findMissingRefs.mockResolvedValue(ok([]))
  ctxRepo.findNonMembers.mockResolvedValue(ok([]))
  ctxRepo.findInitialPhase.mockResolvedValue(ok(initial))
  ctxRepo.listTicketCustomFields.mockResolvedValue(ok([]))
  ctxRepo.listActiveSlaPolicies.mockResolvedValue(ok([]))
  ctxRepo.findDefaultPriorityId.mockResolvedValue(ok(null))
  ctxRepo.findPriorityLevel.mockResolvedValue(ok(2))
  ctxRepo.findDefaultCalendar.mockResolvedValue(ok(null))
  ctxRepo.findWorkspaceOwnerId.mockResolvedValue(ok('owner'))
  ctxRepo.listTransitions.mockResolvedValue(ok([]))
  ctxRepo.findLatestStandaloneApprovalStatus.mockResolvedValue(ok('APPROVED'))
  roundRepo.hasApprovedRound.mockResolvedValue(ok(false))
  windowRepo.listForRange.mockResolvedValue(ok([]))
  scheduleRepo.findConflicts.mockResolvedValue(ok([]))
  ctxRepo.countSolutionClassifications.mockResolvedValue(ok(0))
  ctxRepo.countSignatures.mockResolvedValue(ok(1))
  ctxRepo.findCategory.mockResolvedValue(ok(null))
  autoRepo.insertTasks.mockResolvedValue(ok(1))
  notifyMock.mockResolvedValue(ok(createFakeSdNotifyOutcome()))
  publishMock.mockResolvedValue(undefined)
  recordMock.mockResolvedValue(ok(1))
  ticketRepo.createWithNumber.mockImplementation(async (ws, data) =>
    ok(
      createFakeSdTicket({
        ...(data as Partial<SdTicketWithRelations>),
        id: 'new',
        workspaceId: ws,
        number: 42,
      }),
    ),
  )
  ticketRepo.update.mockImplementation(async (id, data) =>
    ok(
      createFakeSdTicket({
        ...(store.get(id) as SdTicketWithRelations),
        ...(data as Partial<SdTicketWithRelations>),
      }),
    ),
  )
  ticketRepo.isDescendantOrSelf.mockResolvedValue(ok(false))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('actor helpers', () => {
  it('builds actors and resolves user ids', () => {
    const actor = sdUserActor({
      userId: 'u9',
      isAgent: false,
      isAdmin: false,
      departmentIds: [],
      leadDepartmentIds: [],
      role: 'MEMBER',
      isPrivileged: false,
      permissions: null,
    })
    expect(actor).toEqual({
      kind: 'user',
      userId: 'u9',
      isAgent: false,
      isAdmin: false,
      departmentIds: [],
    })
    expect(sdActorUserId(actor)).toBe('u9')
    expect(sdActorUserId(system)).toBeNull()
    expect(
      sdTicketCode({ type: 'CHANGE', number: 3 }, DEFAULT_SD_TICKET_PREFIXES),
    ).toBe('CHG-000003')
  })

  it('resolves the record author (actor, owner, none)', async () => {
    expect(await sdRecordAuthorId('ws1', agent)).toBe('u1')
    expect(await sdRecordAuthorId('ws1', system)).toBe('owner')
    ctxRepo.findWorkspaceOwnerId.mockResolvedValueOnce(err(databaseError()))
    expect(await sdRecordAuthorId('ws1', system)).toBeNull()
  })
})

describe('loadConfig', () => {
  it('returns settings and resolved prefixes', async () => {
    const cfg = expectOk(await SdTicketEngine.loadConfig('ws1'))
    expect(cfg.prefixes.INCIDENT).toBe('INC')
    ctxRepo.ensureSettings.mockResolvedValueOnce(err(databaseError()))
    expectErr(await SdTicketEngine.loadConfig('ws1'), 'DATABASE_ERROR')
  })
})

describe('resolveRef', () => {
  it('resolves by number, code and id', async () => {
    const t = createFakeSdTicket({ number: 12 })
    ticketRepo.findByNumber.mockResolvedValue(ok(t))
    ticketRepo.findById.mockResolvedValue(ok(t))
    expectOk(await SdTicketEngine.resolveRef('ws1', '12'))
    expect(ticketRepo.findByNumber).toHaveBeenCalledWith(12, 'ws1')
    expectOk(await SdTicketEngine.resolveRef('ws1', 'INC-000012'))
    expectErr(
      await SdTicketEngine.resolveRef('ws1', 'REQ-12'),
      'SD_TICKET_NOT_FOUND',
    )
    expectOk(await SdTicketEngine.resolveRef('ws1', 'ckv9x2p0h0000abc'))
    expect(ticketRepo.findById).toHaveBeenCalledWith('ckv9x2p0h0000abc', 'ws1')
    ticketRepo.findByNumber.mockResolvedValueOnce(err(databaseError()))
    expectErr(await SdTicketEngine.resolveRef('ws1', '#3'), 'DATABASE_ERROR')
  })
})

describe('selectSdSlaPolicy', () => {
  const facts = { type: 'INCIDENT', priorityId: 'p1' }
  const matching = createFakeSdSlaPolicy({
    id: 'cond',
    conditions: [{ field: 'type', operator: 'equals', value: 'INCIDENT' }],
  })
  const notMatching = createFakeSdSlaPolicy({
    id: 'no',
    conditions: [{ field: 'type', operator: 'equals', value: 'CHANGE' }],
  })
  const invalid = createFakeSdSlaPolicy({ id: 'bad', conditions: 'x' as never })
  const empty = createFakeSdSlaPolicy({ id: 'empty', conditions: [] })
  const deflt = createFakeSdSlaPolicy({
    id: 'def',
    isDefault: true,
    conditions: [{ field: 'type', operator: 'equals', value: 'INCIDENT' }],
  })

  it('prefers matching conditions, skipping defaults/invalid/empty', () => {
    expect(
      selectSdSlaPolicy(
        [deflt, invalid, empty, notMatching, matching],
        facts,
        [],
        null,
      )?.id,
    ).toBe('cond')
  })

  it('falls back to the catalog chain, settings default and isDefault', () => {
    const list = [notMatching, empty, deflt]
    expect(
      selectSdSlaPolicy(
        list,
        facts,
        [
          { slaPolicyId: null },
          { slaPolicyId: 'gone' },
          { slaPolicyId: 'empty' },
        ],
        null,
      )?.id,
    ).toBe('empty')
    expect(selectSdSlaPolicy(list, facts, [], 'no')?.id).toBe('no')
    expect(selectSdSlaPolicy(list, facts, [], 'gone')?.id).toBe('def')
    expect(selectSdSlaPolicy([notMatching], facts, [], null)).toBeNull()
  })
})

describe('create', () => {
  it('creates with the initial phase, sanitized html, event, publish and log', async () => {
    const t = expectOk(
      await SdTicketEngine.create(
        'ws1',
        baseInput({
          description: '<p>x</p><script>1</script>',
          tags: ['a', 'a'],
        }),
        agent,
        config(),
      ),
    )
    expect(t.number).toBe(42)
    const data = ticketRepo.createWithNumber.mock.calls[0][1]
    expect(data).toMatchObject({
      phaseId: 'ph-new',
      description: '<p>x</p>',
      tags: ['a'],
      createdById: 'u1',
      priorityId: null,
      departmentId: null,
      slaPausedAt: null,
      knownError: false,
    })
    expect(recordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ticket.created',
        actorKind: 'AGENT',
        toValue: { id: 'new', label: 'INC-000042' },
      }),
    )
    // Sem responsável: só o aviso de "novo na fila" (líderes do time).
    expect(notifyMock.mock.calls.map((call) => call[0].event)).toEqual([
      'ticket.created_in_department',
    ])
    expect(publishMock).toHaveBeenCalledWith(
      'ws1',
      expect.objectContaining({ type: 'ticket.created', actorId: 'u1' }),
      expect.objectContaining({ participantIds: [], contactUserId: null }),
    )
    // Outbound webhook (ADR 0036): the ticket snapshot with its code.
    const webhook = vi.mocked(emitWebhookEvent).mock.calls[0]
    expect(webhook.slice(0, 2)).toEqual(['ws1', 'servicedesk.ticket.created'])
    expect((webhook[2] as () => unknown)()).toMatchObject({
      ticket: { id: 'new', code: 'INC-000042', number: 42 },
      actorId: 'u1',
    })
  })

  it('keeps an empty description as null and propagates create errors', async () => {
    ticketRepo.createWithNumber.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SdTicketEngine.create(
        'ws1',
        baseInput({ description: '' }),
        agent,
        config(),
      ),
      'DATABASE_ERROR',
    )
    expect(ticketRepo.createWithNumber.mock.calls[0][1].description).toBeNull()
  })

  describe('templates', () => {
    it('applies defaults and creates the checklist tasks', async () => {
      ctxRepo.findTemplate.mockResolvedValue(
        ok(
          createFakeSdTemplate({
            id: 'tpl',
            defaults: { title: 'ignored', severityId: 's1' },
            tasks: [{ title: 'Checar' }],
          }),
        ),
      )
      expectOk(
        await SdTicketEngine.create(
          'ws1',
          baseInput({ templateId: 'tpl' }),
          agent,
          config(),
        ),
      )
      expect(ticketRepo.createWithNumber.mock.calls[0][1]).toMatchObject({
        title: 'Servidor caiu',
        severityId: 's1',
        templateId: 'tpl',
      })
      expect(autoRepo.insertTasks).toHaveBeenCalledWith('ws1', 'new', 'u1', [
        { title: 'Checar', description: null },
      ])
      expect(recordMock).toHaveBeenCalledWith(
        expect.objectContaining({
          meta: expect.objectContaining({ templateId: 'tpl' }),
        }),
      )
    })

    it('uses the workspace owner as task author for system actors, or skips', async () => {
      ctxRepo.findTemplate.mockResolvedValue(
        ok(createFakeSdTemplate({ tasks: [{ title: 'T' }] })),
      )
      expectOk(
        await SdTicketEngine.create(
          'ws1',
          baseInput({ templateId: 'x' }),
          system,
          config(),
        ),
      )
      expect(autoRepo.insertTasks).toHaveBeenCalledWith(
        'ws1',
        'new',
        'owner',
        expect.any(Array),
      )
      autoRepo.insertTasks.mockClear()
      ctxRepo.findWorkspaceOwnerId.mockResolvedValueOnce(ok(null))
      expectOk(
        await SdTicketEngine.create(
          'ws1',
          baseInput({ templateId: 'x' }),
          system,
          config(),
        ),
      )
      expect(autoRepo.insertTasks).not.toHaveBeenCalled()
    })

    it.each([
      ['missing', null, {}],
      ['inactive', createFakeSdTemplate({ active: false }), {}],
      ['other type', createFakeSdTemplate({ ticketType: 'CHANGE' }), {}],
      [
        'not in portal',
        createFakeSdTemplate({ portalVisible: false }),
        { portal: true },
      ],
    ])('rejects a %s template', async (_label, tpl, extra) => {
      ctxRepo.findTemplate.mockResolvedValue(ok(tpl))
      expectErr(
        await SdTicketEngine.create(
          'ws1',
          baseInput({ templateId: 'x', ...extra }),
          agent,
          config(),
        ),
        'SD_CONFIG_NOT_FOUND',
      )
    })

    it('propagates template lookup errors', async () => {
      ctxRepo.findTemplate.mockResolvedValue(err(databaseError()))
      expectErr(
        await SdTicketEngine.create(
          'ws1',
          baseInput({ templateId: 'x' }),
          agent,
          config(),
        ),
        'DATABASE_ERROR',
      )
    })
  })

  describe('catalog', () => {
    const cat = node({
      id: 'cat',
      level: 'CATEGORY',
      departmentId: 'dcat',
      slaPolicyId: 'spcat',
    })
    const sub = node({ id: 'sub', level: 'SUBCATEGORY', parentId: 'cat' })
    const svc = node({
      id: 'svc',
      level: 'SERVICE',
      parentId: 'sub',
      departmentId: 'dsvc',
    })

    it('derives ancestors from the service and routes to the most specific department', async () => {
      catalog([cat, sub, svc])
      expectOk(
        await SdTicketEngine.create(
          'ws1',
          baseInput({ serviceId: 'svc' }),
          agent,
          config(),
        ),
      )
      expect(ticketRepo.createWithNumber.mock.calls[0][1]).toMatchObject({
        categoryId: 'cat',
        subcategoryId: 'sub',
        serviceId: 'svc',
        departmentId: 'dsvc',
      })
    })

    it('routes through the category and then the settings default', async () => {
      catalog([cat, sub])
      expectOk(
        await SdTicketEngine.create(
          'ws1',
          baseInput({ subcategoryId: 'sub' }),
          agent,
          config(),
        ),
      )
      expect(ticketRepo.createWithNumber.mock.calls[0][1].departmentId).toBe(
        'dcat',
      )
      settings = createFakeSdSettings({ defaultDepartmentId: 'ddef' })
      expectOk(await SdTicketEngine.create('ws1', baseInput(), agent, config()))
      expect(ticketRepo.createWithNumber.mock.calls[1][1].departmentId).toBe(
        'ddef',
      )
      expectOk(
        await SdTicketEngine.create(
          'ws1',
          baseInput({ departmentId: 'dx' }),
          agent,
          config(),
        ),
      )
      expect(ticketRepo.createWithNumber.mock.calls[2][1].departmentId).toBe(
        'dx',
      )
    })

    it.each([
      [
        'service with wrong level',
        { serviceId: 'cat' },
        [cat],
        'SD_CATEGORY_LEVEL_INVALID',
      ],
      [
        'subcategory with wrong level',
        { subcategoryId: 'cat' },
        [cat],
        'SD_CATEGORY_LEVEL_INVALID',
      ],
      [
        'category with wrong level',
        { categoryId: 'sub' },
        [sub],
        'SD_CATEGORY_LEVEL_INVALID',
      ],
      [
        'service outside the subcategory',
        { serviceId: 'svc', subcategoryId: 'sub2' },
        [svc, node({ id: 'sub2', level: 'SUBCATEGORY', parentId: 'cat' })],
        'SD_CATEGORY_LEVEL_INVALID',
      ],
      [
        'subcategory outside the category',
        { subcategoryId: 'sub', categoryId: 'cat2' },
        [sub, node({ id: 'cat2' })],
        'SD_CATEGORY_LEVEL_INVALID',
      ],
      ['missing node', { categoryId: 'nope' }, [], 'SD_CATEGORY_NOT_FOUND'],
      [
        'inactive node',
        { categoryId: 'cat' },
        [node({ id: 'cat', active: false })],
        'SD_CATEGORY_NOT_FOUND',
      ],
      [
        'node of another type',
        { categoryId: 'cat' },
        [node({ id: 'cat', ticketTypes: ['CHANGE'] })],
        'SD_CATEGORY_LEVEL_INVALID',
      ],
      [
        'missing subcategory',
        { subcategoryId: 'nope' },
        [],
        'SD_CATEGORY_NOT_FOUND',
      ],
      ['missing service', { serviceId: 'nope' }, [], 'SD_CATEGORY_NOT_FOUND'],
    ] as const)('rejects %s', async (_l, input, nodes, code) => {
      catalog([...nodes])
      expectErr(
        await SdTicketEngine.create('ws1', baseInput(input), agent, config()),
        code,
      )
    })

    it('accepts a node restricted to the same type', async () => {
      catalog([node({ id: 'cat', ticketTypes: ['INCIDENT'] })])
      expectOk(
        await SdTicketEngine.create(
          'ws1',
          baseInput({ categoryId: 'cat' }),
          agent,
          config(),
        ),
      )
    })

    it('rejects nodes hidden from the portal on portal tickets', async () => {
      catalog([node({ id: 'cat', portalVisible: false })])
      expectErr(
        await SdTicketEngine.create(
          'ws1',
          baseInput({ categoryId: 'cat', portal: true }),
          agent,
          config(),
        ),
        'SD_CATEGORY_NOT_FOUND',
      )
    })

    it('propagates category lookup errors', async () => {
      ctxRepo.findCategory.mockResolvedValue(err(databaseError()))
      expectErr(
        await SdTicketEngine.create(
          'ws1',
          baseInput({ categoryId: 'c' }),
          agent,
          config(),
        ),
        'DATABASE_ERROR',
      )
    })
  })

  describe('priority', () => {
    it('uses the matrix when impact and urgency are given', async () => {
      ctxRepo.findMatrixPriorityId.mockResolvedValue(ok('pm'))
      expectOk(
        await SdTicketEngine.create(
          'ws1',
          baseInput({ impactId: 'i', urgencyId: 'u' }),
          agent,
          config(),
        ),
      )
      expect(ticketRepo.createWithNumber.mock.calls[0][1].priorityId).toBe('pm')
      expect(ctxRepo.findDefaultPriorityId).not.toHaveBeenCalled()
    })

    it('falls back to the default priority', async () => {
      ctxRepo.findMatrixPriorityId.mockResolvedValue(ok(null))
      ctxRepo.findDefaultPriorityId.mockResolvedValue(ok('pd'))
      expectOk(
        await SdTicketEngine.create(
          'ws1',
          baseInput({ impactId: 'i', urgencyId: 'u' }),
          agent,
          config(),
        ),
      )
      expect(ticketRepo.createWithNumber.mock.calls[0][1].priorityId).toBe('pd')
    })

    it('respects an explicit null priority', async () => {
      expectOk(
        await SdTicketEngine.create(
          'ws1',
          baseInput({ priorityId: null }),
          agent,
          config(),
        ),
      )
      expect(ctxRepo.findDefaultPriorityId).not.toHaveBeenCalled()
    })

    it('propagates matrix, default and level errors', async () => {
      ctxRepo.findMatrixPriorityId.mockResolvedValueOnce(err(databaseError()))
      expectErr(
        await SdTicketEngine.create(
          'ws1',
          baseInput({ impactId: 'i', urgencyId: 'u' }),
          agent,
          config(),
        ),
        'DATABASE_ERROR',
      )
      ctxRepo.findDefaultPriorityId.mockResolvedValueOnce(err(databaseError()))
      expectErr(
        await SdTicketEngine.create('ws1', baseInput(), agent, config()),
        'DATABASE_ERROR',
      )
      ctxRepo.findPriorityLevel.mockResolvedValueOnce(err(databaseError()))
      expectErr(
        await SdTicketEngine.create(
          'ws1',
          baseInput({ priorityId: 'p' }),
          agent,
          config(),
        ),
        'DATABASE_ERROR',
      )
    })
  })

  describe('references', () => {
    it.each([
      ['customerId', 'SD_CUSTOMER_NOT_FOUND'],
      ['companyId', 'SD_CUSTOMER_NOT_FOUND'],
      ['contactId', 'SD_CONTACT_NOT_FOUND'],
      ['configItemId', 'SD_CONFIG_ITEM_NOT_FOUND'],
      ['departmentId', 'SD_DEPARTMENT_NOT_FOUND'],
      ['parentId', 'SD_TICKET_NOT_FOUND'],
      ['impactId', 'SD_CONFIG_NOT_FOUND'],
      ['severityId', 'SD_CONFIG_NOT_FOUND'],
    ] as const)('maps a missing %s to %s', async (field, code) => {
      ctxRepo.findMissingRefs.mockResolvedValue(ok([field]))
      expectErr(
        await SdTicketEngine.create('ws1', baseInput(), agent, config()),
        code,
      )
    })

    it('rejects users that are not members and propagates errors', async () => {
      ctxRepo.findNonMembers.mockResolvedValueOnce(ok(['x']))
      expectErr(
        await SdTicketEngine.create(
          'ws1',
          baseInput({ assigneeId: 'x' }),
          agent,
          config(),
        ),
        'VALIDATION_ERROR',
      )
      expect(ctxRepo.findNonMembers).toHaveBeenCalledWith('ws1', ['x'])
      ctxRepo.findNonMembers.mockResolvedValueOnce(err(databaseError()))
      expectErr(
        await SdTicketEngine.create('ws1', baseInput(), agent, config()),
        'DATABASE_ERROR',
      )
      ctxRepo.findMissingRefs.mockResolvedValueOnce(err(databaseError()))
      expectErr(
        await SdTicketEngine.create('ws1', baseInput(), agent, config()),
        'DATABASE_ERROR',
      )
    })
  })

  describe('phase', () => {
    it('uses an explicit phase of the same type', async () => {
      ctxRepo.findPhase.mockResolvedValue(
        ok(createFakeSdPhase({ id: 'ph2', completionPercent: 30 })),
      )
      expectOk(
        await SdTicketEngine.create(
          'ws1',
          baseInput({ phaseId: 'ph2' }),
          agent,
          config(),
        ),
      )
      expect(ticketRepo.createWithNumber.mock.calls[0][1]).toMatchObject({
        phaseId: 'ph2',
        completionPercent: 30,
      })
    })

    it.each([
      ['another type', createFakeSdPhase({ ticketType: 'CHANGE' })],
      ['inactive', createFakeSdPhase({ active: false })],
      ['missing', null],
    ])('rejects an explicit phase that is %s', async (_l, phase) => {
      ctxRepo.findPhase.mockResolvedValue(ok(phase))
      expectErr(
        await SdTicketEngine.create(
          'ws1',
          baseInput({ phaseId: 'x' }),
          agent,
          config(),
        ),
        'SD_PHASE_NOT_FOUND',
      )
    })

    it('fails without an initial phase and propagates errors', async () => {
      ctxRepo.findInitialPhase.mockResolvedValueOnce(ok(null))
      expectErr(
        await SdTicketEngine.create('ws1', baseInput(), agent, config()),
        'SD_PHASE_NOT_FOUND',
      )
      ctxRepo.findInitialPhase.mockResolvedValueOnce(err(databaseError()))
      expectErr(
        await SdTicketEngine.create('ws1', baseInput(), agent, config()),
        'DATABASE_ERROR',
      )
      ctxRepo.findPhase.mockResolvedValueOnce(err(databaseError()))
      expectErr(
        await SdTicketEngine.create(
          'ws1',
          baseInput({ phaseId: 'x' }),
          agent,
          config(),
        ),
        'DATABASE_ERROR',
      )
    })

    it('pauses the SLA when the initial phase pauses it', async () => {
      ctxRepo.findInitialPhase.mockResolvedValueOnce(
        ok(createFakeSdPhase({ pausesSla: true })),
      )
      expectOk(await SdTicketEngine.create('ws1', baseInput(), agent, config()))
      expect(ticketRepo.createWithNumber.mock.calls[0][1].slaPausedAt).toEqual(
        NOW,
      )
      ctxRepo.findInitialPhase.mockResolvedValueOnce(
        ok(createFakeSdPhase({ pausesSla: true, category: 'RESOLVED' })),
      )
      expectOk(await SdTicketEngine.create('ws1', baseInput(), agent, config()))
      expect(
        ticketRepo.createWithNumber.mock.calls[1][1].slaPausedAt,
      ).toBeNull()
    })
  })

  describe('custom fields', () => {
    it('validates required fields and propagates lookup errors', async () => {
      ctxRepo.listTicketCustomFields.mockResolvedValueOnce(
        ok([createFakeSdCustomField({ key: 'k', label: 'K', required: true })]),
      )
      expectErr(
        await SdTicketEngine.create('ws1', baseInput(), agent, config()),
        'SD_CUSTOM_FIELD_INVALID',
      )
      ctxRepo.listTicketCustomFields.mockResolvedValueOnce(err(databaseError()))
      expectErr(
        await SdTicketEngine.create('ws1', baseInput(), agent, config()),
        'DATABASE_ERROR',
      )
      ctxRepo.listTicketCustomFields.mockResolvedValueOnce(
        ok([createFakeSdCustomField({ key: 'k' })]),
      )
      expectOk(
        await SdTicketEngine.create(
          'ws1',
          baseInput({ customFields: { k: 'v' } }),
          agent,
          config(),
        ),
      )
      expect(ticketRepo.createWithNumber.mock.calls[0][1].customFields).toEqual(
        { k: 'v' },
      )
    })
  })

  describe('SLA', () => {
    const policy = (overrides = {}) =>
      createFakeSdSlaPolicy({
        id: 'sp',
        isDefault: true,
        targets: [
          {
            id: 'tg',
            policyId: 'sp',
            priorityId: 'p1',
            firstResponseMinutes: 30,
            resolutionMinutes: 240,
          },
        ],
        ...overrides,
      })

    it('computes due dates on the policy calendar', async () => {
      ctxRepo.listActiveSlaPolicies.mockResolvedValue(
        ok([
          policy({
            calendar: {
              ...WALL,
              id: 'c',
              workspaceId: 'ws1',
              name: 'x',
              isDefault: false,
              createdAt: NOW,
              updatedAt: NOW,
            },
          }),
        ]),
      )
      expectOk(
        await SdTicketEngine.create(
          'ws1',
          baseInput({ priorityId: 'p1' }),
          agent,
          config(),
        ),
      )
      expect(ticketRepo.createWithNumber.mock.calls[0][1]).toMatchObject({
        slaPolicyId: 'sp',
        firstResponseDueAt: new Date('2026-09-21T12:30:00.000Z'),
        resolutionDueAt: new Date('2026-09-21T16:00:00.000Z'),
      })
      expect(ctxRepo.findDefaultCalendar).not.toHaveBeenCalled()
    })

    it('falls back to the workspace default calendar', async () => {
      ctxRepo.listActiveSlaPolicies.mockResolvedValue(ok([policy()]))
      expectOk(
        await SdTicketEngine.create(
          'ws1',
          baseInput({ priorityId: 'p1' }),
          agent,
          config(),
        ),
      )
      expect(ctxRepo.findDefaultCalendar).toHaveBeenCalledWith('ws1')
      ctxRepo.findDefaultCalendar.mockResolvedValueOnce(err(databaseError()))
      expectErr(
        await SdTicketEngine.create(
          'ws1',
          baseInput({ priorityId: 'p1' }),
          agent,
          config(),
        ),
        'DATABASE_ERROR',
      )
    })

    it('keeps the policy without due dates when there is no target', async () => {
      ctxRepo.listActiveSlaPolicies.mockResolvedValue(ok([policy()]))
      expectOk(
        await SdTicketEngine.create(
          'ws1',
          baseInput({ priorityId: 'p9' }),
          agent,
          config(),
        ),
      )
      expect(ticketRepo.createWithNumber.mock.calls[0][1]).toMatchObject({
        slaPolicyId: 'sp',
        firstResponseDueAt: null,
        resolutionDueAt: null,
      })
    })

    it('propagates policy lookup errors', async () => {
      ctxRepo.listActiveSlaPolicies.mockResolvedValueOnce(err(databaseError()))
      expectErr(
        await SdTicketEngine.create('ws1', baseInput(), agent, config()),
        'DATABASE_ERROR',
      )
    })
  })

  describe('round-robin', () => {
    it('assigns the next agent and notifies them', async () => {
      settings = createFakeSdSettings({ autoAssignRoundRobin: true })
      ctxRepo.pickRoundRobinAssignee.mockResolvedValue(ok('u7'))
      expectOk(
        await SdTicketEngine.create(
          'ws1',
          baseInput({ departmentId: 'd1' }),
          agent,
          config(),
        ),
      )
      expect(ticketRepo.createWithNumber.mock.calls[0][1].assigneeId).toBe('u7')
      expect(recordMock).toHaveBeenCalledWith(
        expect.objectContaining({
          meta: expect.objectContaining({ roundRobin: true }),
        }),
      )
      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'ticket.assigned',
          actorId: 'u1',
          ticket: expect.objectContaining({
            code: 'INC-000042',
            assigneeId: 'u7',
          }),
          payload: expect.objectContaining({
            title: 'INC-000042 atribuído a você',
          }),
        }),
      )
    })

    it('skips without department and propagates errors', async () => {
      settings = createFakeSdSettings({ autoAssignRoundRobin: true })
      expectOk(await SdTicketEngine.create('ws1', baseInput(), agent, config()))
      expect(ctxRepo.pickRoundRobinAssignee).not.toHaveBeenCalled()
      ctxRepo.pickRoundRobinAssignee.mockResolvedValue(err(databaseError()))
      expectErr(
        await SdTicketEngine.create(
          'ws1',
          baseInput({ departmentId: 'd1' }),
          agent,
          config(),
        ),
        'DATABASE_ERROR',
      )
    })
  })
})

describe('update · agenda da mudança', () => {
  const change = () =>
    ticket({
      type: 'CHANGE',
      configItemId: 'ci1',
      departmentId: 'd1',
      plannedStartAt: null,
      plannedEndAt: null,
    })
  const schedule = {
    plannedStartAt: new Date('2026-10-10T02:00:00.000Z'),
    plannedEndAt: new Date('2026-10-10T06:00:00.000Z'),
  }
  const freeze = () =>
    createFakeSdChangeWindow({
      id: 'w1',
      name: 'Congelamento de outubro',
      kind: 'FREEZE',
      startsAt: new Date('2026-10-01T00:00:00.000Z'),
      endsAt: new Date('2026-11-01T00:00:00.000Z'),
    })

  it('schedules freely when no window and no rival touch the period', async () => {
    expectOk(await SdTicketEngine.update(change(), schedule, agent, config()))
    expect(windowRepo.listForRange).toHaveBeenCalled()
  })

  it('does not look at the calendar when the window did not move', async () => {
    expectOk(
      await SdTicketEngine.update(change(), { title: 'x' }, agent, config()),
    )
    expect(windowRepo.listForRange).not.toHaveBeenCalled()
  })

  it('refuses a freeze window with SD_CHANGE_FROZEN', async () => {
    windowRepo.listForRange.mockResolvedValue(ok([freeze()]))
    const e = expectErr(
      await SdTicketEngine.update(change(), schedule, agent, config()),
      'SD_CHANGE_FROZEN',
    )
    expect(e.message).toContain('Congelamento de outubro')
    expect(e.message).toContain('administrador')
    expect(ticketRepo.update).not.toHaveBeenCalled()
  })

  it('refuses a rival change on the same config item with SD_CHANGE_CONFLICT', async () => {
    scheduleRepo.findConflicts.mockResolvedValue(
      ok([
        {
          id: 't-rival',
          number: 7,
          type: 'CHANGE',
          title: 'Outra mudança',
          plannedStartAt: schedule.plannedStartAt,
          plannedEndAt: schedule.plannedEndAt,
          changeType: null,
          changeRisk: null,
          configItemId: 'ci1',
          departmentId: 'd1',
          phase: { id: 'p', name: 'Planejada', category: 'IN_PROGRESS' },
          configItem: { id: 'ci1', name: 'Servidor' },
          assignee: null,
        },
      ]),
    )
    const e = expectErr(
      await SdTicketEngine.update(change(), schedule, agent, config()),
      'SD_CHANGE_CONFLICT',
    )
    expect(e.message).toContain('#7')
  })

  it('lets an admin confirm and records what was ignored', async () => {
    windowRepo.listForRange.mockResolvedValue(ok([freeze()]))
    expectOk(
      await SdTicketEngine.update(change(), schedule, admin, config(), {
        confirmChangeSchedule: true,
      }),
    )
    const forced = recordMock.mock.calls
      .flatMap(([events]) => (Array.isArray(events) ? events : [events]))
      .find((event) => event.action === 'change.schedule_forced')
    expect(forced).toBeDefined()
    expect(forced?.meta).toEqual({ kinds: ['FREEZE'] })
  })

  it('refuses an agent confirmation (only admins may force)', async () => {
    windowRepo.listForRange.mockResolvedValue(ok([freeze()]))
    expectErr(
      await SdTicketEngine.update(change(), schedule, agent, config(), {
        confirmChangeSchedule: true,
      }),
      'SD_CHANGE_FROZEN',
    )
  })

  it('ignores a freeze window scoped to another config item', async () => {
    windowRepo.listForRange.mockResolvedValue(
      ok([createFakeSdChangeWindow({ ...freeze(), configItemIds: ['outro'] })]),
    )
    expectOk(await SdTicketEngine.update(change(), schedule, agent, config()))
  })

  it('never blocks a system actor, recording what it ignored', async () => {
    windowRepo.listForRange.mockResolvedValue(ok([freeze()]))
    expectOk(await SdTicketEngine.update(change(), schedule, system, config()))
    const forced = recordMock.mock.calls
      .flatMap(([events]) => (Array.isArray(events) ? events : [events]))
      .find((event) => event.action === 'change.schedule_forced')
    expect(forced).toBeDefined()
  })

  it('propagates a database error from the calendar', async () => {
    windowRepo.listForRange.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdTicketEngine.update(change(), schedule, agent, config()),
      'DATABASE_ERROR',
    )
  })

  it('skips the check for a ticket that is not a change', async () => {
    windowRepo.listForRange.mockResolvedValue(ok([freeze()]))
    expectOk(
      await SdTicketEngine.update(
        ticket({ type: 'INCIDENT' }),
        schedule,
        agent,
        config(),
      ),
    )
  })
})

describe('update', () => {
  it('returns the same ticket when nothing changes', async () => {
    const t = ticket()
    const result = expectOk(
      await SdTicketEngine.update(t, { title: undefined }, agent, config()),
    )
    expect(result).toBe(t)
    expect(ticketRepo.update).not.toHaveBeenCalled()
  })

  it('refuses closed tickets except CSAT, allowClosed or RESOLVED', async () => {
    const closed = ticket({
      phase: { ...createFakeSdTicket().phase, category: 'CLOSED' },
    })
    expectErr(
      await SdTicketEngine.update(closed, { title: 'x' }, agent, config()),
      'SD_TICKET_CLOSED',
    )
    expectOk(
      await SdTicketEngine.update(closed, { csatScore: 5 }, agent, config()),
    )
    expectOk(
      await SdTicketEngine.update(closed, { title: 'x' }, agent, config(), {
        allowClosed: true,
      }),
    )
    const resolved = ticket({
      phase: { ...createFakeSdTicket().phase, category: 'RESOLVED' },
    })
    expectOk(
      await SdTicketEngine.update(resolved, { title: 'x' }, agent, config()),
    )
  })

  it('records diff events, publishes and touches activity', async () => {
    const t = ticket({ title: 'A' })
    const after = expectOk(
      await SdTicketEngine.update(
        t,
        {
          title: 'B',
          description: '<b>x</b><script>y</script>',
          tags: ['a', 'a'],
        },
        agent,
        config(),
        {
          eventMeta: { via: 'test' },
        },
      ),
    )
    expect(after.title).toBe('B')
    const data = ticketRepo.update.mock.calls[0][1]
    expect(data).toMatchObject({
      title: 'B',
      description: '<b>x</b>',
      tags: ['a'],
      lastActivityAt: NOW,
    })
    expect(recordMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'field.changed',
          field: 'title',
          fromValue: 'A',
          toValue: 'B',
          meta: { label: 'Título', via: 'test' },
        }),
      ]),
    )
    expect(publishMock).toHaveBeenCalledWith(
      'ws1',
      expect.objectContaining({ type: 'ticket.updated' }),
      expect.anything(),
    )
  })

  it('clears the description and skips events when nothing differs', async () => {
    const t = ticket({ description: null })
    expectOk(
      await SdTicketEngine.update(t, { description: '' }, system, config(), {
        touchActivity: false,
      }),
    )
    const data = ticketRepo.update.mock.calls[0][1]
    expect(data.description).toBeNull()
    expect(data.lastActivityAt).toBeUndefined()
    expect(recordMock).not.toHaveBeenCalled()
    expect(publishMock).not.toHaveBeenCalled()
  })

  it('notifies a new assignee and publishes ticket.assigned', async () => {
    const t = ticket({
      participants: [
        {
          userId: 'p1',
          user: { id: 'p1', name: 'P', email: 'p@x.io', image: null },
        },
      ],
      contact: { id: 'c', name: 'C', email: null, phone: null, userId: 'cu' },
    })
    expectOk(
      await SdTicketEngine.update(t, { assigneeId: 'u2' }, agent, config()),
    )
    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'ticket.assigned',
        ticket: expect.objectContaining({
          assigneeId: 'u2',
          participantIds: ['p1'],
          contact: { id: 'c', name: 'C', userId: 'cu' },
        }),
      }),
    )
    expect(publishMock).toHaveBeenCalledWith(
      'ws1',
      expect.objectContaining({ type: 'ticket.assigned' }),
      { requesterId: null, participantIds: ['p1'], contactUserId: 'cu' },
    )
  })

  it('propagates repository update errors', async () => {
    ticketRepo.update.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SdTicketEngine.update(ticket(), { title: 'x' }, agent, config()),
      'DATABASE_ERROR',
    )
  })

  describe('catalog', () => {
    const cat = node({ id: 'cat2' })
    const sub = node({ id: 'sub2', level: 'SUBCATEGORY', parentId: 'cat' })
    const svc = node({ id: 'svc2', level: 'SERVICE', parentId: 'sub' })
    const subOfCat = node({ id: 'sub', level: 'SUBCATEGORY', parentId: 'cat' })
    const catA = node({ id: 'cat' })

    it('changing the category clears subcategory and service', async () => {
      catalog([cat])
      const t = ticket({
        categoryId: 'cat',
        subcategoryId: 'sub',
        serviceId: 'svc',
      })
      expectOk(
        await SdTicketEngine.update(t, { categoryId: 'cat2' }, agent, config()),
      )
      expect(ticketRepo.update.mock.calls[0][1]).toMatchObject({
        categoryId: 'cat2',
        subcategoryId: null,
        serviceId: null,
      })
    })

    it('changing the subcategory keeps the category and clears the service', async () => {
      catalog([catA, sub])
      const t = ticket({
        categoryId: 'cat',
        subcategoryId: 'sub',
        serviceId: 'svc',
      })
      expectOk(
        await SdTicketEngine.update(
          t,
          { subcategoryId: 'sub2' },
          agent,
          config(),
        ),
      )
      expect(ticketRepo.update.mock.calls[0][1]).toMatchObject({
        categoryId: 'cat',
        subcategoryId: 'sub2',
        serviceId: null,
      })
    })

    it('changing only the service keeps its ancestors', async () => {
      catalog([catA, subOfCat, svc])
      const t = ticket({ categoryId: 'cat', subcategoryId: 'sub' })
      expectOk(
        await SdTicketEngine.update(t, { serviceId: 'svc2' }, agent, config()),
      )
      expect(ticketRepo.update.mock.calls[0][1]).toMatchObject({
        serviceId: 'svc2',
      })
    })

    it('propagates catalog errors', async () => {
      const t = ticket()
      expectErr(
        await SdTicketEngine.update(t, { categoryId: 'nope' }, agent, config()),
        'SD_CATEGORY_NOT_FOUND',
      )
    })
  })

  describe('priority matrix', () => {
    it('recomputes the priority from impact × urgency', async () => {
      ctxRepo.findMatrixPriorityId.mockResolvedValue(ok('pm'))
      const t = ticket({ urgencyId: 'u' })
      expectOk(
        await SdTicketEngine.update(t, { impactId: 'i' }, agent, config()),
      )
      expect(ctxRepo.findMatrixPriorityId).toHaveBeenCalledWith('ws1', 'i', 'u')
      expect(ticketRepo.update.mock.calls[0][1].priorityId).toBe('pm')
    })

    it('uses the ticket impact when only urgency changes and keeps priority on a matrix miss', async () => {
      ctxRepo.findMatrixPriorityId.mockResolvedValue(ok(null))
      const t = ticket({ impactId: 'i' })
      expectOk(
        await SdTicketEngine.update(t, { urgencyId: 'u' }, agent, config()),
      )
      expect(ctxRepo.findMatrixPriorityId).toHaveBeenCalledWith('ws1', 'i', 'u')
      expect(ticketRepo.update.mock.calls[0][1].priorityId).toBeUndefined()
    })

    it('skips the matrix without both values or with a manual priority', async () => {
      expectOk(
        await SdTicketEngine.update(
          ticket(),
          { impactId: 'i' },
          agent,
          config(),
        ),
      )
      expectOk(
        await SdTicketEngine.update(
          ticket({ urgencyId: 'u' }),
          { impactId: 'i', priorityId: null },
          agent,
          config(),
        ),
      )
      expect(ctxRepo.findMatrixPriorityId).not.toHaveBeenCalled()
    })

    it('propagates matrix errors', async () => {
      ctxRepo.findMatrixPriorityId.mockResolvedValue(err(databaseError()))
      expectErr(
        await SdTicketEngine.update(
          ticket({ urgencyId: 'u' }),
          { impactId: 'i' },
          agent,
          config(),
        ),
        'DATABASE_ERROR',
      )
    })
  })

  it('validates references and members', async () => {
    ctxRepo.findMissingRefs.mockResolvedValueOnce(ok(['departmentId']))
    expectErr(
      await SdTicketEngine.update(
        ticket(),
        { departmentId: 'x' },
        agent,
        config(),
      ),
      'SD_DEPARTMENT_NOT_FOUND',
    )
    expect(ctxRepo.findMissingRefs).toHaveBeenCalledWith('ws1', {
      departmentId: 'x',
    })
    ctxRepo.findNonMembers.mockResolvedValueOnce(ok(['u5']))
    expectErr(
      await SdTicketEngine.update(
        ticket(),
        { requesterId: 'u5' },
        agent,
        config(),
      ),
      'VALIDATION_ERROR',
    )
  })

  it('refuses parent cycles and propagates tree errors', async () => {
    ticketRepo.isDescendantOrSelf.mockResolvedValueOnce(ok(true))
    expectErr(
      await SdTicketEngine.update(ticket(), { parentId: 'p' }, agent, config()),
      'VALIDATION_ERROR',
    )
    ticketRepo.isDescendantOrSelf.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SdTicketEngine.update(ticket(), { parentId: 'p' }, agent, config()),
      'DATABASE_ERROR',
    )
    expectOk(
      await SdTicketEngine.update(ticket(), { parentId: 'p' }, agent, config()),
    )
    expectOk(
      await SdTicketEngine.update(
        ticket({ parentId: 'p' }),
        { parentId: null },
        agent,
        config(),
      ),
    )
    expect(ticketRepo.isDescendantOrSelf).toHaveBeenCalledTimes(3)
  })

  it('merges and validates custom fields', async () => {
    ctxRepo.listTicketCustomFields.mockResolvedValue(
      ok([
        createFakeSdCustomField({ key: 'a' }),
        createFakeSdCustomField({ key: 'b' }),
      ]),
    )
    const t = ticket({ customFields: { a: 'x' } })
    expectOk(
      await SdTicketEngine.update(
        t,
        { customFields: { b: 'y' } },
        agent,
        config(),
      ),
    )
    expect(ticketRepo.update.mock.calls[0][1].customFields).toEqual({
      a: 'x',
      b: 'y',
    })
    expect(recordMock).toHaveBeenCalledWith([
      expect.objectContaining({ field: 'customFields.b', toValue: 'y' }),
    ])
    expectErr(
      await SdTicketEngine.update(
        t,
        { customFields: { z: 1 } },
        agent,
        config(),
      ),
      'SD_CUSTOM_FIELD_INVALID',
    )
    ctxRepo.listTicketCustomFields.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SdTicketEngine.update(
        t,
        { customFields: { b: 'y' } },
        agent,
        config(),
      ),
      'DATABASE_ERROR',
    )
  })

  it('validates custom fields against the new catalog selection', async () => {
    catalog([node({ id: 'cat2' })])
    ctxRepo.listTicketCustomFields.mockResolvedValue(
      ok([createFakeSdCustomField({ key: 'a' })]),
    )
    const t = ticket({ categoryId: 'cat' })
    expectOk(
      await SdTicketEngine.update(
        t,
        { categoryId: 'cat2', customFields: { a: '1' } },
        agent,
        config(),
      ),
    )
  })

  describe('SLA recompute', () => {
    const policies = [
      createFakeSdSlaPolicy({
        id: 'sp',
        isDefault: true,
        targets: [
          {
            id: 'tg',
            policyId: 'sp',
            priorityId: 'p2',
            firstResponseMinutes: 30,
            resolutionMinutes: 600,
          },
        ],
      }),
    ]

    it('recomputes due dates from creation and the breach flags', async () => {
      ctxRepo.listActiveSlaPolicies.mockResolvedValue(ok(policies))
      const t = ticket({
        createdAt: new Date('2026-09-21T11:50:00.000Z'),
        slaAtRiskNotifiedAt: NOW,
      })
      expectOk(
        await SdTicketEngine.update(t, { priorityId: 'p2' }, agent, config()),
      )
      expect(ticketRepo.update.mock.calls[0][1]).toMatchObject({
        slaPolicyId: 'sp',
        firstResponseDueAt: new Date('2026-09-21T12:20:00.000Z'),
        firstResponseBreached: false,
        resolutionDueAt: new Date('2026-09-21T21:50:00.000Z'),
        resolutionBreached: false,
        slaAtRiskNotifiedAt: null,
      })
    })

    it('marks already-overdue timers as breached and keeps completed ones', async () => {
      ctxRepo.listActiveSlaPolicies.mockResolvedValue(ok(policies))
      const old = ticket({ createdAt: new Date('2026-09-20T00:00:00.000Z') })
      expectOk(
        await SdTicketEngine.update(old, { priorityId: 'p2' }, agent, config()),
      )
      expect(ticketRepo.update.mock.calls[0][1]).toMatchObject({
        firstResponseBreached: true,
        resolutionBreached: true,
      })
      const done = ticket({ firstRespondedAt: NOW, resolvedAt: NOW })
      expectOk(
        await SdTicketEngine.update(
          done,
          { priorityId: 'p2' },
          agent,
          config(),
        ),
      )
      const data = ticketRepo.update.mock.calls[1][1]
      expect(data.firstResponseDueAt).toBeUndefined()
      expect(data.resolutionDueAt).toBeUndefined()
    })

    it('keeps the current policy when none applies and tolerates catalog errors', async () => {
      ctxRepo.findCategory.mockResolvedValue(err(databaseError()))
      const t = ticket({ slaPolicyId: 'old', categoryId: 'cat' })
      expectOk(
        await SdTicketEngine.update(t, { priorityId: 'p2' }, agent, config()),
      )
      expect(ticketRepo.update.mock.calls[0][1]).toMatchObject({
        slaPolicyId: 'old',
        firstResponseDueAt: null,
        firstResponseBreached: false,
      })
    })

    it('does not recompute for the same priority, and propagates errors', async () => {
      const t = ticket({ priorityId: 'p2' })
      expectOk(
        await SdTicketEngine.update(t, { priorityId: 'p2' }, agent, config()),
      )
      expect(ctxRepo.listActiveSlaPolicies).not.toHaveBeenCalled()
      ctxRepo.findPriorityLevel.mockResolvedValueOnce(err(databaseError()))
      expectErr(
        await SdTicketEngine.update(
          ticket(),
          { priorityId: 'p3' },
          agent,
          config(),
        ),
        'DATABASE_ERROR',
      )
      ctxRepo.listActiveSlaPolicies.mockResolvedValueOnce(err(databaseError()))
      expectErr(
        await SdTicketEngine.update(
          ticket(),
          { priorityId: 'p3' },
          agent,
          config(),
        ),
        'DATABASE_ERROR',
      )
      expectOk(
        await SdTicketEngine.update(
          ticket({ priorityId: 'p2' }),
          { priorityId: null },
          agent,
          config(),
        ),
      )
    })
  })
})

describe('changePhase', () => {
  const phase = (overrides = {}) =>
    createFakeSdPhase({
      id: 'ph-target',
      name: 'Em andamento',
      category: 'IN_PROGRESS',
      completionPercent: 40,
      ...overrides,
    })

  it('moves, snapshots the percent and records the event', async () => {
    ctxRepo.findPhase.mockResolvedValue(ok(phase()))
    const t = ticket({ phaseId: 'ph-new' })
    const after = expectOk(
      await SdTicketEngine.changePhase(t, 'ph-target', agent, config(), {
        comment: 'bora',
        reason: 'x',
      }),
    )
    expect(after.phaseId).toBe('ph-target')
    expect(ticketRepo.update.mock.calls[0][1]).toMatchObject({
      phaseId: 'ph-target',
      completionPercent: 40,
      lastActivityAt: NOW,
    })
    expect(recordMock).toHaveBeenCalledWith([
      expect.objectContaining({
        action: 'phase.changed',
        toValue: { id: 'ph-target', label: 'Em andamento' },
        meta: {
          fromCategory: 'NEW',
          toCategory: 'IN_PROGRESS',
          comment: 'bora',
          reason: 'x',
        },
      }),
    ])
    expect(publishMock).toHaveBeenCalledWith(
      'ws1',
      expect.objectContaining({ type: 'ticket.phase_changed' }),
      expect.anything(),
    )
    const webhook = vi.mocked(emitWebhookEvent).mock.calls[0]
    expect(webhook[1]).toBe('servicedesk.ticket.updated')
    expect((webhook[2] as () => unknown)()).toMatchObject({ change: 'phase' })
  })

  it.each([
    ['missing', null],
    ['inactive', { active: false }],
    ['of another type', { ticketType: 'CHANGE' }],
  ])('rejects a %s phase', async (_l, overrides) => {
    ctxRepo.findPhase.mockResolvedValue(
      ok(overrides === null ? null : phase(overrides)),
    )
    expectErr(
      await SdTicketEngine.changePhase(ticket(), 'x', agent, config()),
      'SD_PHASE_NOT_FOUND',
    )
  })

  it('is a no-op for the current phase and propagates lookup errors', async () => {
    ctxRepo.findPhase.mockResolvedValueOnce(ok(phase({ id: 'same' })))
    const t = ticket({ phaseId: 'same' })
    expect(
      expectOk(await SdTicketEngine.changePhase(t, 'same', agent, config())),
    ).toBe(t)
    ctxRepo.findPhase.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SdTicketEngine.changePhase(t, 'x', agent, config()),
      'DATABASE_ERROR',
    )
  })

  describe('transitions', () => {
    const tr = (overrides = {}) => ({
      id: 'tr',
      workspaceId: 'ws1',
      fromPhaseId: 'ph-new',
      toPhaseId: 'ph-target',
      allowedDepartmentIds: [] as string[],
      createdAt: NOW,
      ...overrides,
    })

    beforeEach(() => {
      ctxRepo.findPhase.mockResolvedValue(ok(phase()))
    })

    it('refuses a move without a transition', async () => {
      ctxRepo.listTransitions.mockResolvedValue(
        ok([tr({ toPhaseId: 'other' })]),
      )
      expectErr(
        await SdTicketEngine.changePhase(
          ticket({ phaseId: 'ph-new' }),
          'ph-target',
          agent,
          config(),
        ),
        'SD_PHASE_TRANSITION_NOT_ALLOWED',
      )
    })

    it('restricts by department, letting admins, members and system through', async () => {
      ctxRepo.listTransitions.mockResolvedValue(
        ok([tr({ allowedDepartmentIds: ['d9'] })]),
      )
      const t = () => ticket({ phaseId: 'ph-new' })
      const e = expectErr(
        await SdTicketEngine.changePhase(t(), 'ph-target', agent, config()),
        'SD_PHASE_TRANSITION_NOT_ALLOWED',
      )
      expect(e.message).toContain('departamento')
      expectOk(
        await SdTicketEngine.changePhase(t(), 'ph-target', admin, config()),
      )
      expectOk(
        await SdTicketEngine.changePhase(t(), 'ph-target', system, config()),
      )
      expectOk(
        await SdTicketEngine.changePhase(
          t(),
          'ph-target',
          { ...agent, departmentIds: ['d9'] } as SdActor,
          config(),
        ),
      )
      ctxRepo.listTransitions.mockResolvedValue(ok([tr()]))
      expectOk(
        await SdTicketEngine.changePhase(t(), 'ph-target', agent, config()),
      )
    })

    it('propagates transition lookup errors', async () => {
      ctxRepo.listTransitions.mockResolvedValue(err(databaseError()))
      expectErr(
        await SdTicketEngine.changePhase(
          ticket(),
          'ph-target',
          agent,
          config(),
        ),
        'DATABASE_ERROR',
      )
    })
  })

  it('enforces required fields including custom ones', async () => {
    ctxRepo.findPhase.mockResolvedValue(
      ok(
        phase({
          requiredFields: ['assigneeId', 'customFields.contrato', 'title'],
        }),
      ),
    )
    const e = expectErr(
      await SdTicketEngine.changePhase(ticket(), 'ph-target', agent, config()),
      'SD_PHASE_REQUIREMENTS_UNMET',
    )
    expect(e.message).toBe('Preencha antes de mover: Responsável, contrato')
  })

  it('requires an approved approval when configured', async () => {
    ctxRepo.findPhase.mockResolvedValue(ok(phase({ requiresApproval: true })))
    ctxRepo.findLatestStandaloneApprovalStatus.mockResolvedValueOnce(
      ok('PENDING'),
    )
    expectErr(
      await SdTicketEngine.changePhase(ticket(), 'ph-target', agent, config()),
      'SD_APPROVAL_REQUIRED',
    )
    ctxRepo.findLatestStandaloneApprovalStatus.mockResolvedValueOnce(ok(null))
    expectErr(
      await SdTicketEngine.changePhase(ticket(), 'ph-target', agent, config()),
      'SD_APPROVAL_REQUIRED',
    )
    ctxRepo.findLatestStandaloneApprovalStatus.mockResolvedValueOnce(
      err(databaseError()),
    )
    expectErr(
      await SdTicketEngine.changePhase(ticket(), 'ph-target', agent, config()),
      'DATABASE_ERROR',
    )
    expectOk(
      await SdTicketEngine.changePhase(ticket(), 'ph-target', agent, config()),
    )
  })

  it('accepts an approved CAB round instead of a standalone approval', async () => {
    ctxRepo.findPhase.mockResolvedValue(ok(phase({ requiresApproval: true })))
    ctxRepo.findLatestStandaloneApprovalStatus.mockResolvedValue(ok('PENDING'))
    roundRepo.hasApprovedRound.mockResolvedValue(ok(true))
    expectOk(
      await SdTicketEngine.changePhase(ticket(), 'ph-target', agent, config()),
    )
    // Com a rodada aprovada o pedido avulso nem é consultado.
    expect(ctxRepo.findLatestStandaloneApprovalStatus).not.toHaveBeenCalled()
  })

  it('propagates a database error while reading the CAB rounds', async () => {
    ctxRepo.findPhase.mockResolvedValue(ok(phase({ requiresApproval: true })))
    roundRepo.hasApprovedRound.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdTicketEngine.changePhase(ticket(), 'ph-target', agent, config()),
      'DATABASE_ERROR',
    )
  })

  describe('resolve', () => {
    beforeEach(() => {
      ctxRepo.findPhase.mockResolvedValue(
        ok(phase({ category: 'RESOLVED', name: 'Resolvido' })),
      )
    })

    it('requires the solution', async () => {
      const e = expectErr(
        await SdTicketEngine.changePhase(
          ticket({ solution: '  ' }),
          'ph-target',
          agent,
          config(),
        ),
        'SD_PHASE_REQUIREMENTS_UNMET',
      )
      expect(e.message).toContain('solução')
    })

    it('requires the solution classification when the workspace has them', async () => {
      ctxRepo.countSolutionClassifications.mockResolvedValueOnce(ok(2))
      const e = expectErr(
        await SdTicketEngine.changePhase(
          ticket(),
          'ph-target',
          agent,
          config(),
          { solution: 'ok' },
        ),
        'SD_PHASE_REQUIREMENTS_UNMET',
      )
      expect(e.message).toContain('classificação')
      ctxRepo.countSolutionClassifications.mockResolvedValueOnce(
        err(databaseError()),
      )
      expectErr(
        await SdTicketEngine.changePhase(
          ticket(),
          'ph-target',
          agent,
          config(),
          { solution: 'ok' },
        ),
        'DATABASE_ERROR',
      )
    })

    it('stamps resolvedAt, saves the solution and records its diff', async () => {
      const t = ticket()
      expectOk(
        await SdTicketEngine.changePhase(t, 'ph-target', agent, config(), {
          solution: 'Reiniciado',
          solutionClassificationId: 'sc',
        }),
      )
      expect(ctxRepo.findMissingRefs).toHaveBeenCalledWith('ws1', {
        solutionClassificationId: 'sc',
      })
      expect(ctxRepo.countSolutionClassifications).not.toHaveBeenCalled()
      expect(ticketRepo.update.mock.calls[0][1]).toMatchObject({
        resolvedAt: NOW,
        closedAt: null,
        solution: 'Reiniciado',
        solutionClassificationId: 'sc',
      })
      const events = recordMock.mock.calls[0][0] as {
        action: string
        field?: string
      }[]
      expect(events.map((e) => e.field ?? e.action)).toEqual([
        'phaseId',
        'solution',
        'solutionClassificationId',
      ])
    })

    it('schedules the satisfaction survey when the ticket is resolved, never failing the move', async () => {
      vi.mocked(SatisfactionSurveyService.onTicketResolved).mockResolvedValue(
        ok(null),
      )
      expectOk(
        await SdTicketEngine.changePhase(
          ticket(),
          'ph-target',
          agent,
          config(),
          {
            solution: 'Reiniciado',
            solutionClassificationId: 'sc',
          },
        ),
      )
      expect(SatisfactionSurveyService.onTicketResolved).toHaveBeenCalledTimes(
        1,
      )

      vi.mocked(SatisfactionSurveyService.onTicketResolved).mockResolvedValue(
        err(databaseError()),
      )
      expectOk(
        await SdTicketEngine.changePhase(
          ticket(),
          'ph-target',
          agent,
          config(),
          {
            solution: 'Reiniciado',
            solutionClassificationId: 'sc',
          },
        ),
      )
    })

    it('schedules the QA review when the ticket is resolved, never failing the move', async () => {
      const move = () =>
        SdTicketEngine.changePhase(ticket(), 'ph-target', agent, config(), {
          solution: 'Reiniciado',
          solutionClassificationId: 'sc',
        })
      vi.mocked(QaReviewService.onTicketResolved).mockResolvedValue(ok(null))
      expectOk(await move())
      expect(QaReviewService.onTicketResolved).toHaveBeenCalledTimes(1)

      vi.mocked(QaReviewService.onTicketResolved).mockResolvedValue(
        err(databaseError()),
      )
      expectOk(await move())
    })

    it('rejects an invalid solution classification', async () => {
      ctxRepo.findMissingRefs.mockResolvedValueOnce(
        ok(['solutionClassificationId']),
      )
      expectErr(
        await SdTicketEngine.changePhase(
          ticket(),
          'ph-target',
          agent,
          config(),
          {
            solution: 'x',
            solutionClassificationId: 'bad',
          },
        ),
        'SD_CONFIG_NOT_FOUND',
      )
    })

    it('skips solution rules when not required', async () => {
      settings = createFakeSdSettings({ requireSolutionOnResolve: false })
      expectOk(
        await SdTicketEngine.changePhase(
          ticket(),
          'ph-target',
          agent,
          config(),
        ),
      )
    })
  })

  describe('close and cancel', () => {
    it('requires a signature when configured', async () => {
      settings = createFakeSdSettings({ requireSignatureOnClose: true })
      ctxRepo.findPhase.mockResolvedValue(ok(phase({ category: 'CLOSED' })))
      ctxRepo.countSignatures.mockResolvedValueOnce(ok(0))
      expectErr(
        await SdTicketEngine.changePhase(
          ticket(),
          'ph-target',
          agent,
          config(),
        ),
        'SD_SIGNATURE_REQUIRED',
      )
      ctxRepo.countSignatures.mockResolvedValueOnce(err(databaseError()))
      expectErr(
        await SdTicketEngine.changePhase(
          ticket(),
          'ph-target',
          agent,
          config(),
        ),
        'DATABASE_ERROR',
      )
      expectOk(
        await SdTicketEngine.changePhase(
          ticket(),
          'ph-target',
          agent,
          config(),
        ),
      )
    })

    it('stamps closedAt and resolvedAt only when empty', async () => {
      ctxRepo.findPhase.mockResolvedValue(ok(phase({ category: 'CLOSED' })))
      expectOk(
        await SdTicketEngine.changePhase(
          ticket(),
          'ph-target',
          agent,
          config(),
        ),
      )
      expect(ticketRepo.update.mock.calls[0][1]).toMatchObject({
        closedAt: NOW,
        resolvedAt: NOW,
      })
      const earlier = new Date('2026-09-20T00:00:00.000Z')
      expectOk(
        await SdTicketEngine.changePhase(
          ticket({ resolvedAt: earlier }),
          'ph-target',
          agent,
          config(),
        ),
      )
      expect(ticketRepo.update.mock.calls[1][1].resolvedAt).toBeUndefined()
    })

    it('stamps closedAt on cancel', async () => {
      ctxRepo.findPhase.mockResolvedValue(ok(phase({ category: 'CANCELED' })))
      expectOk(
        await SdTicketEngine.changePhase(
          ticket(),
          'ph-target',
          agent,
          config(),
        ),
      )
      expect(ticketRepo.update.mock.calls[0][1]).toMatchObject({
        closedAt: NOW,
      })
      expect(ticketRepo.update.mock.calls[0][1].resolvedAt).toBeUndefined()
    })
  })

  describe('SLA pause', () => {
    it('pauses when entering a pausing phase', async () => {
      ctxRepo.findPhase.mockResolvedValue(
        ok(phase({ category: 'WAITING', pausesSla: true })),
      )
      expectOk(
        await SdTicketEngine.changePhase(
          ticket(),
          'ph-target',
          agent,
          config(),
        ),
      )
      expect(ticketRepo.update.mock.calls[0][1].slaPausedAt).toEqual(NOW)
    })

    it('keeps the pause between pausing phases', async () => {
      ctxRepo.findPhase.mockResolvedValue(
        ok(phase({ category: 'WAITING', pausesSla: true })),
      )
      expectOk(
        await SdTicketEngine.changePhase(
          ticket({ slaPausedAt: NOW }),
          'ph-target',
          agent,
          config(),
        ),
      )
      expect(ticketRepo.update.mock.calls[0][1].slaPausedAt).toBeUndefined()
    })

    it('resumes pushing pending due dates by the paused business minutes', async () => {
      ctxRepo.findPhase.mockResolvedValue(ok(phase()))
      const t = ticket({
        slaPausedAt: new Date('2026-09-21T11:00:00.000Z'),
        slaPausedMinutes: 10,
        firstResponseDueAt: new Date('2026-09-21T12:30:00.000Z'),
        resolutionDueAt: new Date('2026-09-21T15:00:00.000Z'),
      })
      expectOk(
        await SdTicketEngine.changePhase(t, 'ph-target', agent, config()),
      )
      expect(ticketRepo.update.mock.calls[0][1]).toMatchObject({
        slaPausedAt: null,
        slaPausedMinutes: 70,
        firstResponseDueAt: new Date('2026-09-21T13:30:00.000Z'),
        resolutionDueAt: new Date('2026-09-21T16:00:00.000Z'),
      })
    })

    it('does not push completed or missing due dates, also into a final pausing phase', async () => {
      ctxRepo.findPhase.mockResolvedValue(
        ok(phase({ category: 'CANCELED', pausesSla: true })),
      )
      const t = ticket({
        slaPausedAt: new Date('2026-09-21T11:00:00.000Z'),
        firstResponseDueAt: new Date('2026-09-21T12:30:00.000Z'),
        firstRespondedAt: NOW,
        resolutionDueAt: null,
      })
      expectOk(
        await SdTicketEngine.changePhase(t, 'ph-target', agent, config()),
      )
      const data = ticketRepo.update.mock.calls[0][1]
      expect(data.slaPausedAt).toBeNull()
      expect(data.firstResponseDueAt).toBeUndefined()
      expect(data.resolutionDueAt).toBeUndefined()
      const resolved = ticket({
        slaPausedAt: new Date('2026-09-21T11:00:00.000Z'),
        resolutionDueAt: new Date('2026-09-21T15:00:00.000Z'),
        resolvedAt: NOW,
      })
      expectOk(
        await SdTicketEngine.changePhase(
          resolved,
          'ph-target',
          agent,
          config(),
        ),
      )
      expect(ticketRepo.update.mock.calls[1][1].resolutionDueAt).toBeUndefined()
    })
  })

  it('reopens a final ticket and records ticket.reopened', async () => {
    ctxRepo.findPhase.mockResolvedValue(ok(phase()))
    const t = ticket({
      reopenCount: 1,
      resolvedAt: NOW,
      closedAt: NOW,
      phase: { ...createFakeSdTicket().phase, category: 'CLOSED' },
    })
    expectOk(await SdTicketEngine.changePhase(t, 'ph-target', system, config()))
    expect(ticketRepo.update.mock.calls[0][1]).toMatchObject({
      reopenCount: 2,
      resolvedAt: null,
      closedAt: null,
    })
    const events = recordMock.mock.calls[0][0] as {
      action: string
      actorKind: string
    }[]
    expect(events.map((e) => e.action)).toEqual([
      'phase.changed',
      'ticket.reopened',
    ])
    expect(events[0].actorKind).toBe('SYSTEM')
    expect(dispatchSteelAgentEvent).toHaveBeenCalledWith(
      t.workspaceId,
      'sd.ticket.reopened',
      expect.objectContaining({ ticketId: t.id, reopenCount: 2 }),
    )
  })

  it('propagates repository update errors', async () => {
    ctxRepo.findPhase.mockResolvedValue(ok(phase()))
    ticketRepo.update.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SdTicketEngine.changePhase(ticket(), 'ph-target', agent, config()),
      'DATABASE_ERROR',
    )
  })
})

describe('roundRobin', () => {
  it('does nothing without department or candidate', async () => {
    const t = ticket()
    expect(expectOk(await SdTicketEngine.roundRobin(t, system, config()))).toBe(
      t,
    )
    ctxRepo.pickRoundRobinAssignee.mockResolvedValueOnce(ok(null))
    const withDept = ticket({ departmentId: 'd1' })
    expect(
      expectOk(await SdTicketEngine.roundRobin(withDept, system, config())),
    ).toBe(withDept)
    ctxRepo.pickRoundRobinAssignee.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SdTicketEngine.roundRobin(withDept, system, config()),
      'DATABASE_ERROR',
    )
  })

  it('assigns within the ticket department or moves to another one', async () => {
    ctxRepo.pickRoundRobinAssignee.mockResolvedValue(ok('u3'))
    const t = ticket({ departmentId: 'd1' })
    expectOk(await SdTicketEngine.roundRobin(t, system, config()))
    expect(ticketRepo.update.mock.calls[0][1]).toMatchObject({
      assigneeId: 'u3',
    })
    expect(ticketRepo.update.mock.calls[0][1].departmentId).toBeUndefined()
    expectOk(await SdTicketEngine.roundRobin(t, system, config(), 'd2'))
    expect(ticketRepo.update.mock.calls[1][1]).toMatchObject({
      assigneeId: 'u3',
      departmentId: 'd2',
    })
    expect(recordMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          meta: expect.objectContaining({ via: 'round_robin' }),
        }),
      ]),
    )
  })
})

describe('markFirstResponse / touchActivity', () => {
  it('delegates to the repository', async () => {
    ticketRepo.markFirstResponse.mockResolvedValue(ok(true))
    ticketRepo.touchActivity.mockResolvedValue(ok(undefined))
    expect(expectOk(await SdTicketEngine.markFirstResponse('t1'))).toBe(true)
    expect(ticketRepo.markFirstResponse).toHaveBeenCalledWith('t1', NOW)
    expectOk(await SdTicketEngine.touchActivity('t1', NOW))
    expectOk(await SdTicketEngine.touchActivity('t1'))
    expect(ticketRepo.touchActivity).toHaveBeenCalledWith('t1', NOW)
  })
})

describe('reopen', () => {
  const resolved = () =>
    ticket({ phase: { ...createFakeSdTicket().phase, category: 'RESOLVED' } })

  it('does nothing for open tickets', async () => {
    const t = ticket()
    expect(expectOk(await SdTicketEngine.reopen(t, system, config()))).toBe(t)
  })

  it('moves to the first IN_PROGRESS phase, else the initial one', async () => {
    const ip = createFakeSdPhase({ id: 'ip', category: 'IN_PROGRESS' })
    ctxRepo.findFirstPhaseByCategory.mockResolvedValueOnce(ok(ip))
    ctxRepo.findPhase.mockResolvedValue(ok(ip))
    expectOk(await SdTicketEngine.reopen(resolved(), system, config()))
    expect(ctxRepo.findPhase).toHaveBeenCalledWith('ws1', 'ip')

    ctxRepo.findFirstPhaseByCategory.mockResolvedValueOnce(ok(null))
    ctxRepo.findPhase.mockResolvedValue(ok(initial))
    expectOk(await SdTicketEngine.reopen(resolved(), system, config()))
    expect(ctxRepo.findPhase).toHaveBeenLastCalledWith('ws1', 'ph-new')
  })

  it('fails without phases and propagates errors', async () => {
    ctxRepo.findFirstPhaseByCategory.mockResolvedValueOnce(ok(null))
    ctxRepo.findInitialPhase.mockResolvedValueOnce(ok(null))
    expectErr(
      await SdTicketEngine.reopen(resolved(), system, config()),
      'SD_PHASE_NOT_FOUND',
    )
    ctxRepo.findFirstPhaseByCategory.mockResolvedValueOnce(ok(null))
    ctxRepo.findInitialPhase.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SdTicketEngine.reopen(resolved(), system, config()),
      'DATABASE_ERROR',
    )
    ctxRepo.findFirstPhaseByCategory.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SdTicketEngine.reopen(resolved(), system, config()),
      'DATABASE_ERROR',
    )
  })
})
