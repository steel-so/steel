import { z } from 'zod'

export const UpdateMetaChannelSettingsSchema = z
  .object({
    instagramEnabled: z.boolean().optional(),
    messengerEnabled: z.boolean().optional(),
    commentsEnabled: z.boolean().optional(),
    coexistenceEnabled: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Informe ao menos uma configuração',
  })

export type UpdateMetaChannelSettingsDTO = z.infer<
  typeof UpdateMetaChannelSettingsSchema
>

const UserTokenField = z
  .string()
  .min(10, 'Token inválido')
  .max(4000, 'Token inválido')

/** Lists the Pages the logged-in Meta user manages. */
export const ListMetaChannelPagesSchema = z.object({
  accessToken: UserTokenField,
})

export type ListMetaChannelPagesDTO = z.infer<typeof ListMetaChannelPagesSchema>

/** Connects the chosen Page as Messenger and/or Instagram Direct. */
export const ConnectMetaChannelSchema = z.object({
  accessToken: UserTokenField,
  pageId: z.string().regex(/^\d{5,30}$/, 'ID da Página inválido'),
  channels: z
    .array(z.enum(['MESSENGER', 'INSTAGRAM']))
    .min(1, 'Escolha ao menos um canal')
    .max(2),
})

export type ConnectMetaChannelDTO = z.infer<typeof ConnectMetaChannelSchema>

export const ReplySocialCommentSchema = z.object({
  text: z.string().trim().min(1, 'Escreva a resposta').max(2000),
  /** PUBLIC answers under the comment; PRIVATE sends a DM to its author. */
  mode: z.enum(['PUBLIC', 'PRIVATE']).default('PUBLIC'),
})

export type ReplySocialCommentDTO = z.infer<typeof ReplySocialCommentSchema>
