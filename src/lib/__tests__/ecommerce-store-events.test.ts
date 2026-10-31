import { describe, expect, it } from 'vitest'
import {
  normalizeStoreEvent,
  renderStoreVariable,
  resolveEventKind,
  storePhoneToWaId,
} from '../ecommerce/normalize'
import {
  NUVEMSHOP_SIGNATURE_HEADER,
  STORE_SIGNATURE_HEADER,
  signStorePayload,
  verifyStoreSignature,
} from '../ecommerce/signature'

describe('store webhook signature', () => {
  const body = '{"id":"1"}'
  const secret = 's3cret'

  it('accepts the Steel header, with or without the sha256= prefix', () => {
    const sig = signStorePayload(secret, body)
    expect(
      verifyStoreSignature(
        new Headers({ [STORE_SIGNATURE_HEADER]: sig }),
        body,
        secret,
      ),
    ).toBe(true)
    expect(
      verifyStoreSignature(
        new Headers({
          [STORE_SIGNATURE_HEADER]: `sha256=${sig.toUpperCase()}`,
        }),
        body,
        secret,
      ),
    ).toBe(true)
  })

  it('accepts the Nuvemshop header', () => {
    const sig = signStorePayload(secret, body)
    expect(
      verifyStoreSignature(
        new Headers({ [NUVEMSHOP_SIGNATURE_HEADER]: sig }),
        body,
        secret,
      ),
    ).toBe(true)
  })

  it('rejects a missing header, another secret, another body and a short value', () => {
    const sig = signStorePayload(secret, body)
    expect(verifyStoreSignature(new Headers(), body, secret)).toBe(false)
    expect(
      verifyStoreSignature(
        new Headers({ [STORE_SIGNATURE_HEADER]: sig }),
        body,
        'other',
      ),
    ).toBe(false)
    expect(
      verifyStoreSignature(
        new Headers({ [STORE_SIGNATURE_HEADER]: sig }),
        `${body} `,
        secret,
      ),
    ).toBe(false)
    expect(
      verifyStoreSignature(
        new Headers({ [STORE_SIGNATURE_HEADER]: 'abc' }),
        body,
        secret,
      ),
    ).toBe(false)
  })
})

describe('storePhoneToWaId', () => {
  it('adds the country code to Brazilian numbers and keeps long ones', () => {
    expect(storePhoneToWaId('(11) 98888-7777')).toBe('5511988887777')
    expect(storePhoneToWaId('+55 11 98888-7777')).toBe('5511988887777')
    expect(storePhoneToWaId('+44 20 7946 0958')).toBe('442079460958')
  })

  it('refuses numbers that cannot be a phone', () => {
    expect(storePhoneToWaId(null)).toBeNull()
    expect(storePhoneToWaId('12345')).toBeNull()
    expect(storePhoneToWaId('1'.repeat(16))).toBeNull()
  })
})

describe('resolveEventKind', () => {
  it.each([
    ['cart.abandoned', 'CART_ABANDONED'],
    ['checkout/abandoned', 'CART_ABANDONED'],
    ['order/delivered', 'ORDER_DELIVERED'],
    ['order/fulfilled', 'ORDER_SHIPPED'],
    ['invoiced', 'ORDER_SHIPPED'],
    ['order.shipped', 'ORDER_SHIPPED'],
    ['order/created', 'ORDER_CREATED'],
    ['payment-approved', 'ORDER_CREATED'],
  ])('maps %s', (raw, kind) => {
    expect(resolveEventKind(raw)).toBe(kind)
  })

  it('ignores unknown or empty events', () => {
    expect(resolveEventKind('product/updated')).toBeNull()
    expect(resolveEventKind(null)).toBeNull()
  })
})

describe('normalizeStoreEvent', () => {
  it('reads the Steel generic body for any provider', () => {
    const outcome = normalizeStoreEvent(
      'VTEX',
      {
        event: 'cart.abandoned',
        id: 'c1',
        customer: { name: 'Maria Souza', phone: '11988887777' },
        cartUrl: 'https://loja/cart',
        total: '99,90',
        items: [{ name: 'Camiseta' }, { name: 'Boné' }, 'x'],
      },
      null,
    )
    expect(outcome).toEqual({
      ok: true,
      event: {
        kind: 'CART_ABANDONED',
        externalId: 'c1',
        waId: '5511988887777',
        name: 'Maria Souza',
        orderNumber: null,
        total: 99.9,
        cartUrl: 'https://loja/cart',
        trackingCode: null,
        trackingUrl: null,
        items: ['Camiseta', 'Boné'],
      },
    })
  })

  it('lets the event header name the event', () => {
    const outcome = normalizeStoreEvent(
      'TRAY',
      { id: 'o1', customer: { phone: '11988887777' }, trackingCode: 'BR1' },
      'order.shipped',
    )
    expect(outcome).toMatchObject({
      ok: true,
      event: { kind: 'ORDER_SHIPPED', trackingCode: 'BR1' },
    })
  })

  it('reads a full Nuvemshop order', () => {
    const outcome = normalizeStoreEvent(
      'NUVEMSHOP',
      {
        event: 'order/fulfilled',
        id: 77,
        number: 1001,
        contact_name: 'Ana',
        contact_phone: '+5511977776666',
        total: '150.50',
        shipping_tracking_number: 'TRK',
        shipping_tracking_url: 'https://track/TRK',
        abandoned_checkout_url: 'https://loja/retomar',
        products: [{ name: 'Tênis' }],
      },
      null,
    )
    expect(outcome).toMatchObject({
      ok: true,
      event: {
        kind: 'ORDER_SHIPPED',
        externalId: '77',
        waId: '5511977776666',
        name: 'Ana',
        orderNumber: '1001',
        total: 150.5,
        trackingCode: 'TRK',
        trackingUrl: 'https://track/TRK',
        cartUrl: 'https://loja/retomar',
        items: ['Tênis'],
      },
    })
  })

  it('reads a nuvemshop customer block when the contact fields are absent', () => {
    const outcome = normalizeStoreEvent(
      'NUVEMSHOP',
      {
        event: 'order/created',
        id: 'n1',
        customer: { name: 'Bia', phone: '11 91111-2222' },
      },
      null,
    )
    expect(outcome).toMatchObject({ ok: true, event: { name: 'Bia' } })
  })

  it('reads a Tray order wrapped in Order', () => {
    const outcome = normalizeStoreEvent(
      'TRAY',
      {
        Order: {
          id: '555',
          status: 'Enviado',
          total: '80.00',
          sending_code: 'SEDEX1',
          sending_url: 'https://track/SEDEX1',
          Customer: { name: 'Caio', cellphone: '(21) 97777-6666' },
          ProductsSold: [{ ProductsSold: { name: 'Mouse' } }, { name: 'Cabo' }],
        },
      },
      null,
    )
    expect(outcome).toMatchObject({
      ok: true,
      event: {
        kind: 'ORDER_SHIPPED',
        externalId: '555',
        waId: '5521977776666',
        trackingCode: 'SEDEX1',
        trackingUrl: 'https://track/SEDEX1',
        items: ['Mouse', 'Cabo'],
      },
    })
  })

  it('reads a VTEX order with cents and packages', () => {
    const outcome = normalizeStoreEvent(
      'VTEX',
      {
        state: 'invoiced',
        orderId: 'v1-01',
        value: 12990,
        clientProfileData: {
          firstName: 'Dani',
          lastName: 'Lima',
          phone: '+5511955554444',
        },
        packageAttachment: {
          packages: [{ trackingNumber: 'VT1', trackingUrl: 'https://t/VT1' }],
        },
        items: [{ name: 'Panela' }],
      },
      null,
    )
    expect(outcome).toMatchObject({
      ok: true,
      event: {
        kind: 'ORDER_SHIPPED',
        externalId: 'v1-01',
        name: 'Dani Lima',
        total: 129.9,
        trackingCode: 'VT1',
        trackingUrl: 'https://t/VT1',
      },
    })
  })

  it('handles a VTEX order without packages or cents', () => {
    const outcome = normalizeStoreEvent(
      'VTEX',
      {
        status: 'order-created',
        orderId: 'v2',
        clientProfileData: { phone: '11955554444' },
      },
      null,
    )
    expect(outcome).toMatchObject({
      ok: true,
      event: {
        kind: 'ORDER_CREATED',
        name: null,
        total: null,
        trackingCode: null,
      },
    })
  })

  it('refuses thin webhooks, unknown events and bad bodies', () => {
    expect(
      normalizeStoreEvent('NUVEMSHOP', { event: 'order/created', id: 1 }, null),
    ).toEqual({ ok: false, reason: 'O evento não traz o telefone do cliente' })
    expect(
      normalizeStoreEvent('TRAY', { event: 'product/updated', id: 1 }, null),
    ).toEqual({ ok: false, reason: 'Evento não tratado' })
    expect(normalizeStoreEvent('VTEX', [], null)).toEqual({
      ok: false,
      reason: 'Corpo inválido',
    })
    expect(normalizeStoreEvent('VTEX', 'x', null)).toEqual({
      ok: false,
      reason: 'Corpo inválido',
    })
  })
})

describe('renderStoreVariable', () => {
  const event = {
    name: 'Maria Souza',
    orderNumber: '1001',
    total: 99.9,
    items: ['A', 'B'],
    cartUrl: 'https://c',
    trackingCode: 'TRK',
    trackingUrl: 'https://t',
  }

  it('fills every token and keeps unknown ones', () => {
    expect(
      renderStoreVariable(
        '{nome} {pedido} {valor} {itens} {link_carrinho} {rastreio} {link_rastreio} {x}',
        event,
      ).replace(/\s/g, ' '),
    ).toBe('Maria 1001 R$ 99,90 A, B https://c TRK https://t {x}')
  })

  it('falls back when the event lacks a value', () => {
    expect(
      renderStoreVariable('{nome}|{valor}|{rastreio}', {
        ...event,
        name: null,
        total: null,
        trackingCode: null,
      }),
    ).toBe('cliente||')
  })
})
