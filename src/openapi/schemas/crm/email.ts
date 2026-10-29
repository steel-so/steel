import { z } from 'zod'
import { dto } from '../../common'

/**
 * DTOs de e-mail marketing do CRM (`types/crm-email-marketing.d.ts`,
 * `types/crm-email-sync.d.ts`): templates, campanhas, destinatários, listas,
 * descadastros, contas e e-mails registrados.
 */

const id = (example: string) => z.string().meta({ example })
const dateTime = () => z.iso.datetime()
const nullableDateTime = () => z.iso.datetime().nullable()

export const CrmEmailTemplateDTO = dto(
  'CrmEmailTemplate',
  z.object({
    id: id('ckw1etpl0000ab7d3k1e5xyz'),
    name: z.string().meta({ example: 'Newsletter mensal' }),
    subject: z.string().meta({ example: 'Novidades de setembro' }),
    contentHtml: z.string().meta({
      description:
        'HTML final. Com `templateId`, é renderizado a partir do layout fixo.',
    }),
    contentJson: z.string().nullable().meta({
      description: 'Estado serializado do editor de blocos (opaco à API).',
    }),
    templateId: z.string().nullable().meta({
      description: 'Layout fixo de origem (catálogo de marketing), se houver.',
    }),
    templateProps: z.record(z.string(), z.string()).nullable().meta({
      description: 'Campos preenchidos do layout fixo.',
    }),
    kind: z.enum(['LEGACY', 'BUILDER']).meta({
      description:
        '`LEGACY` = HTML livre ou layout antigo; `BUILDER` = editor visual (documento em `builderDocument`).',
    }),
    builderDocument: z.unknown().nullable().meta({
      description:
        'Documento do editor visual. Versão 1: `{ version: 1, layout, previewText, sections: [{ id, type, hidden, props }] }`, com a estrutura travada pelo modelo. Versão 2 (Steel Canvas, ADR 0026): `{ catalog: "email", version: 2, rootId, nodes }` — árvore livre de seções, colunas e blocos validada pelo catálogo de e-mail.',
    }),
    contentText: z.string().nullable().meta({
      description:
        'Texto puro da última renderização (templates `BUILDER`), com as variáveis intactas.',
    }),
    workspaceId: z.string(),
    createdById: z.string(),
    updatedById: z.string().nullable(),
    createdAt: dateTime(),
    updatedAt: dateTime(),
  }),
)

export const CrmEmailTemplatePreviewDTO = dto(
  'CrmEmailTemplatePreview',
  z.object({
    html: z.string().meta({ description: 'HTML renderizado do layout.' }),
  }),
)

export const CrmEmailCampaignDTO = dto(
  'CrmEmailCampaign',
  z.object({
    id: id('ckw1ecmp0000ab7d3k1e5xyz'),
    subject: z.string().meta({ example: 'Conheça o ServiceDesk' }),
    contentHtml: z.string(),
    contentJson: z.string().nullable(),
    fromAddress: z.string().meta({ example: 'marketing@acme.com.br' }),
    status: z.enum(['DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'FAILED']),
    recipientScope: z.enum(['ALL', 'SELECTED']).meta({
      description:
        '`ALL` = todas as pessoas com e-mail; `SELECTED` = pessoas + listas + e-mails avulsos escolhidos.',
    }),
    recipientCount: z.number().int(),
    sentCount: z.number().int(),
    failedCount: z.number().int(),
    skippedCount: z.number().int().meta({
      description:
        'Descadastrados (opt-out LGPD) entre a criação e o envio — não enviados.',
    }),
    scheduledAt: nullableDateTime(),
    sentAt: nullableDateTime(),
    templateId: z.string().nullable().meta({
      description: 'Template do editor visual de origem, se houver.',
    }),
    campaignLink: z.string().nullable().meta({
      description: 'URL rastreada que substitui `{{campaign_link}}` no envio.',
    }),
    workspaceId: z.string(),
    createdById: z.string(),
    createdAt: dateTime(),
    updatedAt: dateTime(),
  }),
)

export const CrmEmailBrandDTO = dto(
  'CrmEmailBrand',
  z.object({
    companyName: z.string().meta({ example: 'Acme Ltda.' }),
    logoUrl: z.string(),
    primaryColor: z.string().meta({ example: '#2893CC' }),
    address: z.string(),
    website: z.string(),
    saved: z.boolean().meta({
      description:
        '`false` enquanto o workspace nunca salvou uma marca (valem o nome/logo do workspace e a cor padrão).',
    }),
    updatedAt: nullableDateTime(),
  }),
)

export const CrmEmailRenderDTO = dto(
  'CrmEmailRender',
  z.object({
    subject: z.string().meta({ example: 'Olá Maria, as novidades chegaram' }),
    html: z.string(),
    text: z.string(),
  }),
)

export const CrmEmailLinkTargetsDTO = dto(
  'CrmEmailLinkTargets',
  z.object({
    landingPages: z.array(
      z.object({ id: z.string(), title: z.string(), url: z.string() }),
    ),
    forms: z.array(
      z.object({ id: z.string(), name: z.string(), url: z.string() }),
    ),
  }),
)

export const CrmEmailTestSendDTO = dto(
  'CrmEmailTestSend',
  z.object({ to: z.string().meta({ example: 'voce@acme.com.br' }) }),
)

export const CrmEmailCampaignRecipientDTO = dto(
  'CrmEmailCampaignRecipient',
  z.object({
    id: z.string(),
    campaignId: z.string(),
    personId: z.string().nullable(),
    email: z.string().meta({ example: 'carlos@empresa.com.br' }),
    name: z.string().nullable(),
    status: z.enum(['PENDING', 'SENT', 'FAILED', 'SKIPPED']).meta({
      description: '`SKIPPED` = descadastrado no momento do envio.',
    }),
    providerMessageId: z
      .string()
      .nullable()
      .meta({ description: 'ID da mensagem no provedor (Resend).' }),
    errorMessage: z.string().nullable(),
    sentAt: nullableDateTime(),
    createdAt: dateTime(),
  }),
)

export const CrmMailingListDTO = dto(
  'CrmMailingList',
  z.object({
    id: id('ckw1mlst0000ab7d3k1e5xyz'),
    name: z.string().meta({ example: 'Clientes ativos' }),
    description: z.string().nullable(),
    memberCount: z.number().int(),
    workspaceId: z.string(),
    createdById: z.string(),
    createdAt: dateTime(),
    updatedAt: dateTime(),
  }),
)

export const CrmMailingListMemberDTO = dto(
  'CrmMailingListMember',
  z.object({
    id: z.string(),
    mailingListId: z.string(),
    email: z.string().meta({ example: 'carlos@empresa.com.br' }),
    name: z.string().nullable(),
    personId: z.string().nullable(),
    createdAt: dateTime(),
  }),
)

export const CrmEmailOptOutDTO = dto(
  'CrmEmailOptOut',
  z
    .object({
      id: z.string(),
      email: z.string().meta({ example: 'carlos@empresa.com.br' }),
      personId: z.string().nullable(),
      campaignId: z
        .string()
        .nullable()
        .meta({ description: 'Campanha cujo link originou o descadastro.' }),
      source: z.enum(['LINK', 'ONE_CLICK', 'PREFERENCES']).meta({
        description:
          '`LINK` = página de descadastro; `ONE_CLICK` = RFC 8058 (botão do cliente de e-mail); `PREFERENCES` = "sair de tudo" na central de preferências da newsletter.',
      }),
      createdAt: dateTime(),
    })
    .meta({ description: 'Descadastro LGPD de campanhas.' }),
)

export const CrmEmailAccountDTO = dto(
  'CrmEmailAccount',
  z
    .object({
      id: z.string(),
      provider: z.enum(['GMAIL', 'OUTLOOK']),
      email: z.string().meta({ example: 'maria@acme.com.br' }),
      lastSyncedAt: nullableDateTime(),
      workspaceId: z.string(),
      userId: z.string().meta({ description: 'Usuário dono da conta.' }),
      createdAt: dateTime(),
      updatedAt: dateTime(),
    })
    .meta({
      description:
        'Conta de e-mail de contexto. Não há sincronização real com Gmail/Outlook: serve para agrupar e-mails e eventos registrados manualmente.',
    }),
)

export const CrmEmailMessageDTO = dto(
  'CrmEmailMessage',
  z
    .object({
      id: z.string(),
      workspaceId: z.string(),
      accountId: z.string().nullable(),
      createdById: z.string(),
      direction: z.enum(['INBOUND', 'OUTBOUND']),
      subject: z.string().nullable(),
      snippet: z.string().nullable(),
      fromEmail: z.string(),
      toEmails: z.array(z.string()),
      personId: z.string().nullable(),
      opportunityId: z.string().nullable(),
      sentAt: dateTime(),
      createdAt: dateTime(),
    })
    .meta({ description: 'E-mail registrado manualmente no CRM.' }),
)

export const CrmEmailSenderOptionsDTO = dto(
  'CrmEmailSenderOptions',
  z.object({
    platformDomain: z.string().meta({
      description:
        'Domínio de e-mail da plataforma: qualquer endereço nele é aceito sem domínio próprio verificado.',
      example: 'stratustelecom.com.br',
    }),
    verifiedDomains: z.array(z.string()).meta({
      description:
        'Domínios de envio VERIFIED do workspace, em ordem alfabética.',
      example: ['news.acme.com.br'],
    }),
  }),
)
