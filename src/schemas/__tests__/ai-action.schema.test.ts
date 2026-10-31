import { describe, expect, it } from 'vitest'
import {
  AiActionInvokeArgsSchema,
  CreateAiActionConnectorSchema,
  connectorProblem,
  UpdateAiActionConnectorSchema,
  UpdateAiActionSettingsSchema,
} from '../ai-action.schema'

const VALID = {
  key: 'consultar_pedido',
  name: 'Consultar pedido',
  description: 'Busca a situação de um pedido.',
  kind: 'LOOKUP',
  method: 'GET',
  urlTemplate: 'https://api.cliente.com.br/pedidos/{orderId}',
  params: [{ name: 'orderId', description: 'Número', required: true }],
}

describe('CreateAiActionConnectorSchema', () => {
  it('should accept a lookup and fill the defaults', () => {
    const parsed = CreateAiActionConnectorSchema.parse(VALID)
    expect(parsed.enabled).toBe(true)
    expect(parsed.headers).toEqual({})
  })

  it('should accept an action with headers', () => {
    const parsed = CreateAiActionConnectorSchema.parse({
      ...VALID,
      key: 'redefinir_senha',
      kind: 'ACTION',
      method: 'POST',
      urlTemplate: 'https://api.cliente.com.br/senha',
      params: [{ name: 'email' }],
      headers: { Authorization: 'Bearer x' },
    })
    expect(parsed.params[0]).toEqual({
      name: 'email',
      description: '',
      required: true,
    })
  })

  it.each([
    ['lookup with POST', { method: 'POST' }],
    ['action with GET', { kind: 'ACTION' }],
    ['http url', { urlTemplate: 'http://api.cliente.com.br/p/{orderId}' }],
    [
      'placeholder in the host',
      { urlTemplate: 'https://{orderId}.cliente.com.br/p' },
    ],
    [
      'undeclared placeholder',
      { urlTemplate: 'https://api.cliente.com.br/p/{other}' },
    ],
    [
      'repeated param',
      {
        params: [
          { name: 'orderId', description: '', required: true },
          { name: 'orderId', description: '', required: true },
        ],
      },
    ],
    ['bad key', { key: 'Pedido!' }],
    ['forbidden header', { headers: { Host: 'x' } }],
    ['bad header name', { headers: { 'a b': 'x' } }],
  ])('should reject %s', (_label, patch) => {
    expect(
      CreateAiActionConnectorSchema.safeParse({ ...VALID, ...patch }).success,
    ).toBe(false)
  })

  it('should reject more than 10 headers', () => {
    const headers = Object.fromEntries(
      Array.from({ length: 11 }, (_, i) => [`X-H${i}`, 'v']),
    )
    expect(
      CreateAiActionConnectorSchema.safeParse({ ...VALID, headers }).success,
    ).toBe(false)
  })
})

describe('connectorProblem', () => {
  it('should be null for a partial shape without conflicts', () => {
    expect(connectorProblem({})).toBeNull()
    expect(connectorProblem({ kind: 'LOOKUP', method: 'GET' })).toBeNull()
  })

  it('should check the url alone when params are unknown', () => {
    expect(connectorProblem({ urlTemplate: 'https://a.com/{x}' })).toBeNull()
  })
})

describe('UpdateAiActionConnectorSchema', () => {
  it('should require at least one field and forbid changing the key', () => {
    expect(UpdateAiActionConnectorSchema.safeParse({}).success).toBe(false)
    expect(UpdateAiActionConnectorSchema.parse({ enabled: false })).toEqual({
      enabled: false,
    })
    expect(
      'key' in UpdateAiActionConnectorSchema.parse({ key: 'x', enabled: true }),
    ).toBe(false)
  })
})

describe('UpdateAiActionSettingsSchema', () => {
  it('should default the mode to APPROVAL', () => {
    const parsed = UpdateAiActionSettingsSchema.parse({
      zapTools: [{ toolName: 'act_lookup' }],
    })
    expect(parsed.zapTools).toEqual([
      { toolName: 'act_lookup', mode: 'APPROVAL' },
    ])
  })

  it('should reject repeated tools and an empty body', () => {
    expect(
      UpdateAiActionSettingsSchema.safeParse({
        zapTools: [{ toolName: 'act_run' }, { toolName: 'act_run' }],
      }).success,
    ).toBe(false)
    expect(UpdateAiActionSettingsSchema.safeParse({}).success).toBe(false)
  })
})

describe('AiActionInvokeArgsSchema', () => {
  it('should default params and accept scalars only', () => {
    expect(AiActionInvokeArgsSchema.parse({ connector: 'x' }).params).toEqual(
      {},
    )
    expect(
      AiActionInvokeArgsSchema.safeParse({
        connector: 'x',
        params: { a: { nested: 1 } },
      }).success,
    ).toBe(false)
  })
})
