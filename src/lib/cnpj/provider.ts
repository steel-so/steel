import { logger } from '@/lib/axiom/logger'
import {
  crmCnpjInvalid,
  crmCnpjLookupFailed,
  crmCnpjNotFound,
} from '@/src/errors'
import { formatCep } from '@/src/lib/crm-cep'
import { isValidCnpj, normalizeCnpj } from '@/src/lib/crm-cnpj'
import { err, ok, type Result } from '@/src/lib/result'
import type { CrmCompanyAddress } from '@/types/crm-company'

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
}

const BRASILAPI_URL = 'https://brasilapi.com.br/api/cnpj/v1'
const MINHA_RECEITA_URL = 'https://minhareceita.org'
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
  }
}

type Endpoint = { name: string; url: (cnpj: string) => string }

/** Both mirrors serve the same payload shape. */
const ENDPOINTS: Endpoint[] = [
  { name: 'brasilapi', url: (c) => `${BRASILAPI_URL}/${c}` },
  { name: 'minhareceita', url: (c) => `${MINHA_RECEITA_URL}/${c}` },
]

/** Definitive answers are never retried on the fallback mirror. */
async function fetchFrom(
  endpoint: Endpoint,
  cnpj: string,
  signal?: AbortSignal,
): Promise<Result<CnpjProfile> | null> {
  try {
    const res = await fetch(endpoint.url(cnpj), {
      signal: signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    })
    if (res.status === 404) return err(crmCnpjNotFound())
    if (!res.ok) {
      logger.warn('crm.cnpj.provider_failed', {
        provider: endpoint.name,
        status: res.status,
      })
      return null
    }
    return ok(toCnpjProfile(cnpj, (await res.json()) as BrasilApiCnpj))
  } catch (error) {
    logger.warn('crm.cnpj.provider_failed', {
      provider: endpoint.name,
      cause: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/** BrasilAPI-backed provider with a Minha Receita fallback (no key). */
export const BrasilApiCnpjProvider: CnpjProvider = {
  source: 'brasilapi',

  async lookup(rawCnpj, signal) {
    const cnpj = normalizeCnpj(rawCnpj)
    if (!isValidCnpj(cnpj)) return err(crmCnpjInvalid())

    let primaryAnswered = true
    for (const [index, endpoint] of ENDPOINTS.entries()) {
      const result = await fetchFrom(endpoint, cnpj, signal)
      if (!result) {
        if (index === 0) primaryAnswered = false
        continue
      }
      // A mirror's "not found" is only definitive when the primary source
      // answered too: with BrasilAPI down, the mirror may simply lag behind
      // a recent CNPJ, and "try again later" is the honest answer.
      if (
        !result.ok &&
        !primaryAnswered &&
        result.error.code === 'CRM_CNPJ_NOT_FOUND'
      ) {
        logger.warn('crm.cnpj.mirror_not_found_primary_down', {
          provider: endpoint.name,
        })
        continue
      }
      return result
    }
    return err(crmCnpjLookupFailed())
  },
}

/** Provider used by the service and the worker (single swap point). */
export function getCnpjProvider(): CnpjProvider {
  return BrasilApiCnpjProvider
}
