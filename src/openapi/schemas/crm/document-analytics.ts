import { z } from 'zod'
import { dto } from '../../common'

/** DTO of the document reading analytics (`types/document.d.ts`). */

const ms = (description: string) => z.number().int().meta({ description })
const rate = (description: string) =>
  z.number().min(0).max(1).meta({ description })

export const DocumentAnalyticsDTO = dto(
  'DocumentAnalytics',
  z.object({
    totals: z.object({
      sessions: z.number().int().meta({ description: 'Sessões de leitura.' }),
      uniqueVisitors: z.number().int(),
      totalActiveMs: ms('Tempo ativo somado (aba visível, leitor ativo).'),
      avgActiveMs: ms('Tempo ativo médio por sessão.'),
      avgScrollPct: z.number().int().min(0).max(100),
      completionRate: rate('Fração 0..1 das sessões que chegaram ao fim.'),
      revisits: z
        .number()
        .int()
        .meta({ description: 'Sessões além da primeira de cada visitante.' }),
      forwards: z.number().int().meta({
        description: 'Visitantes novos no link pessoal de um destinatário.',
      }),
    }),
    sections: z.array(
      z.object({
        id: z.string().meta({ description: 'Id do nó `section` no canvas.' }),
        name: z.string().meta({ example: 'Investimento' }),
        index: z.number().int(),
        totalActiveMs: z.number().int(),
        avgActiveMs: ms('Tempo médio de quem viu a seção.'),
        readers: z
          .number()
          .int()
          .meta({ description: 'Sessões que viram a seção.' }),
        reachRate: rate('readers / sessões: onde os leitores param.'),
      }),
    ),
    devices: z.object({
      desktop: z.number().int(),
      tablet: z.number().int(),
      mobile: z.number().int(),
      unknown: z.number().int(),
    }),
    readers: z.array(
      z.object({
        recipientId: z.string().nullable(),
        name: z.string().nullable().meta({
          description: 'Nome do destinatário; `null` = visitante anônimo.',
        }),
        visitorId: z.string(),
        sessions: z.number().int(),
        activeMs: z.number().int(),
        device: z.string().nullable(),
        lastSeenAt: z.iso.datetime(),
      }),
    ),
    daily: z.array(
      z.object({
        date: z.string().meta({ example: '2026-11-11' }),
        sessions: z.number().int(),
        activeMs: z.number().int(),
      }),
    ),
  }),
)
