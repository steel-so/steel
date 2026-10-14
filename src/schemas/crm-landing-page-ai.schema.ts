import z from 'zod'

/**
 * Mini chat de IA de um campo de texto do construtor de landing pages: o
 * usuário conversa sobre o texto daquela caixa e a IA devolve uma resposta
 * curta e, quando cabe, uma sugestão pronta para aplicar no campo. Sem
 * estado no servidor — o histórico curto vem do cliente a cada rodada.
 */

export const CRM_LANDING_PAGE_AI_MAX_TURNS = 12

const TurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(4000),
})

export const CrmLandingPageAiAssistSchema = z.object({
  /** Texto atual do campo (pode estar vazio — a IA escreve do zero). */
  text: z.string().max(4000).default(''),
  /** Histórico do mini chat, terminando na mensagem nova do usuário. */
  messages: z
    .array(TurnSchema)
    .min(1, 'Envie uma mensagem')
    .max(CRM_LANDING_PAGE_AI_MAX_TURNS)
    .refine((turns) => turns[turns.length - 1]?.role === 'user', {
      message: 'A última mensagem deve ser do usuário',
    }),
  field: z
    .object({
      /** Rótulo/placeholder do campo ("Título principal", "Texto do botão"). */
      label: z.string().trim().max(120).optional(),
      multiline: z.boolean().default(false),
      maxLength: z.number().int().positive().max(4000).optional(),
    })
    .default({ multiline: false }),
  page: z
    .object({
      title: z.string().trim().max(200).optional(),
      section: z.string().trim().max(80).optional(),
    })
    .default({}),
})

export type CrmLandingPageAiAssistDTO = z.infer<
  typeof CrmLandingPageAiAssistSchema
>
export type CrmLandingPageAiAssistInput = z.input<
  typeof CrmLandingPageAiAssistSchema
>

/** Saída estruturada pedida ao provedor. `suggestion` vazio = só conversa. */
export const CrmLandingPageAiOutputSchema = z.object({
  reply: z.string(),
  suggestion: z.string(),
})

export const CRM_LANDING_PAGE_AI_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'suggestion'],
  properties: {
    reply: { type: 'string' },
    suggestion: { type: 'string' },
  },
}
