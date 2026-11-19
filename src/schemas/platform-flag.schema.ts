import { z } from 'zod'

export const PLATFORM_FLAG_KEY_REGEX = /^[a-z][a-z0-9_.-]{1,63}$/

export const CreatePlatformFlagSchema = z.object({
  key: z
    .string()
    .trim()
    .regex(
      PLATFORM_FLAG_KEY_REGEX,
      'Use letras minúsculas, números, ponto, hífen ou sublinhado (2 a 64 caracteres)',
    ),
  name: z.string().trim().min(1, 'Informe o nome').max(80, 'Nome muito longo'),
  description: z
    .string()
    .trim()
    .max(500, 'Descrição muito longa')
    .nullish()
    .transform((v) => (v ? v : null)),
  enabled: z.boolean().default(false),
  betaEnabled: z.boolean().default(false),
})
export type CreatePlatformFlagInput = z.infer<typeof CreatePlatformFlagSchema>

/** A `key` é imutável: o código a referencia. */
export const UpdatePlatformFlagSchema = z
  .object({
    name: z.string().trim().min(1, 'Informe o nome').max(80).optional(),
    description: z
      .string()
      .trim()
      .max(500, 'Descrição muito longa')
      .nullable()
      .optional(),
    enabled: z.boolean().optional(),
    betaEnabled: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nada para atualizar')
export type UpdatePlatformFlagInput = z.infer<typeof UpdatePlatformFlagSchema>

export const SetFlagWorkspaceSchema = z.object({
  workspaceId: z.string().min(1),
  granted: z.boolean(),
})
export type SetFlagWorkspaceInput = z.infer<typeof SetFlagWorkspaceSchema>

export const SetWorkspaceBetaSchema = z.object({
  workspaceId: z.string().min(1),
  beta: z.boolean(),
})
export type SetWorkspaceBetaInput = z.infer<typeof SetWorkspaceBetaSchema>

export const ListFlagWorkspacesQuerySchema = z.object({
  search: z.string().trim().max(80).optional(),
  /** Quando informado, cada linha traz `granted` para essa flag. */
  flagId: z.string().optional(),
})
