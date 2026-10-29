import { z } from 'zod'
import { dto } from '../../common'
import { CrmBillingTypeEnum } from './products'

/**
 * DTOs de oportunidades, itens de linha, pipelines e etapas
 * (`types/crm-opportunity.d.ts`, `types/crm-pipeline.d.ts`).
 */

const dateTime = () => z.iso.datetime()

export const CrmOpportunityDTO = dto(
  'CrmOpportunity',
  z.object({
    id: z.string().meta({ example: 'ckw1opp00000ab7d3k1e5xyz' }),
    name: z.string().meta({ example: 'Implantação ServiceDesk — ACME' }),
    amount: z.number().nullable().meta({ example: 48000 }),
    probability: z
      .number()
      .int()
      .nullable()
      .meta({ description: 'Probabilidade de ganho (0–100).', example: 60 }),
    closeDate: dateTime().nullable().meta({
      description: 'Previsão de fechamento (define o período no forecast).',
    }),
    pipelineId: z.string(),
    stageId: z.string(),
    companyId: z.string().nullable(),
    pointOfContactId: z
      .string()
      .nullable()
      .meta({ description: 'Pessoa de contato (id de `CrmPerson`).' }),
    ownerId: z.string().nullable().meta({ description: 'Responsável.' }),
    source: z.string().nullable(),
    workspaceId: z.string(),
    createdById: z.string(),
    updatedById: z.string().nullable(),
    position: z.number(),
    createdAt: dateTime(),
    updatedAt: dateTime(),
    customFields: z.record(z.string(), z.unknown()).optional().meta({
      description:
        'Valores de campos personalizados achatados, chave `cf_<definitionId>`.',
    }),
  }),
)

export const CrmOpportunityLineItemDTO = dto(
  'CrmOpportunityLineItem',
  z.object({
    id: z.string(),
    opportunityId: z.string(),
    productId: z
      .string()
      .nullable()
      .meta({ description: 'Produto do catálogo (`null` = item avulso).' }),
    name: z.string().meta({ example: 'Licença ServiceDesk' }),
    quantity: z.number().int().meta({ example: 10 }),
    unitPrice: z.number().meta({ example: 199.9 }),
    discountPct: z
      .number()
      .meta({ description: 'Desconto percentual (0–100).', example: 5 }),
    billingType: CrmBillingTypeEnum,
    total: z.number().meta({
      description: 'quantidade × preço unitário × (1 − desconto/100).',
      example: 1899.05,
    }),
    position: z.number(),
    createdAt: dateTime(),
    updatedAt: dateTime(),
  }),
)

export const CrmPipelineDTO = dto(
  'CrmPipeline',
  z.object({
    id: z.string().meta({ example: 'ckw1pipe0000ab7d3k1e5xyz' }),
    workspaceId: z.string(),
    name: z.string().meta({ example: 'Vendas B2B' }),
    position: z.number(),
    isDefault: z.boolean().meta({
      description:
        'Pipeline usado quando a oportunidade é criada sem `pipelineId`.',
    }),
    createdById: z.string(),
    updatedById: z.string().nullable(),
    createdAt: dateTime(),
    updatedAt: dateTime(),
  }),
)

export const CrmPipelineStageDTO = dto(
  'CrmPipelineStage',
  z.object({
    id: z.string().meta({ example: 'ckw1stag0000ab7d3k1e5xyz' }),
    pipelineId: z.string(),
    name: z.string().meta({ example: 'Negociação' }),
    position: z.number(),
    probability: z.number().int().meta({ example: 60 }),
    category: z.enum(['OPEN', 'WON', 'LOST']).meta({
      description:
        'Categoria da etapa: aberta, ganha ou perdida (usada no forecast).',
    }),
    color: z.string().nullable(),
    createdAt: dateTime(),
    updatedAt: dateTime(),
  }),
)

export const CrmNlSearchResultDTO = dto(
  'CrmNlSearchResult',
  z.object({
    query: z
      .string()
      .meta({ example: 'negócios parados há 15 dias acima de 10 mil' }),
    interpretation: z.array(z.string()).meta({
      description: 'Como a pergunta foi lida, em frases curtas.',
      example: [
        'Em andamento',
        'Valor a partir de R$ 10.000',
        'Parados há 15 dias ou mais',
      ],
    }),
    filter: z.record(z.string(), z.unknown()).meta({
      description:
        'Filtro estruturado que rodou: `status`, `amountMin`, `amountMax`, `stalledForDays`, `createdWithinDays`, `closingWithinDays`, `closeDateOverdue`, `noCloseDate`, `probabilityMin`, `probabilityMax`, `ownedByMe`, `unassigned`, `stageContains`, `textContains` e `sort` (os ausentes não restringem).',
    }),
    opportunities: z.array(CrmOpportunityDTO),
    truncated: z.boolean().meta({
      description: 'Havia mais de 200 resultados; só os 200 primeiros vêm.',
    }),
  }),
)
