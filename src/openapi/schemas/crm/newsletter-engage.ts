import { z } from 'zod'
import { CRM_CAMPAIGN_LEGAL_BASES } from '@/src/schemas/crm-campaign.schema'
import { CrmNewsletterWhatsAppVariablesSchema } from '@/src/schemas/crm-newsletter-engage.schema'
import { CRM_NEWSLETTER_DELIVERY_STATUSES } from '@/src/schemas/crm-newsletter-issue.schema'
import { dto } from '../../common'

/**
 * DTOs do engajamento das edições (frente nl2-engage): enquetes (votos por
 * opção, quem votou, voto público) e a versão no WhatsApp.
 */

const nullableDateTime = () => z.iso.datetime().nullable()

const PollOption = z.object({
  index: z.number().int().meta({ example: 0 }),
  label: z.string().meta({ example: 'Novidades do produto' }),
  votes: z.number().int().meta({ example: 42 }),
})

export const CrmNewsletterIssuePollsDTO = dto(
  'CrmNewsletterIssuePollsDTO',
  z.object({
    polls: z.array(
      z.object({
        blockId: z.string().meta({
          description: 'ID do bloco "Enquete" no documento da edição.',
        }),
        question: z.string().meta({ example: 'Qual assunto você quer ver?' }),
        showResults: z.boolean().meta({
          description: 'O leitor vê o resultado parcial depois de votar.',
        }),
        totalVotes: z.number().int(),
        options: z.array(PollOption),
        voters: z.array(
          z.object({
            id: z.string(),
            name: z.string().nullable(),
            email: z.string(),
            personId: z.string().nullable().meta({
              description: 'Pessoa do CRM ligada ao assinante.',
            }),
            optionIndex: z.number().int(),
            votedAt: z.iso.datetime(),
          }),
        ),
        votersTruncated: z.boolean().meta({
          description:
            'Há mais votantes do que os 200 mais recentes listados (o CSV traz todos).',
        }),
      }),
    ),
  }),
)

export const CrmNewsletterPollVoteResultDTO = dto(
  'CrmNewsletterPollVoteResultDTO',
  z.object({
    newsletterName: z.string(),
    question: z.string(),
    chosenIndex: z.number().int(),
    chosenLabel: z.string(),
    changed: z.boolean().meta({
      description: 'O voto anterior do mesmo envio foi trocado.',
    }),
    results: z
      .object({ totalVotes: z.number().int(), options: z.array(PollOption) })
      .nullable()
      .meta({ description: 'null quando o autor ocultou o resultado.' }),
  }),
)

export const CrmNewsletterIssueWhatsAppDTO = dto(
  'CrmNewsletterIssueWhatsAppDTO',
  z.object({
    issueId: z.string(),
    enabled: z.boolean(),
    connectionId: z.string().nullable(),
    templateId: z.string().nullable(),
    variables: CrmNewsletterWhatsAppVariablesSchema.nullable(),
    text: z.string().nullable(),
    legalBasis: z.enum(CRM_CAMPAIGN_LEGAL_BASES).nullable(),
    consentConfirmedAt: nullableDateTime(),
    startedAt: nullableDateTime(),
    available: z.boolean().meta({
      description: 'false quando o módulo Comunicação está desligado.',
    }),
    unavailableReason: z.string().nullable(),
    problems: z.array(z.string()).meta({
      description: 'O que ainda impede o envio no WhatsApp (pt-BR).',
    }),
    reach: z
      .object({
        linked: z.number().int(),
        reachable: z.number().int(),
        missingPhone: z.number().int(),
        optedOut: z.number().int(),
      })
      .nullable()
      .meta({ description: 'Alcance de hoje (só em rascunho/agendada).' }),
  }),
)

export const CrmNewsletterWhatsAppReportDTO = dto(
  'CrmNewsletterWhatsAppReportDTO',
  z.object({
    enabled: z.boolean(),
    provider: z.enum(['META', 'ZAPI']).nullable(),
    stats: z.object({
      total: z.number().int(),
      pending: z.number().int(),
      sent: z.number().int(),
      failed: z.number().int(),
      skipped: z.number().int(),
    }),
    items: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        phone: z.string().meta({ example: '+5511999990000' }),
        personId: z.string().nullable(),
        status: z.enum(CRM_NEWSLETTER_DELIVERY_STATUSES),
        skipReason: z.string().nullable().meta({
          description: 'OPTED_OUT, LIMIT_REACHED, UNAVAILABLE ou STOPPED.',
        }),
        error: z.string().nullable(),
        sentAt: nullableDateTime(),
      }),
    ),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  }),
)
