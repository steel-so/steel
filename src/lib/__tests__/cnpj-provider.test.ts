import { afterEach, describe, expect, it, vi } from 'vitest'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'

vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import {
  BrasilApiCnpjProvider,
  getCnpjProvider,
  toCnpjProfile,
} from '../cnpj/provider'

const CNPJ = '11222333000181'

const FULL = {
  razao_social: ' ACME LTDA ',
  nome_fantasia: 'Acme',
  cnae_fiscal: 4711302,
  cnae_fiscal_descricao: 'Comércio varejista',
  cnaes_secundarios: [
    { codigo: 4712100, descricao: 'Minimercados' },
    { codigo: 0, descricao: 'ignored' },
  ],
  porte: 'EMPRESA DE PEQUENO PORTE',
  natureza_juridica: 'Sociedade Limitada',
  descricao_situacao_cadastral: 'ATIVA',
  data_inicio_atividade: '2015-03-02',
  capital_social: 50000,
  qsa: [
    {
      nome_socio: 'MARIA',
      qualificacao_socio: 'Administrador',
      data_entrada_sociedade: '2015-03-02',
    },
    { nome_socio: '  ' },
  ],
  cep: '01001000',
  logradouro: 'RUA A',
  numero: '10',
  complemento: '',
  bairro: 'CENTRO',
  municipio: 'SAO PAULO',
  uf: 'sp',
}

function respond(status: number, body: unknown = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    })),
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('toCnpjProfile', () => {
  it('maps the full BrasilAPI payload', () => {
    const profile = toCnpjProfile(CNPJ, FULL)
    expect(profile).toMatchObject({
      cnpj: CNPJ,
      legalName: 'ACME LTDA',
      tradeName: 'Acme',
      cnaeCode: '4711302',
      size: 'EPP',
      openedAt: '2015-03-02',
      shareCapital: 50000,
    })
    expect(profile.secondaryCnaes).toEqual([
      { code: '4712100', description: 'Minimercados' },
    ])
    expect(profile.partners).toEqual([
      {
        name: 'MARIA',
        qualification: 'Administrador',
        enteredAt: '2015-03-02',
      },
    ])
    expect(profile.address).toEqual({
      zipCode: '01001-000',
      street: 'RUA A',
      number: '10',
      neighborhood: 'CENTRO',
      city: 'SAO PAULO',
      state: 'SP',
    })
  })

  it('handles an empty payload', () => {
    const profile = toCnpjProfile(CNPJ, {})
    expect(profile).toMatchObject({
      legalName: null,
      cnaeCode: null,
      size: null,
      openedAt: null,
      shareCapital: null,
      address: null,
      secondaryCnaes: [],
      partners: [],
    })
  })

  it.each([
    ['MICRO EMPRESA', 'ME'],
    ['DEMAIS', 'DEMAIS'],
    ['NAO INFORMADO', null],
  ])('maps size %s', (porte, size) => {
    expect(toCnpjProfile(CNPJ, { porte }).size).toBe(size)
  })

  it('pads short CNAE codes and drops bad dates', () => {
    const profile = toCnpjProfile(CNPJ, {
      cnae_fiscal: '111',
      data_inicio_atividade: 'x',
    })
    expect(profile.cnaeCode).toBe('0000111')
    expect(profile.openedAt).toBeNull()
  })
})

describe('BrasilApiCnpjProvider', () => {
  it('exposes itself as the default provider', () => {
    expect(getCnpjProvider()).toBe(BrasilApiCnpjProvider)
    expect(BrasilApiCnpjProvider.source).toBe('brasilapi')
  })

  it('rejects an invalid CNPJ without calling the network', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expectErr(await BrasilApiCnpjProvider.lookup('123'), 'CRM_CNPJ_INVALID')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns the profile for a 200', async () => {
    respond(200, FULL)
    const profile = expectOk(
      await BrasilApiCnpjProvider.lookup('11.222.333/0001-81'),
    )
    expect(profile.cnpj).toBe(CNPJ)
    expect(fetch).toHaveBeenCalledWith(
      `https://brasilapi.com.br/api/cnpj/v1/${CNPJ}`,
      expect.objectContaining({ headers: { accept: 'application/json' } }),
    )
  })

  it.each([
    [404, 'CRM_CNPJ_NOT_FOUND'],
    [429, 'CRM_CNPJ_RATE_LIMITED'],
    [500, 'CRM_CNPJ_LOOKUP_FAILED'],
  ] as const)('maps HTTP %s to %s', async (status, code) => {
    respond(status)
    expectErr(await BrasilApiCnpjProvider.lookup(CNPJ), code)
  })

  it('maps a network failure to a lookup error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    expectErr(
      await BrasilApiCnpjProvider.lookup(CNPJ),
      'CRM_CNPJ_LOOKUP_FAILED',
    )
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue('weird'))
    expectErr(
      await BrasilApiCnpjProvider.lookup(CNPJ, new AbortController().signal),
      'CRM_CNPJ_LOOKUP_FAILED',
    )
  })
})
