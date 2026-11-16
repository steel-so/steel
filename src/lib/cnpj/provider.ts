import { logger } from '@/lib/axiom/logger'
import { CrmCnpjCache } from '@/src/cache/crm-cnpj.cache'
import {
  crmCnpjInvalid,
  crmCnpjLookupFailed,
  crmCnpjNotFound,
} from '@/src/errors'
import { formatCep } from '@/src/lib/crm-cep'
import { isValidCnpj, normalizeCnpj } from '@/src/lib/crm-cnpj'
import { err, ok, type Result } from '@/src/lib/result'
import type { CrmCompanyAddress } from '@/types/crm-company'
import { uniqueEmails, uniquePhones } from './contacts'
import { mergeCnpjProfiles } from './merge'

/** Company size as the Receita classifies it (`porte`). */
export type CnpjSize = 'ME' | 'EPP' | 'DEMAIS'

export type CnpjPartner = {
  name: string
  qualification: string | null
  /** ISO date (`YYYY-MM-DD`) the partner joined the company. */
  enteredAt: string | null
}

export type CnpjSecondaryCnae = { code: string; description: string }

/** Registry profile of one CNPJ, independent of the provider that served it. */
export type CnpjProfile = {
  /** 14 digits, no punctuation. */
  cnpj: string
  legalName: string | null
  tradeName: string | null
  cnaeCode: string | null
  cnaeDescription: string | null
  secondaryCnaes: CnpjSecondaryCnae[]
  size: CnpjSize | null
  legalNature: string | null
  registrationStatus: string | null
  /** ISO date (`YYYY-MM-DD`). */
  openedAt: string | null
  shareCapital: number | null
  partners: CnpjPartner[]
  address: CrmCompanyAddress | null
  /** Deduplicated, lowercase. Absent in profiles cached before this field. */
  emails: string[]
  /** Formatted `(11) 2395-8400`. */
  phones: string[]
}

/**
 * Where CNPJ data comes from. The default is BrasilAPI (public mirror of the
 * Receita base); a paid provider can replace it by implementing this
 * interface, with no change to the service or the worker.
 */
export interface CnpjProvider {
  readonly source: string
  lookup(cnpj: string, signal?: AbortSignal): Promise<Result<CnpjProfile>>
}

type BrasilApiCnae = { codigo?: number | string; descricao?: string }

type BrasilApiPartner = {
  nome_socio?: string
  qualificacao_socio?: string
  data_entrada_sociedade?: string
}

/** Subset of the BrasilAPI `/cnpj/v1/{cnpj}` response we read. */
type BrasilApiCnpj = {
  razao_social?: string
  nome_fantasia?: string
  cnae_fiscal?: number | string
  cnae_fiscal_descricao?: string
  cnaes_secundarios?: BrasilApiCnae[]
  porte?: string
  codigo_porte?: number
  natureza_juridica?: string
  descricao_situacao_cadastral?: string
  data_inicio_atividade?: string
  capital_social?: number
  qsa?: BrasilApiPartner[]
  cep?: string
  logradouro?: string
  numero?: string
  complemento?: string
  bairro?: string
  municipio?: string
  uf?: string
  email?: string | null
  /** Digits with the area code: `1123958400`. */
  ddd_telefone_1?: string | null
  ddd_telefone_2?: string | null
  /** Extra contacts from sources that list more than one (already raw). */
  extra_emails?: string[]
  extra_phones?: string[]
}

const BRASILAPI_URL = 'https://brasilapi.com.br/api/cnpj/v1'
const MINHA_RECEITA_URL = 'https://minhareceita.org'
const CNPJ_WS_URL = 'https://publica.cnpj.ws/cnpj'
const CNPJA_URL = 'https://open.cnpja.com/office'
const RECEITAWS_URL = 'https://receitaws.com.br/v1/cnpj'
const REQUEST_TIMEOUT_MS = 10_000

function text(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const t = String(value).trim()
  return t === '' ? null : t
}

/** Zero-padded 7-digit CNAE code (`4711302`), the format IBGE publishes. */
function cnaeCode(value: string | number | undefined): string | null {
  const t = text(value)
  if (!t || t === '0') return null
  return t.replace(/\D/g, '').padStart(7, '0')
}

function toSize(data: BrasilApiCnpj): CnpjSize | null {
  const label = (data.porte ?? '').toUpperCase()
  if (label.includes('MICRO')) return 'ME'
  if (label.includes('PEQUENO')) return 'EPP'
  if (label.includes('DEMAIS')) return 'DEMAIS'
  return null
}

function isoDate(value: string | undefined): string | null {
  const t = text(value)
  return t && /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : null
}

function toAddress(data: BrasilApiCnpj): CrmCompanyAddress | null {
  const address: CrmCompanyAddress = {
    zipCode: data.cep ? formatCep(data.cep) : undefined,
    street: text(data.logradouro) ?? undefined,
    number: text(data.numero) ?? undefined,
    complement: text(data.complemento) ?? undefined,
    neighborhood: text(data.bairro) ?? undefined,
    city: text(data.municipio) ?? undefined,
    state: text(data.uf)?.toUpperCase(),
  }
  const clean = Object.fromEntries(
    Object.entries(address).filter(([, v]) => v !== undefined),
  ) as CrmCompanyAddress
  return Object.keys(clean).length > 0 ? clean : null
}

export function toCnpjProfile(cnpj: string, data: BrasilApiCnpj): CnpjProfile {
  return {
    cnpj,
    legalName: text(data.razao_social),
    tradeName: text(data.nome_fantasia),
    cnaeCode: cnaeCode(data.cnae_fiscal),
    cnaeDescription: text(data.cnae_fiscal_descricao),
    secondaryCnaes: (data.cnaes_secundarios ?? []).flatMap((c) => {
      const code = cnaeCode(c.codigo)
      return code ? [{ code, description: text(c.descricao) ?? '' }] : []
    }),
    size: toSize(data),
    legalNature: text(data.natureza_juridica),
    registrationStatus: text(data.descricao_situacao_cadastral),
    openedAt: isoDate(data.data_inicio_atividade),
    shareCapital:
      typeof data.capital_social === 'number' ? data.capital_social : null,
    partners: (data.qsa ?? []).flatMap((p) => {
      const name = text(p.nome_socio)
      return name
        ? [
            {
              name,
              qualification: text(p.qualificacao_socio),
              enteredAt: isoDate(p.data_entrada_sociedade),
            },
          ]
        : []
    }),
    address: toAddress(data),
    emails: uniqueEmails([data.email, ...(data.extra_emails ?? [])]),
    phones: uniquePhones([
      data.ddd_telefone_1,
      data.ddd_telefone_2,
      ...(data.extra_phones ?? []),
    ]),
  }
}

// ─── publica.cnpj.ws ─────────────────────────────────────────────────────

type CnpjWsActivity = { id?: string; descricao?: string }

/** Subset of the publica.cnpj.ws `/cnpj/{cnpj}` response we read. */
type CnpjWsResponse = {
  razao_social?: string
  capital_social?: string
  porte?: { descricao?: string }
  natureza_juridica?: { descricao?: string }
  socios?: Array<{
    nome?: string
    data_entrada?: string
    qualificacao_socio?: { descricao?: string }
  }>
  estabelecimento?: {
    nome_fantasia?: string
    email?: string | null
    ddd1?: string | null
    telefone1?: string | null
    ddd2?: string | null
    telefone2?: string | null
    situacao_cadastral?: string
    data_inicio_atividade?: string
    tipo_logradouro?: string
    logradouro?: string
    numero?: string
    complemento?: string
    bairro?: string
    cep?: string
    estado?: { sigla?: string }
    cidade?: { nome?: string }
    atividade_principal?: CnpjWsActivity
    atividades_secundarias?: CnpjWsActivity[]
  }
}

function wsPhone(
  ddd: string | null | undefined,
  number: string | null | undefined,
): string | undefined {
  const n = text(number)
  return n ? `${text(ddd) ?? ''}${n}` : undefined
}

/** The shape BrasilAPI uses, so one mapper (`toCnpjProfile`) serves all. */
function cnpjWsToBrasilApi(data: CnpjWsResponse): BrasilApiCnpj {
  const e = data.estabelecimento ?? {}
  const street = [e.tipo_logradouro, e.logradouro]
    .map((p) => text(p))
    .filter(Boolean)
    .join(' ')
  const capital = Number(data.capital_social)
  return {
    razao_social: data.razao_social,
    nome_fantasia: e.nome_fantasia,
    cnae_fiscal: e.atividade_principal?.id,
    cnae_fiscal_descricao: e.atividade_principal?.descricao,
    cnaes_secundarios: (e.atividades_secundarias ?? []).map((a) => ({
      codigo: a.id,
      descricao: a.descricao,
    })),
    porte: data.porte?.descricao,
    natureza_juridica: data.natureza_juridica?.descricao,
    descricao_situacao_cadastral: e.situacao_cadastral,
    data_inicio_atividade: e.data_inicio_atividade,
    capital_social: Number.isFinite(capital) ? capital : undefined,
    qsa: (data.socios ?? []).map((p) => ({
      nome_socio: p.nome,
      qualificacao_socio: p.qualificacao_socio?.descricao?.trim(),
      data_entrada_sociedade: p.data_entrada,
    })),
    cep: e.cep,
    logradouro: street || undefined,
    numero: e.numero,
    complemento: e.complemento,
    bairro: e.bairro,
    municipio: e.cidade?.nome,
    uf: e.estado?.sigla,
    email: e.email,
    ddd_telefone_1: wsPhone(e.ddd1, e.telefone1),
    ddd_telefone_2: wsPhone(e.ddd2, e.telefone2),
  }
}

// ─── open.cnpja.com ──────────────────────────────────────────────────────

type CnpjaActivity = { id?: number | string; text?: string }

/** Subset of the CNPJá open `/office/{cnpj}` response we read. */
type CnpjaResponse = {
  alias?: string
  founded?: string
  status?: { text?: string }
  company?: {
    name?: string
    equity?: number
    nature?: { text?: string }
    size?: { text?: string }
    members?: Array<{
      since?: string
      person?: { name?: string }
      role?: { text?: string }
    }>
  }
  address?: {
    street?: string
    number?: string
    details?: string | null
    district?: string
    city?: string
    state?: string
    zip?: string
  }
  emails?: Array<{ address?: string }>
  phones?: Array<{ area?: string; number?: string }>
  mainActivity?: CnpjaActivity
  sideActivities?: CnpjaActivity[]
}

function cnpjaToBrasilApi(data: CnpjaResponse): BrasilApiCnpj {
  const a = data.address ?? {}
  return {
    razao_social: data.company?.name,
    nome_fantasia: data.alias,
    cnae_fiscal: data.mainActivity?.id,
    cnae_fiscal_descricao: data.mainActivity?.text,
    cnaes_secundarios: (data.sideActivities ?? []).map((s) => ({
      codigo: s.id,
      descricao: s.text,
    })),
    porte: data.company?.size?.text,
    natureza_juridica: data.company?.nature?.text,
    descricao_situacao_cadastral: data.status?.text,
    data_inicio_atividade: data.founded,
    capital_social: data.company?.equity,
    qsa: (data.company?.members ?? []).map((m) => ({
      nome_socio: m.person?.name,
      qualificacao_socio: m.role?.text,
      data_entrada_sociedade: m.since,
    })),
    cep: a.zip,
    logradouro: a.street,
    numero: a.number,
    complemento: a.details ?? undefined,
    bairro: a.district,
    municipio: a.city,
    uf: a.state,
    extra_emails: (data.emails ?? []).map((e) => e.address ?? ''),
    extra_phones: (data.phones ?? []).map(
      (p) => `${p.area ?? ''}${p.number ?? ''}`,
    ),
  }
}

// ─── receitaws.com.br ────────────────────────────────────────────────────

type ReceitaWsActivity = { code?: string; text?: string }

/** Subset of the ReceitaWS `/v1/cnpj/{cnpj}` response we read. */
type ReceitaWsResponse = {
  status?: string
  message?: string
  nome?: string
  fantasia?: string
  porte?: string
  natureza_juridica?: string
  situacao?: string
  abertura?: string
  capital_social?: string
  atividade_principal?: ReceitaWsActivity[]
  atividades_secundarias?: ReceitaWsActivity[]
  qsa?: Array<{ nome?: string; qual?: string }>
  logradouro?: string
  numero?: string
  complemento?: string
  bairro?: string
  municipio?: string
  uf?: string
  cep?: string
  email?: string
  telefone?: string
}

/** `06/05/1970` → `1970-05-06`. */
function brDate(value: string | undefined): string | undefined {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value?.trim() ?? '')
  return match ? `${match[3]}-${match[2]}-${match[1]}` : undefined
}

function receitaWsToBrasilApi(data: ReceitaWsResponse): BrasilApiCnpj {
  // It answers 200 with `status: "ERROR"` for anything it refuses.
  if (data.status === 'ERROR') {
    throw new Error(data.message ?? 'ReceitaWS error')
  }
  const main = data.atividade_principal?.[0]
  const capital = Number(data.capital_social)
  return {
    razao_social: data.nome,
    nome_fantasia: data.fantasia,
    cnae_fiscal: main?.code,
    cnae_fiscal_descricao: main?.text,
    cnaes_secundarios: (data.atividades_secundarias ?? []).map((a) => ({
      codigo: a.code,
      descricao: a.text,
    })),
    porte: data.porte,
    // "399-9 - Associação Privada" → "Associação Privada"
    natureza_juridica: data.natureza_juridica?.replace(/^[\d-]+\s*-\s*/, ''),
    descricao_situacao_cadastral: data.situacao,
    data_inicio_atividade: brDate(data.abertura),
    capital_social: Number.isFinite(capital) ? capital : undefined,
    qsa: (data.qsa ?? []).map((p) => ({
      nome_socio: p.nome,
      // "10-Diretor" → "Diretor"
      qualificacao_socio: p.qual?.replace(/^\d+\s*-\s*/, ''),
    })),
    cep: data.cep,
    logradouro: data.logradouro,
    numero: data.numero,
    complemento: data.complemento,
    bairro: data.bairro,
    municipio: data.municipio,
    uf: data.uf,
    email: data.email,
    extra_phones: [data.telefone ?? ''],
  }
}

// ─── sources ─────────────────────────────────────────────────────────────

type Endpoint = {
  name: string
  url: (cnpj: string) => string
  /** Payload → the BrasilAPI shape `toCnpjProfile` reads. */
  normalize: (payload: unknown) => BrasilApiCnpj
  /**
   * A 404 from an authoritative source means the CNPJ does not exist. Minha
   * Receita is a mirror that lags behind new registrations, so its 404 only
   * means "not here".
   */
  authoritative: boolean
}

/**
 * Every source is asked and the answers are merged (`mergeCnpjProfiles`),
 * so this order is the priority of a field when sources disagree: CNPJá and
 * cnpj.ws print the street with its type and proper case, BrasilAPI has the
 * fullest partner list, ReceitaWS and the mirror fill what is left. All
 * public, no key; each one is optional (BrasilAPI answers 403/429 to some
 * server IPs).
 */
const ENDPOINTS: Endpoint[] = [
  {
    name: 'cnpja',
    url: (c) => `${CNPJA_URL}/${c}`,
    normalize: (p) => cnpjaToBrasilApi(p as CnpjaResponse),
    authoritative: true,
  },
  {
    name: 'cnpjws',
    url: (c) => `${CNPJ_WS_URL}/${c}`,
    normalize: (p) => cnpjWsToBrasilApi(p as CnpjWsResponse),
    authoritative: true,
  },
  {
    name: 'brasilapi',
    url: (c) => `${BRASILAPI_URL}/${c}`,
    normalize: (p) => p as BrasilApiCnpj,
    authoritative: true,
  },
  {
    name: 'receitaws',
    url: (c) => `${RECEITAWS_URL}/${c}`,
    normalize: (p) => receitaWsToBrasilApi(p as ReceitaWsResponse),
    authoritative: true,
  },
  {
    name: 'minhareceita',
    url: (c) => `${MINHA_RECEITA_URL}/${c}`,
    normalize: (p) => p as BrasilApiCnpj,
    authoritative: false,
  },
]

type Outcome =
  | { kind: 'profile'; profile: CnpjProfile }
  | { kind: 'not_found' }
  | { kind: 'failed' }

async function fetchFrom(
  endpoint: Endpoint,
  cnpj: string,
  signal?: AbortSignal,
): Promise<Outcome> {
  try {
    const res = await fetch(endpoint.url(cnpj), {
      signal: signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    })
    if (res.status === 404) {
      if (endpoint.authoritative) return { kind: 'not_found' }
      logger.warn('crm.cnpj.mirror_not_found', { provider: endpoint.name })
      return { kind: 'failed' }
    }
    if (!res.ok) {
      logger.warn('crm.cnpj.provider_failed', {
        provider: endpoint.name,
        status: res.status,
      })
      return { kind: 'failed' }
    }
    const data = endpoint.normalize(await res.json())
    return { kind: 'profile', profile: toCnpjProfile(cnpj, data) }
  } catch (error) {
    logger.warn('crm.cnpj.provider_failed', {
      provider: endpoint.name,
      cause: error instanceof Error ? error.message : String(error),
    })
    return { kind: 'failed' }
  }
}

/**
 * All public sources in parallel, merged, with a 24 h cache. It fails only
 * when no source has the CNPJ: "not found" when an authoritative one says so,
 * "try again" when they were all out of reach.
 */
export const BrasilApiCnpjProvider: CnpjProvider = {
  source: 'brasilapi',

  async lookup(rawCnpj, signal) {
    const cnpj = normalizeCnpj(rawCnpj)
    if (!isValidCnpj(cnpj)) return err(crmCnpjInvalid())

    const cached = await CrmCnpjCache.get(cnpj)
    // Entries cached before `emails`/`phones` existed must not crash callers.
    if (cached) {
      return ok({
        ...cached,
        emails: cached.emails ?? [],
        phones: cached.phones ?? [],
      })
    }

    const outcomes = await Promise.all(
      ENDPOINTS.map((endpoint) => fetchFrom(endpoint, cnpj, signal)),
    )
    const profiles = outcomes.flatMap((o) =>
      o.kind === 'profile' ? [o.profile] : [],
    )
    if (profiles.length > 0) {
      const merged = mergeCnpjProfiles(profiles)
      await CrmCnpjCache.set(cnpj, merged)
      return ok(merged)
    }
    if (outcomes.some((o) => o.kind === 'not_found')) {
      return err(crmCnpjNotFound())
    }
    return err(crmCnpjLookupFailed())
  },
}

/** Provider used by the service and the worker (single swap point). */
export function getCnpjProvider(): CnpjProvider {
  return BrasilApiCnpjProvider
}
