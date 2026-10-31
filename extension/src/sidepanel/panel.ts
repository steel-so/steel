import { formatDate, labelOf, LEAD_STAGE_LABEL, TICKET_TYPE_LABEL } from '../lib/format'
import { SOURCE_LABEL } from '../lib/html'
import type {
  Config,
  Contact,
  LeadMatch,
  LeadSummary,
  LookupState,
  Message,
  Res,
  TicketSummary,
  TicketType,
} from '../lib/types'
import { normalizeBaseUrl } from '../lib/validate'

type View = 'main' | 'lead' | 'ticket' | 'settings'
type Child = Node | string | null | false | undefined
type Attr = string | boolean | ((event: Event) => void)

const REASON_LABEL = {
  phone: 'Mesmo telefone',
  email: 'Mesmo e-mail',
  linkedin: 'Mesmo perfil do LinkedIn',
  name: 'Mesmo nome (confira)',
} as const

const root = document.getElementById('app') as HTMLElement

let tabId: number | null = null
let state: LookupState | null = null
let view: View = 'main'
let notice: { kind: 'ok' | 'error'; text: string } | null = null
let busy = false

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, Attr> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value === 'function') element.addEventListener(key.slice(2), value)
    else if (value === true) element.setAttribute(key, '')
    else if (value !== false) element.setAttribute(key, value)
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue
    element.append(typeof child === 'string' ? document.createTextNode(child) : child)
  }
  return element
}

async function send<T>(message: Message): Promise<T> {
  return (await chrome.runtime.sendMessage(message)) as T
}

async function activeTabId(): Promise<number | null> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  return tab?.id ?? null
}

/* --------------------------------- shared --------------------------------- */

function link(href: string, label: string): HTMLAnchorElement {
  return h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, label)
}

function field(
  label: string,
  control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
): HTMLLabelElement {
  return h('label', {}, label, control)
}

function noticeBox(): Node | null {
  if (!notice) return null
  return h('div', { class: notice.kind === 'ok' ? 'ok' : 'error', role: 'status' }, notice.text)
}

function header(): HTMLElement {
  const title = h('div', {}, h('h1', {}, 'Steel'))
  if (state?.workspace) title.append(h('small', {}, state.workspace))
  const settings = h(
    'button',
    {
      type: 'button',
      'aria-label': 'Conta',
      onclick: () => go(view === 'settings' ? 'main' : 'settings'),
    },
    state?.configured ? 'Conta' : 'Conectar',
  )
  const refresh = h(
    'button',
    { type: 'button', onclick: () => void refresh_(true) },
    'Atualizar',
  )
  const actions = h('div', { class: 'actions' })
  if (state?.configured) actions.append(refresh)
  actions.append(settings)
  return h('header', {}, title, actions)
}

function go(next: View): void {
  view = next
  notice = null
  render()
}

/* -------------------------------- settings -------------------------------- */

function settingsView(): HTMLElement {
  if (state?.configured) {
    return h(
      'section',
      {},
      h('h2', {}, 'Conta'),
      h('div', { class: 'name' }, state.workspace ?? ''),
      h('div', { class: 'muted' }, state.baseUrl ?? ''),
      h(
        'div',
        { class: 'actions' },
        h(
          'button',
          {
            type: 'button',
            onclick: () => void disconnect(),
          },
          'Desconectar',
        ),
      ),
    )
  }
  const url = h('input', {
    type: 'url',
    name: 'url',
    required: true,
    placeholder: 'https://seu-steel.exemplo.com.br',
    autocomplete: 'off',
  })
  const token = h('input', {
    type: 'password',
    name: 'token',
    required: true,
    placeholder: 'stl_pat_…',
    autocomplete: 'off',
  })
  const form = h(
    'form',
    {
      onsubmit: (event) => {
        event.preventDefault()
        void connect(url.value, token.value)
      },
    },
    field('Endereço do Steel', url),
    field('Token de API', token),
    h(
      'p',
      { class: 'muted' },
      'Crie o token em Configurações › Segurança › Tokens de API. Use o escopo "Ler e alterar" para criar leads e chamados e inclua os módulos CRM e ServiceDesk.',
    ),
    h('button', { type: 'submit', class: 'primary', ...(busy ? { disabled: true } : {}) }, 'Conectar'),
  )
  return h('section', {}, h('h2', {}, 'Conectar ao Steel'), form)
}

async function connect(rawUrl: string, token: string): Promise<void> {
  const origin = normalizeBaseUrl(rawUrl)
  if (!origin) {
    notice = { kind: 'error', text: 'Informe o endereço do Steel (https://…).' }
    return render()
  }
  // Must run inside the click's user gesture, before any other await.
  const granted = await chrome.permissions.request({ origins: [`${origin}/*`] })
  if (!granted) {
    notice = { kind: 'error', text: 'Sem a permissão de acesso ao endereço, a extensão não consegue falar com o Steel.' }
    return render()
  }
  busy = true
  render()
  const res = await send<Res<Config>>({ type: 'save-config', baseUrl: origin, token })
  busy = false
  if (!res.ok) {
    notice = { kind: 'error', text: res.error }
    return render()
  }
  view = 'main'
  notice = { kind: 'ok', text: 'Conectado.' }
  await refresh_(false)
}

async function disconnect(): Promise<void> {
  const base = state?.baseUrl
  await send({ type: 'clear-config' })
  if (base) await chrome.permissions.remove({ origins: [`${base}/*`] }).catch(() => false)
  view = 'settings'
  notice = null
  await refresh_(false)
}

/* ---------------------------------- main ---------------------------------- */

function contactCard(contact: Contact): HTMLElement {
  const lines = [
    ...contact.phones.map((phone) => `+${phone}`),
    ...contact.emails,
    [contact.jobTitle, contact.company].filter(Boolean).join(' · '),
  ].filter((line) => line !== '')
  return h(
    'section',
    {},
    h('h2', {}, SOURCE_LABEL[contact.source]),
    h('div', { class: 'name' }, contact.name ?? lines[0] ?? 'Contato sem nome'),
    ...lines.map((line) => h('div', { class: 'muted' }, line)),
  )
}

function matchRow(match: LeadMatch): HTMLElement {
  return h(
    'div',
    { class: 'row' },
    h('div', { class: 'name' }, match.lead.name),
    h('span', { class: 'badge' }, labelOf(LEAD_STAGE_LABEL, match.lead.stage)),
    h('div', { class: 'muted' }, REASON_LABEL[match.reason]),
    match.lead.company ? h('div', { class: 'muted' }, match.lead.company) : null,
  )
}

function crmSection(current: LookupState): HTMLElement {
  const section = h('section', {}, h('h2', {}, 'CRM'))
  if (current.leadsError) {
    section.append(h('div', { class: 'error' }, current.leadsError))
    return section
  }
  if (current.matches.length === 0) {
    section.append(h('div', { class: 'muted' }, 'Este contato ainda não é um lead no Steel.'))
  } else {
    for (const match of current.matches) section.append(matchRow(match))
  }
  const actions = h('div', { class: 'actions' })
  if (current.canWrite && current.matches.length === 0) {
    actions.append(h('button', { type: 'button', class: 'primary', onclick: () => go('lead') }, 'Criar lead'))
  }
  if (current.baseUrl && current.workspaceSlug) {
    actions.append(link(`${current.baseUrl}/${current.workspaceSlug}/crm/leads`, 'Abrir CRM'))
  }
  section.append(actions)
  return section
}

function ticketRow(current: LookupState, ticket: TicketSummary): HTMLElement {
  const title =
    current.baseUrl && current.workspaceSlug && ticket.number !== null
      ? link(`${current.baseUrl}/${current.workspaceSlug}/servicedesk/tickets/${ticket.number}`, ticket.title)
      : h('span', {}, ticket.title)
  return h(
    'div',
    { class: 'row' },
    h('div', { class: 'name' }, title),
    h(
      'div',
      { class: 'muted' },
      [ticket.code, labelOf(TICKET_TYPE_LABEL, ticket.type), ticket.phase, formatDate(ticket.createdAt)]
        .filter((part) => part !== '')
        .join(' · '),
    ),
  )
}

function serviceDeskSection(current: LookupState): HTMLElement {
  const section = h('section', {}, h('h2', {}, 'Chamados'))
  if (current.ticketsError) {
    section.append(h('div', { class: 'error' }, current.ticketsError))
  } else if (current.tickets.length === 0) {
    section.append(h('div', { class: 'muted' }, 'Nenhum chamado encontrado para este contato.'))
  } else {
    for (const ticket of current.tickets) section.append(ticketRow(current, ticket))
  }
  if (current.canWrite) {
    section.append(
      h(
        'div',
        { class: 'actions' },
        h('button', { type: 'button', class: 'primary', onclick: () => go('ticket') }, 'Abrir chamado'),
      ),
    )
  }
  return section
}

function mainView(current: LookupState): HTMLElement {
  const wrap = h('div', { class: 'stack' })
  if (!current.contact) {
    wrap.append(
      h(
        'section',
        {},
        h('div', { class: 'muted' }, 'Abra uma conversa no WhatsApp Web, um e-mail no Gmail ou um perfil do LinkedIn para ver o contato aqui.'),
      ),
    )
    return wrap
  }
  wrap.append(contactCard(current.contact))
  if (current.hasCrm) wrap.append(crmSection(current))
  if (current.hasServiceDesk) wrap.append(serviceDeskSection(current))
  if (!current.hasCrm && !current.hasServiceDesk) {
    wrap.append(h('section', {}, h('div', { class: 'error' }, 'O token não inclui CRM nem ServiceDesk.')))
  }
  return wrap
}

/* ---------------------------------- forms --------------------------------- */

function leadView(current: LookupState): HTMLElement {
  const contact = current.contact
  const phone = contact?.phones[0] ? `+${contact.phones[0]}` : ''
  const name = h('input', { name: 'name', required: true, value: contact?.name ?? '' })
  const email = h('input', { name: 'email', type: 'email', value: contact?.emails[0] ?? '' })
  const tel = h('input', { name: 'phone', type: 'tel', value: phone })
  const company = h('input', { name: 'company', value: contact?.company ?? '' })
  const jobTitle = h('input', { name: 'jobTitle', value: contact?.jobTitle ?? '' })
  return h(
    'section',
    {},
    h('h2', {}, 'Novo lead'),
    h(
      'form',
      {
        onsubmit: (event) => {
          event.preventDefault()
          void submit<LeadSummary>(
            {
              type: 'create-lead',
              tabId,
              form: {
                name: name.value,
                email: email.value,
                phone: tel.value,
                company: company.value,
                jobTitle: jobTitle.value,
              },
            },
            () => 'Lead criado no Steel.',
          )
        },
      },
      field('Nome', name),
      field('E-mail', email),
      field('Telefone', tel),
      field('Empresa', company),
      field('Cargo', jobTitle),
      formButtons('Criar lead'),
    ),
  )
}

function ticketView(current: LookupState): HTMLElement {
  const contact = current.contact
  const who = contact?.name ?? (contact?.phones[0] ? `+${contact.phones[0]}` : contact?.emails[0] ?? '')
  const type = h('select', { name: 'type' })
  for (const [value, label] of Object.entries(TICKET_TYPE_LABEL)) {
    type.append(h('option', { value, ...(value === 'SERVICE_REQUEST' ? { selected: true } : {}) }, label))
  }
  const title = h('input', { name: 'title', required: true, value: who ? `Atendimento: ${who}` : '' })
  const note = h('textarea', { name: 'note' })
  return h(
    'section',
    {},
    h('h2', {}, 'Novo chamado'),
    h(
      'form',
      {
        onsubmit: (event) => {
          event.preventDefault()
          void submit<TicketSummary>(
            {
              type: 'create-ticket',
              tabId,
              form: { type: type.value as TicketType, title: title.value, note: note.value },
            },
            (ticket) => (ticket.code ? `Chamado ${ticket.code} aberto.` : 'Chamado aberto.'),
          )
        },
      },
      field('Tipo', type),
      field('Título', title),
      field('Descrição', note),
      formButtons('Abrir chamado'),
    ),
  )
}

function formButtons(label: string): HTMLElement {
  return h(
    'div',
    { class: 'actions' },
    h('button', { type: 'submit', class: 'primary', ...(busy ? { disabled: true } : {}) }, label),
    h('button', { type: 'button', onclick: () => go('main') }, 'Cancelar'),
  )
}

async function submit<T>(message: Message, success: (data: T) => string): Promise<void> {
  busy = true
  notice = null
  render()
  const res = await send<Res<T>>(message)
  busy = false
  if (!res.ok) {
    notice = { kind: 'error', text: res.error }
    return render()
  }
  view = 'main'
  await refresh_(true)
  notice = { kind: 'ok', text: success(res.data) }
  render()
}

/* --------------------------------- render --------------------------------- */

function render(): void {
  const current = state
  root.replaceChildren(header())
  if (!current) {
    root.append(h('div', { class: 'muted' }, 'Carregando…'))
    return
  }
  const notices = noticeBox()
  if (!current.configured || view === 'settings') {
    if (notices) root.append(notices)
    root.append(settingsView())
    return
  }
  if (notices) root.append(notices)
  if (view === 'lead') root.append(leadView(current))
  else if (view === 'ticket') root.append(ticketView(current))
  else root.append(mainView(current))
}

async function refresh_(force: boolean): Promise<void> {
  const nextTab = await activeTabId()
  const changedTab = nextTab !== tabId
  tabId = nextTab
  state = await send<LookupState>({ type: force ? 'refresh' : 'state', tabId })
  if (!state.configured) view = 'settings'
  else if (changedTab && view !== 'settings') view = 'main'
  // A form being typed in must not be wiped by a background refresh.
  if (!changedTab && !force && (view === 'lead' || view === 'ticket')) return
  render()
}

let timer: ReturnType<typeof setTimeout> | undefined
function scheduleRefresh(): void {
  clearTimeout(timer)
  timer = setTimeout(() => void refresh_(false), 200)
}

chrome.tabs.onActivated.addListener(scheduleRefresh)
chrome.tabs.onUpdated.addListener((_id, change) => {
  if (change.status === 'complete') scheduleRefresh()
})
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && Object.keys(changes).some((key) => key.startsWith('contact:'))) {
    scheduleRefresh()
  }
})

render()
void refresh_(false)
