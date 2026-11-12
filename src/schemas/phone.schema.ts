import { z } from 'zod'
import { toStoredPhone } from '@/src/lib/phone-br'

/**
 * Phone typed in any mask, with or without the country code. Stored as
 * digits with `55` (the user never types it).
 */
export const PhoneField = z
  .string()
  .trim()
  .max(30)
  .regex(/^[\d\s()+.-]+$/, 'Telefone inválido')
  .transform((value) => toStoredPhone(value) ?? '')
  .refine((value) => value.length >= 8 && value.length <= 15, {
    message: 'Telefone inválido',
  })

const MASKED = /^[\d\s()+.-]+$/

/**
 * WhatsApp id (digits with country code) from what the user typed: masks are
 * stripped and `55` is added to 10/11-digit Brazilian numbers.
 */
export const WaIdField = z.preprocess(
  (value) =>
    typeof value === 'string' && MASKED.test(value)
      ? (toStoredPhone(value) ?? value)
      : value,
  z
    .string()
    .min(8, 'Número inválido')
    .max(20)
    .regex(/^\d+$/, 'Número inválido'),
)
