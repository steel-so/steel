import { z } from 'zod'

/**
 * WhatsApp agent performance report (ADR 0062). Opt-in per workspace,
 * toggled by the platform admin; workspace members read it within the
 * conversations they may see (Equipes).
 */

export const WHATSAPP_AGENT_REPORT_MAX_DAYS = 366

const calendarDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`)
    return (
      !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
    )
  }, 'Data inválida')

export const WhatsAppAgentReportQuerySchema = z.object({
  from: calendarDay.optional().meta({
    description:
      'Primeiro dia (inclusivo), `YYYY-MM-DD` em America/Sao_Paulo. Padrão: 6 dias antes de `to` (últimos 7 dias).',
    example: '2026-11-01',
  }),
  to: calendarDay.optional().meta({
    description:
      'Último dia (inclusivo), `YYYY-MM-DD` em America/Sao_Paulo. Padrão: hoje.',
    example: '2026-11-07',
  }),
  teamId: z.string().min(1).optional().meta({
    description: 'Só conversas desta equipe.',
  }),
  connectionId: z.string().min(1).optional().meta({
    description: 'Só conversas desta conexão.',
  }),
  format: z.enum(['json', 'csv']).optional().meta({
    description: '`csv` baixa a planilha (fora do envelope JSON).',
  }),
})

export type WhatsAppAgentReportQuery = z.infer<
  typeof WhatsAppAgentReportQuerySchema
>

export const UpdateWhatsAppAgentReportSettingsSchema = z.object({
  enabled: z.boolean().meta({
    description: 'Liga o relatório de desempenho dos atendentes no workspace.',
  }),
})

export type UpdateWhatsAppAgentReportSettingsDTO = z.infer<
  typeof UpdateWhatsAppAgentReportSettingsSchema
>
