import type {
  CrmCampaignDetailDTO,
  CrmCampaignOptionsDTO,
  CrmCampaignStatsDTO,
} from '@/types/crm-campaign'

export const WS = 'ws_1'
export const SLUG = 'acme'

export function campaign(
  overrides?: Partial<CrmCampaignDetailDTO>,
): CrmCampaignDetailDTO {
  return {
    id: 'c1',
    workspaceId: WS,
    name: 'Black Friday',
    slug: 'black-friday',
    status: 'DRAFT',
    destinationType: 'FORM',
    landingPageId: null,
    formId: 'f1',
    siteId: null,
    sitePageId: null,
    utmMedium: 'campanha',
    emailFrom: 'mkt@acme.com',
    emailSubject: 'Oferta',
    emailPreheader: null,
    emailTemplateId: 't1',
    emailLegalBasis: 'CONSENT',
    audience: { mailingListIds: [], allPeople: true, leadStages: [] },
    whatsappEnabled: false,
    whatsappConnectionId: null,
    whatsappTemplateId: null,
    whatsappVariables: null,
    whatsappText: null,
    whatsappMediaUrl: null,
    whatsappQuickReplyId: null,
    whatsappDelayHours: 0,
    whatsappLegalBasis: null,
    scheduledAt: null,
    sendWindowStartHour: null,
    sendWindowEndHour: null,
    sendWeekdaysOnly: false,
    consentConfirmedAt: null,
    launchedAt: null,
    startAt: null,
    completedAt: null,
    createdById: 'u1',
    createdAt: '2026-10-09T12:00:00.000Z',
    updatedAt: '2026-10-09T12:00:00.000Z',
    links: {
      destination: 'https://app.test/f/ftok',
      email:
        'https://app.test/f/ftok?utm_source=email&utm_medium=campanha&utm_campaign=black-friday',
      whatsapp:
        'https://app.test/f/ftok?utm_source=whatsapp&utm_medium=campanha&utm_campaign=black-friday',
    },
    destination: {
      type: 'FORM',
      name: 'Inscrição',
      pageTitle: null,
      url: 'https://app.test/f/ftok',
      published: true,
    },
    issues: [],
    emailChecklist: [],
    ...overrides,
  }
}

export function options(
  overrides?: Partial<CrmCampaignOptionsDTO>,
): CrmCampaignOptionsDTO {
  return {
    baseUrl: 'https://app.test',
    sites: [
      {
        id: 's1',
        name: 'Clínica Sorriso',
        slug: 'clinica',
        url: 'https://app.test/s/clinica',
        published: true,
        updatedAt: '2026-10-14T12:00:00.000Z',
        pages: [
          {
            id: 'home',
            title: 'Início',
            path: '',
            url: 'https://app.test/s/clinica',
            isHome: true,
          },
          {
            id: 'contato',
            title: 'Contato',
            path: 'contato',
            url: 'https://app.test/s/clinica/contato',
            isHome: false,
          },
        ],
      },
      {
        id: 's2',
        name: 'Loja nova',
        slug: 'loja',
        url: 'https://app.test/s/loja',
        published: false,
        updatedAt: '2026-10-14T12:00:00.000Z',
        pages: [],
      },
    ],
    landingPages: [
      { id: 'l1', title: 'Página BF', published: true, shareToken: 'ltok' },
    ],
    forms: [
      {
        id: 'f1',
        name: 'Inscrição',
        published: true,
        publicToken: 'ftok',
        url: 'https://app.test/f/ftok',
        embeds: [
          {
            siteId: 's1',
            siteName: 'Clínica Sorriso',
            pageId: 'contato',
            pageTitle: 'Contato',
            url: 'https://app.test/s/clinica/contato',
          },
        ],
      },
      {
        id: 'f2',
        name: 'Rascunho',
        published: false,
        publicToken: 'f2tok',
        url: 'https://app.test/f/f2tok',
        embeds: [],
      },
    ],
    emailTemplates: [
      {
        id: 't1',
        name: 'Oferta',
        subject: 'Oi',
        editor: 'v2',
        updatedAt: '2026-10-14T12:00:00.000Z',
      },
      {
        id: 't2',
        name: 'Newsletter antiga',
        subject: 'Oi',
        editor: 'html',
        updatedAt: '2026-10-14T12:00:00.000Z',
      },
    ],
    mailingLists: [{ id: 'ml1', name: 'Clientes VIP' }],
    whatsapp: {
      available: true,
      reason: null,
      connections: [
        {
          id: 'zapi',
          label: 'Comercial',
          provider: 'ZAPI',
          phoneNumber: '5511999990000',
          templates: [],
        },
        {
          id: 'meta',
          label: 'Oficial',
          provider: 'META',
          phoneNumber: '5511999990001',
          templates: [
            {
              id: 'wt1',
              name: 'promo_bf',
              language: 'pt_BR',
              category: 'MARKETING',
              status: 'APPROVED',
              quality: 'GREEN',
              headerFormat: 'IMAGE',
              headerMediaUrl: 'https://cdn.test/bf.png',
              buttons: [
                {
                  type: 'URL',
                  label: 'Ver oferta',
                  url: 'https://app.test/api/crm/campaigns/c/{{1}}',
                  dynamic: true,
                  actionCount: 0,
                },
                {
                  type: 'REPLY',
                  label: 'Falar com vendas',
                  url: null,
                  dynamic: false,
                  actionCount: 2,
                },
              ],
              blockedReason: null,
              fields: {
                headerVariables: 0,
                bodyVariables: 2,
                bodyText: 'Oi {{1}}, confira: {{2}}',
                urlButtons: [0],
              },
            },
            {
              id: 'wt-red',
              name: 'promo_velha',
              language: 'pt_BR',
              category: 'MARKETING',
              status: 'APPROVED',
              quality: 'RED',
              headerFormat: null,
              headerMediaUrl: null,
              buttons: [],
              blockedReason:
                'Qualidade baixa (vermelha) na Meta: use outro template.',
              fields: {
                headerVariables: 0,
                bodyVariables: 0,
                bodyText: 'Oi',
                urlButtons: [],
              },
            },
          ],
        },
      ],
      quickReplies: [
        {
          id: 'qr1',
          shortcut: 'promo',
          title: 'Promo da semana',
          body: 'Oi {nome}, olha a promo!',
          mediaUrl: null,
          buttons: [
            {
              type: 'REPLY',
              label: 'Quero',
              url: null,
              dynamic: false,
              actionCount: 1,
            },
            {
              type: 'URL',
              label: 'Ver',
              url: 'https://x.test/{link}',
              dynamic: true,
              actionCount: 0,
            },
          ],
        },
      ],
    },
    ...overrides,
  }
}

export function stats(
  overrides?: Partial<CrmCampaignStatsDTO>,
): CrmCampaignStatsDTO {
  return {
    recipients: 10,
    email: {
      eligible: 10,
      pending: 0,
      sent: 10,
      delivered: 9,
      opened: 5,
      clicked: 2,
      failed: 0,
      skipped: 0,
      bounced: 1,
      unsubscribed: 1,
    },
    whatsapp: {
      eligible: 4,
      pending: 0,
      sent: 4,
      delivered: 4,
      read: 3,
      clicked: 1,
      replied: 2,
      failed: 0,
      skipped: 0,
    },
    conversions: {
      total: 3,
      visits: 0,
      submissions: 3,
      byChannel: { email: 2, whatsapp: 1, unknown: 0 },
      byDestination: { siteView: 5, siteForm: 2, crmForm: 1, landingView: 0 },
    },
    convertedContacts: [
      {
        id: 'cv1',
        kind: 'FORM_SUBMISSION',
        channel: 'EMAIL',
        recipientId: 'r1',
        name: 'Ana Souza',
        leadId: 'lead1',
        personId: null,
        createdAt: '2026-10-09T15:00:00.000Z',
      },
    ],
    ...overrides,
  }
}
