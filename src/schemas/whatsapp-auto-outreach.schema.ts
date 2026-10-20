import { z } from 'zod'
import {
  WHATSAPP_AUTO_OUTREACH_MAX_INTERVAL_SECONDS,
  WHATSAPP_AUTO_OUTREACH_MAX_QUEUE,
  WHATSAPP_AUTO_OUTREACH_MIN_INTERVAL_SECONDS,
} from '@/src/lib/whatsapp/auto-outreach'

/**
 * Connection + template (together, only while stopped) and/or the
 * aggressiveness — the interval between sends, which can change mid-run.
 */
export const ConfigureWhatsAppAutoOutreachSchema = z
  .object({
    connectionId: z.string().min(1, 'Escolha a conexão').optional(),
    templateId: z.string().min(1, 'Escolha o template').optional(),
    intervalSeconds: z
      .number()
      .int('Informe um número inteiro de segundos')
      .min(
        WHATSAPP_AUTO_OUTREACH_MIN_INTERVAL_SECONDS,
        `O intervalo mínimo é de ${WHATSAPP_AUTO_OUTREACH_MIN_INTERVAL_SECONDS} segundos`,
      )
      .max(
        WHATSAPP_AUTO_OUTREACH_MAX_INTERVAL_SECONDS,
        `O intervalo máximo é de ${WHATSAPP_AUTO_OUTREACH_MAX_INTERVAL_SECONDS} segundos`,
      )
      .optional(),
  })
  .refine(
    (value) =>
      (value.connectionId === undefined) === (value.templateId === undefined),
    { message: 'Informe a conexão e o template juntos' },
  )
  .refine(
    (value) =>
      value.connectionId !== undefined || value.intervalSeconds !== undefined,
    { message: 'Informe o template ou o intervalo' },
  )

export type ConfigureWhatsAppAutoOutreachDTO = z.infer<
  typeof ConfigureWhatsAppAutoOutreachSchema
>

/** `all: true` queues every contact (not opted out); else `contactIds`. */
export const QueueWhatsAppAutoOutreachSchema = z
  .object({
    all: z.boolean().optional(),
    contactIds: z
      .array(z.string().min(1))
      .max(
        WHATSAPP_AUTO_OUTREACH_MAX_QUEUE,
        `Adicione até ${WHATSAPP_AUTO_OUTREACH_MAX_QUEUE} contatos por vez`,
      )
      .optional(),
  })
  .refine(
    (value) => value.all === true || (value.contactIds?.length ?? 0) > 0,
    {
      message: 'Escolha os contatos ou marque todos',
    },
  )

export type QueueWhatsAppAutoOutreachDTO = z.infer<
  typeof QueueWhatsAppAutoOutreachSchema
>

export const ClearWhatsAppAutoOutreachSchema = z.object({
  /** true = also forget who already got it (they can be queued again). */
  all: z.boolean().optional().default(false),
})

export type ClearWhatsAppAutoOutreachDTO = z.infer<
  typeof ClearWhatsAppAutoOutreachSchema
>
