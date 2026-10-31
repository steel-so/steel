import type { WhatsAppStoreProvider } from '@prisma/client'

/** A product as a store reports it. */
export interface StoreProduct {
  externalId: string
  sku: string | null
  name: string
  description: string | null
  price: number
  imageUrl: string | null
  url: string | null
  available: boolean
}

export interface StoreCredentials {
  /** Store API host, e.g. `https://loja.com.br` (Tray) or the store id. */
  storeUrl: string | null
  /** Access token / app key of the store API. */
  accessToken: string
  /** Nuvemshop store id. */
  storeId?: string
}

/** Pulls the product list of a store. Behind a setting that is off. */
export interface StoreCatalogAdapter {
  provider: WhatsAppStoreProvider
  listProducts(
    credentials: StoreCredentials,
    fetcher?: typeof fetch,
  ): Promise<StoreProduct[]>
}

/** Pages a store sync reads at most (a guard, not a business limit). */
export const STORE_SYNC_MAX_PAGES = 40

type Json = Record<string, unknown>
const isRecord = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim()
    ? v.trim()
    : typeof v === 'number'
      ? String(v)
      : null
const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

async function getJson(
  fetcher: typeof fetch,
  url: string,
  headers: Record<string, string>,
): Promise<unknown> {
  const response = await fetcher(url, {
    headers: { accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) {
    throw new Error(`A loja respondeu ${response.status}`)
  }
  return response.json()
}

function localized(value: unknown): string | null {
  if (isRecord(value)) return str(value.pt) ?? str(value.es) ?? str(value.en)
  return str(value)
}

/** Nuvemshop REST API: `GET /v1/{store_id}/products`. */
export const nuvemshopAdapter: StoreCatalogAdapter = {
  provider: 'NUVEMSHOP',
  async listProducts(credentials, fetcher = fetch) {
    if (!credentials.storeId) throw new Error('Informe o id da loja')
    const products: StoreProduct[] = []
    for (let page = 1; page <= STORE_SYNC_MAX_PAGES; page += 1) {
      const rows = await getJson(
        fetcher,
        `https://api.nuvemshop.com.br/v1/${encodeURIComponent(credentials.storeId)}/products?per_page=100&page=${page}`,
        {
          authentication: `bearer ${credentials.accessToken}`,
          'user-agent': 'Steel (suporte@stratustelecom.com.br)',
        },
      )
      if (!Array.isArray(rows) || rows.length === 0) break
      for (const row of rows) {
        if (!isRecord(row)) continue
        const variant =
          Array.isArray(row.variants) && isRecord(row.variants[0])
            ? row.variants[0]
            : {}
        const image =
          Array.isArray(row.images) && isRecord(row.images[0])
            ? str(row.images[0].src)
            : null
        const id = str(row.id)
        const name = localized(row.name)
        if (!id || !name) continue
        products.push({
          externalId: id,
          sku: str(variant.sku),
          name,
          description: localized(row.description),
          price: num(variant.promotional_price ?? variant.price),
          imageUrl: image,
          url: str(row.canonical_url),
          available: row.published !== false,
        })
      }
      if (rows.length < 100) break
    }
    return products
  },
}

/** Tray REST API: `GET {api_address}/products?access_token=...`. */
export const trayAdapter: StoreCatalogAdapter = {
  provider: 'TRAY',
  async listProducts(credentials, fetcher = fetch) {
    if (!credentials.storeUrl)
      throw new Error('Informe o endereço da API da loja')
    const base = credentials.storeUrl.replace(/\/+$/, '')
    const products: StoreProduct[] = []
    for (let page = 1; page <= STORE_SYNC_MAX_PAGES; page += 1) {
      const body = await getJson(
        fetcher,
        `${base}/products?limit=50&page=${page}&access_token=${encodeURIComponent(credentials.accessToken)}`,
        {},
      )
      const rows =
        isRecord(body) && Array.isArray(body.Products) ? body.Products : []
      if (rows.length === 0) break
      for (const row of rows) {
        const product =
          isRecord(row) && isRecord(row.Product) ? row.Product : null
        const id = product ? str(product.id) : null
        const name = product ? str(product.name) : null
        if (!product || !id || !name) continue
        products.push({
          externalId: id,
          sku: str(product.reference),
          name,
          description: str(product.description_small),
          price: num(product.promotional_price) || num(product.price),
          imageUrl: str(product.image),
          url: str(product.url),
          available: product.available !== '0' && product.available !== 0,
        })
      }
      if (rows.length < 50) break
    }
    return products
  },
}

export function getStoreCatalogAdapter(
  provider: WhatsAppStoreProvider,
): StoreCatalogAdapter | null {
  if (provider === 'NUVEMSHOP') return nuvemshopAdapter
  if (provider === 'TRAY') return trayAdapter
  return null
}
