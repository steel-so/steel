import { z } from 'zod'

const base64url = z
  .string()
  .min(8)
  .max(256)
  .regex(/^[A-Za-z0-9_-]+$/, 'Chave inválida')

/** Body of `POST /api/push/subscriptions` (the browser's `PushSubscriptionJSON`). */
export const CreatePushSubscriptionSchema = z.object({
  endpoint: z
    .url()
    .max(2048)
    .refine((value) => value.startsWith('https://'), 'O endpoint deve ser https'),
  keys: z.object({
    p256dh: base64url,
    auth: base64url,
  }),
})

export const DeletePushSubscriptionSchema = z.object({
  endpoint: z.url().max(2048),
})

export type CreatePushSubscriptionDTO = z.infer<
  typeof CreatePushSubscriptionSchema
>
export type DeletePushSubscriptionDTO = z.infer<
  typeof DeletePushSubscriptionSchema
>
