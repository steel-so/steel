import { z } from 'zod'
import { WhatsAppButtonsSchema } from './whatsapp-button.schema'

export const WHATSAPP_TEMPLATE_CATEGORIES = [
  'UTILITY',
  'MARKETING',
  'AUTHENTICATION',
] as const
export type WhatsAppTemplateCategory =
  (typeof WHATSAPP_TEMPLATE_CATEGORIES)[number]

// Meta exige nome em snake_case (minúsculas, números e "_").
const NAME_PATTERN = /^[a-z0-9_]+$/

export const WHATSAPP_TEMPLATE_HEADER_FORMATS = [
  'TEXT',
  'IMAGE',
  'VIDEO',
  'DOCUMENT',
] as const
export type WhatsAppTemplateHeaderFormat =
  (typeof WHATSAPP_TEMPLATE_HEADER_FORMATS)[number]

export const CreateWhatsAppTemplateSchema = z
  .object({
    connectionId: z.string().min(1),
    name: z
      .string()
      .trim()
      .min(1)
      .max(512)
      .regex(NAME_PATTERN, 'Use apenas letras minúsculas, números e "_"'),
    language: z.string().trim().min(1).max(10),
    category: z.enum(WHATSAPP_TEMPLATE_CATEGORIES),
    // Cabeçalho: texto (`headerText`) ou mídia (`headerMediaUrl`, enviada antes
    // pelo POST /whatsapp/media/upload — IMAGE jpg/png, VIDEO mp4, DOCUMENT pdf).
    headerFormat: z.enum(WHATSAPP_TEMPLATE_HEADER_FORMATS).optional(),
    headerText: z.string().trim().max(60).optional(),
    headerMediaUrl: z.url().max(2048).optional(),
    body: z.string().trim().min(1).max(1024),
    // Meta exige um valor de exemplo por variável {{n}} do corpo — sem isso a
    // submissão é rejeitada com INVALID_FORMAT. Índice do array = posição da
    // variável (bodyExample[0] preenche {{1}}, etc.).
    bodyExample: z.array(z.string().trim().min(1)).max(10).optional(),
    footer: z.string().trim().max(60).optional(),
    buttons: WhatsAppButtonsSchema.optional(),
  })
  .superRefine((value, ctx) => {
    const format = value.headerFormat ?? (value.headerText ? 'TEXT' : undefined)
    if (format === 'TEXT' && !value.headerText) {
      ctx.addIssue({
        code: 'custom',
        path: ['headerText'],
        message: 'Informe o texto do cabeçalho',
      })
    }
    if (format && format !== 'TEXT' && !value.headerMediaUrl) {
      ctx.addIssue({
        code: 'custom',
        path: ['headerMediaUrl'],
        message: 'Envie a mídia do cabeçalho',
      })
    }
  })

export type CreateWhatsAppTemplateInput = z.infer<
  typeof CreateWhatsAppTemplateSchema
>
