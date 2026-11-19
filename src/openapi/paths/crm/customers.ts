import {
  CrmCustomerFiltersSchema,
  ListCrmCustomersSchema,
} from '@/src/schemas/crm-customer.schema'
import type { RouteConfig } from '../../registry'
import {
  CrmCustomerOptionsDTO,
  CrmCustomersPageDTO,
} from '../../schemas/crm/customers'
import { CRM_ERRORS, crmAccess, describe } from './shared'

/**
 * CRM · Clientes: visão calculada das empresas e pessoas com ao menos uma
 * oportunidade ganha. Não há entidade "cliente": tudo vem dos negócios.
 */

const TAGS: RouteConfig['tags'] = ['CRM · Clientes']
const BASE = '/workspaces/{id}/crm/customers'

const ACCESS = crmAccess('companies', 'VIEW')
const ACCESS_NOTE =
  'Para empresas exige `companies` × `VIEW`; para pessoas, `people` × `VIEW`; em "todos", as duas.'

export const crmCustomerRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: BASE,
    tags: TAGS,
    summary: 'Listar clientes',
    description: describe(
      `Empresas e pessoas com negócio ganho: número de negócios, total ganho, ticket médio, primeiro e último ganho, próxima renovação (contrato ativo), responsável e saúde (empresas). Filtros por período do ganho, valor, produto, funil, responsável, renovação e dias sem compra; ordenação e paginação no servidor. \`totals\` (clientes, receita, negócios, ticket médio) vale para todos os filtrados. ${ACCESS_NOTE}`,
      ACCESS,
    ),
    query: ListCrmCustomersSchema,
    responses: {
      200: { description: 'Página de clientes.', schema: CrmCustomersPageDTO },
    },
    errors: [...CRM_ERRORS, 'VALIDATION_ERROR'],
  },
  {
    method: 'get',
    path: `${BASE}/export`,
    tags: TAGS,
    summary: 'Exportar clientes (CSV)',
    description: describe(
      `CSV em UTF-8 com BOM dos clientes filtrados (até 50 mil linhas). Mesmos filtros da listagem, sem paginação. Auditado (dado pessoal). ${ACCESS_NOTE}`,
      ACCESS,
    ),
    query: CrmCustomerFiltersSchema,
    responses: {
      200: {
        description: 'Arquivo CSV (`Content-Disposition: attachment`).',
        envelope: false,
        contentType: 'text/csv',
        schema: { type: 'string' },
      },
    },
    errors: [...CRM_ERRORS, 'VALIDATION_ERROR'],
  },
  {
    method: 'get',
    path: `${BASE}/options`,
    tags: TAGS,
    summary: 'Opções dos filtros',
    description: describe('Funis e produtos dos filtros.', ACCESS),
    responses: {
      200: { description: 'Opções.', schema: CrmCustomerOptionsDTO },
    },
    errors: CRM_ERRORS,
  },
]
