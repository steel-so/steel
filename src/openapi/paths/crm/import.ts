import { CrmImportSchema } from '@/src/schemas/crm-import.schema'
import type { RouteConfig } from '../../registry'
import { CrmImportResultDTO } from '../../schemas/crm/import'
import { CRM_ERRORS, crmAccess, describe } from './shared'

/** CRM · Importação CSV de leads, pessoas e empresas. */
export const crmImportRoutes: RouteConfig[] = [
  {
    method: 'post',
    path: '/workspaces/{id}/crm/import',
    tags: ['CRM · Leads'],
    summary: 'Importar leads, pessoas ou empresas (CSV)',
    description: describe(
      'O navegador lê o CSV e envia as linhas já mapeadas por coluna. Cada linha passa pelo mesmo fluxo da criação manual (validação, duplicidade, pontuação e roteamento no caso de leads, workflows, auditoria); uma linha inválida ou repetida volta em `rejected` com o motivo e não impede as demais. Exige `consentConfirmed: true`. Até 1.000 linhas por chamada. A permissão exigida é `leads`, `people` ou `companies` × `CREATE`, conforme `entity`.',
      crmAccess(null),
    ),
    consent: true,
    body: {
      schema: CrmImportSchema,
      example: {
        entity: 'people',
        rows: [
          {
            name: 'Ana Souza',
            email: 'ana@acme.com.br',
            phone: '(11) 91234-5678',
            company: 'Acme Ltda',
          },
        ],
        consentConfirmed: true,
      },
    },
    responses: {
      200: {
        description: 'Resumo da importação.',
        schema: CrmImportResultDTO,
      },
    },
    errors: CRM_ERRORS,
  },
]
