import { V1PageQuerySchema } from '@/src/lib/api/v1-pagination'
import {
  ImportV1CrmLeadsQuerySchema,
  ListV1CrmLeadsSchema,
  ListV1CrmOpportunitiesSchema,
  MoveV1CrmOpportunityStageSchema,
  V1_LEAD_IMPORT_MAX_ROWS,
} from '@/src/schemas/api-v1.schema'
import { CreateCrmLeadSchema } from '@/src/schemas/crm-lead.schema'
import { notFoundError } from '../../paths/crm/shared'
import type { OpenApiRegistry } from '../../registry'
import { CrmOpportunityDTO } from '../../schemas/crm/opportunities'
import { CrmLeadDTO } from '../../schemas/public'
import {
  ApiV1CrmPipelineDTO,
  ApiV1LeadImportResultDTO,
  v1Page,
} from '../schemas'
import {
  moduleErrors,
  PAGINATION_NOTE,
  V1_READ,
  V1_WRITE,
  WRITE_ERRORS,
} from './shared'

/** v1 · CRM — `app/api/v1/crm/**`, over the CRM services. */

const TAG = 'v1 · CRM' as const
const ACCESS = moduleErrors('CRM')
const CURSOR_ERROR = {
  code: 'VALIDATION_ERROR',
  message: 'Cursor inválido',
} as const

const LEAD_IMPORT_CSV = `name,email,phone,company,source
Carlos Lima,carlos@empresa.com.br,11999990000,Empresa,Site
Bia Rocha,,11988887777,,Feira`

export function registerV1CrmPaths(registry: OpenApiRegistry): void {
  registry.registerRoute({
    method: 'get',
    path: '/crm/leads',
    tags: [TAG],
    summary: 'Listar leads',
    operationId: 'listLeads',
    description: `Leads do workspace, na ordem do funil. ${PAGINATION_NOTE} ${V1_READ}`,
    auth: 'apiToken',
    query: ListV1CrmLeadsSchema,
    responses: {
      200: {
        description: 'Página de leads.',
        schema: v1Page('CrmLead', CrmLeadDTO),
      },
    },
    errors: [...ACCESS, CURSOR_ERROR],
  })

  registry.registerRoute({
    method: 'post',
    path: '/crm/leads',
    tags: [TAG],
    summary: 'Criar lead',
    operationId: 'createLead',
    description: `Mesma entrada de leads do app: exige ao menos um e-mail ou telefone, calcula a pontuação, aplica o roteamento de dono e dispara os workflows de "lead criado". Um lead em aberto com o mesmo e-mail ou telefone responde \`409 CRM_LEAD_DUPLICATE\`. ${V1_WRITE}`,
    auth: 'apiToken',
    consent: true,
    body: CreateCrmLeadSchema,
    responses: { 201: { description: 'Lead criado.', schema: CrmLeadDTO } },
    errors: [...WRITE_ERRORS, ...ACCESS, 'CRM_LEAD_DUPLICATE'],
  })

  registry.registerRoute({
    method: 'post',
    path: '/crm/leads/import',
    tags: [TAG],
    summary: 'Importar leads (CSV)',
    operationId: 'importLeads',
    description: [
      `Importa até ${V1_LEAD_IMPORT_MAX_ROWS.toLocaleString('pt-BR')} leads de um CSV enviado como corpo (\`Content-Type: text/csv\`, até 5 MB). Separador \`,\` ou \`;\`, primeira linha com o cabeçalho.`,
      '',
      'Colunas (maiúsculas e acentos não importam): `name`/`nome` (obrigatória), `email`, `phone`/`telefone`/`celular`, `company`/`empresa`, `job_title`/`cargo`, `city`/`cidade`, `linkedin`, `source`/`origem`, `channel`/`canal`. Vários e-mails ou telefones na mesma célula vão separados por `;`.',
      '',
      'Cada linha passa pela mesma entrada do `POST /crm/leads`, em ordem. Linha igual a um lead em aberto conta em `skipped`; linha recusada vai para `errors` com o número da linha, e as outras seguem.',
      '',
      V1_WRITE,
    ].join('\n'),
    auth: 'apiToken',
    consent: true,
    query: ImportV1CrmLeadsQuerySchema,
    body: {
      contentType: 'text/csv',
      schema: { type: 'string' },
      example: LEAD_IMPORT_CSV,
    },
    responses: {
      200: {
        description: 'Resumo da importação.',
        schema: ApiV1LeadImportResultDTO,
        example: {
          total: 2,
          created: 1,
          skipped: 1,
          errors: [],
        },
      },
    },
    errors: [
      ...WRITE_ERRORS,
      ...ACCESS,
      {
        code: 'VALIDATION_ERROR',
        message:
          'O CSV precisa de uma linha de cabeçalho com a coluna name (ou nome)',
        when: 'CSV vazio, sem a coluna de nome, maior que 5 MB ou com mais linhas que o limite',
      },
    ],
  })

  registry.registerRoute({
    method: 'get',
    path: '/crm/opportunities',
    tags: [TAG],
    summary: 'Listar oportunidades',
    operationId: 'listOpportunities',
    description: `Oportunidades do workspace, filtráveis por funil e etapa. ${PAGINATION_NOTE} ${V1_READ}`,
    auth: 'apiToken',
    query: ListV1CrmOpportunitiesSchema,
    responses: {
      200: {
        description: 'Página de oportunidades.',
        schema: v1Page('CrmOpportunity', CrmOpportunityDTO),
      },
    },
    errors: [...ACCESS, CURSOR_ERROR],
  })

  registry.registerRoute({
    method: 'post',
    path: '/crm/opportunities/{opportunityId}/stage',
    tags: [TAG],
    summary: 'Mudar etapa da oportunidade',
    operationId: 'moveOpportunityStage',
    description: `Move a oportunidade para outra etapa (e, com \`pipelineId\`, para outro funil). Etapa ganha marca a data de ganho, como no app, e dispara os workflows de "oportunidade atualizada". ${V1_WRITE}`,
    auth: 'apiToken',
    consent: true,
    params: { opportunityId: 'Id da oportunidade.' },
    body: MoveV1CrmOpportunityStageSchema,
    responses: {
      200: {
        description: 'Oportunidade na nova etapa.',
        schema: CrmOpportunityDTO,
      },
    },
    errors: [
      ...WRITE_ERRORS,
      ...ACCESS,
      notFoundError(
        'CrmOpportunity',
        'Oportunidade inexistente, excluída ou de outro workspace',
      ),
      notFoundError('CrmPipeline', 'Funil inexistente ou de outro workspace'),
      notFoundError('CrmPipelineStage', 'Etapa inexistente ou de outro funil'),
    ],
  })

  registry.registerRoute({
    method: 'get',
    path: '/crm/pipelines',
    tags: [TAG],
    summary: 'Listar funis',
    operationId: 'listPipelines',
    description: `Funis do workspace com as etapas de cada um, na ordem. ${PAGINATION_NOTE} ${V1_READ}`,
    auth: 'apiToken',
    query: V1PageQuerySchema,
    responses: {
      200: {
        description: 'Página de funis.',
        schema: v1Page('CrmPipeline', ApiV1CrmPipelineDTO),
      },
    },
    errors: [...ACCESS, CURSOR_ERROR],
  })
}
