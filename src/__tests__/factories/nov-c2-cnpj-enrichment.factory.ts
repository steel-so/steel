import { createId } from '@paralleldrive/cuid2'
import type { CrmCnpjEnrichmentRun, CrmCompanyEnrichment } from '@prisma/client'
import type { CnpjProfile } from '@/src/lib/cnpj/provider'
import { prisma } from '@/src/lib/prisma'

/** A valid CNPJ (passes the check digits). */
export const VALID_CNPJ = '11222333000181'

export function createFakeCnpjProfile(
  overrides?: Partial<CnpjProfile>,
): CnpjProfile {
  return {
    cnpj: VALID_CNPJ,
    legalName: 'ACME COMERCIO DE ALIMENTOS LTDA',
    tradeName: 'Acme Mercado',
    cnaeCode: '4711302',
    cnaeDescription: 'Comércio varejista de mercadorias em geral',
    secondaryCnaes: [{ code: '4712100', description: 'Minimercados' }],
    size: 'EPP',
    legalNature: 'Sociedade Empresária Limitada',
    registrationStatus: 'ATIVA',
    openedAt: '2015-03-02',
    shareCapital: 50000,
    partners: [
      {
        name: 'MARIA DA SILVA',
        qualification: 'Sócio-Administrador',
        enteredAt: '2015-03-02',
      },
    ],
    address: {
      street: 'RUA DAS FLORES',
      number: '100',
      neighborhood: 'CENTRO',
      city: 'SAO PAULO',
      state: 'SP',
      zipCode: '01001-000',
    },
    ...overrides,
  }
}

export function createFakeCompanyEnrichment(
  overrides?: Partial<CrmCompanyEnrichment>,
): CrmCompanyEnrichment {
  const now = new Date()
  return {
    id: createId(),
    companyId: createId(),
    workspaceId: createId(),
    cnpj: VALID_CNPJ,
    legalName: 'ACME COMERCIO DE ALIMENTOS LTDA',
    tradeName: 'Acme Mercado',
    cnaeCode: '4711302',
    cnaeDescription: 'Comércio varejista de mercadorias em geral',
    secondaryCnaes: [{ code: '4712100', description: 'Minimercados' }],
    size: 'EPP',
    legalNature: 'Sociedade Empresária Limitada',
    registrationStatus: 'ATIVA',
    openedAt: new Date('2015-03-02T00:00:00Z'),
    shareCapital: null,
    partners: [
      {
        name: 'MARIA DA SILVA',
        qualification: 'Sócio-Administrador',
        enteredAt: '2015-03-02',
      },
    ],
    source: 'brasilapi',
    fetchedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as CrmCompanyEnrichment
}

export function createFakeCnpjRun(
  overrides?: Partial<CrmCnpjEnrichmentRun>,
): CrmCnpjEnrichmentRun {
  const now = new Date()
  return {
    id: createId(),
    workspaceId: createId(),
    createdById: createId(),
    status: 'QUEUED',
    onlyMissing: true,
    overwrite: false,
    total: 0,
    processed: 0,
    enriched: 0,
    notFound: 0,
    invalid: 0,
    failed: 0,
    error: null,
    startedAt: null,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

/** Inserts a run row (integration tests). */
export async function seedCnpjRun(
  workspaceId: string,
  createdById: string,
  overrides?: Partial<CrmCnpjEnrichmentRun>,
): Promise<CrmCnpjEnrichmentRun> {
  const {
    id: _id,
    createdAt: _c,
    updatedAt: _u,
    ...rest
  } = createFakeCnpjRun({ workspaceId, createdById, ...overrides })
  return prisma.crmCnpjEnrichmentRun.create({ data: rest })
}
