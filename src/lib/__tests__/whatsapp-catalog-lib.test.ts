import { describe, expect, it, vi } from 'vitest'
import { buildMetaProductsMessage } from '../whatsapp/catalog/message'
import {
  CATALOG_ORDER_MAX_ITEMS,
  orderSummary,
  orderTotal,
  parseCatalogOrder,
} from '../whatsapp/catalog/order'
import {
  getStoreCatalogAdapter,
  nuvemshopAdapter,
  trayAdapter,
} from '../whatsapp/catalog/store-adapters'

describe('parseCatalogOrder', () => {
  it('cleans the Meta block', () => {
    const order = parseCatalogOrder({
      catalog_id: ' 123 ',
      text: ' sem cebola ',
      product_items: [
        {
          product_retailer_id: 'SKU1',
          quantity: '2',
          item_price: 10.5,
          currency: 'brl',
        },
        { product_retailer_id: ' ', quantity: 1 },
        { product_retailer_id: 'SKU2', quantity: 0 },
        { product_retailer_id: 'SKU3', quantity: 1, item_price: 'x' },
      ],
    })
    expect(order).toEqual({
      catalogId: '123',
      note: 'sem cebola',
      items: [
        { retailerId: 'SKU1', quantity: 2, unitPrice: 10.5, currency: 'BRL' },
        { retailerId: 'SKU3', quantity: 1, unitPrice: 0, currency: 'BRL' },
      ],
    })
  })

  it('returns null without a usable line and caps the cart', () => {
    expect(parseCatalogOrder(undefined)).toBeNull()
    expect(parseCatalogOrder({ product_items: [] })).toBeNull()
    const many = Array.from(
      { length: CATALOG_ORDER_MAX_ITEMS + 5 },
      (_, i) => ({
        product_retailer_id: `S${i}`,
        quantity: 1,
      }),
    )
    const order = parseCatalogOrder({ product_items: many })
    expect(order?.items).toHaveLength(CATALOG_ORDER_MAX_ITEMS)
    expect(order?.catalogId).toBeNull()
    expect(order?.note).toBeNull()
  })

  it('totals in cents and writes the summary', () => {
    const items = [
      { retailerId: 'A', quantity: 3, unitPrice: 0.1, currency: 'BRL' },
      { retailerId: 'B', quantity: 1, unitPrice: 20, currency: 'BRL' },
    ]
    expect(orderTotal(items)).toBe(20.3)
    const text = orderSummary(
      [
        { name: 'A', quantity: 3, unitPrice: 0.1 },
        { name: 'B', quantity: 1, unitPrice: 20 },
      ],
      20.3,
    )
    expect(text.split('\n')[0]).toBe('Carrinho recebido')
    expect(text).toContain('3x A')
    expect(text).toContain('Total: R$')
  })
})

describe('buildMetaProductsMessage', () => {
  const base = { to: '55', catalogId: 'cat', bodyText: 'Veja' }

  it('builds a single product message', () => {
    expect(
      buildMetaProductsMessage({
        ...base,
        retailerIds: ['A'],
        footerText: 'rodapé',
      }),
    ).toEqual({
      type: 'product',
      body: { text: 'Veja' },
      footer: { text: 'rodapé' },
      action: { catalog_id: 'cat', product_retailer_id: 'A' },
    })
  })

  it('builds a product list with a trimmed section title', () => {
    const message = buildMetaProductsMessage({
      ...base,
      retailerIds: ['A', 'B'],
      sectionTitle: 'x'.repeat(40),
    })
    expect(message).toMatchObject({
      type: 'product_list',
      header: { type: 'text', text: 'Nossos produtos' },
      action: {
        catalog_id: 'cat',
        sections: [
          {
            title: 'x'.repeat(24),
            product_items: [
              { product_retailer_id: 'A' },
              { product_retailer_id: 'B' },
            ],
          },
        ],
      },
    })
    expect(
      buildMetaProductsMessage({
        ...base,
        retailerIds: ['A', 'B'],
        headerText: 'Oferta',
      }),
    ).toMatchObject({
      header: { text: 'Oferta' },
      action: { sections: [{ title: 'Produtos' }] },
    })
  })
})

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status })

describe('store adapters', () => {
  it('picks the adapter by provider', () => {
    expect(getStoreCatalogAdapter('NUVEMSHOP')).toBe(nuvemshopAdapter)
    expect(getStoreCatalogAdapter('TRAY')).toBe(trayAdapter)
    expect(getStoreCatalogAdapter('VTEX')).toBeNull()
  })

  it('reads Nuvemshop products across pages', async () => {
    const first = Array.from({ length: 100 }, (_, i) => ({
      id: i,
      name: { pt: `P${i}` },
      published: true,
      variants: [{ sku: `S${i}`, price: '10.00', promotional_price: null }],
      images: [{ src: 'https://img' }],
      canonical_url: 'https://loja/p',
    }))
    const second = [
      {
        id: 'x',
        name: 'Solto',
        published: false,
        variants: [],
        images: [],
        description: { en: 'Desc' },
      },
      { id: null, name: { pt: 'sem id' } },
      'lixo',
    ]
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json(first))
      .mockResolvedValueOnce(json(second))
    const products = await nuvemshopAdapter.listProducts(
      { storeUrl: null, accessToken: 'tok', storeId: '9' },
      fetcher as unknown as typeof fetch,
    )
    expect(products).toHaveLength(101)
    expect(products[0]).toMatchObject({
      externalId: '0',
      sku: 'S0',
      name: 'P0',
      price: 10,
      imageUrl: 'https://img',
      url: 'https://loja/p',
      available: true,
    })
    expect(products[100]).toMatchObject({
      externalId: 'x',
      name: 'Solto',
      description: 'Desc',
      sku: null,
      price: 0,
      available: false,
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls[0][1].headers.authentication).toBe('bearer tok')
  })

  it('stops Nuvemshop on an empty page and rejects a missing store id', async () => {
    const fetcher = vi.fn().mockResolvedValue(json([]))
    expect(
      await nuvemshopAdapter.listProducts(
        { storeUrl: null, accessToken: 't', storeId: '9' },
        fetcher as unknown as typeof fetch,
      ),
    ).toEqual([])
    await expect(
      nuvemshopAdapter.listProducts({ storeUrl: null, accessToken: 't' }),
    ).rejects.toThrow('Informe o id da loja')
  })

  it('reads Tray products', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      json({
        Products: [
          {
            Product: {
              id: '1',
              name: 'Camisa',
              reference: 'CAM',
              price: '100.00',
              promotional_price: '80.00',
              image: 'https://i',
              url: 'https://u',
              available: '1',
              description_small: 'curta',
            },
          },
          { Product: { id: '2', name: 'Off', price: '5', available: '0' } },
          { Product: { id: null } },
          'x',
        ],
      }),
    )
    const products = await trayAdapter.listProducts(
      { storeUrl: 'https://api.tray/', accessToken: 'tk' },
      fetcher as unknown as typeof fetch,
    )
    expect(products).toEqual([
      expect.objectContaining({
        externalId: '1',
        sku: 'CAM',
        price: 80,
        available: true,
        description: 'curta',
      }),
      expect.objectContaining({
        externalId: '2',
        sku: null,
        price: 5,
        available: false,
      }),
    ])
    expect(fetcher.mock.calls[0][0]).toContain(
      'https://api.tray/products?limit=50&page=1&access_token=tk',
    )
  })

  it('handles Tray empty pages, no address and store errors', async () => {
    expect(
      await trayAdapter.listProducts(
        { storeUrl: 'https://api.tray', accessToken: 'tk' },
        (async () => json({})) as unknown as typeof fetch,
      ),
    ).toEqual([])
    await expect(
      trayAdapter.listProducts({ storeUrl: null, accessToken: 'tk' }),
    ).rejects.toThrow('Informe o endereço da API da loja')
    await expect(
      trayAdapter.listProducts(
        { storeUrl: 'https://api.tray', accessToken: 'tk' },
        (async () => json({}, 500)) as unknown as typeof fetch,
      ),
    ).rejects.toThrow('A loja respondeu 500')
  })
})
