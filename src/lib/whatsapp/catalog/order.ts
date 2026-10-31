/** One line of a cart the contact sent from the catalog. */
export interface CatalogOrderItem {
  retailerId: string
  quantity: number
  unitPrice: number
  currency: string
}

export interface CatalogOrderPayload {
  catalogId: string | null
  note: string | null
  items: CatalogOrderItem[]
}

/** Meta `messages[].order` block of an inbound `order` message. */
export interface MetaOrderBlock {
  catalog_id?: string
  text?: string
  product_items?: {
    product_retailer_id?: string
    quantity?: number | string
    item_price?: number | string
    currency?: string
  }[]
}

/** Most lines Meta allows in a cart. */
export const CATALOG_ORDER_MAX_ITEMS = 60

/** Cleans Meta's order block; `null` when it carries no usable line. */
export function parseCatalogOrder(
  block: MetaOrderBlock | undefined,
): CatalogOrderPayload | null {
  const items: CatalogOrderItem[] = []
  for (const row of block?.product_items ?? []) {
    const retailerId = row.product_retailer_id?.trim()
    const quantity = Math.floor(Number(row.quantity))
    if (!retailerId || !Number.isFinite(quantity) || quantity < 1) continue
    const price = Number(row.item_price)
    items.push({
      retailerId: retailerId.slice(0, 120),
      quantity,
      unitPrice: Number.isFinite(price) && price >= 0 ? price : 0,
      currency: (row.currency ?? 'BRL').toUpperCase().slice(0, 3),
    })
    if (items.length === CATALOG_ORDER_MAX_ITEMS) break
  }
  if (items.length === 0) return null
  return {
    catalogId: block?.catalog_id?.trim() || null,
    note: block?.text?.trim().slice(0, 1000) || null,
    items,
  }
}

export function orderTotal(items: CatalogOrderItem[]): number {
  const cents = items.reduce(
    (sum, item) => sum + Math.round(item.unitPrice * 100) * item.quantity,
    0,
  )
  return cents / 100
}

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

/** Timeline text of a received cart. */
export function orderSummary(
  lines: { name: string; quantity: number; unitPrice: number }[],
  total: number,
): string {
  const rows = lines.map(
    (line) => `${line.quantity}x ${line.name} - ${BRL.format(line.unitPrice)}`,
  )
  return ['Carrinho recebido', ...rows, `Total: ${BRL.format(total)}`].join(
    '\n',
  )
}
