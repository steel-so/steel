import { z } from 'zod'
import {
  CRM_NEWSLETTER_DELAY_UNITS,
  CRM_NEWSLETTER_REENGAGEMENT_ACTIONS,
} from '@/src/schemas/crm-newsletter-automation.schema'
import { dto } from '../../common'

/**
 * DTOs da automação da newsletter (newsletter2, frente nl2-automation):
 * série de boas-vindas e reengajamento de inativos.
 */

export const CrmNewsletterWelcomeStepDTO = dto(
  'CrmNewsletterWelcomeStepDTO',
  z.object({
    id: z.string().meta({ example: 'ckw1step000ab7d3k1e5xyz' }),
    newsletterId: z.string(),
    position: z.number().int().meta({ example: 0 }),
    delayValue: z.number().int().meta({
      example: 2,
      description: 'Atraso depois da confirmação do assinante.',
    }),
    delayUnit: z.enum(CRM_NEWSLETTER_DELAY_UNITS),
    subject: z.string().meta({ example: 'Boas-vindas à nossa newsletter' }),
    preheader: z.string().nullable(),
    enabled: z.boolean(),
    stats: z.object({
      sent: z.number().int().meta({ example: 320 }),
      opened: z.number().int().meta({ example: 180 }),
      clicked: z.number().int().meta({ example: 42 }),
    }),
    builderDocument: z.unknown().optional().meta({
      description:
        'Documento Steel Canvas de e-mail. Só no detalhe (`GET .../welcome-steps/{stepId}`) e nas escritas.',
    }),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  }),
)

export const CrmNewsletterReengagementPreviewDTO = dto(
  'CrmNewsletterReengagementPreviewDTO',
  z.object({
    candidates: z.number().int().meta({
      example: 37,
      description:
        'Receberiam o e-mail de reengajamento se a rodada fosse agora.',
    }),
    waiting: z.number().int().meta({
      description: 'Já receberam e ainda estão dentro do prazo de resposta.',
    }),
    dueNow: z.number().int().meta({
      description:
        'Prazo vencido sem interação: a próxima rodada diária descadastra (ou marca).',
    }),
  }),
)

export const CrmNewsletterReengagementDTO = dto(
  'CrmNewsletterReengagementDTO',
  z.object({
    newsletterId: z.string(),
    saved: z.boolean().meta({
      description: 'Falso enquanto a seção nunca foi salva (valores padrão).',
    }),
    enabled: z.boolean(),
    minIssues: z.number().int().meta({ example: 3 }),
    inactiveDays: z.number().int().meta({ example: 90 }),
    graceDays: z.number().int().meta({ example: 30 }),
    action: z.enum(CRM_NEWSLETTER_REENGAGEMENT_ACTIONS),
    subject: z.string(),
    heading: z.string(),
    body: z.string(),
    buttonLabel: z.string().meta({ example: 'Quero continuar recebendo' }),
    updatedAt: z.iso.datetime().nullable(),
    preview: CrmNewsletterReengagementPreviewDTO,
    totals: z.object({
      sent: z.number().int(),
      reengaged: z.number().int(),
      unsubscribed: z.number().int(),
      flagged: z.number().int(),
    }),
  }),
)

export const NewsletterReengagePreviewDTO = dto(
  'NewsletterReengagePreviewDTO',
  z.object({
    email: z.string().meta({ example: 'ana@empresa.com.br' }),
    newsletterName: z.string(),
    publisherName: z.string(),
    alreadyConfirmed: z.boolean(),
  }),
)

export const NewsletterReengageResultDTO = dto(
  'NewsletterReengageResultDTO',
  z.object({
    newsletterName: z.string(),
    resubscribed: z.boolean().meta({
      description:
        'O assinante tinha sido descadastrado por inatividade e voltou.',
    }),
  }),
)
