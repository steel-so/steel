import z from 'zod'
import { sdId } from './sd-config.schema'
import { SdMessageMentionsSchema } from './sd-notification.schema'
import { SteelAgentMentionsSchema } from './steel-agent.schema'

/** Tamanho máximo do texto de uma mensagem do chamado. */
export const SD_MESSAGE_MAX_LENGTH = 10_000
/** Anexos por mensagem. */
export const SD_MESSAGE_MAX_ATTACHMENTS = 10

const body = z
  .string()
  .max(SD_MESSAGE_MAX_LENGTH, 'Mensagem muito longa')
  .transform((v) => v.trim())

export const SdMessageVisibilityEnum = z.enum(['PUBLIC', 'INTERNAL'])

/**
 * Nova mensagem do histórico: texto (pode ser vazio quando há anexos) e ids
 * de anexos já enviados por `POST .../attachments`. Solicitantes só postam
 * `PUBLIC` (o service recusa `INTERNAL`).
 */
export const CreateSdTicketMessageSchema = z
  .object({
    body: body.default(''),
    visibility: SdMessageVisibilityEnum.default('PUBLIC'),
    attachmentIds: z
      .array(sdId)
      .max(SD_MESSAGE_MAX_ATTACHMENTS, 'Anexos demais numa mensagem')
      .default([]),
    /** Agentes citados com `@` (dispara `ticket.mentioned`). */
    mentionedUserIds: SdMessageMentionsSchema,
    /** Steel Agents citados com `@` (acorda cada agente com o chamado). */
    mentionedAgentIds: SteelAgentMentionsSchema,
  })
  .refine((data) => data.body.length > 0 || data.attachmentIds.length > 0, {
    message: 'Escreva uma mensagem ou anexe um arquivo',
    path: ['body'],
  })
export type CreateSdTicketMessageDTO = z.infer<
  typeof CreateSdTicketMessageSchema
>

export const UpdateSdTicketMessageSchema = z.object({
  body: body.pipe(z.string().min(1, 'A mensagem não pode ficar vazia')),
})
export type UpdateSdTicketMessageDTO = z.infer<
  typeof UpdateSdTicketMessageSchema
>

/** `?before=<messageId>&limit=50` (histórico em páginas, das mais novas). */
export const ListSdTicketMessagesSchema = z.object({
  before: sdId.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})
export type ListSdTicketMessagesDTO = z.infer<typeof ListSdTicketMessagesSchema>

/** `?download=1` na rota do anexo força `Content-Disposition: attachment`. */
export const SdAttachmentDownloadQuerySchema = z.object({
  download: z
    .enum(['1', 'true', '0', 'false'])
    .optional()
    .transform((v) => v === '1' || v === 'true'),
})
