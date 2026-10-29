import { z } from 'zod'
import {
  CRM_NEWSLETTER_STATUSES,
  CRM_NEWSLETTER_SUBSCRIBER_SOURCES,
  CRM_NEWSLETTER_SUBSCRIBER_STATUSES,
} from '@/src/schemas/crm-newsletter.schema'
import { dto } from '../../common'

/**
 * DTOs das newsletters do CRM e dos assinantes (ADR 0054,
 * `src/schemas/crm-newsletter.schema.ts`).
 */

const dateTime = () => z.iso.datetime()
const nullableDateTime = () => z.iso.datetime().nullable()

export const CrmNewsletterDTO = dto(
  'CrmNewsletter',
  z
    .object({
      id: z.string().meta({ example: 'ckw1nl00000ab7d3k1e5xyz' }),
      name: z.string().meta({ example: 'Novidades da Acme' }),
      slug: z.string().meta({
        example: 'novidades',
        description: 'Endereço do arquivo público `/n/<workspace>/<slug>`.',
      }),
      description: z.string().nullable(),
      cadenceLabel: z.string().nullable().meta({ example: 'Mensal' }),
      fromName: z.string().meta({ example: 'Acme' }),
      fromEmail: z.string().meta({ example: 'news@news.acme.com.br' }),
      replyTo: z.string().nullable(),
      sendingDomainId: z.string().nullable(),
      senderVerified: z.boolean().meta({
        description:
          'Falso enquanto o domínio do remetente não está verificado no workspace: o envio fica bloqueado.',
      }),
      templateId: z.string().nullable(),
      doubleOptIn: z.boolean(),
      legalBasis: z.enum(['CONSENT', 'LEGITIMATE_INTEREST', 'CONTRACT']),
      archiveEnabled: z.boolean(),
      status: z.enum(CRM_NEWSLETTER_STATUSES),
      counts: z.object({
        active: z.number().int(),
        pending: z.number().int(),
        issuesSent: z.number().int(),
      }),
      lastIssueSentAt: nullableDateTime(),
      archiveUrl: z.string().nullable().meta({
        description:
          'Arquivo público (nulo com o arquivo desligado ou a newsletter arquivada).',
      }),
      createdAt: dateTime(),
      updatedAt: dateTime(),
    })
    .meta({ description: 'Newsletter do CRM.' }),
)

export const CrmNewsletterSubscriberDTO = dto(
  'CrmNewsletterSubscriber',
  z
    .object({
      id: z.string(),
      email: z.string().meta({ example: 'ana@empresa.com.br' }),
      name: z.string().nullable(),
      personId: z.string().nullable().meta({
        description: 'Pessoa do CRM com este e-mail, quando existe.',
      }),
      status: z.enum(CRM_NEWSLETTER_SUBSCRIBER_STATUSES),
      source: z.enum(CRM_NEWSLETTER_SUBSCRIBER_SOURCES),
      consentAt: nullableDateTime(),
      confirmedAt: nullableDateTime(),
      unsubscribedAt: nullableDateTime(),
      unsubscribeReason: z.string().nullable(),
      lastSentAt: nullableDateTime(),
      lastOpenedAt: nullableDateTime(),
      lastClickedAt: nullableDateTime(),
      createdAt: dateTime(),
    })
    .meta({ description: 'Assinante de uma newsletter.' }),
)

export const CrmNewsletterSubscriberPageDTO = dto(
  'CrmNewsletterSubscriberPage',
  z.object({
    items: z.array(CrmNewsletterSubscriberDTO),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  }),
)

export const CrmNewsletterImportResultDTO = dto(
  'CrmNewsletterImportResult',
  z.object({
    created: z.number().int(),
    reactivated: z.number().int().meta({
      description:
        'Quem tinha saído e voltou para `PENDING` (recebe a confirmação de novo).',
    }),
    unchanged: z.number().int().meta({ description: 'Já ACTIVE/PENDING.' }),
    rejected: z.array(
      z.object({
        row: z.number().int(),
        email: z.string(),
        reason: z.string(),
      }),
    ),
  }),
)

export const PublicNewsletterSubscribeResultDTO = dto(
  'PublicNewsletterSubscribeResult',
  z.object({
    requiresConfirmation: z.boolean().meta({
      description:
        'Verdadeiro: "confira seu e-mail para confirmar". A resposta é a mesma qualquer que seja a situação do endereço.',
    }),
    status: z.enum(['PENDING', 'ACTIVE']).meta({
      description:
        'Situação de uma inscrição nova nesta newsletter (`PENDING` com confirmação dupla), nunca a situação real do endereço.',
    }),
  }),
)

export const NewsletterUnsubscribeResultDTO = dto(
  'NewsletterUnsubscribeResult',
  z.object({
    email: z.string(),
    newsletterName: z.string(),
    alreadyUnsubscribed: z.boolean(),
  }),
)

export const NewsletterPreferencesDTO = dto(
  'NewsletterPreferences',
  z.object({
    workspaceName: z.string(),
    email: z.string(),
    optedOutOfAll: z.boolean(),
    newsletters: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        description: z.string().nullable(),
        cadenceLabel: z.string().nullable(),
        subscribed: z.boolean(),
      }),
    ),
  }),
)
