import { z } from 'zod'
import {
  CRM_NEWSLETTER_DELIVERY_STATUSES,
  CRM_NEWSLETTER_ISSUE_STATUSES,
} from '@/src/schemas/crm-newsletter-issue.schema'
import { dto } from '../../common'
import { CrmNewsletterAbTestDTO } from './newsletter2-digest-ai'

/**
 * DTOs das edições da newsletter do CRM (ADR 0054, frente nl-issues):
 * edição, funil, cliques por link, destinatários, conferência antes do
 * envio, evolução das últimas edições e o uso mensal.
 */

const nullableDateTime = () => z.iso.datetime().nullable()

export const CrmNewsletterIssueStatsDTO = dto(
  'CrmNewsletterIssueStatsDTO',
  z.object({
    recipients: z.number().int().meta({ example: 1200 }),
    sent: z.number().int().meta({ example: 1180 }),
    skipped: z.number().int().meta({ example: 20 }),
    failed: z.number().int().meta({ example: 0 }),
    delivered: z.number().int().meta({ example: 1170 }),
    opened: z.number().int().meta({
      example: 540,
      description:
        'Aberturas únicas. O Apple Mail (proteção de privacidade) infla este número.',
    }),
    clicked: z.number().int().meta({ example: 96 }),
    bounced: z.number().int().meta({ example: 10 }),
    complained: z.number().int().meta({ example: 1 }),
    unsubscribed: z.number().int().meta({ example: 4 }),
  }),
)

export const CrmNewsletterIssueDTO = dto(
  'CrmNewsletterIssueDTO',
  z.object({
    id: z.string().meta({ example: 'ckw1issue000ab7d3k1e5xyz' }),
    newsletterId: z.string(),
    number: z.number().int().nullable().meta({
      example: 12,
      description: 'Atribuído quando o envio começa (máximo + 1).',
    }),
    subject: z.string().meta({ example: 'Novidades de outubro' }),
    preheader: z.string().nullable(),
    slug: z.string().meta({ example: 'novidades-de-outubro' }),
    status: z.enum(CRM_NEWSLETTER_ISSUE_STATUSES),
    scheduledAt: nullableDateTime(),
    sendingStartedAt: nullableDateTime(),
    sentAt: nullableDateTime(),
    canceledAt: nullableDateTime(),
    failureReason: z.string().nullable(),
    builderDocument: z.unknown().optional().meta({
      description:
        'Documento Steel Canvas de e-mail. Só no detalhe (`GET .../issues/{issueId}`).',
    }),
    stats: CrmNewsletterIssueStatsDTO.nullable(),
    webUrl: z.string().nullable().meta({
      description:
        'Versão web pública (null antes do envio ou com o arquivo desligado).',
    }),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    abTest: CrmNewsletterAbTestDTO.nullable().optional().meta({
      description: 'Teste A/B de assunto (null = sem teste).',
    }),
    digestId: z.string().nullable().optional().meta({
      description: 'Resumo automático que criou a edição.',
    }),
  }),
)

export const CrmNewsletterIssuePageDTO = dto(
  'CrmNewsletterIssuePageDTO',
  z.object({
    items: z.array(CrmNewsletterIssueDTO),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  }),
)

export const CrmNewsletterIssueReportDTO = dto(
  'CrmNewsletterIssueReportDTO',
  z.object({
    stats: CrmNewsletterIssueStatsDTO,
    links: z.array(
      z.object({
        url: z.string().meta({ example: 'https://acme.com.br/blog/novidade' }),
        clicks: z.number().int(),
        uniqueClickers: z.number().int(),
      }),
    ),
  }),
)

export const CrmNewsletterIssueRecipientPageDTO = dto(
  'CrmNewsletterIssueRecipientPageDTO',
  z.object({
    items: z.array(
      z.object({
        id: z.string(),
        email: z.string(),
        name: z.string().nullable(),
        status: z.enum(CRM_NEWSLETTER_DELIVERY_STATUSES),
        skipReason: z.string().nullable(),
        error: z.string().nullable(),
        sentAt: nullableDateTime(),
        deliveredAt: nullableDateTime(),
        openedAt: nullableDateTime(),
        clickedAt: nullableDateTime(),
        bouncedAt: nullableDateTime(),
        complainedAt: nullableDateTime(),
        unsubscribedAt: nullableDateTime(),
      }),
    ),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  }),
)

export const CrmNewsletterUsageDTO = dto(
  'CrmNewsletterUsageDTO',
  z.object({
    month: z.string().meta({
      example: '2026-10',
      description: 'Mês no fuso America/Sao_Paulo.',
    }),
    emailsSent: z.number().int().meta({ example: 1180 }),
    limit: z.number().int().nullable().meta({
      example: 3000,
      description: 'null = ilimitado.',
    }),
    limitSource: z.enum(['PLAN', 'OVERRIDE']),
  }),
)

export const CrmNewsletterIssuePreflightDTO = dto(
  'CrmNewsletterIssuePreflightDTO',
  z.object({
    audience: z.number().int().meta({
      example: 1200,
      description: 'Assinantes ACTIVE fora do descadastro geral.',
    }),
    usage: CrmNewsletterUsageDTO,
    remaining: z.number().int().nullable(),
    senderVerified: z.boolean(),
    checklist: z.array(
      z.object({
        code: z.string().meta({ example: 'PREHEADER_EMPTY' }),
        level: z.enum(['error', 'warning']),
        message: z.string(),
      }),
    ),
    blockers: z.array(
      z.object({
        code: z.enum([
          'NEWSLETTER_ARCHIVED',
          'SENDER_NOT_VERIFIED',
          'CONTENT_INVALID',
          'NO_SUBSCRIBERS',
          'LIMIT_REACHED',
          'AB_AUDIENCE_TOO_SMALL',
        ]),
        message: z.string(),
      }),
    ),
  }),
)

export const CrmNewsletterIssueTrendDTO = dto(
  'CrmNewsletterIssueTrendDTO',
  z.object({
    issues: z.array(
      z.object({
        id: z.string(),
        number: z.number().int().nullable(),
        subject: z.string(),
        sentAt: nullableDateTime(),
        recipients: z.number().int(),
        openRate: z.number().nullable().meta({ example: 0.4576 }),
        clickRate: z.number().nullable().meta({ example: 0.0813 }),
      }),
    ),
  }),
)
