import { z } from 'zod'

const Reason = z
  .string()
  .trim()
  .min(5, 'Informe o motivo (mínimo 5 caracteres)')
  .max(500)

/**
 * Global admin: saves (or replaces) the credentials of the platform
 * verification line, copied from the Z-API dashboard. Always replaces the
 * three values together; the connection state resets until the QR is scanned.
 */
export const SavePlatformZapiLineSchema = z.object({
  instanceId: z
    .string()
    .trim()
    .min(1, 'Informe o ID da instância')
    .max(100)
    .regex(/^[A-Za-z0-9_-]+$/, 'ID da instância inválido'),
  token: z
    .string()
    .trim()
    .min(1, 'Informe o token da instância')
    .max(200)
    .regex(/^[A-Za-z0-9_-]+$/, 'Token da instância inválido'),
  clientToken: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((value) => (value ? value : undefined)),
  label: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((value) => (value ? value : undefined)),
  reason: Reason.optional(),
})

export type SavePlatformZapiLineDTO = z.infer<typeof SavePlatformZapiLineSchema>

/** Disconnect, restart and remove need a reason (goes to the audit trail). */
export const PlatformZapiLineActionSchema = z.object({
  reason: Reason,
})

export type PlatformZapiLineActionDTO = z.infer<
  typeof PlatformZapiLineActionSchema
>
