import { signPayload } from '@steel-so/sdk'
import { NodeApiError, NodeOperationError } from 'n8n-workflow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fail, makeContext, ok, type Params, page } from './helpers'

const client = {
  webhooks: {
    events: vi.fn(),
    listEndpoints: vi.fn(),
    createEndpoint: vi.fn(),
    deleteEndpoint: vi.fn(),
  },
}

vi.mock('@steel-so/sdk', async (importActual) => ({
  ...(await importActual<typeof import('@steel-so/sdk')>()),
  createSteelClient: () => client,
}))

const { SteelTrigger } = await import('../nodes/SteelTrigger/SteelTrigger.node')

const trigger = new SteelTrigger()
const methods = trigger.webhookMethods.default
const WEBHOOK_URL = 'https://n8n.example.com.br/webhook/abc/webhook'

function hookContext(params: Params = { events: ['crm.deal.won'] }) {
  return makeContext(params, {
    getNodeWebhookUrl: () => WEBHOOK_URL,
    getWorkflow: () => ({ id: 'wf1', name: 'Avisar vendas' }),
  })
}

beforeEach(() => vi.clearAllMocks())

describe('description', () => {
  it('is a webhook trigger with no input', () => {
    expect(trigger.description.group).toEqual(['trigger'])
    expect(trigger.description.inputs).toEqual([])
    expect(trigger.description.webhooks?.[0]).toMatchObject({
      httpMethod: 'POST',
      responseMode: 'onReceived',
    })
  })
})

describe('getEvents', () => {
  it('offers all events first, then the subscribable catalog', async () => {
    client.webhooks.events.mockResolvedValue(
      ok([
        {
          type: 'steel.ping',
          module: 'PLATFORM',
          description: 'Teste',
          subscribable: false,
        },
        {
          type: 'crm.deal.won',
          module: 'CRM',
          description: 'Negócio ganho',
          subscribable: true,
        },
        {
          type: 'x.y',
          module: 'OTHER',
          description: 'Novo módulo',
          subscribable: true,
        },
      ]),
    )
    const options = await trigger.methods.loadOptions.getEvents.call(
      makeContext() as never,
    )
    expect(options.map((option) => option.value)).toEqual([
      '*',
      'crm.deal.won',
      'x.y',
    ])
    expect(options[1]).toMatchObject({
      name: 'CRM: crm.deal.won',
      description: 'Negócio ganho',
    })
    expect(options[2]?.name).toBe('OTHER: x.y')
  })
})

describe('webhookMethods.create', () => {
  it('registers the endpoint and keeps id and secret', async () => {
    client.webhooks.createEndpoint.mockResolvedValue(
      ok({ endpoint: { id: 'ep1' }, secret: 'whsec_abc' }, 201),
    )
    const ctx = hookContext()
    expect(await methods.create.call(ctx as never)).toBe(true)
    expect(client.webhooks.createEndpoint).toHaveBeenCalledWith({
      url: WEBHOOK_URL,
      description: 'n8n: Avisar vendas',
      events: ['crm.deal.won'],
      active: true,
    })
    expect(ctx.staticData).toEqual({ endpointId: 'ep1', secret: 'whsec_abc' })
  })

  it('collapses the selection to * when "All Events" is chosen', async () => {
    client.webhooks.createEndpoint.mockResolvedValue(
      ok({ endpoint: { id: 'ep1' }, secret: 's' }, 201),
    )
    await methods.create.call(
      hookContext({ events: ['crm.deal.won', '*'] }) as never,
    )
    expect(client.webhooks.createEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({ events: ['*'] }),
    )
  })

  it('names the endpoint after the workflow id when it has no name', async () => {
    client.webhooks.createEndpoint.mockResolvedValue(
      ok({ endpoint: { id: 'ep1' }, secret: 's' }, 201),
    )
    const ctx = makeContext(
      { events: ['*'] },
      {
        getNodeWebhookUrl: () => WEBHOOK_URL,
        getWorkflow: () => ({ id: 'wf9' }),
      },
    )
    await methods.create.call(ctx as never)
    expect(client.webhooks.createEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'n8n: wf9' }),
    )
  })

  it('names the endpoint "workflow" when it has neither', async () => {
    client.webhooks.createEndpoint.mockResolvedValue(
      ok({ endpoint: { id: 'ep1' }, secret: 's' }, 201),
    )
    const ctx = makeContext(
      { events: ['*'] },
      { getNodeWebhookUrl: () => WEBHOOK_URL, getWorkflow: () => ({}) },
    )
    await methods.create.call(ctx as never)
    expect(client.webhooks.createEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'n8n: workflow' }),
    )
  })

  it('fails when n8n gives no webhook URL', async () => {
    const ctx = makeContext(
      { events: ['*'] },
      { getNodeWebhookUrl: () => undefined },
    )
    await expect(methods.create.call(ctx as never)).rejects.toBeInstanceOf(
      NodeOperationError,
    )
  })

  it('explains a refusal (for example an http:// n8n URL)', async () => {
    client.webhooks.createEndpoint.mockResolvedValue(
      fail(400, 'VALIDATION_ERROR', 'A URL precisa começar com https://'),
    )
    await expect(methods.create.call(hookContext() as never)).rejects.toThrow(
      'https://',
    )
  })
})

describe('webhookMethods.checkExists', () => {
  it('is false without recorded data', async () => {
    expect(await methods.checkExists.call(hookContext() as never)).toBe(false)
    expect(client.webhooks.listEndpoints).not.toHaveBeenCalled()
  })

  it('is true when the endpoint still points to this webhook', async () => {
    client.webhooks.listEndpoints.mockResolvedValue(
      page([{ id: 'ep1', url: WEBHOOK_URL }]),
    )
    const ctx = hookContext()
    ctx.staticData.endpointId = 'ep1'
    ctx.staticData.secret = 's'
    expect(await methods.checkExists.call(ctx as never)).toBe(true)
  })

  it('is false (keeping data) when the URL changed', async () => {
    client.webhooks.listEndpoints.mockResolvedValue(
      page([{ id: 'ep1', url: 'https://old.example.com/x' }]),
    )
    const ctx = hookContext()
    ctx.staticData.endpointId = 'ep1'
    ctx.staticData.secret = 's'
    expect(await methods.checkExists.call(ctx as never)).toBe(false)
    expect(ctx.staticData.endpointId).toBe('ep1')
  })

  it('forgets the data when Steel no longer has the endpoint', async () => {
    client.webhooks.listEndpoints.mockResolvedValue(page([]))
    const ctx = hookContext()
    ctx.staticData.endpointId = 'ep1'
    ctx.staticData.secret = 's'
    expect(await methods.checkExists.call(ctx as never)).toBe(false)
    expect(ctx.staticData).toEqual({})
  })
})

describe('webhookMethods.delete', () => {
  it('does nothing without a recorded endpoint', async () => {
    expect(await methods.delete.call(hookContext() as never)).toBe(true)
    expect(client.webhooks.deleteEndpoint).not.toHaveBeenCalled()
  })

  it('removes the endpoint and clears the data', async () => {
    client.webhooks.deleteEndpoint.mockResolvedValue(ok({ id: 'ep1' }))
    const ctx = hookContext()
    ctx.staticData.endpointId = 'ep1'
    ctx.staticData.secret = 's'
    expect(await methods.delete.call(ctx as never)).toBe(true)
    expect(client.webhooks.deleteEndpoint).toHaveBeenCalledWith('ep1')
    expect(ctx.staticData).toEqual({})
  })

  it('accepts an endpoint that is already gone', async () => {
    client.webhooks.deleteEndpoint.mockResolvedValue(fail(404, 'NOT_FOUND'))
    const ctx = hookContext()
    ctx.staticData.endpointId = 'ep1'
    expect(await methods.delete.call(ctx as never)).toBe(true)
    expect(ctx.staticData.endpointId).toBeUndefined()
  })

  it('surfaces any other failure and keeps the data', async () => {
    client.webhooks.deleteEndpoint.mockResolvedValue(fail(403, 'FORBIDDEN'))
    const ctx = hookContext()
    ctx.staticData.endpointId = 'ep1'
    await expect(methods.delete.call(ctx as never)).rejects.toBeInstanceOf(
      NodeApiError,
    )
    expect(ctx.staticData.endpointId).toBe('ep1')
  })
})

describe('webhook', () => {
  const SECRET = 'whsec_test_secret'
  const event = {
    id: 'evt1',
    type: 'crm.deal.won',
    createdAt: '2026-11-06T12:00:00.000Z',
    workspaceId: 'ws1',
    data: { deal: { id: 'd1' } },
  }

  function delivery(options: {
    secret?: string
    verify?: boolean
    sign?: string
    body?: string
    timestamp?: number
    rawBody?: unknown
    headers?: Record<string, string | string[]>
  }) {
    const body = options.body ?? JSON.stringify(event)
    const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000)
    const json = vi.fn()
    const status = vi.fn(() => ({ json }))
    const ctx = makeContext(
      { options: options.verify === false ? { verifySignature: false } : {} },
      {
        getRequestObject: () => ({
          rawBody:
            'rawBody' in options ? options.rawBody : Buffer.from(body, 'utf8'),
        }),
        getHeaderData: () =>
          options.headers ?? {
            'steel-signature': signPayload(
              options.sign ?? SECRET,
              timestamp,
              body,
            ),
            'steel-webhook-timestamp': String(timestamp),
          },
        getBodyData: () => JSON.parse(body),
        getResponseObject: () => ({ status }),
      },
    )
    if (options.secret !== '') ctx.staticData.secret = options.secret ?? SECRET
    return { ctx, status, json }
  }

  it('starts the workflow with the event when the signature is valid', async () => {
    const { ctx } = delivery({})
    const out = await trigger.webhook.call(ctx as never)
    expect(out.workflowData?.[0]?.[0]?.json).toEqual(event)
  })

  it('rejects a signature made with another secret', async () => {
    const { ctx, status, json } = delivery({ sign: 'whsec_other' })
    const out = await trigger.webhook.call(ctx as never)
    expect(out).toEqual({ noWebhookResponse: true })
    expect(status).toHaveBeenCalledWith(401)
    expect(json).toHaveBeenCalledWith({ error: 'invalid signature' })
  })

  it('rejects a stale timestamp', async () => {
    const { ctx, status } = delivery({
      timestamp: Math.floor(Date.now() / 1000) - 3600,
    })
    const out = await trigger.webhook.call(ctx as never)
    expect(out.noWebhookResponse).toBe(true)
    expect(status).toHaveBeenCalledWith(401)
  })

  it('rejects when the secret is unknown or the raw body is missing', async () => {
    const noSecret = delivery({ secret: '' })
    expect(
      (await trigger.webhook.call(noSecret.ctx as never)).noWebhookResponse,
    ).toBe(true)
    const noRaw = delivery({ rawBody: undefined })
    expect(
      (await trigger.webhook.call(noRaw.ctx as never)).noWebhookResponse,
    ).toBe(true)
  })

  it('rejects missing signature headers', async () => {
    const { ctx } = delivery({ headers: {} })
    expect((await trigger.webhook.call(ctx as never)).noWebhookResponse).toBe(
      true,
    )
  })

  it('reads array-valued headers', async () => {
    const body = JSON.stringify(event)
    const timestamp = Math.floor(Date.now() / 1000)
    const { ctx } = delivery({
      headers: {
        'steel-signature': [signPayload(SECRET, timestamp, body)],
        'steel-webhook-timestamp': [String(timestamp)],
      },
    })
    const out = await trigger.webhook.call(ctx as never)
    expect(out.workflowData).toBeDefined()
  })

  it('skips the check when "Verify Signature" is off', async () => {
    const { ctx } = delivery({ verify: false, headers: {}, secret: '' })
    const out = await trigger.webhook.call(ctx as never)
    expect(out.workflowData?.[0]?.[0]?.json).toEqual(event)
  })
})
