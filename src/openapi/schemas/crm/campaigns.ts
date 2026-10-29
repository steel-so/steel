import { z } from 'zod'
import { dto } from '../../common'

/**
 * DTOs das campanhas multicanal do CRM (`types/crm-campaign.d.ts`, ADR
 * 0025): campanha (assistente de 4 passos), funil por canal, destinatários,
 * alcance do público, opções dos seletores e envio de teste.
 */

const nullableDateTime = () => z.iso.datetime().nullable()
const status = z.enum([
  'DRAFT',
  'SCHEDULED',
  'SENDING',
  'PAUSED',
  'COMPLETED',
  'CANCELED',
  'FAILED',
])
const delivery = z.enum([
  'NONE',
  'PENDING',
  'SENDING',
  'SENT',
  'FAILED',
  'SKIPPED',
])
const legalBasis = z.enum(['CONSENT', 'LEGITIMATE_INTEREST', 'CONTRACT'])
const variable = z.object({
  source: z.enum(['name', 'first_name', 'link', 'link_code', 'static']),
  value: z.string().optional(),
})
const variableMap = z.record(z.string(), variable)

const campaignShape = {
  id: z.string().meta({ example: 'ckw1camp0000ab7d3k1e5xyz' }),
  workspaceId: z.string(),
  name: z.string().meta({ example: 'Black Friday 2026' }),
  slug: z.string().meta({
    example: 'black-friday-2026',
    description: 'Valor de `utm_campaign`.',
  }),
  status,
  destinationType: z
    .enum(['LANDING_PAGE', 'FORM', 'SITE_PAGE'])
    .nullable()
    .meta({
      description:
        'SITE_PAGE = página de um site publicado (`siteId` + `sitePageId`); LANDING_PAGE = landing page antiga.',
    }),
  landingPageId: z.string().nullable(),
  formId: z.string().nullable(),
  siteId: z.string().nullable(),
  sitePageId: z.string().nullable(),
  utmMedium: z.string().meta({ example: 'campanha' }),
  emailFrom: z.string().nullable(),
  emailSubject: z.string().nullable(),
  emailPreheader: z.string().nullable(),
  emailTemplateId: z.string().nullable(),
  emailLegalBasis: legalBasis.nullable(),
  audience: z.object({
    mailingListIds: z.array(z.string()),
    allPeople: z.boolean(),
    leadStages: z.array(z.string()),
  }),
  whatsappEnabled: z.boolean(),
  whatsappConnectionId: z.string().nullable(),
  whatsappTemplateId: z.string().nullable(),
  whatsappVariables: z
    .object({ header: variableMap, body: variableMap, buttons: variableMap })
    .nullable(),
  whatsappText: z.string().nullable(),
  whatsappMediaUrl: z.string().nullable(),
  whatsappQuickReplyId: z.string().nullable().meta({
    description:
      'Z-API: resposta rápida cujos botões vão com o texto (ações mantidas).',
  }),
  whatsappDelayHours: z.number().int(),
  whatsappLegalBasis: legalBasis.nullable(),
  scheduledAt: nullableDateTime(),
  sendWindowStartHour: z.number().int().nullable(),
  sendWindowEndHour: z.number().int().nullable(),
  sendWeekdaysOnly: z.boolean(),
  consentConfirmedAt: nullableDateTime(),
  launchedAt: nullableDateTime(),
  startAt: nullableDateTime(),
  completedAt: nullableDateTime(),
  createdById: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  links: z.object({
    destination: z.string().nullable(),
    email: z.string().nullable(),
    whatsapp: z.string().nullable(),
  }),
  destination: z
    .object({
      type: z.enum(['LANDING_PAGE', 'FORM', 'SITE_PAGE']),
      name: z.string(),
      pageTitle: z.string().nullable(),
      url: z.string().nullable(),
      published: z.boolean(),
    })
    .nullable()
    .meta({ description: 'Resumo do destino (nome, página e endereço).' }),
}

const conversionKind = z.enum([
  'LANDING_VIEW',
  'FORM_SUBMISSION',
  'SITE_VIEW',
  'SITE_FORM_SUBMISSION',
])
const button = z.object({
  type: z.enum(['REPLY', 'URL']),
  label: z.string(),
  url: z.string().nullable(),
  dynamic: z.boolean(),
  actionCount: z.number().int(),
})

export const CrmCampaignDetailDTO = dto(
  'CrmCampaignDetail',
  z.object({
    ...campaignShape,
    issues: z
      .array(
        z.object({
          step: z.enum(['destination', 'content', 'audience']),
          message: z.string(),
          fix: z.enum(['SENDING_DOMAINS']).optional().meta({
            description:
              'Onde resolver: `SENDING_DOMAINS` = Ajustes › Domínios de e-mail.',
          }),
        }),
      )
      .meta({ description: 'O que ainda impede o envio, por passo.' }),
    emailChecklist: z
      .array(
        z.object({ level: z.enum(['error', 'warning']), message: z.string() }),
      )
      .meta({
        description:
          'Checklist do template de e-mail; os erros também entram em `issues` e bloqueiam o envio.',
      }),
  }),
)

export const CrmCampaignListItemDTO = dto(
  'CrmCampaignListItem',
  z.object({
    ...campaignShape,
    kpis: z.object({
      recipients: z.number().int(),
      emailSent: z.number().int(),
      emailOpened: z.number().int(),
      emailClicked: z.number().int(),
      whatsappSent: z.number().int(),
      whatsappRead: z.number().int(),
      whatsappReplied: z.number().int(),
      conversions: z.number().int(),
    }),
  }),
)

const count = () => z.number().int()

export const CrmCampaignStatsDTO = dto(
  'CrmCampaignStats',
  z.object({
    recipients: count(),
    email: z.object({
      eligible: count(),
      pending: count(),
      sent: count(),
      delivered: count(),
      opened: count(),
      clicked: count(),
      failed: count(),
      skipped: count(),
      bounced: count(),
      unsubscribed: count(),
    }),
    whatsapp: z.object({
      eligible: count(),
      pending: count(),
      sent: count(),
      delivered: count(),
      read: count(),
      clicked: count(),
      replied: count(),
      failed: count(),
      skipped: count(),
    }),
    conversions: z.object({
      total: count(),
      visits: count(),
      submissions: count(),
      byChannel: z.object({
        email: count(),
        whatsapp: count(),
        unknown: count(),
      }),
      byDestination: z.object({
        siteView: count(),
        siteForm: count(),
        crmForm: count(),
        landingView: count(),
      }),
    }),
    convertedContacts: z.array(
      z.object({
        id: z.string(),
        kind: conversionKind,
        channel: z.enum(['EMAIL', 'WHATSAPP']).nullable(),
        recipientId: z.string().nullable(),
        name: z.string().nullable(),
        leadId: z.string().nullable(),
        personId: z.string().nullable(),
        createdAt: z.iso.datetime(),
      }),
    ),
  }),
)

export const CrmCampaignRecipientPageDTO = dto(
  'CrmCampaignRecipientPage',
  z.object({
    items: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        email: z.string().nullable(),
        waId: z.string().nullable(),
        personId: z.string().nullable(),
        leadId: z.string().nullable(),
        emailStatus: delivery,
        emailSkipReason: z.string().nullable(),
        emailError: z.string().nullable(),
        emailSentAt: nullableDateTime(),
        emailDeliveredAt: nullableDateTime(),
        emailOpenedAt: nullableDateTime(),
        emailClickedAt: nullableDateTime(),
        emailBouncedAt: nullableDateTime(),
        unsubscribedAt: nullableDateTime(),
        whatsappStatus: delivery,
        whatsappSkipReason: z.string().nullable(),
        whatsappError: z.string().nullable(),
        whatsappSentAt: nullableDateTime(),
        whatsappDeliveredAt: nullableDateTime(),
        whatsappReadAt: nullableDateTime(),
        whatsappClickedAt: nullableDateTime(),
        whatsappRepliedAt: nullableDateTime(),
        conversationId: z.string().nullable(),
        convertedAt: nullableDateTime(),
      }),
    ),
    total: count(),
    page: count(),
    pageSize: count(),
  }),
)

const reach = z.object({
  reachable: count(),
  optedOut: count(),
  missing: count(),
})

export const CrmCampaignAudiencePreviewDTO = dto(
  'CrmCampaignAudiencePreview',
  z.object({ total: count(), email: reach, whatsapp: reach }),
)

export const CrmCampaignOptionsDTO = dto(
  'CrmCampaignOptions',
  z.object({
    baseUrl: z.string(),
    sites: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        slug: z.string(),
        url: z.string(),
        published: z.boolean(),
        updatedAt: z.iso.datetime(),
        pages: z.array(
          z.object({
            id: z.string(),
            title: z.string(),
            path: z.string(),
            url: z.string(),
            isHome: z.boolean(),
          }),
        ),
      }),
    ),
    landingPages: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        published: z.boolean(),
        shareToken: z.string(),
      }),
    ),
    forms: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        published: z.boolean(),
        publicToken: z.string(),
        url: z.string(),
        embeds: z.array(
          z.object({
            siteId: z.string(),
            siteName: z.string(),
            pageId: z.string(),
            pageTitle: z.string(),
            url: z.string(),
          }),
        ),
      }),
    ),
    emailTemplates: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        subject: z.string(),
        editor: z.enum(['v2', 'v1', 'html']),
        updatedAt: z.iso.datetime(),
      }),
    ),
    mailingLists: z.array(z.object({ id: z.string(), name: z.string() })),
    whatsapp: z.object({
      available: z.boolean(),
      reason: z.string().nullable(),
      connections: z.array(
        z.object({
          id: z.string(),
          label: z.string(),
          provider: z.enum(['META', 'ZAPI']),
          phoneNumber: z.string(),
          templates: z.array(
            z.object({
              id: z.string(),
              name: z.string(),
              language: z.string(),
              category: z.string(),
              status: z.enum(['APPROVED', 'PAUSED', 'DISABLED']),
              quality: z.enum(['GREEN', 'YELLOW', 'RED', 'UNKNOWN']),
              headerFormat: z
                .enum(['TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT'])
                .nullable(),
              headerMediaUrl: z.string().nullable(),
              buttons: z.array(button),
              blockedReason: z.string().nullable(),
              fields: z.object({
                headerVariables: count(),
                bodyVariables: count(),
                bodyText: z.string(),
                urlButtons: z.array(count()),
              }),
            }),
          ),
        }),
      ),
      quickReplies: z.array(
        z.object({
          id: z.string(),
          shortcut: z.string(),
          title: z.string(),
          body: z.string(),
          mediaUrl: z.string().nullable(),
          buttons: z.array(button),
        }),
      ),
    }),
  }),
)

export const CrmCampaignEmailPreviewDTO = dto(
  'CrmCampaignEmailPreview',
  z.object({ subject: z.string(), html: z.string(), text: z.string() }),
)

const outcome = z.enum(['sent', 'failed']).nullable()

export const CrmCampaignTestSendResultDTO = dto(
  'CrmCampaignTestSendResult',
  z.object({ email: outcome, whatsapp: outcome, errors: z.array(z.string()) }),
)
