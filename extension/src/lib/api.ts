import { createSteelClient } from '@steel-so/sdk'
import { toE164 } from './phone'
import type {
  ApiClient,
  Config,
  Contact,
  LeadForm,
  LeadSummary,
  MeSummary,
  Res,
  TicketForm,
  TicketSummary,
} from './types'

export const LEAD_SOURCE = 'Extensão de navegador'
const PAGE_SIZE = 100
/** 2,000 leads; a workspace bigger than this still matches on what was read. */
const MAX_LEAD_PAGES = 20
const HISTORY_LIMIT = 8
const ALL_PHASES = 'NEW,IN_PROGRESS,WAITING,RESOLVED,CLOSED,CANCELED'

export function makeClient(config: { baseUrl: string; token: string }): ApiClient {
  // No `userAgent`: browsers do not let a page-level fetch set that header.
  return createSteelClient({
    baseUrl: config.baseUrl,
    token: config.token,
  }) as unknown as ApiClient
}

const STATUS_MESSAGE: Record<number, string> = {
  401: 'O token é inválido, expirou ou foi revogado.',
  403: 'O token não tem permissão para isso (escopo ou módulo).',
  404: 'Não encontrado no Steel.',
  409: 'Já existe um registro com esse contato.',
  422: 'O Steel recusou algum campo. Confira os dados.',
  429: 'Limite de requisições do Steel atingido. Tente de novo em instantes.',
}

export function describeFailure(status: number, code?: string, message?: string): string {
  if (code === 'API_TOKEN_MODULE_NOT_ALLOWED') {
    return 'O token foi criado sem o módulo necessário. Crie outro token que o inclua.'
  }
  if (code === 'NETWORK_ERROR') return 'Não foi possível falar com o Steel. Confira o endereço e a conexão.'
  if (code === 'TIMEOUT') return 'O Steel demorou demais para responder.'
  const known = STATUS_MESSAGE[status]
  if (known) return known
  if (status >= 500) return 'O Steel está com problemas. Tente de novo em instantes.'
  return message ?? 'Não foi possível concluir a ação.'
}

interface Envelope {
  success?: boolean
  data?: unknown
  error?: { code?: string; message?: string }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** One call, with the SDK result and the API envelope folded into a `Res`. */
export async function call<T>(
  client: ApiClient,
  options: Parameters<ApiClient['request']>[0],
): Promise<Res<T>> {
  let result: Awaited<ReturnType<ApiClient['request']>>
  try {
    result = await client.request(options)
  } catch {
    return { ok: false, error: describeFailure(0, 'NETWORK_ERROR') }
  }
  if (!result.ok) {
    const { error } = result
    return { ok: false, error: describeFailure(error.status, error.code, error.message) }
  }
  const { ok, status, body } = result.data
  const envelope: Envelope = isObject(body) ? (body as Envelope) : {}
  if (!ok || envelope.success === false) {
    return {
      ok: false,
      error: describeFailure(status, envelope.error?.code, envelope.error?.message),
    }
  }
  const data = 'success' in envelope || 'data' in envelope ? envelope.data : body
  return { ok: true, data: data as T }
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

export function toLeadSummary(raw: unknown): LeadSummary | null {
  if (!isObject(raw) || typeof raw.id !== 'string') return null
  return {
    id: raw.id,
    name: text(raw.name) ?? '(sem nome)',
    emails: strings(raw.emails),
    phones: strings(raw.phones),
    company: text(raw.company),
    jobTitle: text(raw.jobTitle),
    linkedin: text(raw.linkedin),
    stage: text(raw.stage) ?? 'RECEIVED',
  }
}

export function toTicketSummary(raw: unknown): TicketSummary | null {
  if (!isObject(raw) || typeof raw.id !== 'string') return null
  const phase = isObject(raw.phase) ? text(raw.phase.name) : null
  return {
    id: raw.id,
    number: typeof raw.number === 'number' ? raw.number : null,
    code: text(raw.code) ?? '',
    title: text(raw.title) ?? '(sem título)',
    type: text(raw.type) ?? '',
    phase: phase ?? '',
    createdAt: text(raw.createdAt),
  }
}

function pageOf(data: unknown): { items: unknown[]; next: string | null } {
  if (!isObject(data)) return { items: [], next: null }
  return {
    items: Array.isArray(data.items) ? data.items : [],
    next: text(data.nextCursor),
  }
}

export async function whoami(client: ApiClient): Promise<Res<MeSummary>> {
  const res = await call<unknown>(client, { method: 'GET', path: '/api/v1/me' })
  if (!res.ok) return res
  const data = isObject(res.data) ? res.data : {}
  const user = isObject(data.user) ? data.user : {}
  const workspace = isObject(data.workspace) ? data.workspace : {}
  const token = isObject(data.token) ? data.token : {}
  return {
    ok: true,
    data: {
      userName: text(user.name) ?? '',
      workspaceName: text(workspace.name) ?? '',
      workspaceSlug: text(workspace.slug) ?? '',
      scopes: strings(data.scopes),
      modules: strings(data.modules),
      expiresAt: text(token.expiresAt),
    },
  }
}

/** Every lead the token can read, page by page. */
export async function listLeads(client: ApiClient): Promise<Res<LeadSummary[]>> {
  const leads: LeadSummary[] = []
  let cursor: string | null = null
  for (let page = 0; page < MAX_LEAD_PAGES; page++) {
    const query: Record<string, string> = { limit: String(PAGE_SIZE) }
    if (cursor) query.cursor = cursor
    const res: Res<unknown> = await call<unknown>(client, {
      method: 'GET',
      path: '/api/v1/crm/leads',
      query,
    })
    if (!res.ok) return res
    const { items, next } = pageOf(res.data)
    for (const item of items) {
      const lead = toLeadSummary(item)
      if (lead) leads.push(lead)
    }
    // A server that repeats the cursor would loop until the page cap.
    if (!next || next === cursor) break
    cursor = next
  }
  return { ok: true, data: leads }
}

/** Tickets that mention `term`, newest first, closed ones included. */
export async function searchTickets(
  client: ApiClient,
  term: string,
): Promise<Res<TicketSummary[]>> {
  const res = await call<unknown>(client, {
    method: 'GET',
    path: '/api/v1/servicedesk/tickets',
    query: { q: term, status: ALL_PHASES, limit: String(HISTORY_LIMIT) },
  })
  if (!res.ok) return res
  const tickets: TicketSummary[] = []
  for (const item of pageOf(res.data).items) {
    const ticket = toTicketSummary(item)
    if (ticket) tickets.push(ticket)
  }
  return { ok: true, data: tickets }
}

export function leadBody(contact: Contact | null, form: LeadForm) {
  const emails = form.email.trim() ? [form.email.trim().toLowerCase()] : []
  const phone = form.phone.trim() ? toE164(form.phone) : null
  const channel = contact
    ? { whatsapp: 'WhatsApp', gmail: 'E-mail', linkedin: 'LinkedIn' }[contact.source]
    : undefined
  return {
    name: form.name.trim(),
    emails,
    phones: phone ? [phone] : [],
    source: LEAD_SOURCE,
    ...(channel ? { channel } : {}),
    ...(form.company.trim() ? { company: form.company.trim() } : {}),
    ...(form.jobTitle.trim() ? { jobTitle: form.jobTitle.trim() } : {}),
    ...(contact?.linkedin ? { linkedin: contact.linkedin } : {}),
  }
}

export async function createLead(
  client: ApiClient,
  contact: Contact | null,
  form: LeadForm,
): Promise<Res<LeadSummary>> {
  if (!form.name.trim()) return { ok: false, error: 'Informe o nome.' }
  if (form.phone.trim() && !toE164(form.phone)) {
    return { ok: false, error: 'Telefone inválido.' }
  }
  const body = leadBody(contact, form)
  if (body.emails.length === 0 && body.phones.length === 0) {
    return { ok: false, error: 'Informe ao menos um e-mail ou telefone.' }
  }
  const res = await call<unknown>(client, {
    method: 'POST',
    path: '/api/v1/crm/leads',
    body,
  })
  if (!res.ok) return res
  const lead = toLeadSummary(res.data)
  return lead ? { ok: true, data: lead } : { ok: false, error: 'Resposta inesperada do Steel.' }
}

export async function createTicket(
  client: ApiClient,
  title: string,
  type: TicketForm['type'],
  descriptionHtml: string,
): Promise<Res<TicketSummary>> {
  if (!title.trim()) return { ok: false, error: 'Informe o título do chamado.' }
  const res = await call<unknown>(client, {
    method: 'POST',
    path: '/api/v1/servicedesk/tickets',
    body: { type, title: title.trim(), description: descriptionHtml, channel: 'API' },
  })
  if (!res.ok) return res
  const ticket = toTicketSummary(res.data)
  return ticket ? { ok: true, data: ticket } : { ok: false, error: 'Resposta inesperada do Steel.' }
}

export function configFromMe(baseUrl: string, token: string, me: MeSummary): Config {
  return { baseUrl, token, me }
}
