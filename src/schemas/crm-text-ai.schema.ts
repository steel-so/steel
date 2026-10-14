import z from 'zod'

/**
 * Mini chat de IA de um campo de texto do CRM: o usuário conversa sobre o
 * texto daquela caixa e a IA devolve uma resposta curta e, quando cabe, uma
 * sugestão pronta para aplicar no campo. Serve o construtor de landing
 * pages, os documentos (propostas e modelos) e os estúdios de redes
 * sociais — `surface` decide a permissão exigida e o tom do redator. Sem
 * estado no servidor: o histórico curto vem do cliente a cada rodada.
 */

export const CRM_TEXT_AI_MAX_TURNS = 12

export const CrmTextAiSurfaceEnum = z.enum([
  'LANDING_PAGE',
  'DOCUMENT',
  'SOCIAL',
])
export type CrmTextAiSurface = z.infer<typeof CrmTextAiSurfaceEnum>

const TurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(6000),
})

export const CrmTextAiAssistSchema = z.object({
  surface: CrmTextAiSurfaceEnum,
  /** Texto atual do campo (pode estar vazio — a IA escreve do zero). */
  text: z.string().max(6000).default(''),
  /** Histórico do mini chat, terminando na mensagem nova do usuário. */
  messages: z
    .array(TurnSchema)
    .min(1, 'Envie uma mensagem')
    .max(CRM_TEXT_AI_MAX_TURNS)
    .refine((turns) => turns[turns.length - 1]?.role === 'user', {
      message: 'A última mensagem deve ser do usuário',
    }),
  field: z
    .object({
      /** Rótulo do campo ("Título principal", "Legenda", "Condições de pagamento"). */
      label: z.string().trim().max(120).optional(),
      multiline: z.boolean().default(false),
      maxLength: z.number().int().positive().max(6000).optional(),
    })
    .default({ multiline: false }),
  context: z
    .object({
      /** Título da página, nome da proposta ou do vídeo. */
      title: z.string().trim().max(200).optional(),
      /** Bloco onde o campo está ("Destaque", "Condições comerciais"). */
      section: z.string().trim().max(80).optional(),
      /** Rede social do post ("Instagram · Reels"). */
      platform: z.string().trim().max(60).optional(),
    })
    .default({}),
})

export type CrmTextAiAssistDTO = z.infer<typeof CrmTextAiAssistSchema>
export type CrmTextAiAssistInput = z.input<typeof CrmTextAiAssistSchema>

/** Saída estruturada pedida ao provedor. `suggestion` vazio = só conversa. */
export const CrmTextAiOutputSchema = z.object({
  reply: z.string(),
  suggestion: z.string(),
})

export const CRM_TEXT_AI_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'suggestion'],
  properties: {
    reply: { type: 'string' },
    suggestion: { type: 'string' },
  },
}
