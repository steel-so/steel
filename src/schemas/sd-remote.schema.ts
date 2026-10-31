import z from 'zod'
import {
  isValidRemoteId,
  normalizeRemoteId,
  validateLinkTemplate,
} from '@/src/lib/servicedesk/remote-access'
import { sdId } from './sd-config.schema'

/** Acesso remoto integrado (S4): provedor por workspace, ID por ativo e conexão. */

export const SdRemoteProviderEnum = z.enum(['RUSTDESK', 'ANYDESK'])

export const UpdateSdRemoteSettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    provider: SdRemoteProviderEnum.optional(),
    linkTemplate: z
      .string()
      .trim()
      .max(300)
      .nullable()
      .optional()
      .superRefine((value, ctx) => {
        if (!value) return
        const problem = validateLinkTemplate(value)
        if (problem) ctx.addIssue({ code: 'custom', message: problem })
      }),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Informe ao menos um campo',
  })
  // Blank clears the template, but only when the caller sent the field.
  .transform((data) =>
    data.linkTemplate === undefined
      ? data
      : { ...data, linkTemplate: data.linkTemplate || null },
  )
export type UpdateSdRemoteSettingsDTO = z.infer<
  typeof UpdateSdRemoteSettingsSchema
>

/** ID público da máquina: nunca senha. */
export const SdRemoteIdSchema = z
  .string()
  .trim()
  .min(1, 'Informe o ID de acesso remoto')
  .transform(normalizeRemoteId)
  .refine(isValidRemoteId, {
    message: 'ID inválido: use de 4 a 64 letras, números, ponto, @ ou hífen',
  })

export const UpsertSdRemoteEndpointSchema = z.object({
  configItemId: sdId,
  provider: SdRemoteProviderEnum,
  remoteId: SdRemoteIdSchema,
})
export type UpsertSdRemoteEndpointDTO = z.infer<
  typeof UpsertSdRemoteEndpointSchema
>

export const ListSdRemoteEndpointsSchema = z.object({ configItemId: sdId })
export type ListSdRemoteEndpointsDTO = z.infer<
  typeof ListSdRemoteEndpointsSchema
>

export const ConnectSdRemoteSchema = z.object({
  configItemId: sdId,
  ticketId: sdId.optional(),
})
export type ConnectSdRemoteDTO = z.infer<typeof ConnectSdRemoteSchema>

export const ListSdRemoteSessionsSchema = z.object({
  configItemId: sdId,
  limit: z.coerce.number().int().min(1).max(100).default(20),
})
export type ListSdRemoteSessionsDTO = z.infer<typeof ListSdRemoteSessionsSchema>

/** Parte opcional do relatório do agente: IDs das ferramentas instaladas na máquina. */
export const SdInventoryRemoteIdsSchema = z
  .object({
    rustdesk: SdRemoteIdSchema.optional().nullable(),
    anydesk: SdRemoteIdSchema.optional().nullable(),
  })
  .partial()
