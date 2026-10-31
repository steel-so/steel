import { describe, expect, it, vi } from 'vitest'

const { createSteelClient } = vi.hoisted(() => ({
  createSteelClient: vi.fn((options: unknown) => ({ options })),
}))
vi.mock('@steel-so/sdk', () => ({ createSteelClient }))

import {
  call,
  configFromMe,
  createLead,
  createTicket,
  describeFailure,
  leadBody,
  listLeads,
  makeClient,
  searchTickets,
  toLeadSummary,
  toTicketSummary,
  whoami,
} from '../src/lib/api'
import type { ApiClient } from '../src/lib/types'
import { contact, envelope, failure, fakeClient } from './helpers'

const rawLead = {
  id: 'l1',
  name: 'Maria',
  emails: ['m@x.com', 3],
  phones: ['+5511912345678'],
  company: 'Acme',
  jobTitle: null,
  linkedin: '',
  stage: 'QUALIFIED',
}

describe('makeClient', () => {
  it('builds the SDK client from the address and the token', () => {
    const client = makeClient({ baseUrl: 'https://s.example.com', token: 'stl_pat_x' })
    expect(createSteelClient).toHaveBeenCalledWith({
      baseUrl: 'https://s.example.com',
      token: 'stl_pat_x',
    })
    expect(client).toBeDefined()
  })
})

describe('describeFailure', () => {
  it('explains the common failures in Portuguese', () => {
    expect(describeFailure(403, 'API_TOKEN_MODULE_NOT_ALLOWED')).toContain('módulo')
    expect(describeFailure(0, 'NETWORK_ERROR')).toContain('Não foi possível falar')
    expect(describeFailure(0, 'TIMEOUT')).toContain('demorou')
    expect(describeFailure(401)).toContain('inválido')
    expect(describeFailure(503)).toContain('problemas')
    expect(describeFailure(400, 'X', 'Mensagem do servidor')).toBe('Mensagem do servidor')
    expect(describeFailure(400)).toBe('Não foi possível concluir a ação.')
  })
})

describe('call', () => {
  const options = { method: 'GET', path: '/api/v1/x' }

  it('unwraps the API envelope', async () => {
    const { client } = fakeClient({ 'GET /api/v1/x': envelope({ a: 1 }) })
    expect(await call(client, options)).toEqual({ ok: true, data: { a: 1 } })
  })

  it('returns a body that is not an envelope as it is', async () => {
    const { client } = fakeClient({ 'GET /api/v1/x': { body: { items: [] } } })
    expect(await call(client, options)).toEqual({ ok: true, data: { items: [] } })
    const text = fakeClient({ 'GET /api/v1/x': { body: 'plain' } })
    expect(await call(text.client, options)).toEqual({ ok: true, data: 'plain' })
  })

  it('turns an HTTP error into a message', async () => {
    const { client } = fakeClient({ 'GET /api/v1/x': failure(409, 'CONFLICT') })
    expect(await call(client, options)).toEqual({
      ok: false,
      error: 'Já existe um registro com esse contato.',
    })
  })

  it('treats success:false as a failure even with a 200', async () => {
    const { client } = fakeClient({
      'GET /api/v1/x': { status: 200, body: { success: false, error: { message: 'Ruim' } } },
    })
    expect(await call(client, options)).toEqual({ ok: false, error: 'Ruim' })
  })

  it('uses the status when the error body is not JSON', async () => {
    const { client } = fakeClient({ 'GET /api/v1/x': { status: 502, body: '<html>' } })
    const res = await call(client, options)
    expect(res.ok).toBe(false)
  })

  it('maps SDK-level and thrown failures', async () => {
    const sdk = fakeClient({ 'GET /api/v1/x': 'sdk-error' })
    expect(await call(sdk.client, options)).toEqual({
      ok: false,
      error: describeFailure(0, 'NETWORK_ERROR'),
    })
    const thrown = fakeClient({ 'GET /api/v1/x': new Error('boom') })
    expect((await call(thrown.client, options)).ok).toBe(false)
  })
})

describe('whoami', () => {
  it('reads the token owner, workspace, scopes and modules', async () => {
    const { client } = fakeClient({
      'GET /api/v1/me': envelope({
        user: { name: 'Ana' },
        workspace: { name: 'Stratus', slug: 'stratus' },
        scopes: ['api:read', 'api:write'],
        modules: ['CRM'],
        token: { expiresAt: '2027-01-01T00:00:00.000Z' },
      }),
    })
    expect(await whoami(client)).toEqual({
      ok: true,
      data: {
        userName: 'Ana',
        workspaceName: 'Stratus',
        workspaceSlug: 'stratus',
        scopes: ['api:read', 'api:write'],
        modules: ['CRM'],
        expiresAt: '2027-01-01T00:00:00.000Z',
      },
    })
  })

  it('tolerates an empty answer and propagates failures', async () => {
    const empty = fakeClient({ 'GET /api/v1/me': envelope(null) })
    const res = await whoami(empty.client)
    expect(res.ok && res.data.scopes).toEqual([])
    const bad = fakeClient({ 'GET /api/v1/me': failure(401, 'UNAUTHORIZED') })
    expect((await whoami(bad.client)).ok).toBe(false)
  })
})

describe('mappers', () => {
  it('maps a lead and drops bad values', () => {
    expect(toLeadSummary(rawLead)).toEqual({
      id: 'l1',
      name: 'Maria',
      emails: ['m@x.com'],
      phones: ['+5511912345678'],
      company: 'Acme',
      jobTitle: null,
      linkedin: null,
      stage: 'QUALIFIED',
    })
    expect(toLeadSummary({ id: 'l2' })).toMatchObject({ name: '(sem nome)', stage: 'RECEIVED' })
    expect(toLeadSummary(null)).toBeNull()
    expect(toLeadSummary({ name: 'x' })).toBeNull()
  })

  it('maps a ticket', () => {
    expect(
      toTicketSummary({
        id: 't1',
        number: 12,
        code: 'REQ-000012',
        title: 'Ajuda',
        type: 'SERVICE_REQUEST',
        phase: { name: 'Em andamento' },
        createdAt: '2026-11-01T10:00:00.000Z',
      }),
    ).toEqual({
      id: 't1',
      number: 12,
      code: 'REQ-000012',
      title: 'Ajuda',
      type: 'SERVICE_REQUEST',
      phase: 'Em andamento',
      createdAt: '2026-11-01T10:00:00.000Z',
    })
    expect(toTicketSummary({ id: 't2', phase: 'x' })).toMatchObject({
      number: null,
      title: '(sem título)',
      phase: '',
    })
    expect(toTicketSummary('x')).toBeNull()
    expect(toTicketSummary({})).toBeNull()
  })
})

describe('listLeads', () => {
  it('reads every page', async () => {
    const { client, calls } = fakeClient({
      'GET /api/v1/crm/leads': [
        envelope({ items: [rawLead, 'junk'], nextCursor: 'c2' }),
        envelope({ items: [{ ...rawLead, id: 'l2' }], nextCursor: null }),
      ],
    })
    const res = await listLeads(client)
    expect(res.ok && res.data.map((lead) => lead.id)).toEqual(['l1', 'l2'])
    expect(calls[0]?.query).toEqual({ limit: '100' })
    expect(calls[1]?.query).toEqual({ limit: '100', cursor: 'c2' })
  })

  it('stops when the server repeats the cursor', async () => {
    const { client, calls } = fakeClient({
      'GET /api/v1/crm/leads': [
        envelope({ items: [rawLead], nextCursor: 'same' }),
        envelope({ items: [rawLead], nextCursor: 'same' }),
      ],
    })
    await listLeads(client)
    expect(calls).toHaveLength(2)
  })

  it('stops at the page cap and handles a malformed page', async () => {
    let n = 0
    const client: ApiClient = {
      async request() {
        n += 1
        return {
          ok: true,
          data: { ok: true, status: 200, body: envelopeBody({ items: [], nextCursor: `c${n}` }) },
        }
      },
    }
    await listLeads(client)
    expect(n).toBe(20)
    const odd = fakeClient({ 'GET /api/v1/crm/leads': envelope('nope') })
    expect(await listLeads(odd.client)).toEqual({ ok: true, data: [] })
  })

  it('propagates a failure', async () => {
    const { client } = fakeClient({ 'GET /api/v1/crm/leads': failure(403, 'FORBIDDEN') })
    expect((await listLeads(client)).ok).toBe(false)
  })
})

function envelopeBody(data: unknown) {
  return { success: true, statusCode: 200, data }
}

describe('searchTickets', () => {
  it('searches every phase and maps the items', async () => {
    const { client, calls } = fakeClient({
      'GET /api/v1/servicedesk/tickets': envelope({ items: [{ id: 't1', title: 'A' }, 5] }),
    })
    const res = await searchTickets(client, '551112345678')
    expect(res.ok && res.data).toHaveLength(1)
    expect(calls[0]?.query).toMatchObject({ q: '551112345678', limit: '8' })
    expect((calls[0]?.query as { status: string }).status).toContain('CLOSED')
  })

  it('propagates a failure', async () => {
    const { client } = fakeClient({
      'GET /api/v1/servicedesk/tickets': failure(403, 'API_TOKEN_MODULE_NOT_ALLOWED'),
    })
    expect((await searchTickets(client, 'x')).ok).toBe(false)
  })
})

describe('leadBody', () => {
  const form = {
    name: ' Maria ',
    email: ' Maria@X.com ',
    phone: '(11) 91234-5678',
    company: ' Acme ',
    jobTitle: ' CTO ',
  }

  it('builds the lead with source, channel and the LinkedIn profile', () => {
    expect(
      leadBody(contact({ source: 'linkedin', linkedin: 'https://www.linkedin.com/in/m' }), form),
    ).toEqual({
      name: 'Maria',
      emails: ['maria@x.com'],
      phones: ['+5511912345678'],
      source: 'Extensão de navegador',
      channel: 'LinkedIn',
      company: 'Acme',
      jobTitle: 'CTO',
      linkedin: 'https://www.linkedin.com/in/m',
    })
  })

  it('names the channel of each source and omits empty fields', () => {
    const empty = { name: 'A', email: '', phone: '', company: '', jobTitle: '' }
    expect(leadBody(contact({ source: 'gmail' }), empty)).toMatchObject({ channel: 'E-mail', emails: [], phones: [] })
    expect(leadBody(contact(), empty).channel).toBe('WhatsApp')
    expect(leadBody(null, empty)).toEqual({
      name: 'A',
      emails: [],
      phones: [],
      source: 'Extensão de navegador',
    })
  })
})

describe('createLead', () => {
  const form = { name: 'Maria', email: '', phone: '11912345678', company: '', jobTitle: '' }

  it('requires a name, a valid phone and a way to reach the person', async () => {
    const { client, calls } = fakeClient({})
    expect(await createLead(client, null, { ...form, name: ' ' })).toEqual({
      ok: false,
      error: 'Informe o nome.',
    })
    expect(await createLead(client, null, { ...form, phone: '12' })).toEqual({
      ok: false,
      error: 'Telefone inválido.',
    })
    expect(await createLead(client, null, { ...form, phone: '' })).toEqual({
      ok: false,
      error: 'Informe ao menos um e-mail ou telefone.',
    })
    expect(calls).toHaveLength(0)
  })

  it('posts the lead and returns it', async () => {
    const { client, calls } = fakeClient({ 'POST /api/v1/crm/leads': envelope(rawLead, 201) })
    const res = await createLead(client, contact(), form)
    expect(res.ok && res.data.id).toBe('l1')
    expect(calls[0]?.body).toMatchObject({ phones: ['+5511912345678'], channel: 'WhatsApp' })
  })

  it('reports a duplicate and an unexpected answer', async () => {
    const dup = fakeClient({ 'POST /api/v1/crm/leads': failure(409, 'CONFLICT') })
    expect(await createLead(dup.client, null, form)).toMatchObject({ ok: false })
    const odd = fakeClient({ 'POST /api/v1/crm/leads': envelope({}, 201) })
    expect(await createLead(odd.client, null, form)).toEqual({
      ok: false,
      error: 'Resposta inesperada do Steel.',
    })
  })
})

describe('createTicket', () => {
  it('requires a title', async () => {
    const { client } = fakeClient({})
    expect(await createTicket(client, ' ', 'INCIDENT', '<p>x</p>')).toEqual({
      ok: false,
      error: 'Informe o título do chamado.',
    })
  })

  it('posts the ticket through the API channel', async () => {
    const { client, calls } = fakeClient({
      'POST /api/v1/servicedesk/tickets': envelope({ id: 't1', code: 'INC-000001', number: 1 }, 201),
    })
    const res = await createTicket(client, ' Sem internet ', 'INCIDENT', '<p>x</p>')
    expect(res.ok && res.data.code).toBe('INC-000001')
    expect(calls[0]?.body).toEqual({
      type: 'INCIDENT',
      title: 'Sem internet',
      description: '<p>x</p>',
      channel: 'API',
    })
  })

  it('reports a failure and an unexpected answer', async () => {
    const bad = fakeClient({ 'POST /api/v1/servicedesk/tickets': failure(422, 'VALIDATION_ERROR') })
    expect(await createTicket(bad.client, 'x', 'CHANGE', '')).toMatchObject({ ok: false })
    const odd = fakeClient({ 'POST /api/v1/servicedesk/tickets': envelope(null, 201) })
    expect(await createTicket(odd.client, 'x', 'CHANGE', '')).toEqual({
      ok: false,
      error: 'Resposta inesperada do Steel.',
    })
  })
})

describe('configFromMe', () => {
  it('bundles what is stored', () => {
    const me = { userName: '', workspaceName: '', workspaceSlug: '', scopes: [], modules: [], expiresAt: null }
    expect(configFromMe('https://s', 'stl_pat_x', me)).toEqual({ baseUrl: 'https://s', token: 'stl_pat_x', me })
  })
})
