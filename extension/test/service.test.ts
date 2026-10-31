import { describe, expect, it, vi } from 'vitest'
import {
  clearConfig,
  CONFIG_KEY,
  createLead,
  createTicket,
  type Deps,
  forgetTab,
  getConfig,
  LEADS_KEY,
  LEADS_TTL_MS,
  lookup,
  saveConfig,
  saveContact,
} from '../src/lib/service'
import type { Config } from '../src/lib/types'
import { contact, envelope, failure, fakeClient, memoryStore } from './helpers'

const TOKEN = `stl_pat_${'a'.repeat(43)}`
const BASE = 'https://steel.example.com'

function config(overrides: Partial<Config['me']> = {}): Config {
  return {
    baseUrl: BASE,
    token: TOKEN,
    me: {
      userName: 'Ana',
      workspaceName: 'Stratus',
      workspaceSlug: 'stratus',
      scopes: ['api:read', 'api:write'],
      modules: ['CRM', 'SERVICE_DESK'],
      expiresAt: null,
      ...overrides,
    },
  }
}

const rawLead = { id: 'l1', name: 'Maria Silva', phones: ['+5511912345678'], stage: 'QUALIFIED' }

function setup(options: {
  config?: Config | null
  client?: ReturnType<typeof fakeClient>
  session?: Record<string, unknown>
  now?: () => number
} = {}) {
  const local = memoryStore(options.config === null ? {} : { [CONFIG_KEY]: options.config ?? config() })
  const session = memoryStore(options.session ?? {})
  const api = options.client ?? fakeClient({})
  const makeClient = vi.fn(() => api.client)
  const deps: Deps = { local, session, makeClient, now: options.now ?? (() => 1_000_000) }
  return { deps, local, session, api, makeClient }
}

describe('saveConfig', () => {
  const me = envelope({
    user: { name: 'Ana' },
    workspace: { name: 'Stratus', slug: 'stratus' },
    scopes: ['api:read'],
    modules: ['CRM'],
  })

  it('rejects a bad address and a bad token before calling the API', async () => {
    const { deps, makeClient } = setup({ config: null })
    expect(await saveConfig(deps, { baseUrl: 'ftp://x', token: TOKEN })).toMatchObject({ ok: false })
    expect(await saveConfig(deps, { baseUrl: BASE, token: 'nope' })).toMatchObject({
      ok: false,
      error: 'O token deve começar com stl_pat_.',
    })
    expect(makeClient).not.toHaveBeenCalled()
  })

  it('does not store a token the API refuses', async () => {
    const client = fakeClient({ 'GET /api/v1/me': failure(401, 'UNAUTHORIZED') })
    const { deps, local } = setup({ config: null, client })
    expect((await saveConfig(deps, { baseUrl: BASE, token: TOKEN })).ok).toBe(false)
    expect(local.data.size).toBe(0)
  })

  it('stores the configuration and drops the lead cache', async () => {
    const client = fakeClient({ 'GET /api/v1/me': me })
    const { deps, local, session } = setup({ config: null, client, session: { [LEADS_KEY]: {} } })
    const res = await saveConfig(deps, { baseUrl: ` ${BASE}/path `, token: ` ${TOKEN} ` })
    expect(res.ok && res.data.baseUrl).toBe(BASE)
    expect(local.data.get(CONFIG_KEY)).toMatchObject({ baseUrl: BASE, token: TOKEN })
    expect(session.data.has(LEADS_KEY)).toBe(false)
  })
})

describe('config and contacts', () => {
  it('reads, clears and forgets', async () => {
    const { deps, local, session } = setup({ session: { [LEADS_KEY]: {} } })
    expect((await getConfig(deps))?.baseUrl).toBe(BASE)
    await saveContact(deps, 7, contact())
    expect(session.data.get('contact:7')).toEqual(contact())
    await saveContact(deps, 7, null)
    expect(session.data.has('contact:7')).toBe(false)
    await saveContact(deps, 8, contact())
    await forgetTab(deps, 8)
    expect(session.data.has('contact:8')).toBe(false)
    await clearConfig(deps)
    expect(local.data.has(CONFIG_KEY)).toBe(false)
    expect(session.data.has(LEADS_KEY)).toBe(false)
  })
})

describe('lookup', () => {
  it('says the extension is not connected without a configuration', async () => {
    const { deps } = setup({ config: null })
    expect(await lookup(deps, 1)).toMatchObject({ configured: false, contact: null })
  })

  it('shows the account but no contact when the tab has none, or no tab', async () => {
    const { deps, makeClient } = setup()
    expect(await lookup(deps, 1)).toMatchObject({
      configured: true,
      workspace: 'Stratus',
      workspaceSlug: 'stratus',
      baseUrl: BASE,
      canWrite: true,
      hasCrm: true,
      hasServiceDesk: true,
      contact: null,
    })
    expect(await lookup(deps, null)).toMatchObject({ contact: null })
    expect(makeClient).not.toHaveBeenCalled()
  })

  it('finds the lead and the ticket history', async () => {
    const client = fakeClient({
      'GET /api/v1/crm/leads': envelope({ items: [rawLead], nextCursor: null }),
      'GET /api/v1/servicedesk/tickets': [
        envelope({
          items: [
            { id: 't1', title: 'Antigo', createdAt: '2026-10-01T00:00:00.000Z' },
            { id: 't2', title: 'Novo', createdAt: '2026-11-01T00:00:00.000Z' },
          ],
        }),
        envelope({ items: [{ id: 't2', title: 'Novo', createdAt: '2026-11-01T00:00:00.000Z' }, { id: 't3', title: 'Sem data' }] }),
      ],
    })
    const { deps } = setup({
      client,
      session: { 'contact:1': contact({ emails: ['maria@x.com'] }) },
    })
    const state = await lookup(deps, 1)
    expect(state.matches.map((match) => match.lead.id)).toEqual(['l1'])
    expect(state.matches[0]?.reason).toBe('phone')
    expect(state.tickets.map((ticket) => ticket.id)).toEqual(['t2', 't1', 't3'])
    expect(state.leadsError).toBeNull()
    expect(state.ticketsError).toBeNull()
    const queries = client.calls
      .filter((call) => call.path.includes('tickets'))
      .map((call) => (call.query as { q: string }).q)
    expect(queries).toEqual(['551112345678', 'maria@x.com'])
  })

  it('reuses the lead list until it expires, and reads it again when forced', async () => {
    let now = 1_000_000
    const client = fakeClient({
      'GET /api/v1/crm/leads': envelope({ items: [rawLead], nextCursor: null }),
      'GET /api/v1/servicedesk/tickets': envelope({ items: [] }),
    })
    const { deps } = setup({ client, now: () => now, session: { 'contact:1': contact() } })
    const leadCalls = () => client.calls.filter((call) => call.path.endsWith('/leads')).length
    await lookup(deps, 1)
    await lookup(deps, 1)
    expect(leadCalls()).toBe(1)
    now += LEADS_TTL_MS + 1
    await lookup(deps, 1)
    expect(leadCalls()).toBe(2)
    await lookup(deps, 1, true)
    expect(leadCalls()).toBe(3)
  })

  it('ignores a cache that belongs to another Steel', async () => {
    const client = fakeClient({
      'GET /api/v1/crm/leads': envelope({ items: [], nextCursor: null }),
      'GET /api/v1/servicedesk/tickets': envelope({ items: [] }),
    })
    const { deps } = setup({
      client,
      session: {
        'contact:1': contact(),
        [LEADS_KEY]: { at: 1_000_000, baseUrl: 'https://other.example.com', leads: [] },
      },
    })
    await lookup(deps, 1)
    expect(client.calls.some((call) => call.path.endsWith('/leads'))).toBe(true)
  })

  it('skips the modules the token does not have', async () => {
    const client = fakeClient({})
    const { deps } = setup({
      config: config({ modules: [], scopes: ['api:read'] }),
      client,
      session: { 'contact:1': contact() },
    })
    const state = await lookup(deps, 1)
    expect(state).toMatchObject({ hasCrm: false, hasServiceDesk: false, canWrite: false })
    expect(client.calls).toHaveLength(0)
  })

  it('reports each module error without losing the other module', async () => {
    const client = fakeClient({
      'GET /api/v1/crm/leads': failure(403, 'FORBIDDEN'),
      'GET /api/v1/servicedesk/tickets': failure(429, 'RATE_LIMITED'),
    })
    const { deps } = setup({ client, session: { 'contact:1': contact() } })
    const state = await lookup(deps, 1)
    expect(state.leadsError).toContain('permissão')
    expect(state.ticketsError).toContain('Limite')
    expect(state.matches).toEqual([])
    expect(state.tickets).toEqual([])
  })

  it('skips the history for a contact with nothing to search for', async () => {
    const client = fakeClient({
      'GET /api/v1/crm/leads': envelope({ items: [], nextCursor: null }),
    })
    const { deps } = setup({ client, session: { 'contact:1': contact({ phones: [] }) } })
    const state = await lookup(deps, 1)
    expect(state.tickets).toEqual([])
    expect(client.calls.some((call) => call.path.includes('tickets'))).toBe(false)
  })
})

describe('createLead', () => {
  const form = { name: 'Maria', email: 'm@x.com', phone: '', company: '', jobTitle: '' }

  it('needs a connection, write access and the CRM module', async () => {
    expect(await createLead(setup({ config: null }).deps, 1, form)).toEqual({
      ok: false,
      error: 'Conecte o Steel antes.',
    })
    const readOnly = setup({ config: config({ scopes: ['api:read'] }) })
    expect(await createLead(readOnly.deps, 1, form)).toMatchObject({ ok: false })
    const noModule = setup({ config: config({ modules: ['SERVICE_DESK'] }) })
    expect(await createLead(noModule.deps, 1, form)).toEqual({
      ok: false,
      error: 'O token não inclui esse módulo.',
    })
  })

  it('creates the lead for the contact on the tab and drops the cache', async () => {
    const client = fakeClient({ 'POST /api/v1/crm/leads': envelope(rawLead, 201) })
    const { deps, session } = setup({
      client,
      session: { 'contact:3': contact(), [LEADS_KEY]: { at: 1 } },
    })
    const res = await createLead(deps, 3, form)
    expect(res.ok).toBe(true)
    expect(client.calls[0]?.body).toMatchObject({ channel: 'WhatsApp' })
    expect(session.data.has(LEADS_KEY)).toBe(false)
  })

  it('keeps the cache when the creation fails, and works without a tab', async () => {
    const client = fakeClient({ 'POST /api/v1/crm/leads': failure(409, 'CONFLICT') })
    const { deps, session } = setup({ client, session: { [LEADS_KEY]: { at: 1 } } })
    expect((await createLead(deps, null, form)).ok).toBe(false)
    expect(session.data.has(LEADS_KEY)).toBe(true)
    expect(client.calls[0]?.body).not.toHaveProperty('channel')
  })
})

describe('createTicket', () => {
  const form = { type: 'SERVICE_REQUEST' as const, title: 'Ajuda', note: 'Cliente sem acesso' }

  it('needs write access to the ServiceDesk', async () => {
    const { deps } = setup({ config: config({ modules: ['CRM'] }) })
    expect(await createTicket(deps, 1, form)).toMatchObject({ ok: false })
  })

  it('opens the ticket with the contact in the description', async () => {
    const client = fakeClient({
      'POST /api/v1/servicedesk/tickets': envelope({ id: 't1', code: 'REQ-000001' }, 201),
    })
    const { deps } = setup({ client, session: { 'contact:3': contact() } })
    const res = await createTicket(deps, 3, form)
    expect(res.ok && res.data.code).toBe('REQ-000001')
    const body = client.calls[0]?.body as { description: string; type: string }
    expect(body.type).toBe('SERVICE_REQUEST')
    expect(body.description).toContain('Cliente sem acesso')
    expect(body.description).toContain('Telefone: 551112345678')
  })

  it('works without a contact', async () => {
    const client = fakeClient({
      'POST /api/v1/servicedesk/tickets': envelope({ id: 't1', code: 'REQ-000002' }, 201),
    })
    const { deps } = setup({ client })
    const res = await createTicket(deps, null, form)
    expect(res.ok).toBe(true)
  })
})
