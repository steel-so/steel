import { z } from 'zod'
import {
  EnrichCompanySchema,
  ListCnpjRunsSchema,
  LookupCnpjSchema,
  StartCnpjRunSchema,
} from '@/src/schemas/crm-cnpj.schema'
import { dto } from '../../common'
import type { ErrorEntry, RouteConfig } from '../../registry'
import { CrmCompanyAddressDTO, CrmCompanyDTO } from '../../schemas/crm/people'
import {
  CRM_ERRORS,
  CRM_PRIVILEGED_ERRORS,
  crmAccess,
  describe,
  notFoundError,
} from './shared'

/**
 * CRM · Enriquecimento por CNPJ — perfil da Receita Federal (razão social,
 * CNAE, porte, sócios, endereço) de cada empresa, prévia de um CNPJ digitado
 * e o reenriquecimento da base inteira no worker.
 */

const TAG = 'CRM · Pessoas e empresas' as const
const BASE = '/workspaces/{id}/crm/companies'
const WORKSPACE = { id: 'Id do workspace.' }
const dateTime = () => z.iso.datetime()

const SOURCE =
  'Os dados vêm da base pública da Receita Federal (BrasilAPI); sócios são nome, qualificação e data de entrada — nenhum CPF é guardado.'

const Partner = z.object({
  name: z.string(),
  qualification: z.string().nullable(),
  enteredAt: z.iso.date().nullable(),
})

const SecondaryCnae = z.object({
  code: z.string().meta({ example: '4712100' }),
  description: z.string(),
})

const profileShape = {
  cnpj: z.string().meta({ example: '11222333000181' }),
  legalName: z.string().nullable(),
  tradeName: z.string().nullable(),
  cnaeCode: z.string().nullable().meta({ example: '4711302' }),
  cnaeDescription: z.string().nullable(),
  secondaryCnaes: z.array(SecondaryCnae),
  size: z.enum(['ME', 'EPP', 'DEMAIS']).nullable(),
  legalNature: z.string().nullable(),
  registrationStatus: z.string().nullable(),
  openedAt: z.iso.date().nullable(),
  shareCapital: z.number().nullable(),
  partners: z.array(Partner),
}

const Profile = dto(
  'CrmCnpjProfile',
  z.object({ ...profileShape, address: CrmCompanyAddressDTO.nullable() }),
)

const Enrichment = dto(
  'CrmCompanyEnrichment',
  z.object({
    id: z.string(),
    companyId: z.string(),
    ...profileShape,
    source: z.string().meta({ example: 'brasilapi' }),
    fetchedAt: dateTime(),
  }),
)

const EnrichResult = dto(
  'CrmCompanyEnrichResult',
  z.object({
    company: CrmCompanyDTO,
    enrichment: Enrichment,
    applied: z.array(z.enum(['name', 'address'])).meta({
      description: 'Campos da empresa que o enriquecimento preencheu.',
    }),
  }),
)

const Run = dto(
  'CrmCnpjEnrichmentRun',
  z.object({
    id: z.string(),
    workspaceId: z.string(),
    createdById: z.string(),
    status: z.enum(['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED']),
    onlyMissing: z.boolean(),
    overwrite: z.boolean(),
    total: z.number().int(),
    processed: z.number().int(),
    enriched: z.number().int(),
    notFound: z.number().int(),
    invalid: z.number().int(),
    failed: z.number().int(),
    error: z.string().nullable(),
    startedAt: dateTime().nullable(),
    finishedAt: dateTime().nullable(),
    createdAt: dateTime(),
  }),
)

const LOOKUP_ERRORS: ErrorEntry[] = [
  {
    code: 'CRM_CNPJ_INVALID',
    when: 'CNPJ com dígitos verificadores inválidos',
  },
  { code: 'CRM_CNPJ_NOT_FOUND', when: 'CNPJ inexistente na Receita' },
  {
    code: 'CRM_CNPJ_RATE_LIMITED',
    when: 'A fonte pública limitou as consultas',
  },
  { code: 'CRM_CNPJ_LOOKUP_FAILED', when: 'A fonte não respondeu' },
]

export const crmCnpjRoutes: RouteConfig[] = [
  {
    method: 'post',
    path: `${BASE}/cnpj-lookup`,
    tags: [TAG],
    summary: 'Consultar um CNPJ na Receita',
    description: describe(
      'Prévia dos dados de um CNPJ digitado (razão social, CNAE, porte, sócios e endereço), sem gravar nada — usada ao cadastrar uma empresa.',
      SOURCE,
      crmAccess('companies', 'VIEW'),
    ),
    params: WORKSPACE,
    body: LookupCnpjSchema,
    responses: { 200: { description: 'Perfil do CNPJ.', schema: Profile } },
    errors: [...CRM_ERRORS, ...LOOKUP_ERRORS],
  },
  {
    method: 'get',
    path: `${BASE}/{companyId}/enrichment`,
    tags: [TAG],
    summary: 'Dados da Receita de uma empresa',
    description: describe(
      'Perfil da Receita guardado para a empresa, ou `null` se ela ainda não foi enriquecida.',
      crmAccess('companies', 'VIEW'),
    ),
    params: { ...WORKSPACE, companyId: 'Id da empresa.' },
    responses: {
      200: { description: 'Perfil ou `null`.', schema: Enrichment.nullable() },
    },
    errors: [...CRM_ERRORS, notFoundError('CrmCompany')],
  },
  {
    method: 'post',
    path: `${BASE}/{companyId}/enrichment`,
    tags: [TAG],
    summary: 'Enriquecer uma empresa pelo CNPJ',
    description: describe(
      'Consulta o CNPJ da empresa, guarda o perfil da Receita e preenche o que estiver em branco: o nome (nome fantasia ou razão social; também substitui o provisório `Empresa 00.000.000/0000-00`) e o endereço. Com `overwrite`, substitui nome e endereço mesmo preenchidos. `applied` diz o que mudou.',
      SOURCE,
      crmAccess('companies', 'EDIT'),
    ),
    consent: true,
    params: { ...WORKSPACE, companyId: 'Id da empresa.' },
    body: EnrichCompanySchema,
    responses: {
      200: {
        description: 'Empresa e perfil atualizados.',
        schema: EnrichResult,
      },
    },
    errors: [...CRM_ERRORS, notFoundError('CrmCompany'), ...LOOKUP_ERRORS],
  },
  {
    method: 'get',
    path: `${BASE}/enrichment-runs`,
    tags: [TAG],
    summary: 'Histórico de reenriquecimentos da base',
    description: describe(
      'Execuções mais recentes primeiro, com o andamento (`processed` de `total`).',
      crmAccess('companies', 'VIEW'),
    ),
    params: WORKSPACE,
    query: ListCnpjRunsSchema,
    responses: { 200: { description: 'Execuções.', schema: z.array(Run) } },
    errors: CRM_ERRORS,
  },
  {
    method: 'post',
    path: `${BASE}/enrichment-runs`,
    tags: [TAG],
    summary: 'Reenriquecer a base pelo CNPJ',
    description: describe(
      'Enfileira (`202`) a consulta de todas as empresas com CNPJ: o worker faz cerca de uma por segundo. Com `onlyMissing` (padrão) pula as que já têm dados da Receita. Só uma execução por vez no workspace.',
      SOURCE,
      crmAccess('privileged'),
    ),
    consent: true,
    params: WORKSPACE,
    body: StartCnpjRunSchema,
    responses: { 202: { description: 'Execução na fila.', schema: Run } },
    errors: [
      ...CRM_PRIVILEGED_ERRORS,
      {
        code: 'CRM_CNPJ_RUN_ACTIVE',
        when: 'Já há um reenriquecimento em andamento',
      },
    ],
  },
  {
    method: 'get',
    path: `${BASE}/enrichment-runs/{runId}`,
    tags: [TAG],
    summary: 'Andamento de um reenriquecimento',
    description: describe(
      'Estado e contagens (a tela consulta enquanto `QUEUED`/`RUNNING`).',
      crmAccess('companies', 'VIEW'),
    ),
    params: { ...WORKSPACE, runId: 'Id da execução.' },
    responses: { 200: { description: 'Execução.', schema: Run } },
    errors: [
      ...CRM_ERRORS,
      {
        code: 'CRM_CNPJ_RUN_NOT_FOUND',
        when: 'Execução inexistente no workspace',
      },
    ],
  },
]
