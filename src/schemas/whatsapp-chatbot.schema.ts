import { z } from 'zod'

/**
 * Chatbot flow contract (Z2). A flow is a graph in the same shape React Flow
 * uses (`nodes` + `edges`), so the editor stores it as is. Every edge leaves
 * a node through a named handle: `next` for single-exit nodes, the option id
 * for a menu, the branch id for a condition, plus the special `else`,
 * `invalid` and `error` handles documented per node.
 */

export const CHATBOT_NODE_TYPES = [
  'start',
  'message',
  'menu',
  'question',
  'condition',
  'set-variable',
  'webhook',
  'send-form',
  'handoff-human',
  'handoff-ai',
  'end',
] as const
export type ChatbotNodeType = (typeof CHATBOT_NODE_TYPES)[number]

export const CHATBOT_TRIGGERS = [
  'NEW_CONVERSATION',
  'KEYWORD',
  'OUTSIDE_BUSINESS_HOURS',
] as const
export type ChatbotTrigger = (typeof CHATBOT_TRIGGERS)[number]

export const CHATBOT_STATUSES = ['DRAFT', 'ACTIVE', 'PAUSED'] as const
export type ChatbotStatus = (typeof CHATBOT_STATUSES)[number]

export const CHATBOT_QUESTION_VALIDATIONS = [
  'TEXT',
  'NUMBER',
  'EMAIL',
  'PHONE',
  'CPF',
  'CNPJ',
  'DATE',
] as const
export type ChatbotQuestionValidation =
  (typeof CHATBOT_QUESTION_VALIDATIONS)[number]

export const CHATBOT_CONDITION_OPERATORS = [
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'greater_than',
  'less_than',
  'is_empty',
  'is_not_empty',
] as const
export type ChatbotConditionOperator =
  (typeof CHATBOT_CONDITION_OPERATORS)[number]

/** Limits shared by the schema, the editor and the engine. */
export const CHATBOT_LIMITS = {
  nodes: 100,
  edges: 300,
  text: 1024,
  menuOptions: { min: 2, max: 10 },
  menuButtonsMax: 3,
  menuButtonLabelMax: 20,
  conditionBranches: { min: 1, max: 8 },
  keywords: 20,
  attempts: { min: 1, max: 5 },
} as const

/** Names of the variables the engine fills itself. */
export const CHATBOT_RESERVED_VARIABLES = [
  'contact_name',
  'contact_phone',
  'last_message',
] as const

const VariableNameSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9_]{0,31}$/,
    'Use letras minúsculas, números e _ (começando por letra)',
  )
  .refine(
    (name) => !(CHATBOT_RESERVED_VARIABLES as readonly string[]).includes(name),
    'Este nome de variável é reservado',
  )

/** Variable read by a condition: any name, reserved ones included. */
const VariableRefSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,31}$/, 'Nome de variável inválido')

const MessageTextSchema = z
  .string()
  .trim()
  .min(1, 'Escreva a mensagem')
  .max(CHATBOT_LIMITS.text)

const OptionalTextSchema = z.string().trim().max(CHATBOT_LIMITS.text).optional()

const HandleIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,40}$/, 'Identificador inválido')

const PositionSchema = z.object({ x: z.number(), y: z.number() })

const nodeBase = { id: HandleIdSchema, position: PositionSchema }

export const ChatbotMenuOptionSchema = z.object({
  id: HandleIdSchema,
  label: z.string().trim().min(1, 'Escreva o texto da opção').max(60),
})

export const ChatbotConditionBranchSchema = z.object({
  id: HandleIdSchema,
  variable: VariableRefSchema,
  operator: z.enum(CHATBOT_CONDITION_OPERATORS),
  value: z.string().max(256).default(''),
})

export const ChatbotNodeSchema = z.discriminatedUnion('type', [
  z.object({
    ...nodeBase,
    type: z.literal('start'),
    data: z.object({}).default({}),
  }),
  z.object({
    ...nodeBase,
    type: z.literal('message'),
    data: z.object({ text: MessageTextSchema }),
  }),
  z.object({
    ...nodeBase,
    type: z.literal('menu'),
    data: z.object({
      text: MessageTextSchema,
      options: z
        .array(ChatbotMenuOptionSchema)
        .min(CHATBOT_LIMITS.menuOptions.min)
        .max(CHATBOT_LIMITS.menuOptions.max),
      /** Variable that receives the label of the chosen option. */
      variable: VariableNameSchema.optional(),
      maxAttempts: z
        .number()
        .int()
        .min(CHATBOT_LIMITS.attempts.min)
        .max(CHATBOT_LIMITS.attempts.max)
        .default(2),
    }),
  }),
  z.object({
    ...nodeBase,
    type: z.literal('question'),
    data: z.object({
      text: MessageTextSchema,
      variable: VariableNameSchema,
      validation: z.enum(CHATBOT_QUESTION_VALIDATIONS).default('TEXT'),
      errorText: OptionalTextSchema,
      maxAttempts: z
        .number()
        .int()
        .min(CHATBOT_LIMITS.attempts.min)
        .max(CHATBOT_LIMITS.attempts.max)
        .default(2),
    }),
  }),
  z.object({
    ...nodeBase,
    type: z.literal('condition'),
    data: z.object({
      branches: z
        .array(ChatbotConditionBranchSchema)
        .min(CHATBOT_LIMITS.conditionBranches.min)
        .max(CHATBOT_LIMITS.conditionBranches.max),
    }),
  }),
  z.object({
    ...nodeBase,
    type: z.literal('set-variable'),
    data: z.object({
      variable: VariableNameSchema,
      value: z.string().max(512),
    }),
  }),
  z.object({
    ...nodeBase,
    type: z.literal('webhook'),
    data: z.object({
      url: z.url({ protocol: /^https$/ }).max(2048),
      method: z.enum(['GET', 'POST']).default('POST'),
      /** JSON template; `{{variable}}` is replaced inside string values. */
      body: z.string().max(4096).optional(),
      /** Variable that receives the value found at `responsePath`. */
      responseVariable: VariableNameSchema.optional(),
      /** Dot path in the JSON answer, e.g. `data.protocol`. */
      responsePath: z.string().max(128).optional(),
    }),
  }),
  z.object({
    ...nodeBase,
    type: z.literal('send-form'),
    data: z.object({
      /**
       * Id of the WhatsApp Flow (Z3) the contact receives. Empty while the
       * block is a draft; publishing requires it (see `validateChatbotFlow`).
       */
      flowId: z.string().trim().max(40),
      /** Replaces the message of the Flow; `{{variable}}` is replaced. */
      bodyText: OptionalTextSchema,
      /** Replaces the label of the button that opens the Flow. */
      ctaLabel: z.string().trim().max(30).optional(),
      /** Sent instead when the form cannot be delivered (Z-API, retired). */
      fallbackText: OptionalTextSchema,
    }),
  }),
  z.object({
    ...nodeBase,
    type: z.literal('handoff-human'),
    data: z.object({
      text: OptionalTextSchema,
      teamId: z.string().max(40).optional(),
      userId: z.string().max(40).optional(),
    }),
  }),
  z.object({
    ...nodeBase,
    type: z.literal('handoff-ai'),
    data: z.object({
      text: OptionalTextSchema,
      /** Extra instruction for the AI's first answer. */
      instruction: z.string().trim().max(1000).optional(),
    }),
  }),
  z.object({
    ...nodeBase,
    type: z.literal('end'),
    data: z.object({
      text: OptionalTextSchema,
      closeConversation: z.boolean().default(false),
    }),
  }),
])
export type ChatbotNode = z.infer<typeof ChatbotNodeSchema>
export type ChatbotNodeOf<T extends ChatbotNodeType> = Extract<
  ChatbotNode,
  { type: T }
>

export const ChatbotEdgeSchema = z.object({
  id: z.string().min(1).max(120),
  source: HandleIdSchema,
  sourceHandle: z.string().min(1).max(60).default('next'),
  target: HandleIdSchema,
})
export type ChatbotEdge = z.infer<typeof ChatbotEdgeSchema>

export const ChatbotFlowSchema = z.object({
  nodes: z.array(ChatbotNodeSchema).max(CHATBOT_LIMITS.nodes),
  edges: z.array(ChatbotEdgeSchema).max(CHATBOT_LIMITS.edges),
})
export type ChatbotFlow = z.infer<typeof ChatbotFlowSchema>

const KeywordsSchema = z
  .array(z.string().trim().min(1).max(60))
  .max(CHATBOT_LIMITS.keywords)

const BotNameSchema = z.string().trim().min(1, 'Dê um nome ao bot').max(80)

export const CreateWhatsAppChatbotSchema = z.object({
  name: BotNameSchema,
  description: z.string().trim().max(300).optional(),
  triggerKind: z.enum(CHATBOT_TRIGGERS).default('NEW_CONVERSATION'),
  keywords: KeywordsSchema.default([]),
  connectionId: z.string().max(40).nullable().optional(),
  sessionTtlMinutes: z.number().int().min(5).max(10080).default(720),
  /** Starts from a template (`blank` when omitted). */
  template: z.enum(['blank', 'menu', 'lead-capture']).default('blank'),
})
export type CreateWhatsAppChatbotDTO = z.infer<
  typeof CreateWhatsAppChatbotSchema
>

export const UpdateWhatsAppChatbotSchema = z.object({
  name: BotNameSchema.optional(),
  description: z.string().trim().max(300).nullable().optional(),
  triggerKind: z.enum(CHATBOT_TRIGGERS).optional(),
  keywords: KeywordsSchema.optional(),
  connectionId: z.string().max(40).nullable().optional(),
  sessionTtlMinutes: z.number().int().min(5).max(10080).optional(),
  /** Replaces the draft of the flow. */
  flow: ChatbotFlowSchema.optional(),
})
export type UpdateWhatsAppChatbotDTO = z.infer<
  typeof UpdateWhatsAppChatbotSchema
>

export const SetWhatsAppChatbotStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'PAUSED', 'DRAFT']),
})
export type SetWhatsAppChatbotStatusDTO = z.infer<
  typeof SetWhatsAppChatbotStatusSchema
>

/** Dry run of the draft: no message is sent and no webhook is called. */
export const SimulateWhatsAppChatbotSchema = z.object({
  /** Engine state returned by the previous step; omitted on the first one. */
  state: z.unknown().optional(),
  /** What the "contact" typed (or the id of the button they tapped). */
  input: z.string().max(2000).optional(),
  contactName: z.string().max(120).optional(),
  contactPhone: z.string().max(40).optional(),
})
export type SimulateWhatsAppChatbotDTO = z.infer<
  typeof SimulateWhatsAppChatbotSchema
>

export const ListWhatsAppChatbotSessionsSchema = z.object({
  status: z
    .enum([
      'RUNNING',
      'HANDED_OFF_HUMAN',
      'HANDED_OFF_AI',
      'COMPLETED',
      'EXPIRED',
      'CANCELLED',
      'FAILED',
    ])
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
})
export type ListWhatsAppChatbotSessionsDTO = z.infer<
  typeof ListWhatsAppChatbotSessionsSchema
>
