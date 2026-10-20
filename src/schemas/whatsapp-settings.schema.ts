import { z } from 'zod'
import { WHATSAPP_CLOSE_STATUS_MAX_SELECTIONS } from './whatsapp-close-status.schema'

/** Limite de 30 dias para o fechamento automático por inatividade. */
export const WHATSAPP_AUTO_CLOSE_MAX_HOURS = 720
/** Intervalo mínimo entre alertas de sentimento da mesma conversa. */
export const WHATSAPP_SENTIMENT_ALERT_MAX_COOLDOWN_HOURS = 168
/** Retenção do áudio das ligações gravadas: de 1 dia a 5 anos. */
export const CALL_RECORDING_MIN_RETENTION_DAYS = 1
export const CALL_RECORDING_MAX_RETENTION_DAYS = 1825
export const CALL_RECORDING_NOTICE_MAX = 500

export const UpdateWhatsAppSettingsSchema = z.object({
  autoCloseAfterHours: z
    .number()
    .int('Informe um número inteiro de horas')
    .min(0, 'Use 0 para desligar o fechamento automático')
    .max(
      WHATSAPP_AUTO_CLOSE_MAX_HOURS,
      `Máximo de ${WHATSAPP_AUTO_CLOSE_MAX_HOURS} horas (30 dias)`,
    )
    .optional(),

  sentimentAlertEnabled: z.boolean().optional(),
  /** Média de sentimento da conversa (-1 a 1) que dispara o alerta. */
  sentimentAlertThreshold: z
    .number()
    .min(-1, 'O limite vai de -1 (muito negativo) a 0 (neutro)')
    .max(0, 'O limite vai de -1 (muito negativo) a 0 (neutro)')
    .optional(),
  sentimentAlertNotifyInApp: z.boolean().optional(),
  sentimentAlertNotifyEmail: z.boolean().optional(),
  /** Vazio = todos os proprietários e administradores. */
  sentimentAlertRecipientIds: z
    .array(z.string().min(1))
    .max(50, 'Selecione no máximo 50 membros')
    .optional(),
  sentimentAlertAssignToId: z.string().min(1).nullable().optional(),
  sentimentAlertCooldownHours: z
    .number()
    .int('Informe um número inteiro de horas')
    .min(1, 'O intervalo mínimo é de 1 hora')
    .max(
      WHATSAPP_SENTIMENT_ALERT_MAX_COOLDOWN_HOURS,
      `Máximo de ${WHATSAPP_SENTIMENT_ALERT_MAX_COOLDOWN_HOURS} horas (7 dias)`,
    )
    .optional(),

  /** Gravação das ligações do "Ligar" (ADR 0043). */
  callRecordingEnabled: z.boolean().optional(),
  /** Aviso que o atendente lê ao contato; vazio/nulo = texto padrão. */
  callRecordingNotice: z
    .string()
    .trim()
    .max(
      CALL_RECORDING_NOTICE_MAX,
      `O aviso pode ter até ${CALL_RECORDING_NOTICE_MAX} caracteres`,
    )
    .nullable()
    .optional(),
  callRecordingRetentionDays: z
    .number()
    .int('Informe um número inteiro de dias')
    .min(
      CALL_RECORDING_MIN_RETENTION_DAYS,
      'Guarde o áudio por pelo menos 1 dia',
    )
    .max(
      CALL_RECORDING_MAX_RETENTION_DAYS,
      `Máximo de ${CALL_RECORDING_MAX_RETENTION_DAYS} dias (5 anos)`,
    )
    .optional(),
  callTranscriptionEnabled: z.boolean().optional(),

  /** Quantos status de fechamento o atendente escolhe (mínimo 0 = opcional). */
  closeStatusMinSelections: z
    .number()
    .int('Informe um número inteiro')
    .min(0, 'O mínimo vai de 0 (opcional) a 10')
    .max(WHATSAPP_CLOSE_STATUS_MAX_SELECTIONS, 'O mínimo vai de 0 a 10')
    .optional(),
  closeStatusMaxSelections: z
    .number()
    .int('Informe um número inteiro')
    .min(1, 'O máximo vai de 1 a 10')
    .max(WHATSAPP_CLOSE_STATUS_MAX_SELECTIONS, 'O máximo vai de 1 a 10')
    .optional(),
})

export type UpdateWhatsAppSettingsDTO = z.infer<
  typeof UpdateWhatsAppSettingsSchema
>
