import z from 'zod'
import { SD_STATUS_PAGE_SLUG_PATTERN } from '@/src/lib/servicedesk/major-incident'

const Id = z.string().trim().min(1).max(64)

const Slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    SD_STATUS_PAGE_SLUG_PATTERN,
    'Use 3 a 48 letras minúsculas, números e hífens',
  )

export const CreateSdStatusPageSchema = z.object({
  name: z.string().trim().min(2).max(120),
  /** Omitted: generated from the name plus a random suffix. */
  slug: Slug.optional(),
  description: z.string().trim().max(1000).optional(),
  customerId: Id.optional(),
  serviceIds: z.array(Id).max(50).default([]),
  published: z.boolean().default(true),
  allowSubscriptions: z.boolean().default(true),
})

export const UpdateSdStatusPageSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(1000).nullable(),
    customerId: Id.nullable(),
    serviceIds: z.array(Id).max(50),
    published: z.boolean(),
    allowSubscriptions: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Informe ao menos um campo',
  })

const Email = z.string().trim().toLowerCase().max(254).pipe(z.email())
const Phone = z
  .string()
  .trim()
  .transform((value) => value.replace(/\D/g, ''))
  .pipe(z.string().min(10).max(15))

/** Subscriber added by an agent: e-mail or WhatsApp, already confirmed. */
export const AddSdStatusSubscriberSchema = z.discriminatedUnion('channel', [
  z.object({
    channel: z.literal('EMAIL'),
    address: Email,
    name: z.string().trim().max(120).optional(),
  }),
  z.object({
    channel: z.literal('WHATSAPP'),
    address: Phone,
    name: z.string().trim().max(120).optional(),
  }),
])

/** Self-service subscription on the public page (e-mail, double opt-in). */
export const SubscribeSdStatusPageSchema = z.object({
  email: Email,
  name: z.string().trim().max(120).optional(),
})

export const SdStatusSubscriptionActionSchema = z.object({
  action: z.enum(['CONFIRM', 'UNSUBSCRIBE']),
})

export const SdStatusSlugParamSchema = Slug
export const SdStatusTokenSchema = z.string().trim().min(16).max(80)

export type CreateSdStatusPageInput = z.infer<typeof CreateSdStatusPageSchema>
export type UpdateSdStatusPageInput = z.infer<typeof UpdateSdStatusPageSchema>
export type AddSdStatusSubscriberInput = z.infer<
  typeof AddSdStatusSubscriberSchema
>
export type SubscribeSdStatusPageInput = z.infer<
  typeof SubscribeSdStatusPageSchema
>
