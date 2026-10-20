import { z } from 'zod'
import { WHATSAPP_AUTO_OUTREACH_MAX_QUEUE } from '@/src/lib/whatsapp/auto-outreach'

export const ConfigureWhatsAppAutoOutreachSchema = z.object({
  connectionId: z.string().min(1, 'Escolha a conexão'),
  templateId: z.string().min(1, 'Escolha o template'),
})

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
