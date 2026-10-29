import { z } from 'zod'
import {
  CRM_NEWSLETTER_SUBSCRIBER_SOURCES,
  CRM_NEWSLETTER_SUBSCRIBER_STATUSES,
} from '@/src/schemas/crm-newsletter.schema'
import { dto } from '../../common'

/**
 * DTOs do cartão "Newsletters" da pessoa do CRM (ponte newsletter ↔ CRM,
 * `src/schemas/crm-newsletter-bridge.schema.ts`).
 */

const nullableDateTime = () => z.iso.datetime().nullable()

export const CrmPersonNewsletterSubscriptionDTO = dto(
  'CrmPersonNewsletterSubscription',
  z.object({
    subscriberId: z.string(),
    newsletterId: z.string(),
    newsletterName: z.string().meta({ example: 'Novidades da Acme' }),
    newsletterArchived: z.boolean(),
    email: z.string().meta({ example: 'ana@empresa.com.br' }),
    status: z.enum(CRM_NEWSLETTER_SUBSCRIBER_STATUSES),
    source: z.enum(CRM_NEWSLETTER_SUBSCRIBER_SOURCES),
    consentAt: nullableDateTime(),
    confirmedAt: nullableDateTime(),
    unsubscribedAt: nullableDateTime(),
    lastOpenedAt: nullableDateTime(),
    lastClickedAt: nullableDateTime(),
    canUnsubscribe: z
      .boolean()
      .meta({ description: '`ACTIVE` ou `PENDING`: pode descadastrar.' }),
    welcome: z
      .object({
        sent: z.number().int(),
        opened: z.number().int(),
        clicked: z.number().int(),
      })
      .nullable()
      .meta({
        description:
          'E-mails da série de boas-vindas enviados, abertos e clicados; `null` quando nenhum foi enviado.',
      }),
  }),
)

export const CrmPersonNewslettersDTO = dto(
  'CrmPersonNewsletters',
  z.object({
    personId: z.string(),
    emails: z.array(z.string()),
    subscriptions: z.array(CrmPersonNewsletterSubscriptionDTO),
    available: z.array(z.object({ id: z.string(), name: z.string() })).meta({
      description:
        'Newsletters ativas em que a pessoa pode entrar (sem inscrição ou descadastrada).',
    }),
  }),
)
