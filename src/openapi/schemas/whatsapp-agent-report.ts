import { z } from 'zod'
import { dto } from '../common'

/**
 * WhatsApp agent performance report (ADR 0062). Zod versions of
 * `types/whatsapp-agent-report.d.ts`, only for the documentation; keep them
 * in line with `src/lib/whatsapp/agent-report.ts`.
 */

export const WhatsAppAgentReportSettingsDTO = dto(
  'WhatsAppAgentReportSettings',
  z.object({
    enabled: z.boolean(),
    updatedAt: z.iso.datetime().nullable(),
  }),
)

const StatusCount = z.object({
  label: z.string().meta({ example: 'Venda realizada' }),
  outcome: z.enum(['SUCCESS', 'FAILURE']).nullable().meta({
    description: '`null` quando o status foi removido ou mudou de nome.',
  }),
  count: z.number().int(),
})

const Metrics = {
  closed: z.number().int().meta({
    description: 'Conversas encerradas no período (tabuladas ou não).',
  }),
  tabulated: z.number().int().meta({ description: '`success + failure`.' }),
  success: z.number().int(),
  failure: z.number().int(),
  successRate: z.number().nullable().meta({
    description:
      '`success / tabulated`, 0-100 com uma casa; `null` sem tabuladas.',
  }),
  untabulated: z.number().int().meta({
    description: 'Encerradas sem nenhum status de fechamento.',
  }),
  avgHandlingSeconds: z.number().int().nullable().meta({
    description:
      'Média de `criação -> encerramento` da conversa (conversa reaberta conta a vida inteira).',
  }),
  open: z.number().int().meta({
    description: 'Conversas ainda não encerradas, neste momento.',
  }),
  byStatus: z.array(StatusCount).meta({
    description: 'Conversa com vários status conta uma vez em cada.',
  }),
}

export const WhatsAppAgentReportDTO = dto(
  'WhatsAppAgentReport',
  z.object({
    fromDay: z.string().meta({ example: '2026-11-01' }),
    toDay: z.string().meta({ example: '2026-11-07' }),
    timeZone: z.string().meta({ example: 'America/Sao_Paulo' }),
    teamId: z.string().nullable(),
    connectionId: z.string().nullable(),
    visibility: z.enum(['ALL', 'TEAMS', 'SELF']).meta({
      description:
        '`ALL`: OWNER/ADMIN; `TEAMS`: líder de equipe; `SELF`: atendente.',
    }),
    rows: z.array(
      z.object({
        agentId: z.string().nullable().meta({
          description: '`null` = "Sem atendente".',
        }),
        agentName: z.string(),
        ...Metrics,
      }),
    ),
    totals: z.object(Metrics),
    statuses: z.array(StatusCount),
  }),
)
