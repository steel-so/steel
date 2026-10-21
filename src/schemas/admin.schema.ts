import { z } from 'zod'
import { isValidIpEntry } from '@/src/lib/ip-allowlist'

/** Motivo obrigatório das ações destrutivas do admin (vai para a auditoria). */
export const AdminReasonSchema = z
  .string()
  .trim()
  .min(5, 'Descreva o motivo (mínimo 5 caracteres)')
  .max(500, 'Motivo muito longo (máximo 500 caracteres)')

export const SetWorkspaceStatusSchema = z.object({
  action: z.enum(['suspend', 'reactivate']),
  reason: AdminReasonSchema,
})
export type SetWorkspaceStatusInput = z.infer<typeof SetWorkspaceStatusSchema>

export const ChangeWorkspacePlanSchema = z.object({
  plan: z.enum(['FREE', 'PRO', 'BUSINESS', 'ENTERPRISE']),
  reason: AdminReasonSchema,
})
export type ChangeWorkspacePlanInput = z.infer<typeof ChangeWorkspacePlanSchema>

/** Allowlist de rede do workspace; lista vazia = acesso de qualquer lugar. */
export const SetWorkspaceAllowedIpsSchema = z.object({
  allowedIps: z
    .array(
      z
        .string()
        .trim()
        .refine(
          isValidIpEntry,
          'IP ou CIDR inválido (ex.: 200.1.2.3 ou 200.1.2.0/24)',
        ),
    )
    .max(50, 'Máximo de 50 entradas')
    .transform((list) => [...new Set(list)]),
  reason: AdminReasonSchema,
})
export type SetWorkspaceAllowedIpsInput = z.infer<
  typeof SetWorkspaceAllowedIpsSchema
>

/** Exclusão definitiva e restore: o admin digita o slug para confirmar. */
export const ConfirmedWorkspaceActionSchema = z.object({
  confirmSlug: z.string().trim().min(1, 'Digite o slug do workspace'),
  reason: AdminReasonSchema,
})
export type ConfirmedWorkspaceActionInput = z.infer<
  typeof ConfirmedWorkspaceActionSchema
>

/**
 * Exclusão definitiva. `ignoreSubscriptionCancelFailure` é o *force*: por
 * padrão a exclusão é **barrada** se o cancelamento de alguma assinatura no
 * AbacatePay falhar (nada é apagado). Marcado, a exclusão segue e as
 * assinaturas que não cancelaram ficam registradas como pendentes de
 * cancelamento manual (operação + auditoria).
 */
export const DeleteWorkspaceSchema = ConfirmedWorkspaceActionSchema.extend({
  ignoreSubscriptionCancelFailure: z.boolean().default(false),
})
export type DeleteWorkspaceInput = z.infer<typeof DeleteWorkspaceSchema>

export const TriggerBackupSchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('FULL') }),
  z.object({ scope: z.literal('WORKSPACE'), workspaceId: z.string().min(1) }),
])
export type TriggerBackupInput = z.infer<typeof TriggerBackupSchema>

export const ListBackupsQuerySchema = z.object({
  scope: z.enum(['FULL', 'WORKSPACE']).optional(),
  workspaceId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})
export type ListBackupsQuery = z.infer<typeof ListBackupsQuerySchema>

export const BackupDownloadQuerySchema = z.object({
  exp: z.coerce.number().int().positive(),
  sig: z.string().regex(/^[a-f0-9]{64}$/),
})
