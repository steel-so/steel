import { NodeApiError, NodeOperationError } from 'n8n-workflow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fail, makeContext, ok, type Params, page } from './helpers'

const client = {
  servicedesk: {
    tickets: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      comment: vi.fn(),
      move: vi.fn(),
    },
    phases: vi.fn(),
  },
  crm: {
    leads: { list: vi.fn(), create: vi.fn() },
    opportunities: { list: vi.fn(), move: vi.fn() },
    pipelines: vi.fn(),
  },
  whatsapp: {
    templates: vi.fn(),
    sendTemplate: vi.fn(),
    conversations: { waiting: vi.fn() },
  },
  request: vi.fn(),
}

vi.mock('@steel-so/sdk', async (importActual) => ({
  ...(await importActual<typeof import('@steel-so/sdk')>()),
  createSteelClient: () => client,
}))

const { Steel } = await import('../nodes/Steel/Steel.node')
const { compact } = await import('../nodes/Steel/operations')

const node = new Steel()

function run(params: Params, extra: Record<string, unknown> = {}) {
  const ctx = makeContext(params, extra)
  return { ctx, result: node.execute.call(ctx as never) }
}

async function json(params: Params) {
  const [out] = await run(params).result
  return (out ?? []).map((item) => item.json)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('description', () => {
  it('declares the credential and is usable as an AI tool', () => {
    expect(node.description.credentials).toEqual([
      { name: 'steelApi', required: true },
    ])
    expect(node.description.usableAsTool).toBe(true)
    const resource = node.description.properties.find(
      (property) => property.name === 'resource',
    )
    expect(resource?.options).toHaveLength(6)
  })

  it('gives every operation a matching handler', () => {
    const operations = node.description.properties.filter(
      (property) => property.name === 'operation',
    )
    const pairs = operations.flatMap((property) => {
      const resource = (
        property.displayOptions?.show?.resource as string[] | undefined
      )?.[0]
      return (property.options ?? []).map((option) => [
        resource,
        (option as { value: string }).value,
      ])
    })
    expect(pairs.length).toBeGreaterThan(10)
  })
})

describe('compact', () => {
  it('drops empty values only', () => {
    expect(
      compact({ a: '', b: undefined, c: null, d: [], e: 0, f: false, g: 'x' }),
    ).toEqual({ e: 0, f: false, g: 'x' })
  })
})

describe('ticket', () => {
  it('creates a ticket with the optional fields', async () => {
    client.servicedesk.tickets.create.mockResolvedValue(ok({ id: 't1' }))
    const rows = await json({
      resource: 'ticket',
      operation: 'create',
      ticketType: 'INCIDENT',
      title: 'Sem internet',
      description: 'Desde cedo',
      additionalFields: { priorityId: 'p1', tags: 'a, b', serviceId: '' },
    })
    expect(rows).toEqual([{ id: 't1' }])
    expect(client.servicedesk.tickets.create).toHaveBeenCalledWith({
      type: 'INCIDENT',
      title: 'Sem internet',
      description: 'Desde cedo',
      channel: 'API',
      priorityId: 'p1',
      tags: ['a', 'b'],
    })
  })

  it('creates a ticket without description or extras', async () => {
    client.servicedesk.tickets.create.mockResolvedValue(ok({ id: 't2' }))
    await json({
      resource: 'ticket',
      operation: 'create',
      ticketType: 'CHANGE',
      title: 'Janela',
      description: '',
      additionalFields: { tags: ['x'] },
    })
    expect(client.servicedesk.tickets.create).toHaveBeenCalledWith({
      type: 'CHANGE',
      title: 'Janela',
      channel: 'API',
      tags: ['x'],
    })
  })

  it('gets a ticket by id or number', async () => {
    client.servicedesk.tickets.get.mockResolvedValue(ok({ id: 't1' }))
    await json({ resource: 'ticket', operation: 'get', ticketId: 'INC-1' })
    expect(client.servicedesk.tickets.get).toHaveBeenCalledWith('INC-1')
  })

  it('lists tickets with CSV filters turned into arrays', async () => {
    client.servicedesk.tickets.list.mockResolvedValue(page([{ id: 'a' }]))
    const rows = await json({
      resource: 'ticket',
      operation: 'getAll',
      returnAll: false,
      limit: 10,
      filters: {
        q: 'rede',
        status: ['NEW'],
        phaseId: 'f1, f2',
        assigneeId: 'me',
      },
    })
    expect(rows).toEqual([{ id: 'a' }])
    expect(client.servicedesk.tickets.list).toHaveBeenCalledWith({
      q: 'rede',
      status: ['NEW'],
      phaseId: ['f1', 'f2'],
      assigneeId: ['me'],
      limit: 10,
    })
  })

  it('follows the cursor when returning all', async () => {
    client.servicedesk.tickets.list
      .mockResolvedValueOnce(page([{ id: 'a' }], 'c1'))
      .mockResolvedValueOnce(page([{ id: 'b' }]))
    const rows = await json({
      resource: 'ticket',
      operation: 'getAll',
      returnAll: true,
      filters: {},
    })
    expect(rows).toEqual([{ id: 'a' }, { id: 'b' }])
    expect(client.servicedesk.tickets.list).toHaveBeenLastCalledWith({
      limit: 100,
      cursor: 'c1',
    })
  })

  it('comments with the chosen visibility', async () => {
    client.servicedesk.tickets.comment.mockResolvedValue(ok({ id: 'm1' }))
    await json({
      resource: 'ticket',
      operation: 'comment',
      ticketId: 't1',
      commentBody: 'Olá',
      visibility: 'INTERNAL',
    })
    expect(client.servicedesk.tickets.comment).toHaveBeenCalledWith('t1', {
      body: 'Olá',
      visibility: 'INTERNAL',
    })
  })

  it('moves the phase with the optional solution', async () => {
    client.servicedesk.tickets.move.mockResolvedValue(ok({ id: 't1' }))
    await json({
      resource: 'ticket',
      operation: 'changePhase',
      ticketId: 't1',
      phaseId: 'ph9',
      phaseOptions: { solution: 'Reiniciado', comment: '' },
    })
    expect(client.servicedesk.tickets.move).toHaveBeenCalledWith('t1', {
      solution: 'Reiniciado',
      phaseId: 'ph9',
    })
  })

  it('turns an API failure into a NodeApiError', async () => {
    client.servicedesk.tickets.get.mockResolvedValue(
      fail(404, 'NOT_FOUND', 'Chamado não encontrado'),
    )
    await expect(
      run({ resource: 'ticket', operation: 'get', ticketId: 'x' }).result,
    ).rejects.toBeInstanceOf(NodeApiError)
  })
})

describe('lead', () => {
  it('creates a lead splitting e-mails and phones', async () => {
    client.crm.leads.create.mockResolvedValue(ok({ id: 'l1' }))
    await json({
      resource: 'lead',
      operation: 'create',
      name: 'Carlos',
      source: 'n8n',
      additionalFields: {
        emails: 'a@x.com, b@x.com',
        phones: '+5511999990000',
        company: 'ACME',
      },
    })
    expect(client.crm.leads.create).toHaveBeenCalledWith({
      emails: ['a@x.com', 'b@x.com'],
      phones: ['+5511999990000'],
      company: 'ACME',
      name: 'Carlos',
      source: 'n8n',
    })
  })

  it('keeps e-mails that already come as an array', async () => {
    client.crm.leads.create.mockResolvedValue(ok({ id: 'l1' }))
    await json({
      resource: 'lead',
      operation: 'create',
      name: 'Ana',
      source: 'n8n',
      additionalFields: { emails: ['a@x.com'] },
    })
    expect(client.crm.leads.create).toHaveBeenCalledWith({
      emails: ['a@x.com'],
      name: 'Ana',
      source: 'n8n',
    })
  })

  it('lists leads by stage', async () => {
    client.crm.leads.list.mockResolvedValue(page([{ id: 'l1' }]))
    const rows = await json({
      resource: 'lead',
      operation: 'getAll',
      returnAll: false,
      limit: 5,
      filters: { stage: 'QUALIFIED' },
    })
    expect(rows).toEqual([{ id: 'l1' }])
    expect(client.crm.leads.list).toHaveBeenCalledWith({
      stage: 'QUALIFIED',
      limit: 5,
    })
  })
})

describe('opportunity', () => {
  it('lists opportunities of a pipeline', async () => {
    client.crm.opportunities.list.mockResolvedValue(page([{ id: 'o1' }]))
    await json({
      resource: 'opportunity',
      operation: 'getAll',
      returnAll: false,
      limit: 20,
      filters: { pipelineId: 'pp1' },
    })
    expect(client.crm.opportunities.list).toHaveBeenCalledWith({
      pipelineId: 'pp1',
      limit: 20,
    })
  })

  it('moves to a stage, with and without a pipeline', async () => {
    client.crm.opportunities.move.mockResolvedValue(ok({ id: 'o1' }))
    await json({
      resource: 'opportunity',
      operation: 'moveStage',
      opportunityId: 'o1',
      stageId: 's2',
      pipelineId: 'pp2',
    })
    expect(client.crm.opportunities.move).toHaveBeenLastCalledWith('o1', {
      stageId: 's2',
      pipelineId: 'pp2',
    })
    await json({
      resource: 'opportunity',
      operation: 'moveStage',
      opportunityId: 'o1',
      stageId: 's3',
      pipelineId: '',
    })
    expect(client.crm.opportunities.move).toHaveBeenLastCalledWith('o1', {
      stageId: 's3',
    })
  })
})

describe('whatsapp template', () => {
  it('lists templates', async () => {
    client.whatsapp.templates.mockResolvedValue(page([{ id: 'tp1' }]))
    await json({
      resource: 'template',
      operation: 'getAll',
      returnAll: false,
      limit: 3,
      filters: { status: 'APPROVED' },
    })
    expect(client.whatsapp.templates).toHaveBeenCalledWith({
      status: 'APPROVED',
      limit: 3,
    })
  })

  it('sends a template to a phone number with components', async () => {
    client.whatsapp.sendTemplate.mockResolvedValue(ok({ id: 'wm1' }))
    await json({
      resource: 'template',
      operation: 'send',
      recipientType: 'to',
      to: '+5511999990000',
      templateName: 'lembrete',
      language: 'pt_BR',
      sendOptions: {
        components: '[{"type":"body","parameters":[]}]',
        connectionId: 'c1',
      },
    })
    expect(client.whatsapp.sendTemplate).toHaveBeenCalledWith({
      to: '+5511999990000',
      connectionId: 'c1',
      templateName: 'lembrete',
      language: 'pt_BR',
      components: [{ type: 'body', parameters: [] }],
    })
  })

  it('sends to a conversation without components', async () => {
    client.whatsapp.sendTemplate.mockResolvedValue(ok({ id: 'wm1' }))
    await json({
      resource: 'template',
      operation: 'send',
      recipientType: 'conversationId',
      conversationId: 'cv1',
      templateName: 'lembrete',
      language: 'pt_BR',
      sendOptions: { components: [] },
    })
    expect(client.whatsapp.sendTemplate).toHaveBeenCalledWith({
      conversationId: 'cv1',
      templateName: 'lembrete',
      language: 'pt_BR',
    })
  })

  it('accepts components given as an array', async () => {
    client.whatsapp.sendTemplate.mockResolvedValue(ok({ id: 'wm1' }))
    await json({
      resource: 'template',
      operation: 'send',
      recipientType: 'contactId',
      contactId: 'ct1',
      templateName: 't',
      language: 'pt_BR',
      sendOptions: { components: [{ type: 'body' }], connectionId: 'c1' },
    })
    expect(client.whatsapp.sendTemplate).toHaveBeenCalledWith({
      contactId: 'ct1',
      connectionId: 'c1',
      templateName: 't',
      language: 'pt_BR',
      components: [{ type: 'body' }],
    })
  })

  it('rejects invalid JSON and non-array components', async () => {
    const base = {
      resource: 'template',
      operation: 'send',
      recipientType: 'to',
      to: '+5511999990000',
      templateName: 't',
      language: 'pt_BR',
    }
    await expect(
      run({ ...base, sendOptions: { components: '{oops' } }).result,
    ).rejects.toThrow('"Components" is not valid JSON')
    await expect(
      run({ ...base, sendOptions: { components: '{"a":1}' } }).result,
    ).rejects.toThrow('must be a JSON array')
    expect(client.whatsapp.sendTemplate).not.toHaveBeenCalled()
  })

  it('treats a blank components string as none', async () => {
    client.whatsapp.sendTemplate.mockResolvedValue(ok({ id: 'wm1' }))
    await json({
      resource: 'template',
      operation: 'send',
      recipientType: 'to',
      to: '+5511999990000',
      templateName: 't',
      language: 'pt_BR',
      sendOptions: { components: '  ' },
    })
    expect(client.whatsapp.sendTemplate).toHaveBeenCalledWith({
      to: '+5511999990000',
      templateName: 't',
      language: 'pt_BR',
    })
  })
})

describe('whatsapp conversation', () => {
  it('lists the waiting queue', async () => {
    client.whatsapp.conversations.waiting.mockResolvedValue(
      page([{ id: 'cv1' }]),
    )
    const rows = await json({
      resource: 'conversation',
      operation: 'getWaiting',
      returnAll: false,
      limit: 10,
      filters: { teamId: 'tm1' },
    })
    expect(rows).toEqual([{ id: 'cv1' }])
    expect(client.whatsapp.conversations.waiting).toHaveBeenCalledWith({
      teamId: 'tm1',
      limit: 10,
    })
  })
})

describe('custom API call', () => {
  it('calls a GET route with a query', async () => {
    client.request.mockResolvedValue(
      ok({ status: 200, ok: true, headers: new Headers(), body: { id: 'u' } }),
    )
    const rows = await json({
      resource: 'apiCall',
      operation: 'create', // left over from another resource
      method: 'GET',
      path: ' /api/v1/me ',
      query: '{"a":"1"}',
    })
    expect(rows).toEqual([{ id: 'u' }])
    expect(client.request).toHaveBeenCalledWith({
      method: 'GET',
      path: '/api/v1/me',
      query: { a: '1' },
    })
  })

  it('sends a JSON body on POST and wraps a non-object answer', async () => {
    client.request.mockResolvedValue(
      ok({ status: 204, ok: true, headers: new Headers(), body: null }),
    )
    const rows = await json({
      resource: 'apiCall',
      method: 'POST',
      path: '/api/v1/crm/leads',
      query: '{}',
      body: { name: 'x' },
    })
    expect(rows).toEqual([{ statusCode: 204, body: null }])
    expect(client.request).toHaveBeenCalledWith({
      method: 'POST',
      path: '/api/v1/crm/leads',
      body: { name: 'x' },
    })
  })

  it('omits an empty body and empty query', async () => {
    client.request.mockResolvedValue(
      ok({ status: 200, ok: true, headers: new Headers(), body: {} }),
    )
    await json({
      resource: 'apiCall',
      method: 'PUT',
      path: '/api/v1/x',
      query: '',
      body: '',
    })
    expect(client.request).toHaveBeenCalledWith({
      method: 'PUT',
      path: '/api/v1/x',
    })
  })

  it('reports an HTTP error answer', async () => {
    client.request.mockResolvedValue(
      ok({
        status: 422,
        ok: false,
        headers: new Headers(),
        body: { error: 'x' },
      }),
    )
    await expect(
      run({
        resource: 'apiCall',
        method: 'GET',
        path: '/api/v1/x',
        query: '{}',
      }).result,
    ).rejects.toThrow('Steel answered 422')
  })

  it('refuses paths outside /api/v1/ and invalid JSON', async () => {
    await expect(
      run({ resource: 'apiCall', method: 'GET', path: '/api/auth/x' }).result,
    ).rejects.toThrow('must start with /api/v1/')
    await expect(
      run({ resource: 'apiCall', method: 'GET', path: '/api/v1/../x' }).result,
    ).rejects.toBeInstanceOf(NodeOperationError)
    await expect(
      run({
        resource: 'apiCall',
        method: 'GET',
        path: '/api/v1/x',
        query: '{bad',
      }).result,
    ).rejects.toThrow('"Query" is not valid JSON')
    expect(client.request).not.toHaveBeenCalled()
  })
})

describe('execute', () => {
  it('rejects an unknown resource', async () => {
    await expect(
      run({ resource: 'nope', operation: 'x' }).result,
    ).rejects.toThrow('not supported')
  })

  it('returns an error item with continueOnFail', async () => {
    client.servicedesk.tickets.get.mockResolvedValue(fail(500, 'HTTP_ERROR'))
    const { result } = run(
      { resource: 'ticket', operation: 'get', ticketId: 'x' },
      { continueOnFail: () => true },
    )
    const [out] = await result
    expect(out?.[0]?.json).toEqual({ error: 'HTTP_ERROR' })
    expect(out?.[0]?.pairedItem).toEqual({ item: 0 })
  })

  it('runs once per input item', async () => {
    client.servicedesk.tickets.get.mockResolvedValue(ok({ id: 't' }))
    const { result } = run(
      { resource: 'ticket', operation: 'get', ticketId: 'x' },
      { getInputData: () => [{ json: {} }, { json: {} }] },
    )
    const [out] = await result
    expect(out).toHaveLength(2)
    expect(out?.[1]?.pairedItem).toEqual({ item: 1 })
  })
})

describe('loadOptions', () => {
  const methods = node.methods.loadOptions

  it('labels phases with their ticket type', async () => {
    client.servicedesk.phases.mockResolvedValue(
      page([{ id: 'ph1', name: 'Novo', ticketType: 'INCIDENT' }]),
    )
    expect(await methods.getPhases.call(makeContext() as never)).toEqual([
      { name: 'Novo (INCIDENT)', value: 'ph1' },
    ])
  })

  it('lists pipelines', async () => {
    client.crm.pipelines.mockResolvedValue(
      page([{ id: 'pp1', name: 'Vendas', stages: [] }]),
    )
    expect(await methods.getPipelines.call(makeContext() as never)).toEqual([
      { name: 'Vendas', value: 'pp1' },
    ])
  })

  it('lists the stages of the chosen pipeline, or all of them', async () => {
    client.crm.pipelines.mockResolvedValue(
      page([
        { id: 'pp1', name: 'Vendas', stages: [{ id: 's1', name: 'Novo' }] },
        { id: 'pp2', name: 'Pós', stages: [{ id: 's2', name: 'Ativo' }] },
        { id: 'pp3', name: 'Vazio' },
      ]),
    )
    const chosen = makeContext(
      {},
      { getCurrentNodeParameter: () => 'pp2' },
    ) as never
    expect(await methods.getStages.call(chosen)).toEqual([
      { name: 'Ativo', value: 's2' },
    ])
    const all = makeContext(
      {},
      { getCurrentNodeParameter: () => undefined },
    ) as never
    expect(await methods.getStages.call(all)).toEqual([
      { name: 'Vendas › Novo', value: 's1' },
      { name: 'Pós › Ativo', value: 's2' },
    ])
  })
})
