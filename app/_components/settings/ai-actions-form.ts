import type { AiActionConnectorInput } from '@/src/hooks/use-ai-actions'

/** Raw values of the "Novo conector" form. */
export interface ConnectorFormState {
  name: string
  key: string
  description: string
  kind: 'LOOKUP' | 'ACTION'
  method: AiActionConnectorInput['method']
  urlTemplate: string
  /** One per line: `nome: descrição`; `nome?: descrição` = opcional. */
  params: string
  /** One per line: `Nome: valor`. */
  headers: string
}

export const EMPTY_CONNECTOR_FORM: ConnectorFormState = {
  name: '',
  key: '',
  description: '',
  kind: 'LOOKUP',
  method: 'GET',
  urlTemplate: 'https://',
  params: '',
  headers: '',
}

/** `Consultar pedido` → `consultar_pedido`. */
export function slugifyKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[0-9]+/, '')
    .slice(0, 48)
}

export function placeholdersOf(urlTemplate: string): string[] {
  return [...urlTemplate.matchAll(/\{([^}]+)\}/g)].map((m) => m[1] ?? '')
}

export function parseParams(text: string, urlTemplate: string) {
  const params = new Map<
    string,
    { name: string; description: string; required: boolean }
  >()
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const colon = trimmed.indexOf(':')
    const rawName = (colon === -1 ? trimmed : trimmed.slice(0, colon)).trim()
    const optional = rawName.endsWith('?')
    const name = optional ? rawName.slice(0, -1).trim() : rawName
    if (!name) continue
    params.set(name, {
      name,
      description: colon === -1 ? '' : trimmed.slice(colon + 1).trim(),
      required: !optional,
    })
  }
  // Placeholders of the URL are always arguments, even when not listed.
  for (const name of placeholdersOf(urlTemplate)) {
    if (!params.has(name)) params.set(name, { name, description: '', required: true })
  }
  return [...params.values()]
}

export function parseHeaders(text: string): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const name = line.slice(0, colon).trim()
    const value = line.slice(colon + 1).trim()
    if (name && value) headers[name] = value
  }
  return headers
}

export function toConnectorInput(
  form: ConnectorFormState,
): AiActionConnectorInput {
  const urlTemplate = form.urlTemplate.trim()
  return {
    key: form.key.trim() || slugifyKey(form.name),
    name: form.name.trim(),
    description: form.description.trim(),
    kind: form.kind,
    method: form.kind === 'LOOKUP' ? 'GET' : form.method,
    urlTemplate,
    params: parseParams(form.params, urlTemplate),
    headers: parseHeaders(form.headers),
    enabled: true,
  }
}

/** Tools the WhatsApp auto-reply may be given (curated list). */
export const ZAP_TOOL_OPTIONS = [
  {
    toolName: 'act_lookup',
    label: 'Consultar sistema externo',
    hint: 'Lê dados (por exemplo, a situação de um pedido) pelos conectores de consulta.',
  },
  {
    toolName: 'act_run',
    label: 'Executar ação externa',
    hint: 'Redefine senha, libera acesso… pelos conectores de ação.',
  },
  {
    toolName: 'sd_create_ticket',
    label: 'Abrir chamado',
    hint: 'Abre um chamado no ServiceDesk com o que o cliente relatou.',
  },
  {
    toolName: 'crm_create_lead',
    label: 'Criar lead',
    hint: 'Cadastra o contato como lead no CRM.',
  },
] as const
