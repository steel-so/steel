import { z } from 'zod'
import { configurableNotificationKinds } from '@/src/lib/notification-kind'

/**
 * Kinds the user can mute: everything outside the ServiceDesk (which keeps
 * its own per-event preferences). Derived from the catalog, so a kind added
 * there shows up here without touching this file.
 */
export const CONFIGURABLE_NOTIFICATION_KINDS =
  configurableNotificationKinds().map((info) => info.kind)

export const NotificationPreferenceItemSchema = z
  .object({
    kind: z.enum(CONFIGURABLE_NOTIFICATION_KINDS, {
      error: 'Tipo de notificação inválido',
    }),
    inApp: z.boolean().optional(),
    whatsapp: z.boolean().optional(),
  })
  .refine((item) => item.inApp !== undefined || item.whatsapp !== undefined, {
    message: 'Informe inApp ou whatsapp',
  })

export const UpdateNotificationPreferencesSchema = z.object({
  preferences: z.array(NotificationPreferenceItemSchema).min(1).max(100),
})

export type UpdateNotificationPreferencesDTO = z.infer<
  typeof UpdateNotificationPreferencesSchema
>

/** Delivery channels of the inbox (kind-agnostic): browser notifications. */
export const UpdateNotificationDeliverySchema = z.object({
  browserEnabled: z.boolean(),
})

export type UpdateNotificationDeliveryDTO = z.infer<
  typeof UpdateNotificationDeliverySchema
>

/** Phone to receive the verification code (digits, spaces, +, -, parens). */
export const RequestNotificationWhatsappCodeSchema = z.object({
  number: z
    .string()
    .trim()
    .min(8, 'Informe o número com DDD')
    .max(24)
    .regex(/^[\d\s()+-]+$/, 'Número inválido'),
})

export const ConfirmNotificationWhatsappCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'O código tem 6 dígitos'),
})

export const UpdateNotificationWhatsappSchema = z.object({
  enabled: z.boolean(),
})
