import type {
  WhatsAppEcomEventKind,
  WhatsAppStoreProvider,
} from '@prisma/client'

/** What every store event is reduced to before it is stored. */
export interface NormalizedStoreEvent {
  kind: WhatsAppEcomEventKind
  /** Cart / order id in the store; with the kind it makes the event unique. */
  externalId: string
  /** Phone digits with country code. */
  waId: string
  name: string | null
  orderNumber: string | null
  total: number | null
  cartUrl: string | null
  trackingCode: string | null
  trackingUrl: string | null
  items: string[]
}

export type NormalizeOutcome =
  | { ok: true; event: NormalizedStoreEvent }
  | { ok: false; reason: string }

type Json = Record<string, unknown>

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function text(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value))
      return String(value)
  }
  return null
}

function amount(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed =
      typeof value === 'number'
        ? value
        : Number(String(value ?? '').replace(',', '.'))
    if (value !== null && value !== '' && Number.isFinite(parsed)) {
      return Math.round(parsed * 100) / 100
    }
  }
  return null
}

/** Digits with country code (Brazilian numbers without it get `55`). */
export function storePhoneToWaId(raw: string | null): string | null {
  const digits = (raw ?? '').replace(/\D/g, '')
  if (digits.length < 10 || digits.length > 15) return null
  return digits.length <= 11 ? `55${digits}` : digits
}

/** Maps the many spellings of a store event to ours; `null` = not handled. */
export function resolveEventKind(
  raw: string | null,
): WhatsAppEcomEventKind | null {
  if (!raw) return null
  const value = raw.toLowerCase().replace(/[^a-z]+/g, '.')
  if (value.includes('abandon')) return 'CART_ABANDONED'
  if (value.includes('deliver')) return 'ORDER_DELIVERED'
  if (/(ship|fulfil|invoic|dispatch|tracking|sent|enviad)/.test(value)) {
    return 'ORDER_SHIPPED'
  }
  if (/(creat|paid|placed|approved|payment|new)/.test(value)) {
    return 'ORDER_CREATED'
  }
  return null
}

function firstItemNames(list: unknown, key: string): string[] {
  if (!Array.isArray(list)) return []
  return list
    .map((item) => (isRecord(item) ? text(item[key], item.name) : null))
    .filter((name): name is string => name !== null)
    .slice(0, 5)
}

/** Picks the fields of the Steel generic format (used by every provider). */
function fromGeneric(body: Json): Omit<NormalizedStoreEvent, 'kind'> | null {
  const customer = isRecord(body.customer) ? body.customer : {}
  const externalId = text(body.id, body.orderId, body.cartId)
  const waId = storePhoneToWaId(text(customer.phone, body.phone))
  if (!externalId || !waId) return null
  return {
    externalId,
    waId,
    name: text(customer.name, body.name),
    orderNumber: text(body.orderNumber, body.number),
    total: amount(body.total),
    cartUrl: text(body.cartUrl),
    trackingCode: text(body.trackingCode),
    trackingUrl: text(body.trackingUrl),
    items: firstItemNames(body.items, 'name'),
  }
}

function fromNuvemshop(body: Json): Omit<NormalizedStoreEvent, 'kind'> | null {
  const customer = isRecord(body.customer) ? body.customer : {}
  const externalId = text(body.id)
  const waId = storePhoneToWaId(text(body.contact_phone, customer.phone))
  if (!externalId || !waId) return null
  return {
    externalId,
    waId,
    name: text(body.contact_name, customer.name),
    orderNumber: text(body.number),
    total: amount(body.total),
    cartUrl: text(body.abandoned_checkout_url),
    trackingCode: text(body.shipping_tracking_number),
    trackingUrl: text(body.shipping_tracking_url),
    items: firstItemNames(body.products, 'name'),
  }
}

function fromTray(root: Json): Omit<NormalizedStoreEvent, 'kind'> | null {
  const order = isRecord(root.Order) ? root.Order : root
  const customer = isRecord(order.Customer) ? order.Customer : {}
  const externalId = text(order.id, order.session_id)
  const waId = storePhoneToWaId(text(customer.cellphone, customer.phone))
  if (!externalId || !waId) return null
  const products = Array.isArray(order.ProductsSold)
    ? order.ProductsSold.map((row) =>
        isRecord(row) && isRecord(row.ProductsSold) ? row.ProductsSold : row,
      )
    : []
  return {
    externalId,
    waId,
    name: text(customer.name),
    orderNumber: text(order.id),
    total: amount(order.total, order.partial_total),
    cartUrl: text(order.cart_url, order.recovery_url),
    trackingCode: text(order.sending_code),
    trackingUrl: text(order.tracking_url, order.sending_url),
    items: firstItemNames(products, 'name'),
  }
}

function fromVtex(body: Json): Omit<NormalizedStoreEvent, 'kind'> | null {
  const profile = isRecord(body.clientProfileData) ? body.clientProfileData : {}
  const externalId = text(body.orderId, body.orderFormId, body.id)
  const waId = storePhoneToWaId(text(profile.phone))
  if (!externalId || !waId) return null
  const packages = isRecord(body.packageAttachment)
    ? body.packageAttachment.packages
    : undefined
  const firstPackage =
    Array.isArray(packages) && isRecord(packages[0]) ? packages[0] : {}
  const name = [profile.firstName, profile.lastName]
    .map((part) => text(part))
    .filter(Boolean)
    .join(' ')
  const cents = typeof body.value === 'number' ? body.value / 100 : null
  return {
    externalId,
    waId,
    name: name || null,
    orderNumber: text(body.orderId, body.sequence),
    total: amount(cents),
    cartUrl: text(body.cartUrl, body.checkoutUrl),
    trackingCode: text(firstPackage.trackingNumber),
    trackingUrl: text(firstPackage.trackingUrl),
    items: firstItemNames(body.items, 'name'),
  }
}

const EVENT_FIELDS = ['event', 'type', 'topic', 'status', 'state', 'hookType']

/**
 * Reduces a store webhook to a {@link NormalizedStoreEvent}. Every provider
 * accepts the Steel generic body (`{ event, id, customer: { name, phone } }`);
 * Nuvemshop, Tray and VTEX full objects are read too. A body that carries only
 * an id (the stores' default thin webhooks) has no phone and is refused.
 */
export function normalizeStoreEvent(
  provider: WhatsAppStoreProvider,
  body: unknown,
  eventHeader: string | null,
): NormalizeOutcome {
  if (!isRecord(body)) return { ok: false, reason: 'Corpo inválido' }
  const inner = isRecord(body.Order) ? body.Order : body
  const rawKind =
    eventHeader ??
    text(...EVENT_FIELDS.map((field) => body[field] ?? inner[field]))
  const kind = resolveEventKind(rawKind)
  if (!kind) return { ok: false, reason: 'Evento não tratado' }

  const parsers = [
    fromGeneric,
    provider === 'NUVEMSHOP'
      ? fromNuvemshop
      : provider === 'TRAY'
        ? fromTray
        : fromVtex,
  ]
  for (const parse of parsers) {
    const parsed = parse(body)
    if (parsed) return { ok: true, event: { kind, ...parsed } }
  }
  return { ok: false, reason: 'O evento não traz o telefone do cliente' }
}

/** Tokens a trigger's template variables may use. */
export const STORE_VARIABLE_TOKENS = [
  { token: 'nome', label: 'Nome do cliente' },
  { token: 'pedido', label: 'Número do pedido' },
  { token: 'valor', label: 'Valor total' },
  { token: 'itens', label: 'Itens (até 5)' },
  { token: 'link_carrinho', label: 'Link para retomar o carrinho' },
  { token: 'rastreio', label: 'Código de rastreio' },
  { token: 'link_rastreio', label: 'Link de rastreio' },
] as const

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

/** Fills `{token}` placeholders with the event data (unknown ones stay). */
export function renderStoreVariable(
  template: string,
  event: Pick<
    NormalizedStoreEvent,
    | 'name'
    | 'orderNumber'
    | 'total'
    | 'items'
    | 'cartUrl'
    | 'trackingCode'
    | 'trackingUrl'
  >,
): string {
  const values: Record<string, string> = {
    nome: event.name?.split(' ')[0] ?? 'cliente',
    pedido: event.orderNumber ?? '',
    valor: event.total === null ? '' : BRL.format(event.total),
    itens: event.items.join(', '),
    link_carrinho: event.cartUrl ?? '',
    rastreio: event.trackingCode ?? '',
    link_rastreio: event.trackingUrl ?? '',
  }
  return template.replace(/\{(\w+)\}/g, (match, token: string) =>
    token in values ? values[token] : match,
  )
}
