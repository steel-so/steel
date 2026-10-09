import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sendEmail } from '@/src/lib/mail/send'
import { ok } from '@/src/lib/result'
import type { CrmWorkflowDefinition } from '@/src/schemas/crm-workflow.schema'

vi.mock('@/src/lib/mail/send')

const { crmTask } = vi.hoisted(() => ({
  crmTask: {
    create: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
  },
}))

vi.mock('@/src/lib/prisma', () => ({
  prisma: {
    crmTask,
    crmCompany: {},
    crmPerson: {},
    crmOpportunity: {},
    crmNote: {},
  },
}))

vi.mock('@/src/repositories/crm-workflow.repository', () => ({
  CrmWorkflowRunRepository: {
    setStatus: vi.fn().mockResolvedValue(ok({})),
    createStep: vi.fn().mockResolvedValue(ok({ id: 'step-1' })),
    updateStep: vi.fn().mockResolvedValue(ok({})),
    pause: vi.fn().mockResolvedValue(ok({})),
    clearPause: vi.fn().mockResolvedValue(ok({})),
    findRunWorkflow: vi
      .fn()
      .mockResolvedValue(
        ok({ id: 'wf-1', name: 'Fluxo', createdById: 'owner-1' }),
      ),
  },
}))
vi.mock('../crm-notifications', () => ({
  notifyCrmWorkflowFailed: vi.fn().mockResolvedValue(1),
  notifyCrmWorkflowWaiting: vi.fn().mockResolvedValue(1),
}))

import { CrmWorkflowRunRepository } from '@/src/repositories/crm-workflow.repository'
import {
  notifyCrmWorkflowFailed,
  notifyCrmWorkflowWaiting,
} from '../crm-notifications'
import { resumeCrmWorkflow, runCrmWorkflow } from '../crm-workflow-runner'

const mockedSendEmail = vi.mocked(sendEmail)
const mockedRunRepo = vi.mocked(CrmWorkflowRunRepository)

function baseParams(definition: CrmWorkflowDefinition) {
  return {
    runId: 'run-1',
    workspaceId: 'ws-1',
    actingUserId: 'user-1',
    definition,
    triggerType: 'launch-manually' as const,
    triggerPayload: { record: { id: 'lead-1', email: 'lead@acme.com' } },
    testMode: false,
  }
}

describe('runCrmWorkflow()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedRunRepo.setStatus.mockResolvedValue(ok({} as never))
    mockedRunRepo.createStep.mockResolvedValue(ok({ id: 'step-1' } as never))
    mockedRunRepo.updateStep.mockResolvedValue(ok({} as never))
    mockedRunRepo.pause.mockResolvedValue(ok({} as never))
    mockedRunRepo.clearPause.mockResolvedValue(ok({} as never))
  })

  it('should execute a create-record node and resolve trigger expressions', async () => {
    crmTask.create.mockResolvedValue({ id: 'task-1' })

    const definition: CrmWorkflowDefinition = {
      trigger: {
        id: 'trigger',
        position: { x: 0, y: 0 },
        data: { type: 'launch-manually', inputs: [] },
      },
      nodes: [
        {
          id: 'n1',
          position: { x: 0, y: 0 },
          data: {
            type: 'create-record',
            entity: 'task',
            fields: { title: 'Falar com {{trigger.record.email}}' },
          },
        },
      ],
      edges: [{ id: 'e1', source: 'trigger', target: 'n1' }],
    }

    await runCrmWorkflow(baseParams(definition))

    expect(crmTask.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ title: 'Falar com lead@acme.com' }),
      }),
    )
    expect(mockedRunRepo.setStatus).toHaveBeenCalledWith(
      'run-1',
      'COMPLETED',
      expect.anything(),
    )
  })

  it('filter should stop the branch when the condition fails', async () => {
    const definition: CrmWorkflowDefinition = {
      trigger: {
        id: 'trigger',
        position: { x: 0, y: 0 },
        data: { type: 'launch-manually', inputs: [] },
      },
      nodes: [
        {
          id: 'f1',
          position: { x: 0, y: 0 },
          data: {
            type: 'filter',
            conditions: [
              {
                field: '{{trigger.record.email}}',
                operator: 'equals',
                value: 'nope@x.com',
              },
            ],
          },
        },
        {
          id: 'n1',
          position: { x: 0, y: 0 },
          data: {
            type: 'create-record',
            entity: 'task',
            fields: { title: 'x' },
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'f1' },
        { id: 'e2', source: 'f1', target: 'n1' },
      ],
    }

    await runCrmWorkflow(baseParams(definition))

    expect(crmTask.create).not.toHaveBeenCalled()
    expect(mockedRunRepo.setStatus).toHaveBeenCalledWith(
      'run-1',
      'COMPLETED',
      expect.anything(),
    )
  })

  it('if-else should follow the true branch via sourceHandle', async () => {
    crmTask.create.mockResolvedValue({ id: 'task-1' })

    const definition: CrmWorkflowDefinition = {
      trigger: {
        id: 'trigger',
        position: { x: 0, y: 0 },
        data: { type: 'launch-manually', inputs: [] },
      },
      nodes: [
        {
          id: 'if1',
          position: { x: 0, y: 0 },
          data: {
            type: 'if-else',
            conditions: [
              {
                field: '{{trigger.record.email}}',
                operator: 'equals',
                value: 'lead@acme.com',
              },
            ],
          },
        },
        {
          id: 'onTrue',
          position: { x: 0, y: 0 },
          data: {
            type: 'create-record',
            entity: 'task',
            fields: { title: 'true branch' },
          },
        },
        {
          id: 'onFalse',
          position: { x: 0, y: 0 },
          data: {
            type: 'create-record',
            entity: 'task',
            fields: { title: 'false branch' },
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'if1' },
        { id: 'e2', source: 'if1', target: 'onTrue', sourceHandle: 'true' },
        { id: 'e3', source: 'if1', target: 'onFalse', sourceHandle: 'false' },
      ],
    }

    await runCrmWorkflow(baseParams(definition))

    expect(crmTask.create).toHaveBeenCalledTimes(1)
    expect(crmTask.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ title: 'true branch' }),
      }),
    )
  })

  it('form node should pause the run as WAITING without enqueueing children', async () => {
    crmTask.create.mockResolvedValue({ id: 'task-1' })

    const definition: CrmWorkflowDefinition = {
      trigger: {
        id: 'trigger',
        position: { x: 0, y: 0 },
        data: { type: 'launch-manually', inputs: [] },
      },
      nodes: [
        {
          id: 'form1',
          position: { x: 0, y: 0 },
          data: {
            type: 'form',
            title: 'Preencha',
            fields: [{ name: 'ok', type: 'boolean', required: false }],
          },
        },
        {
          id: 'n1',
          position: { x: 0, y: 0 },
          data: {
            type: 'create-record',
            entity: 'task',
            fields: { title: 'depois do form' },
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'form1' },
        { id: 'e2', source: 'form1', target: 'n1' },
      ],
    }

    await runCrmWorkflow(baseParams(definition))

    expect(crmTask.create).not.toHaveBeenCalled()
    expect(mockedRunRepo.pause).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ waitingStepId: 'step-1' }),
    )
    expect(mockedRunRepo.setStatus).toHaveBeenCalledWith('run-1', 'WAITING')
    expect(mockedRunRepo.setStatus).not.toHaveBeenCalledWith(
      'run-1',
      'COMPLETED',
      expect.anything(),
    )
  })

  it('send-email should call the mail lib and mark the run completed', async () => {
    mockedSendEmail.mockResolvedValue({ id: 'msg-1' } as never)

    const definition: CrmWorkflowDefinition = {
      trigger: {
        id: 'trigger',
        position: { x: 0, y: 0 },
        data: { type: 'launch-manually', inputs: [] },
      },
      nodes: [
        {
          id: 'mail1',
          position: { x: 0, y: 0 },
          data: {
            type: 'send-email',
            to: '{{trigger.record.email}}',
            subject: 'Oi',
            body: '<p>Oi</p>',
          },
        },
      ],
      edges: [{ id: 'e1', source: 'trigger', target: 'mail1' }],
    }

    await runCrmWorkflow(baseParams(definition))

    expect(mockedSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'lead@acme.com', subject: 'Oi' }),
    )
    expect(mockedRunRepo.setStatus).toHaveBeenCalledWith(
      'run-1',
      'COMPLETED',
      expect.anything(),
    )
  })

  it('should mark the run FAILED and record the step error when a node throws', async () => {
    mockedSendEmail.mockRejectedValue(new Error('boom'))

    const definition: CrmWorkflowDefinition = {
      trigger: {
        id: 'trigger',
        position: { x: 0, y: 0 },
        data: { type: 'launch-manually', inputs: [] },
      },
      nodes: [
        {
          id: 'mail1',
          position: { x: 0, y: 0 },
          data: {
            type: 'send-email',
            to: 'x@y.com',
            subject: 'Oi',
            body: '<p>Oi</p>',
          },
        },
      ],
      edges: [{ id: 'e1', source: 'trigger', target: 'mail1' }],
    }

    await runCrmWorkflow(baseParams(definition))

    expect(mockedRunRepo.updateStep).toHaveBeenCalledWith(
      'step-1',
      expect.objectContaining({
        status: 'FAILED',
        error: expect.stringContaining('boom'),
      }),
    )
    expect(mockedRunRepo.setStatus).toHaveBeenCalledWith(
      'run-1',
      'FAILED',
      expect.objectContaining({ error: expect.stringContaining('boom') }),
    )
  })
})

/* ======================= cobertura ampliada ======================= */

type NodeSpec = { id: string; data: Record<string, unknown> }

/**
 * Monta uma definition. Sem `edges`, encadeia trigger → n[0] → n[1] → ...
 * O runner não revalida o schema, então aceitamos dados crus.
 */
function def(
  nodes: NodeSpec[],
  edges?: Array<{ source: string; target: string; sourceHandle?: string }>,
): CrmWorkflowDefinition {
  const chain =
    edges ??
    nodes.map((n, i) => ({
      source: i === 0 ? 'trigger' : nodes[i - 1].id,
      target: n.id,
    }))
  return {
    trigger: {
      id: 'trigger',
      position: { x: 0, y: 0 },
      data: { type: 'launch-manually', inputs: [] },
    },
    nodes: nodes.map((n) => ({ ...n, position: { x: 0, y: 0 } })),
    edges: chain.map((e, i) => ({ id: `e${i}`, ...e })),
  } as unknown as CrmWorkflowDefinition
}

/** Output gravado no step N (ordem das chamadas COMPLETED/SKIPPED). */
function stepOutputs(): unknown[] {
  return mockedRunRepo.updateStep.mock.calls.map(
    (call) => (call[1] as { output?: unknown }).output,
  )
}

function stepStatuses(): string[] {
  return mockedRunRepo.updateStep.mock.calls.map(
    (call) => (call[1] as { status: string }).status,
  )
}

function lastSetStatus() {
  return mockedRunRepo.setStatus.mock.calls.at(-1)
}

describe('runCrmWorkflow() — node executors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedRunRepo.setStatus.mockResolvedValue(ok({} as never))
    mockedRunRepo.createStep.mockResolvedValue(ok({ id: 'step-1' } as never))
    mockedRunRepo.updateStep.mockResolvedValue(ok({} as never))
    mockedRunRepo.pause.mockResolvedValue(ok({} as never))
    mockedRunRepo.clearPause.mockResolvedValue(ok({} as never))
  })

  describe('create-record', () => {
    it('should drop empty values and inject workspace/creator', async () => {
      crmTask.create.mockResolvedValue({ id: 'task-9' })
      await runCrmWorkflow(
        baseParams(
          def([
            {
              id: 'n1',
              data: {
                type: 'create-record',
                entity: 'task',
                fields: {
                  title: 'Oi',
                  empty: '',
                  missing: '{{trigger.record.nope}}',
                  nested: '{{trigger.record.id.deep}}',
                },
              },
            },
          ]),
        ),
      )
      expect(crmTask.create).toHaveBeenCalledWith({
        data: { title: 'Oi', workspaceId: 'ws-1', createdById: 'user-1' },
      })
      expect(stepOutputs()[0]).toMatchObject({ id: 'task-9', title: 'Oi' })
    })

    it('should interpolate objects as JSON and nullish values as empty strings', async () => {
      crmTask.create.mockResolvedValue({ id: 'task-1' })
      await runCrmWorkflow({
        ...baseParams(
          def([
            {
              id: 'n1',
              data: {
                type: 'create-record',
                entity: 'task',
                fields: {
                  title: 'rec={{trigger.record}} nada={{trigger.record.x}}',
                },
              },
            },
          ]),
        ),
        triggerPayload: { record: { x: null } },
      })
      expect(crmTask.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ title: 'rec={"x":null} nada=' }),
      })
    })

    it('should use the whole payload as the record when there is no `record` key', async () => {
      crmTask.create.mockResolvedValue({ id: 'task-1' })
      await runCrmWorkflow({
        ...baseParams(
          def([
            {
              id: 'n1',
              data: {
                type: 'create-record',
                entity: 'task',
                fields: { title: '{{trigger.record.name}}' },
              },
            },
          ]),
        ),
        triggerPayload: { name: 'Direto' },
      })
      expect(crmTask.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ title: 'Direto' }),
      })
    })

    it('should only simulate in test mode', async () => {
      await runCrmWorkflow({
        ...baseParams(
          def([
            {
              id: 'n1',
              data: {
                type: 'create-record',
                entity: 'task',
                fields: { title: 'x' },
              },
            },
          ]),
        ),
        testMode: true,
      })
      expect(crmTask.create).not.toHaveBeenCalled()
      expect(stepOutputs()[0]).toEqual({
        simulated: true,
        fields: { title: 'x' },
      })
    })
  })

  describe('update-record', () => {
    const node = (recordId: string) => ({
      id: 'n1',
      data: {
        type: 'update-record',
        entity: 'task',
        recordId,
        fields: { title: 'Atualizado' },
      },
    })

    it('should update the resolved record id stamping updatedById', async () => {
      crmTask.update.mockResolvedValue({ id: 'lead-1' })
      await runCrmWorkflow(baseParams(def([node('{{trigger.record.id}}')])))
      expect(crmTask.update).toHaveBeenCalledWith({
        where: { id: 'lead-1' },
        data: { title: 'Atualizado', updatedById: 'user-1' },
      })
      expect(stepOutputs()[0]).toEqual({ id: 'lead-1', title: 'Atualizado' })
    })

    it('should skip when the record id resolves empty', async () => {
      await runCrmWorkflow(baseParams(def([node('{{trigger.record.none}}')])))
      expect(crmTask.update).not.toHaveBeenCalled()
      expect(stepOutputs()[0]).toEqual({
        skipped: true,
        reason: 'no recordId',
      })
    })

    it('should only simulate in test mode', async () => {
      await runCrmWorkflow({
        ...baseParams(def([node('abc')])),
        testMode: true,
      })
      expect(crmTask.update).not.toHaveBeenCalled()
      expect(stepOutputs()[0]).toEqual({
        simulated: true,
        id: 'abc',
        fields: { title: 'Atualizado' },
      })
    })
  })

  describe('delete-record', () => {
    const node = (recordId: string) => ({
      id: 'n1',
      data: { type: 'delete-record', entity: 'task', recordId },
    })

    it('should soft delete the record', async () => {
      crmTask.update.mockResolvedValue({ id: 't1' })
      await runCrmWorkflow(baseParams(def([node('t1')])))
      expect(crmTask.update).toHaveBeenCalledWith({
        where: { id: 't1' },
        data: { deletedAt: expect.any(Date), updatedById: 'user-1' },
      })
      expect(stepOutputs()[0]).toEqual({ id: 't1', deleted: true })
    })

    it('should skip without a record id', async () => {
      await runCrmWorkflow(baseParams(def([node('')])))
      expect(crmTask.update).not.toHaveBeenCalled()
      expect(stepOutputs()[0]).toEqual({
        skipped: true,
        reason: 'no recordId',
      })
    })

    it('should only simulate in test mode', async () => {
      await runCrmWorkflow({ ...baseParams(def([node('t1')])), testMode: true })
      expect(crmTask.update).not.toHaveBeenCalled()
      expect(stepOutputs()[0]).toEqual({ simulated: true, id: 't1' })
    })
  })

  describe('search-records + iterator', () => {
    it('should translate every condition operator into a Prisma where and feed the iterator', async () => {
      crmTask.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }])
      await runCrmWorkflow(
        baseParams(
          def([
            {
              id: 's1',
              data: {
                type: 'search-records',
                entity: 'task',
                limit: 10,
                outputAlias: 'found',
                conditions: [
                  { field: 'status', operator: 'equals', value: 'OPEN' },
                  { field: 'title', operator: 'not_equals', value: 'x' },
                  {
                    field: 'description',
                    operator: 'contains',
                    value: '{{trigger.record.email}}',
                  },
                  { field: 'priority', operator: 'gt', value: '2' },
                  { field: 'order', operator: 'lt', value: '9' },
                  { field: 'dueAt', operator: 'is_empty', value: '' },
                  { field: 'ownerId', operator: 'is_not_empty', value: '' },
                  { field: 'ignored', operator: 'gte', value: '1' },
                  { field: '', operator: 'equals', value: 'skip' },
                ],
              },
            },
            {
              id: 'it1',
              data: {
                type: 'iterator',
                source: '{{steps.found.output}}',
                itemAlias: 'item',
              },
            },
          ]),
        ),
      )

      expect(crmTask.findMany).toHaveBeenCalledWith({
        where: {
          workspaceId: 'ws-1',
          deletedAt: null,
          status: 'OPEN',
          title: { not: 'x' },
          description: { contains: 'lead@acme.com', mode: 'insensitive' },
          priority: { gt: 2 },
          order: { lt: 9 },
          dueAt: null,
          ownerId: { not: null },
        },
        take: 10,
      })
      expect(stepOutputs()[1]).toEqual({
        items: 2,
        sample: [{ id: 'a' }, { id: 'b' }],
      })
    })

    it('should report an empty iterator when the source is not an array', async () => {
      await runCrmWorkflow(
        baseParams(
          def([
            {
              id: 'it1',
              data: {
                type: 'iterator',
                source: '{{trigger.record.email}}',
                itemAlias: 'item',
              },
            },
          ]),
        ),
      )
      expect(stepOutputs()[0]).toEqual({ items: 0, sample: [] })
    })
  })

  describe('create-or-update-record', () => {
    const node = {
      id: 'n1',
      data: {
        type: 'create-or-update-record',
        entity: 'task',
        lookupField: 'externalId',
        lookupValue: '{{trigger.record.id}}',
        fields: { title: 'Upsert' },
      },
    }

    it('should update the existing record found by the lookup', async () => {
      crmTask.findFirst.mockResolvedValue({ id: 'existing' })
      crmTask.update.mockResolvedValue({ id: 'existing' })
      await runCrmWorkflow(baseParams(def([node])))
      expect(crmTask.findFirst).toHaveBeenCalledWith({
        where: { workspaceId: 'ws-1', deletedAt: null, externalId: 'lead-1' },
      })
      expect(crmTask.update).toHaveBeenCalledWith({
        where: { id: 'existing' },
        data: { title: 'Upsert', updatedById: 'user-1' },
      })
      expect(crmTask.create).not.toHaveBeenCalled()
      expect(stepOutputs()[0]).toMatchObject({ action: 'updated' })
    })

    it('should create with the lookup field when nothing matches', async () => {
      crmTask.findFirst.mockResolvedValue(null)
      crmTask.create.mockResolvedValue({ id: 'new' })
      await runCrmWorkflow(baseParams(def([node])))
      expect(crmTask.create).toHaveBeenCalledWith({
        data: {
          title: 'Upsert',
          externalId: 'lead-1',
          workspaceId: 'ws-1',
          createdById: 'user-1',
        },
      })
      expect(stepOutputs()[0]).toMatchObject({ id: 'new', action: 'created' })
    })

    it('should only simulate the write in test mode', async () => {
      crmTask.findFirst.mockResolvedValue({ id: 'existing' })
      await runCrmWorkflow({ ...baseParams(def([node])), testMode: true })
      expect(crmTask.update).not.toHaveBeenCalled()
      expect(crmTask.create).not.toHaveBeenCalled()
      expect(stepOutputs()[0]).toEqual({
        simulated: true,
        lookupValue: 'lead-1',
        fields: { title: 'Upsert' },
      })
    })
  })

  describe('filter operators', () => {
    const cases: Array<[string, unknown, string, boolean]> = [
      ['equals', 'a', 'a', true],
      ['not_equals', 'a', 'b', true],
      ['not_equals', 'a', 'a', false],
      ['contains', 'hello world', 'world', true],
      ['contains', 42, '4', false],
      ['not_contains', 'hello', 'x', true],
      ['not_contains', 42, 'x', false],
      ['is_empty', null, '', true],
      ['is_empty', '', '', true],
      ['is_empty', [], '', true],
      ['is_empty', 'x', '', false],
      ['is_not_empty', 'x', '', true],
      ['is_not_empty', [], '', false],
      ['gt', 5, '3', true],
      ['gte', 3, '3', true],
      ['lt', 2, '3', true],
      ['lte', 4, '3', false],
    ]

    it.each(cases)('%s(%j, %j) → %s', async (operator, left, right, passes) => {
      crmTask.create.mockResolvedValue({ id: 't' })
      await runCrmWorkflow({
        ...baseParams(
          def([
            {
              id: 'f1',
              data: {
                type: 'filter',
                conditions: [
                  { field: '{{trigger.record.v}}', operator, value: right },
                ],
              },
            },
            {
              id: 'n1',
              data: {
                type: 'create-record',
                entity: 'task',
                fields: { title: 'passou' },
              },
            },
          ]),
        ),
        triggerPayload: { record: { v: left } },
      })
      expect(stepStatuses()[0]).toBe(passes ? 'COMPLETED' : 'SKIPPED')
      expect(crmTask.create).toHaveBeenCalledTimes(passes ? 1 : 0)
    })

    it('should treat a missing condition value as empty string', async () => {
      await runCrmWorkflow({
        ...baseParams(
          def([
            {
              id: 'f1',
              data: {
                type: 'filter',
                conditions: [
                  { field: '{{trigger.record.v}}', operator: 'equals' },
                ],
              },
            },
          ]),
        ),
        triggerPayload: { record: { v: '' } },
      })
      expect(stepOutputs()[0]).toEqual({ passes: true })
    })

    it('should resolve paths through primitives as undefined', async () => {
      await runCrmWorkflow(
        baseParams(
          def([
            {
              id: 'f1',
              data: {
                type: 'filter',
                conditions: [
                  {
                    field: '{{trigger.type.length}}',
                    operator: 'is_empty',
                    value: '',
                  },
                ],
              },
            },
          ]),
        ),
      )
      expect(stepOutputs()[0]).toEqual({ passes: true })
    })
  })

  describe('if-else', () => {
    it('should follow only the false branch when conditions fail', async () => {
      crmTask.create.mockResolvedValue({ id: 't' })
      await runCrmWorkflow(
        baseParams(
          def(
            [
              {
                id: 'if1',
                data: {
                  type: 'if-else',
                  conditions: [
                    {
                      field: '{{trigger.record.email}}',
                      operator: 'equals',
                      value: 'other@x.com',
                    },
                  ],
                },
              },
              {
                id: 'yes',
                data: {
                  type: 'create-record',
                  entity: 'task',
                  fields: { title: 'yes' },
                },
              },
              {
                id: 'no',
                data: {
                  type: 'create-record',
                  entity: 'task',
                  fields: { title: 'no' },
                },
              },
              {
                id: 'unlabeled',
                data: {
                  type: 'create-record',
                  entity: 'task',
                  fields: { title: 'unlabeled' },
                },
              },
            ],
            [
              { source: 'trigger', target: 'if1' },
              { source: 'if1', target: 'yes', sourceHandle: 'true' },
              { source: 'if1', target: 'no', sourceHandle: 'false' },
              { source: 'if1', target: 'unlabeled' },
            ],
          ),
        ),
      )
      expect(crmTask.create).toHaveBeenCalledTimes(1)
      expect(crmTask.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ title: 'no' }),
      })
      expect(stepOutputs()[0]).toEqual({ branch: 'false' })
    })
  })

  describe('delay', () => {
    // Real (non-test) delays pause the run: see crm-workflow-delay.test.ts.
    it.each([
      ['seconds', { amount: 1, unit: 'seconds' }, 1000],
      ['days', { amount: 1, unit: 'days' }, 86_400_000],
      [
        'unknown unit (defaults to minutes)',
        { amount: 2, unit: 'weeks' },
        120_000,
      ],
    ])(
      'should only record a %s delay in test mode',
      async (_label, data, ms) => {
        await runCrmWorkflow({
          ...baseParams(def([{ id: 'd1', data: { type: 'delay', ...data } }])),
          testMode: true,
        })
        expect(stepOutputs()[0]).toEqual({ simulated: true, delayMs: ms })
        expect(mockedRunRepo.pause).not.toHaveBeenCalled()
        expect(lastSetStatus()?.[1]).toBe('COMPLETED')
      },
    )
  })
  describe('send-email / draft-email', () => {
    const mail = (to: string, body = '<p>x</p>') => ({
      id: 'm1',
      data: {
        type: 'send-email',
        to,
        subject: 'Olá {{trigger.record.id}}',
        body,
      },
    })

    it('should simulate in test mode', async () => {
      await runCrmWorkflow({
        ...baseParams(def([mail('a@b.com')])),
        testMode: true,
      })
      expect(mockedSendEmail).not.toHaveBeenCalled()
      expect(stepOutputs()[0]).toEqual({
        simulated: true,
        to: 'a@b.com',
        subject: 'Olá lead-1',
      })
    })

    it('should skip when the recipient resolves empty', async () => {
      await runCrmWorkflow(baseParams(def([mail('{{trigger.record.none}}')])))
      expect(mockedSendEmail).not.toHaveBeenCalled()
      expect(stepOutputs()[0]).toEqual({
        skipped: true,
        reason: 'no recipient',
      })
    })

    it('should send a placeholder body and a null messageId when absent', async () => {
      mockedSendEmail.mockResolvedValue({} as never)
      await runCrmWorkflow(baseParams(def([mail('a@b.com', '')])))
      expect(mockedSendEmail).toHaveBeenCalledWith({
        to: 'a@b.com',
        subject: 'Olá lead-1',
        html: '<p></p>',
      })
      expect(stepOutputs()[0]).toEqual({
        messageId: null,
        to: 'a@b.com',
        subject: 'Olá lead-1',
      })
    })

    it('should stringify a non-Error send failure', async () => {
      mockedSendEmail.mockRejectedValue('smtp down')
      await runCrmWorkflow(baseParams(def([mail('a@b.com')])))
      expect(lastSetStatus()).toEqual([
        'run-1',
        'FAILED',
        expect.objectContaining({ error: 'sendEmail: smtp down' }),
      ])
    })

    it('should resolve a draft without sending', async () => {
      await runCrmWorkflow(
        baseParams(
          def([
            {
              id: 'dr1',
              data: {
                type: 'draft-email',
                to: '{{trigger.record.email}}',
                subject: 'Rascunho',
                body: 'Oi {{trigger.record.id}}',
              },
            },
          ]),
        ),
      )
      expect(mockedSendEmail).not.toHaveBeenCalled()
      expect(stepOutputs()[0]).toEqual({
        drafted: true,
        to: 'lead@acme.com',
        subject: 'Rascunho',
        body: 'Oi lead-1',
      })
    })
  })
})

describe('runCrmWorkflow() — graph traversal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedRunRepo.setStatus.mockResolvedValue(ok({} as never))
    mockedRunRepo.createStep.mockResolvedValue(ok({ id: 'step-1' } as never))
    mockedRunRepo.updateStep.mockResolvedValue(ok({} as never))
    mockedRunRepo.pause.mockResolvedValue(ok({} as never))
  })

  const task = (id: string, title = id, extra = {}) => ({
    id,
    data: {
      type: 'create-record',
      entity: 'task',
      fields: { title },
      ...extra,
    },
  })

  it('should run a diamond join node only once and ignore edges to unknown nodes', async () => {
    crmTask.create.mockResolvedValue({ id: 't' })
    await runCrmWorkflow(
      baseParams(
        def(
          [task('a'), task('b'), task('join')],
          [
            { source: 'trigger', target: 'a' },
            { source: 'trigger', target: 'b' },
            { source: 'trigger', target: 'ghost' },
            { source: 'a', target: 'join' },
            { source: 'b', target: 'join' },
          ],
        ),
      ),
    )
    expect(crmTask.create.mock.calls.map((c) => c[0].data.title)).toEqual([
      'a',
      'b',
      'join',
    ])
    expect(lastSetStatus()?.[1]).toBe('COMPLETED')
  })

  it('should expose a node output under its outputAlias to later nodes', async () => {
    crmTask.create
      .mockResolvedValueOnce({ id: 'first-id' })
      .mockResolvedValueOnce({ id: 'second-id' })
    await runCrmWorkflow(
      baseParams(
        def([
          task('a', 'primeira', { outputAlias: 'primeira' }),
          task('b', 'ref {{steps.primeira.output.id}}'),
        ]),
      ),
    )
    expect(crmTask.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ title: 'ref first-id' }),
    })
  })

  it('should keep the first error, continue sibling branches and fail the run', async () => {
    crmTask.create
      .mockRejectedValueOnce(new Error('first'))
      .mockRejectedValueOnce('second')
      .mockResolvedValueOnce({ id: 'ok' })
    await runCrmWorkflow(
      baseParams(
        def(
          [task('a'), task('b'), task('c')],
          [
            { source: 'trigger', target: 'a' },
            { source: 'trigger', target: 'b' },
            { source: 'trigger', target: 'c' },
          ],
        ),
      ),
    )
    expect(stepStatuses()).toEqual(['FAILED', 'FAILED', 'COMPLETED'])
    expect(mockedRunRepo.updateStep.mock.calls[1][1]).toMatchObject({
      error: 'second',
    })
    expect(lastSetStatus()).toEqual([
      'run-1',
      'FAILED',
      expect.objectContaining({ error: 'first', finishedAt: expect.any(Date) }),
    ])
  })

  it('should still execute and finish when step rows cannot be created', async () => {
    mockedRunRepo.createStep.mockResolvedValue({
      ok: false,
      error: { code: 'DATABASE_ERROR', message: 'x' },
    } as never)
    crmTask.create.mockRejectedValueOnce(new Error('nope'))
    await runCrmWorkflow(
      baseParams(
        def([
          {
            id: 'f1',
            data: {
              type: 'filter',
              conditions: [{ field: 'a', operator: 'equals', value: 'a' }],
            },
          },
          task('a'),
        ]),
      ),
    )
    expect(mockedRunRepo.updateStep).not.toHaveBeenCalled()
    expect(lastSetStatus()).toEqual([
      'run-1',
      'FAILED',
      expect.objectContaining({ error: 'nope' }),
    ])
  })

  it('should not pause on a form when its step row could not be created', async () => {
    mockedRunRepo.createStep.mockResolvedValue({
      ok: false,
      error: { code: 'DATABASE_ERROR', message: 'x' },
    } as never)
    crmTask.create.mockResolvedValue({ id: 't' })
    await runCrmWorkflow(
      baseParams(
        def([
          {
            id: 'form1',
            data: {
              type: 'form',
              title: 'F',
              fields: [{ name: 'ok', type: 'boolean', required: false }],
            },
          },
          task('after'),
        ]),
      ),
    )
    expect(mockedRunRepo.pause).not.toHaveBeenCalled()
    expect(crmTask.create).toHaveBeenCalledTimes(1)
    expect(lastSetStatus()?.[1]).toBe('COMPLETED')
  })

  it('should persist the scope and a PENDING form step when pausing', async () => {
    await runCrmWorkflow(
      baseParams(
        def([
          {
            id: 'form1',
            data: {
              type: 'form',
              title: 'F',
              fields: [
                { name: 'ok', type: 'boolean', required: false },
                { name: 'nota', type: 'text', required: false },
              ],
            },
          },
        ]),
      ),
    )
    expect(mockedRunRepo.updateStep).toHaveBeenCalledWith('step-1', {
      status: 'PENDING',
      output: {
        paused: true,
        fields: ['ok', 'nota'],
        title: 'F',
        assigneeId: null,
      },
      startedAt: expect.any(Date),
    })
    expect(mockedRunRepo.pause).toHaveBeenCalledWith('run-1', {
      state: expect.objectContaining({
        trigger: expect.objectContaining({ type: 'launch-manually' }),
      }),
      waitingStepId: 'step-1',
    })
  })

  it('should complete immediately a workflow with no nodes', async () => {
    await runCrmWorkflow(baseParams(def([])))
    expect(mockedRunRepo.createStep).not.toHaveBeenCalled()
    expect(mockedRunRepo.setStatus.mock.calls.map((c) => c[1])).toEqual([
      'RUNNING',
      'COMPLETED',
    ])
  })
})

describe('resumeCrmWorkflow()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedRunRepo.setStatus.mockResolvedValue(ok({} as never))
    mockedRunRepo.createStep.mockResolvedValue(ok({ id: 'step-2' } as never))
    mockedRunRepo.updateStep.mockResolvedValue(ok({} as never))
    mockedRunRepo.clearPause.mockResolvedValue(ok({} as never))
  })

  const definition = def(
    [
      {
        id: 'form1',
        data: {
          type: 'form',
          title: 'F',
          fields: [{ name: 'nome', type: 'text', required: true }],
        },
      },
      {
        id: 'after',
        data: {
          type: 'create-record',
          entity: 'task',
          fields: {
            title: 'Olá {{steps.aprov.output.nome}} ({{steps.prev.output}})',
          },
        },
      },
    ],
    [
      { source: 'trigger', target: 'form1' },
      { source: 'form1', target: 'after' },
      // ciclo de volta ao form — não deve reexecutar o node pausado
      { source: 'after', target: 'form1' },
    ],
  )

  function resumeParams(scope: Record<string, unknown>) {
    return {
      runId: 'run-1',
      workspaceId: 'ws-1',
      actingUserId: 'user-1',
      definition,
      triggerType: 'launch-manually' as const,
      triggerPayload: {},
      waitingStepId: 'step-1',
      pausedNodeId: 'form1',
      scope,
      submission: { nome: 'Ana' },
      outputAlias: 'aprov',
    }
  }

  it('should complete the waiting step, clear the pause and run the children with the submission', async () => {
    crmTask.create.mockResolvedValue({ id: 't' })
    await resumeCrmWorkflow(
      resumeParams({ trigger: {}, steps: { prev: { output: 'antes' } } }),
    )

    expect(mockedRunRepo.updateStep).toHaveBeenCalledWith('step-1', {
      status: 'COMPLETED',
      output: { nome: 'Ana' },
      finishedAt: expect.any(Date),
    })
    expect(mockedRunRepo.clearPause).toHaveBeenCalledWith('run-1')
    expect(crmTask.create).toHaveBeenCalledTimes(1)
    expect(crmTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ title: 'Olá Ana (antes)' }),
    })
    expect(mockedRunRepo.setStatus.mock.calls.map((c) => c[1])).toEqual([
      'RUNNING',
      'COMPLETED',
    ])
  })

  it('should tolerate a persisted scope without steps', async () => {
    crmTask.create.mockResolvedValue({ id: 't' })
    await resumeCrmWorkflow(resumeParams({ trigger: {} }))
    expect(crmTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ title: 'Olá Ana ()' }),
    })
  })
})

describe('runCrmWorkflow() — unresolved expressions', () => {
  const none = '{{trigger.record.none}}'

  beforeEach(() => {
    vi.clearAllMocks()
    mockedRunRepo.setStatus.mockResolvedValue(ok({} as never))
    mockedRunRepo.createStep.mockResolvedValue(ok({ id: 'step-1' } as never))
    mockedRunRepo.updateStep.mockResolvedValue(ok({} as never))
  })

  it('search-records should drop conditions whose field is unresolved and default a missing value', async () => {
    crmTask.findMany.mockResolvedValue([])
    await runCrmWorkflow(
      baseParams(
        def([
          {
            id: 's1',
            data: {
              type: 'search-records',
              entity: 'task',
              limit: 5,
              outputAlias: 'found',
              conditions: [
                { field: none, operator: 'equals', value: 'x' },
                { field: 'dueAt', operator: 'is_empty' },
                { field: 'title', operator: 'equals' },
              ],
            },
          },
        ]),
      ),
    )
    expect(crmTask.findMany).toHaveBeenCalledWith({
      where: { workspaceId: 'ws-1', deletedAt: null, dueAt: null, title: '' },
      take: 5,
    })
  })

  it('delete-record should skip when the record id resolves to nothing', async () => {
    await runCrmWorkflow(
      baseParams(
        def([
          {
            id: 'd1',
            data: { type: 'delete-record', entity: 'task', recordId: none },
          },
        ]),
      ),
    )
    expect(crmTask.update).not.toHaveBeenCalled()
    expect(stepOutputs()[0]).toEqual({ skipped: true, reason: 'no recordId' })
  })

  it('send-email should use empty subject/body when they resolve to nothing', async () => {
    await runCrmWorkflow({
      ...baseParams(
        def([
          {
            id: 'm1',
            data: {
              type: 'send-email',
              to: 'a@b.com',
              subject: none,
              body: none,
            },
          },
        ]),
      ),
      testMode: true,
    })
    expect(stepOutputs()[0]).toEqual({
      simulated: true,
      to: 'a@b.com',
      subject: '',
    })
  })

  it('draft-email should produce empty strings for unresolved fields', async () => {
    await runCrmWorkflow(
      baseParams(
        def([
          {
            id: 'dr1',
            data: { type: 'draft-email', to: none, subject: none, body: none },
          },
        ]),
      ),
    )
    expect(stepOutputs()[0]).toEqual({
      drafted: true,
      to: '',
      subject: '',
      body: '',
    })
  })

  it('filter should compare an unresolved right side as null', async () => {
    await runCrmWorkflow({
      ...baseParams(
        def([
          {
            id: 'f1',
            data: {
              type: 'filter',
              conditions: [
                {
                  field: '{{trigger.record.v}}',
                  operator: 'equals',
                  value: none,
                },
              ],
            },
          },
        ]),
      ),
      triggerPayload: { record: { v: null } },
    })
    expect(stepOutputs()[0]).toEqual({ passes: true })
  })

  it('filter should accept raw non-string values from stored definitions', async () => {
    await runCrmWorkflow({
      ...baseParams(
        def([
          {
            id: 'f1',
            data: {
              type: 'filter',
              conditions: [
                { field: '{{trigger.record.v}}', operator: 'equals', value: 5 },
              ],
            },
          },
        ]),
      ),
      triggerPayload: { record: { v: 5 } },
    })
    expect(stepOutputs()[0]).toEqual({ passes: true })
  })
})

describe('runCrmWorkflow() — notifications', () => {
  const failing = (): CrmWorkflowDefinition =>
    ({
      trigger: {
        id: 'trigger',
        position: { x: 0, y: 0 },
        data: { type: 'launch-manually', inputs: [] },
      },
      nodes: [
        {
          id: 'mail',
          position: { x: 0, y: 0 },
          data: { type: 'send-email', to: 'a@b.com', subject: 's', body: 'b' },
        },
      ],
      edges: [{ id: 'e1', source: 'trigger', target: 'mail' }],
    }) as unknown as CrmWorkflowDefinition

  const formFlow = (assigneeId?: string): CrmWorkflowDefinition =>
    ({
      trigger: {
        id: 'trigger',
        position: { x: 0, y: 0 },
        data: { type: 'launch-manually', inputs: [] },
      },
      nodes: [
        {
          id: 'form1',
          position: { x: 0, y: 0 },
          data: {
            type: 'form',
            title: 'Aprovar desconto',
            fields: [{ name: 'ok', type: 'boolean', required: false }],
            ...(assigneeId ? { assigneeId } : {}),
          },
        },
      ],
      edges: [{ id: 'e1', source: 'trigger', target: 'form1' }],
    }) as unknown as CrmWorkflowDefinition

  beforeEach(() => {
    vi.clearAllMocks()
    mockedRunRepo.setStatus.mockResolvedValue(ok({} as never))
    mockedRunRepo.createStep.mockResolvedValue(ok({ id: 'step-1' } as never))
    mockedRunRepo.updateStep.mockResolvedValue(ok({} as never))
    mockedRunRepo.pause.mockResolvedValue(ok({} as never))
    mockedRunRepo.findRunWorkflow.mockResolvedValue(
      ok({ id: 'wf-1', name: 'Fluxo', createdById: 'owner-1' }),
    )
  })

  it('should notify the workflow owner when a run fails', async () => {
    mockedSendEmail.mockRejectedValue(new Error('smtp down'))

    await runCrmWorkflow(baseParams(failing()))

    expect(notifyCrmWorkflowFailed).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      workflow: { id: 'wf-1', name: 'Fluxo', createdById: 'owner-1' },
      runId: 'run-1',
      error: 'sendEmail: smtp down',
      actorId: null,
    })
  })

  it('should treat the person who pressed Run as the actor in test mode', async () => {
    await runCrmWorkflow({ ...baseParams(formFlow()), testMode: true })

    expect(notifyCrmWorkflowWaiting).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'user-1' }),
    )
  })

  it('should not notify when the workflow of the run is gone', async () => {
    mockedSendEmail.mockRejectedValue(new Error('smtp down'))
    mockedRunRepo.findRunWorkflow.mockResolvedValue(ok(null))

    await runCrmWorkflow(baseParams(failing()))

    expect(notifyCrmWorkflowFailed).not.toHaveBeenCalled()
  })

  it('should notify the resolved form assignee when a run pauses', async () => {
    await runCrmWorkflow({
      ...baseParams(formFlow('{{trigger.record.ownerId}}')),
      triggerPayload: { record: { id: 'lead-1', ownerId: 'seller-1' } },
    })

    expect(notifyCrmWorkflowWaiting).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      workflow: { id: 'wf-1', name: 'Fluxo', createdById: 'owner-1' },
      stepId: 'step-1',
      formTitle: 'Aprovar desconto',
      assigneeId: 'seller-1',
      actorId: null,
    })
    expect(notifyCrmWorkflowFailed).not.toHaveBeenCalled()
  })

  it('should pass no assignee when the form has none', async () => {
    await runCrmWorkflow(baseParams(formFlow()))

    expect(notifyCrmWorkflowWaiting).toHaveBeenCalledWith(
      expect.objectContaining({ assigneeId: null }),
    )
  })
})
