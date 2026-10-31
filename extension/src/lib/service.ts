import {
  configFromMe,
  createLead as apiCreateLead,
  createTicket as apiCreateTicket,
  listLeads,
  searchTickets,
  whoami,
} from './api'
import { normalizeBaseUrl, TOKEN_PATTERN } from './validate'
import { findMatches, ticketSearchTerms } from './match'
import { ticketDescriptionHtml } from './html'
import type {
  ApiClient,
  Config,
  Contact,
  LeadForm,
  LeadSummary,
  LookupState,
  Res,
  Store,
  TicketForm,
  TicketSummary,
} from './types'

export const CONFIG_KEY = 'steel:config'
export const LEADS_KEY = 'steel:leads'
/** How long the lead list is reused before it is read again. */
export const LEADS_TTL_MS = 5 * 60 * 1000
const contactKey = (tabId: number) => `contact:${tabId}`

export interface Deps {
  /** Persistent store (chrome.storage.local): the configuration. */
  local: Store
  /** Per-session store (chrome.storage.session): contacts per tab, lead cache. */
  session: Store
  makeClient(config: { baseUrl: string; token: string }): ApiClient
  now(): number
}

interface LeadCache {
  at: number
  baseUrl: string
  leads: LeadSummary[]
}

export async function getConfig(deps: Deps): Promise<Config | undefined> {
  return deps.local.get<Config>(CONFIG_KEY)
}

/** Checks the address and the token against `GET /api/v1/me`, then keeps them. */
export async function saveConfig(
  deps: Deps,
  input: { baseUrl: string; token: string },
): Promise<Res<Config>> {
  const baseUrl = normalizeBaseUrl(input.baseUrl)
  if (!baseUrl) {
    return { ok: false, error: 'Informe o endereço do Steel (https://…).' }
  }
  const token = input.token.trim()
  if (!TOKEN_PATTERN.test(token)) {
    return { ok: false, error: 'O token deve começar com stl_pat_.' }
  }
  const me = await whoami(deps.makeClient({ baseUrl, token }))
  if (!me.ok) return me
  const config = configFromMe(baseUrl, token, me.data)
  await deps.local.set(CONFIG_KEY, config)
  await deps.session.remove(LEADS_KEY)
  return { ok: true, data: config }
}

export async function clearConfig(deps: Deps): Promise<void> {
  await deps.local.remove(CONFIG_KEY)
  await deps.session.remove(LEADS_KEY)
}

export async function saveContact(
  deps: Deps,
  tabId: number,
  contact: Contact | null,
): Promise<void> {
  if (contact) await deps.session.set(contactKey(tabId), contact)
  else await deps.session.remove(contactKey(tabId))
}

export async function forgetTab(deps: Deps, tabId: number): Promise<void> {
  await deps.session.remove(contactKey(tabId))
}

async function loadLeads(
  deps: Deps,
  config: Config,
  client: ApiClient,
  force: boolean,
): Promise<Res<LeadSummary[]>> {
  const cached = await deps.session.get<LeadCache>(LEADS_KEY)
  if (
    !force &&
    cached &&
    cached.baseUrl === config.baseUrl &&
    deps.now() - cached.at < LEADS_TTL_MS
  ) {
    return { ok: true, data: cached.leads }
  }
  const res = await listLeads(client)
  if (!res.ok) return res
  await deps.session.set(LEADS_KEY, {
    at: deps.now(),
    baseUrl: config.baseUrl,
    leads: res.data,
  } satisfies LeadCache)
  return res
}

const EMPTY: LookupState = {
  configured: false,
  workspace: null,
  canWrite: false,
  hasCrm: false,
  hasServiceDesk: false,
  contact: null,
  matches: [],
  tickets: [],
  baseUrl: null,
  workspaceSlug: null,
  leadsError: null,
  ticketsError: null,
}

/** Everything the panel shows for the contact on the given tab. */
export async function lookup(
  deps: Deps,
  tabId: number | null,
  force = false,
): Promise<LookupState> {
  const config = await getConfig(deps)
  if (!config) return EMPTY
  const contact = tabId === null ? undefined : await deps.session.get<Contact>(contactKey(tabId))
  const state: LookupState = {
    ...EMPTY,
    configured: true,
    workspace: config.me.workspaceName,
    workspaceSlug: config.me.workspaceSlug,
    baseUrl: config.baseUrl,
    canWrite: config.me.scopes.includes('api:write'),
    hasCrm: config.me.modules.includes('CRM'),
    hasServiceDesk: config.me.modules.includes('SERVICE_DESK'),
    contact: contact ?? null,
  }
  if (!contact) return state

  const client = deps.makeClient(config)
  const [leads, tickets] = await Promise.all([
    state.hasCrm ? loadLeads(deps, config, client, force) : Promise.resolve(null),
    state.hasServiceDesk ? collectTickets(client, contact) : Promise.resolve(null),
  ])
  if (leads) {
    if (leads.ok) state.matches = findMatches(leads.data, contact)
    else state.leadsError = leads.error
  }
  if (tickets) {
    if (tickets.ok) state.tickets = tickets.data
    else state.ticketsError = tickets.error
  }
  return state
}

/** History: tickets mentioning any identifier of the contact, newest first. */
async function collectTickets(
  client: ApiClient,
  contact: Contact,
): Promise<Res<TicketSummary[]>> {
  const terms = ticketSearchTerms(contact)
  const seen = new Map<string, TicketSummary>()
  for (const term of terms) {
    const res = await searchTickets(client, term)
    if (!res.ok) return res
    for (const ticket of res.data) seen.set(ticket.id, ticket)
  }
  const sorted = [...seen.values()].sort((a, b) =>
    (b.createdAt ?? '').localeCompare(a.createdAt ?? ''),
  )
  return { ok: true, data: sorted }
}

async function requireWriter(
  deps: Deps,
  module: 'CRM' | 'SERVICE_DESK',
): Promise<Res<{ config: Config; client: ApiClient }>> {
  const config = await getConfig(deps)
  if (!config) return { ok: false, error: 'Conecte o Steel antes.' }
  if (!config.me.scopes.includes('api:write')) {
    return { ok: false, error: 'O token é somente leitura. Crie um com permissão de alterar.' }
  }
  if (!config.me.modules.includes(module)) {
    return { ok: false, error: 'O token não inclui esse módulo.' }
  }
  return { ok: true, data: { config, client: deps.makeClient(config) } }
}

export async function createLead(
  deps: Deps,
  tabId: number | null,
  form: LeadForm,
): Promise<Res<LeadSummary>> {
  const access = await requireWriter(deps, 'CRM')
  if (!access.ok) return access
  const contact = tabId === null ? undefined : await deps.session.get<Contact>(contactKey(tabId))
  const res = await apiCreateLead(access.data.client, contact ?? null, form)
  if (res.ok) await deps.session.remove(LEADS_KEY)
  return res
}

export async function createTicket(
  deps: Deps,
  tabId: number | null,
  form: TicketForm,
): Promise<Res<TicketSummary>> {
  const access = await requireWriter(deps, 'SERVICE_DESK')
  if (!access.ok) return access
  const contact = tabId === null ? undefined : await deps.session.get<Contact>(contactKey(tabId))
  return apiCreateTicket(
    access.data.client,
    form.title,
    form.type,
    ticketDescriptionHtml(contact ?? null, form.note),
  )
}
