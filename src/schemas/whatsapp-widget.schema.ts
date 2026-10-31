import { z } from 'zod'
import {
  normalizeOrigin,
  WIDGET_MAX_ORIGINS,
  WIDGET_MESSAGE_MAX,
} from '@/src/lib/whatsapp/widget'

const originEntry = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .transform((value, ctx) => {
    const origin = normalizeOrigin(value)
    if (!origin) {
      ctx.addIssue({
        code: 'custom',
        message:
          'Informe o endereço do site com https://, por exemplo https://www.empresa.com.br',
      })
      return z.NEVER
    }
    return origin
  })

// PATCH .../whatsapp/widget
export const UpdateWhatsAppWidgetSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  allowedOrigins: z
    .array(originEntry)
    .max(WIDGET_MAX_ORIGINS, `Até ${WIDGET_MAX_ORIGINS} sites`)
    .transform((list) => Array.from(new Set(list)))
    .optional(),
  title: z.string().trim().min(1, 'Informe o título').max(60).optional(),
  welcomeMessage: z
    .string()
    .trim()
    .min(1, 'Informe a mensagem de boas-vindas')
    .max(280)
    .optional(),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use uma cor no formato #RRGGBB')
    .optional(),
  position: z.enum(['RIGHT', 'LEFT']).optional(),
  preChatEnabled: z.boolean().optional(),
  preChatAskEmail: z.boolean().optional(),
  preChatAskPhone: z.boolean().optional(),
  offlineEnabled: z.boolean().optional(),
  offlineMessage: z
    .string()
    .trim()
    .min(1, 'Informe a mensagem fora do horário')
    .max(280)
    .optional(),
  teamId: z.string().min(1).nullable().optional(),
  showPortal: z.boolean().optional(),
  showSurvey: z.boolean().optional(),
})

export type UpdateWhatsAppWidgetSettingsDTO = z.infer<
  typeof UpdateWhatsAppWidgetSettingsSchema
>

/** `?key=` of every public widget endpoint. */
export const WidgetKeyQuerySchema = z.object({
  key: z.string().trim().min(1).max(100),
})

// GET /api/widget/messages
export const WidgetMessagesQuerySchema = WidgetKeyQuerySchema.extend({
  /** Cursor: only messages created after this instant (ISO 8601). */
  after: z.iso.datetime().optional(),
})

export type WidgetMessagesQueryDTO = z.infer<typeof WidgetMessagesQuerySchema>

// POST /api/widget/messages
export const WidgetSendMessageSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, 'Escreva uma mensagem')
    .max(WIDGET_MESSAGE_MAX, `Até ${WIDGET_MESSAGE_MAX} caracteres`),
  /** Pre-chat answers, read only on the visitor's first message. */
  name: z.string().trim().min(1).max(120).optional(),
  email: z.email().max(200).optional(),
  phone: z.string().trim().min(5).max(40).optional(),
  /** Page where the chat was opened (context for the agent). */
  pageUrl: z.string().trim().max(500).optional(),
  /** Honeypot: a real visitor never fills it. */
  website: z.string().max(200).optional(),
})

export type WidgetSendMessageDTO = z.infer<typeof WidgetSendMessageSchema>

// POST /api/widget/survey
export const WidgetSurveyAnswerSchema = z.object({
  score: z.number().int().min(0).max(10),
  comment: z.string().trim().min(1).max(500).optional(),
})

export type WidgetSurveyAnswerDTO = z.infer<typeof WidgetSurveyAnswerSchema>
