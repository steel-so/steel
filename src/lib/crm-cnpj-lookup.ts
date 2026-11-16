import { ApiError, apiFetchJson } from '@/src/hooks/_fetch'
import type { CrmCnpjProfileDTO } from '@/types/crm-cnpj'
import {
  type CnpjLookup,
  CnpjNotFoundError,
  formatCnpj,
  normalizeCnpj,
} from './crm-cnpj'

/**
 * Resolve um CNPJ nos dados da empresa pelo servidor do Steel
 * (`POST .../crm/companies/cnpj-lookup`, que já tem espelho de fallback).
 * O navegador nunca fala com a BrasilAPI: a CSP só libera `'self'`.
 * Lança `CnpjNotFoundError` quando o CNPJ não existe na base e o erro da
 * API nas demais falhas.
 */
export async function lookupCnpj(
  workspaceId: string,
  rawCnpj: string,
): Promise<CnpjLookup> {
  const cnpj = normalizeCnpj(rawCnpj)
  if (cnpj.length !== 14) throw new CnpjNotFoundError()

  let profile: CrmCnpjProfileDTO
  try {
    profile = await apiFetchJson<CrmCnpjProfileDTO>(
      `/api/workspaces/${workspaceId}/crm/companies/cnpj-lookup`,
      'POST',
      { cnpj },
      'Falha ao consultar o CNPJ',
    )
  } catch (error) {
    if (error instanceof ApiError && error.code === 'CRM_CNPJ_NOT_FOUND') {
      throw new CnpjNotFoundError()
    }
    throw error
  }

  const razaoSocial = profile.legalName ?? undefined
  const nomeFantasia = profile.tradeName ?? undefined
  const registry: Record<string, unknown> = {}
  const scalars = {
    legalName: profile.legalName,
    tradeName: profile.tradeName,
    cnaeCode: profile.cnaeCode,
    cnaeDescription: profile.cnaeDescription,
    size: profile.size,
    legalNature: profile.legalNature,
    registrationStatus: profile.registrationStatus,
    openedAt: profile.openedAt,
    shareCapital: profile.shareCapital,
  }
  for (const [key, value] of Object.entries(scalars)) {
    if (value !== null && value !== undefined) registry[key] = value
  }
  if (profile.emails?.length) registry.emails = profile.emails
  if (profile.phones?.length) registry.phones = profile.phones

  return {
    cnpj: formatCnpj(cnpj),
    registry,
    razaoSocial,
    nomeFantasia,
    name: nomeFantasia ?? razaoSocial,
    address: profile.address,
  }
}
