import { z } from 'zod'
import { dto } from '../common'

/**
 * Monthly spending cap per WhatsApp number (ADR 0064). Zod version of
 * `types/whatsapp-spend-cap.d.ts`, only for the documentation.
 */

const SpendCategory = z.object({
  category: z.string().meta({
    description: 'Categoria de preço da Meta.',
    example: 'MARKETING',
  }),
  label: z.string().meta({ example: 'Marketing' }),
  volume: z.number().int().meta({
    description: 'Mensagens contadas pela Meta, gratuitas incluídas.',
  }),
  billableVolume: z.number().int().meta({
    description: 'Mensagens que a Meta cobra (tipo REGULAR).',
  }),
  cost: z.number().meta({ description: 'Custo da categoria, na moeda.' }),
})

export const WhatsAppSpendCapStatusDTO = dto(
  'WhatsAppSpendCapStatus',
  z.object({
    connectionId: z.string(),
    label: z.string(),
    phoneNumber: z.string(),
    period: z.string().meta({
      description: 'Mês de uso (AAAA-MM, America/Sao_Paulo).',
      example: '2026-11',
    }),
    currency: z.string().meta({ example: 'BRL' }),
    monthlyCapAmount: z.number().nullable().meta({
      description: 'Limite mensal em R$; `null` = sem limite.',
      example: 1500,
    }),
    capMode: z.enum(['WARN', 'BLOCK']).nullable().meta({
      description:
        '`WARN` só avisa; `BLOCK` recusa envios pagos (templates) que passariam do limite.',
    }),
    spent: z.number().meta({
      description:
        'Gasto do mês: dias fechados informados pela Meta + razão do Steel desde então.',
    }),
    metaSpent: z.number().meta({
      description: 'Parte informada pela Meta (dias UTC já fechados).',
    }),
    ledgerSpent: z.number().meta({
      description:
        'Parte contada pela razão do Steel desde o último dia fechado da Meta.',
    }),
    source: z.enum(['META_COST', 'META_VOLUME', 'STEEL_LEDGER']).meta({
      description:
        '`META_COST` = custo da Meta; `META_VOLUME` = volume da Meta x tabela de preços (a Meta recusou o custo); `STEEL_LEDGER` = a Meta ainda não foi lida neste mês.',
    }),
    byCategory: z.array(SpendCategory),
    fetchedAt: z.string().nullable().meta({
      description: 'Última leitura bem-sucedida da Meta (ISO 8601).',
    }),
    metaPeriodEnd: z.string().nullable().meta({
      description: 'Fim (exclusivo) dos dias fechados informados pela Meta.',
    }),
    stale: z.boolean().meta({
      description:
        'A última chamada à Meta falhou; os números são da leitura anterior.',
    }),
    staleReason: z.string().nullable(),
    percent: z.number().int().nullable(),
    level: z.union([z.literal(80), z.literal(100)]).nullable(),
    status: z.enum(['NO_CAP', 'ALLOWED', 'BLOCKED']),
    projection: z.number().meta({
      description: 'Projeção do mês pelo ritmo atual.',
    }),
    daysElapsed: z.number().int(),
    daysInMonth: z.number().int(),
  }),
)
