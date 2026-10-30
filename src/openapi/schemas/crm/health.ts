import { z } from 'zod'
import { dto } from '../../common'

/** DTOs das notas de saúde do CRM (`types/crm-health.d.ts`). */

const level = () =>
  z.enum(['LOW', 'MEDIUM', 'HIGH']).meta({
    description:
      'Faixa do risco, com os mesmos cortes do risco preditivo do ServiceDesk: `MEDIUM` a partir de 40, `HIGH` a partir de 70.',
  })

export const CrmHealthFactorDTO = dto(
  'CrmHealthFactor',
  z.object({
    key: z.string(),
    label: z.string().meta({ description: 'Nome do fator, em pt-BR.' }),
    points: z
      .number()
      .meta({ description: 'Pontos que o fator somou ao risco.' }),
    max: z
      .number()
      .meta({ description: 'O máximo que o fator poderia somar.' }),
    detail: z.string().meta({
      description:
        'Frase que explica o fator neste registro ("Última interação há 52 dias").',
    }),
  }),
)

export const CrmHealthNextActionDTO = dto(
  'CrmHealthNextAction',
  z.object({
    key: z.string(),
    label: z.string().meta({ description: 'A ação sugerida, em pt-BR.' }),
    detail: z.string(),
  }),
)

const base = {
  riskScore: z.number().int().min(0).max(100),
  level: level(),
  levelLabel: z.string(),
  factors: z.array(CrmHealthFactorDTO).meta({
    description: 'Só os fatores que pontuaram, do maior para o menor.',
  }),
  nextAction: CrmHealthNextActionDTO,
  riskDelta: z.number().int().nullable().meta({
    description:
      'Variação do risco desde o cálculo anterior (positivo = piorou). `null` no primeiro cálculo.',
  }),
  computedAt: z.iso.datetime(),
}

export const CrmCustomerHealthDTO = dto(
  'CrmCustomerHealth',
  z.object({
    companyId: z.string(),
    companyName: z.string(),
    ...base,
    healthScore: z.number().int().min(0).max(100).meta({
      description: 'Saúde do cliente: `100 - riskScore`.',
    }),
    missing: z.array(z.string()).meta({
      description:
        'Fatores que ficaram de fora por falta de dado (sem WhatsApp, sem chamados vinculados).',
    }),
  }),
)

export const CrmOpportunityHealthDTO = dto(
  'CrmOpportunityHealth',
  z.object({
    opportunityId: z.string(),
    opportunityName: z.string(),
    ...base,
  }),
)
