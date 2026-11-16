import { afterEach, describe, expect, it, vi } from 'vitest'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'

vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const cache = vi.hoisted(() => ({
  get: vi.fn(async () => null as unknown),
  set: vi.fn(async () => undefined),
}))
vi.mock('@/src/cache/crm-cnpj.cache', () => ({ CrmCnpjCache: cache }))

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

afterEach(() => {
  vi.unstubAllGlobals()
  cache.get.mockResolvedValue(null)
  cache.set.mockClear()
})

type Reply = { status: number; body?: unknown } | Error

/** Routes by host: every source answers what the test says, 503 otherwise. */
function sources(replies: Partial<Record<string, Reply>>) {
  const fetchMock = vi.fn(async (url: string) => {
    const host = new URL(url).hostname
    const reply = replies[host] ?? { status: 503 }
    if (reply instanceof Error) throw reply
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      json: async () => reply.body ?? {},
    }
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const HOSTS = {
  brasilapi: 'brasilapi.com.br',
  cnpjws: 'publica.cnpj.ws',
  cnpja: 'open.cnpja.com',
  receitaws: 'receitaws.com.br',
  mirror: 'minhareceita.org',
} as const

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

const WS = {
  razao_social: 'ACME LTDA',
  capital_social: '1000.00',
  porte: { descricao: 'Demais' },
  natureza_juridica: { descricao: 'Sociedade Limitada' },
  socios: [
    {
      nome: 'MARIA SOUZA',
      data_entrada: '2015-03-02',
      qualificacao_socio: { descricao: 'Sócio-Administrador ' },
    },
  ],
  estabelecimento: {
    nome_fantasia: null,
    situacao_cadastral: 'Ativa',
    data_inicio_atividade: '2015-03-02',
    tipo_logradouro: 'RUA',
    logradouro: 'A',
    numero: '10',
    bairro: 'CENTRO',
    cep: '01001000',
    estado: { sigla: 'SP' },
    cidade: { nome: 'São Paulo' },
    atividade_principal: { id: '4711302', descricao: 'Comércio varejista' },
    atividades_secundarias: [{ id: '4712100', descricao: 'Minimercados' }],
  },
}

const CNPJA = {
  alias: 'Acme Store',
  founded: '2015-03-02',
  status: { text: 'Ativa' },
  company: {
    name: 'ACME LTDA',
    equity: 1000,
    nature: { text: 'Sociedade Limitada' },
    size: { text: 'Demais' },
    members: [
      {
        since: '2015-03-02',
        person: { name: 'Maria Souza' },
        role: { text: 'Sócio-Administrador' },
      },
    ],
  },
  address: {
    street: 'Rua A',
    number: '10',
    details: null,
    district: 'Centro',
    city: 'São Paulo',
    state: 'SP',
    zip: '01001000',
  },
  mainActivity: { id: 4711302, text: 'Comércio varejista' },
  sideActivities: [{ id: 4712100, text: 'Minimercados' }],
}

const RECEITAWS = {
  status: 'OK',
  nome: 'ACME LTDA',
  fantasia: '',
  porte: 'EMPRESA DE PEQUENO PORTE',
  natureza_juridica: '206-2 - Sociedade Empresária Limitada',
  situacao: 'ATIVA',
  abertura: '02/03/2015',
  capital_social: '1000.00',
  atividade_principal: [{ code: '47.11-3-02', text: 'Comércio varejista' }],
  atividades_secundarias: [{ code: '47.12-1-00', text: 'Minimercados' }],
  qsa: [{ nome: 'MARIA SOUZA', qual: '49-Sócio-Administrador' }],
  logradouro: 'R A',
  numero: '10',
  bairro: 'CENTRO',
  municipio: 'SAO PAULO',
  uf: 'SP',
  cep: '01.001-000',
}

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

  it('asks all five sources and merges what they return', async () => {
    const fetchMock = sources({
      [HOSTS.brasilapi]: { status: 200, body: FULL },
      [HOSTS.cnpjws]: { status: 200, body: WS },
      [HOSTS.cnpja]: { status: 200, body: CNPJA },
      [HOSTS.receitaws]: { status: 200, body: RECEITAWS },
      [HOSTS.mirror]: { status: 404 },
    })
    const profile = expectOk(
      await BrasilApiCnpjProvider.lookup('11.222.333/0001-81'),
    )
    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(fetchMock).toHaveBeenCalledWith(
      `https://brasilapi.com.br/api/cnpj/v1/${CNPJ}`,
      expect.objectContaining({ headers: { accept: 'application/json' } }),
    )
    expect(profile.cnpj).toBe(CNPJ)
    // CNPJá is the first source: its street (with type, proper case) wins.
    expect(profile.address).toMatchObject({
      street: 'Rua A',
      city: 'São Paulo',
    })
    expect(profile.tradeName).toBe('Acme Store')
    expect(cache.set).toHaveBeenCalledWith(CNPJ, profile)
  })

  it('fills the gaps of the source that answered with the others', async () => {
    sources({
      [HOSTS.cnpjws]: { status: 200, body: WS },
      [HOSTS.receitaws]: { status: 200, body: RECEITAWS },
      [HOSTS.brasilapi]: { status: 403 },
    })
    const profile = expectOk(await BrasilApiCnpjProvider.lookup(CNPJ))
    expect(profile.legalName).toBe('ACME LTDA')
    expect(profile.size).toBe('DEMAIS')
    expect(profile.cnaeCode).toBe('4711302')
    expect(profile.openedAt).toBe('2015-03-02')
    expect(profile.legalNature).toBe('Sociedade Limitada')
    expect(profile.address?.street).toBe('RUA A')
    expect(profile.partners).toEqual([
      {
        name: 'MARIA SOUZA',
        qualification: 'Sócio-Administrador',
        enteredAt: '2015-03-02',
      },
    ])
  })

  it('parses the ReceitaWS formats (date, nature, role, activity code)', async () => {
    sources({ [HOSTS.receitaws]: { status: 200, body: RECEITAWS } })
    const profile = expectOk(await BrasilApiCnpjProvider.lookup(CNPJ))
    expect(profile).toMatchObject({
      openedAt: '2015-03-02',
      legalNature: 'Sociedade Empresária Limitada',
      size: 'EPP',
      cnaeCode: '4711302',
      shareCapital: 1000,
    })
    expect(profile.partners[0]?.qualification).toBe('Sócio-Administrador')
    expect(profile.address?.zipCode).toBe('01001-000')
  })

  it('treats a ReceitaWS "ERROR" answer as a failed source', async () => {
    sources({
      [HOSTS.receitaws]: {
        status: 200,
        body: { status: 'ERROR', message: 'Too many requests' },
      },
    })
    expectErr(
      await BrasilApiCnpjProvider.lookup(CNPJ),
      'CRM_CNPJ_LOOKUP_FAILED',
    )
  })

  it('answers from the cache without calling any source', async () => {
    const fetchMock = sources({})
    const cached = toCnpjProfile(CNPJ, FULL)
    cache.get.mockResolvedValue(cached)
    expect(expectOk(await BrasilApiCnpjProvider.lookup(CNPJ))).toBe(cached)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('says not found when an authoritative source does and nobody has it', async () => {
    sources({
      [HOSTS.brasilapi]: { status: 404 },
      [HOSTS.cnpjws]: { status: 404 },
    })
    expectErr(await BrasilApiCnpjProvider.lookup(CNPJ), 'CRM_CNPJ_NOT_FOUND')
    expect(cache.set).not.toHaveBeenCalled()
  })

  it('does not trust the mirror 404 while the others are out of reach', async () => {
    sources({ [HOSTS.mirror]: { status: 404 } })
    expectErr(
      await BrasilApiCnpjProvider.lookup(CNPJ),
      'CRM_CNPJ_LOOKUP_FAILED',
    )
  })

  it('still returns a profile when one source says 404 and another has it', async () => {
    sources({
      [HOSTS.brasilapi]: { status: 404 },
      [HOSTS.cnpja]: { status: 200, body: CNPJA },
    })
    expect(expectOk(await BrasilApiCnpjProvider.lookup(CNPJ)).legalName).toBe(
      'ACME LTDA',
    )
  })

  it('maps network failures of every source to a lookup error', async () => {
    sources({
      [HOSTS.brasilapi]: new Error('offline'),
      [HOSTS.cnpjws]: new Error('offline'),
    })
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
