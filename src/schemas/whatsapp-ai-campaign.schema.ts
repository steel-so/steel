import { z } from 'zod'

/** Segundos entre dois envios: mais agressivo 20 s, mais cauteloso 60 s. */
export const AI_CAMPAIGN_MIN_INTERVAL_SECONDS = 20
export const AI_CAMPAIGN_MAX_INTERVAL_SECONDS = 60
export const AI_CAMPAIGN_DEFAULT_INTERVAL_SECONDS = 30
export const AI_CAMPAIGN_NAME_MAX = 120
export const AI_CAMPAIGN_OBJECTIVE_MAX = 500
export const AI_CAMPAIGN_INSTRUCTIONS_MAX = 8000
export const AI_CAMPAIGN_MAX_ACTIONS = 15
export const AI_CAMPAIGN_MAX_WEBHOOK_FIELDS = 10
/** Contatos adicionados de uma vez (seleção, todos ou planilha). */
export const AI_CAMPAIGN_MAX_QUEUE = 10_000
export const AI_CAMPAIGN_MAX_IMPORT_ROWS = 5000
export const AI_CAMPAIGN_FOLLOW_UP_MAX_HOURS = 168

// ─── Variáveis do template ────────────────────────────────────────────────

export const AI_CAMPAIGN_CONTACT_FIELDS = [
  'FIRST_NAME',
  'NAME',
  'PHONE',
  'DESCRIPTION',
] as const

const fallback = z.string().trim().max(500).optional()

/** De onde vem o valor de uma variável do template. */
export const AiCampaignVariableSourceSchema = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('FIXED'),
    value: z.string().trim().min(1, 'Informe o texto da variável').max(1000),
  }),
  z.object({
    source: z.literal('CONTACT'),
    field: z.enum(AI_CAMPAIGN_CONTACT_FIELDS),
    fallback,
  }),
  z.object({
    source: z.literal('COLUMN'),
    column: z.string().trim().min(1, 'Escolha a coluna da planilha').max(100),
    fallback,
  }),
])

export type AiCampaignVariableSource = z.infer<
  typeof AiCampaignVariableSourceSchema
>

const variableIndex = z.string().regex(/^\d{1,2}$/)

/**
 * Mapeamento por posição: `header`/`body` pelo número da variável (`{{1}}`
 * = "1"), `buttons` pelo índice do botão de link dinâmico no template.
 */
export const AiCampaignVariablesSchema = z.object({
  header: z.record(variableIndex, AiCampaignVariableSourceSchema).default({}),
  body: z.record(variableIndex, AiCampaignVariableSourceSchema).default({}),
  buttons: z.record(variableIndex, AiCampaignVariableSourceSchema).default({}),
})

export type AiCampaignVariables = z.infer<typeof AiCampaignVariablesSchema>

// ─── Ações da IA ──────────────────────────────────────────────────────────

export const AI_CAMPAIGN_ACTION_KINDS = [
  'TRANSFER_USER',
  'TRANSFER_TEAM',
  'CLOSE',
  'OPT_OUT',
  'ADD_NOTE',
  'FOLLOW_UP',
  'CRM_WORKFLOW',
  'WEBHOOK',
] as const

export type AiCampaignActionKind = (typeof AI_CAMPAIGN_ACTION_KINDS)[number]

const actionBase = {
  id: z.string().trim().min(1).max(40),
  label: z
    .string()
    .trim()
    .min(1, 'Dê um nome para a ação')
    .max(80, 'O nome da ação pode ter até 80 caracteres'),
  /** Quando a IA deve usar a ação — escrito pelo admin, em linguagem livre. */
  when: z
    .string()
    .trim()
    .min(1, 'Descreva quando a IA deve usar a ação')
    .max(1000, 'A regra pode ter até 1000 caracteres'),
}

export const AiCampaignWebhookFieldSchema = z.object({
  key: z
    .string()
    .regex(
      /^[a-z][a-z0-9_]{0,39}$/,
      'Use letras minúsculas, números e _ (ex.: cpf, data_escolhida)',
    ),
  description: z
    .string()
    .trim()
    .min(1, 'Explique o que a IA deve preencher')
    .max(300),
})

export const AiCampaignActionSchema = z.discriminatedUnion('kind', [
  z.object({
    ...actionBase,
    kind: z.literal('TRANSFER_USER'),
    userId: z.string().min(1, 'Escolha o atendente'),
  }),
  z.object({
    ...actionBase,
    kind: z.literal('TRANSFER_TEAM'),
    teamId: z.string().min(1, 'Escolha a equipe'),
  }),
  z.object({
    ...actionBase,
    kind: z.literal('CLOSE'),
    /** Status de fechamento aplicados (vazio = fecha sem classificação). */
    statusIds: z.array(z.string().min(1)).max(10).default([]),
  }),
  z.object({ ...actionBase, kind: z.literal('OPT_OUT') }),
  z.object({ ...actionBase, kind: z.literal('ADD_NOTE') }),
  z.object({
    ...actionBase,
    kind: z.literal('FOLLOW_UP'),
    delayHours: z
      .number()
      .int('Informe um número inteiro de horas')
      .min(1, 'Mínimo de 1 hora')
      .max(
        AI_CAMPAIGN_FOLLOW_UP_MAX_HOURS,
        `Máximo de ${AI_CAMPAIGN_FOLLOW_UP_MAX_HOURS} horas (7 dias)`,
      ),
  }),
  z.object({
    ...actionBase,
    kind: z.literal('CRM_WORKFLOW'),
    workflowId: z.string().min(1, 'Escolha o workflow'),
  }),
  z.object({
    ...actionBase,
    kind: z.literal('WEBHOOK'),
    url: z
      .string()
      .trim()
      .url('Informe uma URL válida')
      .refine((value) => value.startsWith('https://'), {
        message: 'O webhook precisa usar HTTPS',
      }),
    secret: z.string().trim().max(200).optional(),
    fields: z
      .array(AiCampaignWebhookFieldSchema)
      .max(AI_CAMPAIGN_MAX_WEBHOOK_FIELDS)
      .default([]),
  }),
])

export type AiCampaignAction = z.infer<typeof AiCampaignActionSchema>

export const AiCampaignActionsSchema = z
  .array(AiCampaignActionSchema)
  .max(
    AI_CAMPAIGN_MAX_ACTIONS,
    `Cadastre até ${AI_CAMPAIGN_MAX_ACTIONS} ações por campanha`,
  )
  .refine(
    (actions) =>
      new Set(actions.map((action) => action.id)).size === actions.length,
    { message: 'Cada ação precisa de um id único' },
  )

// ─── Campanha ─────────────────────────────────────────────────────────────

const name = z
  .string()
  .trim()
  .min(1, 'Dê um nome para a campanha')
  .max(
    AI_CAMPAIGN_NAME_MAX,
    `O nome pode ter até ${AI_CAMPAIGN_NAME_MAX} caracteres`,
  )

const objective = z
  .string()
  .trim()
  .max(
    AI_CAMPAIGN_OBJECTIVE_MAX,
    `O objetivo pode ter até ${AI_CAMPAIGN_OBJECTIVE_MAX} caracteres`,
  )

export const CreateWhatsAppAiCampaignSchema = z.object({
  name,
  objective: objective.optional(),
})

export type CreateWhatsAppAiCampaignDTO = z.infer<
  typeof CreateWhatsAppAiCampaignSchema
>

/**
 * Atualização parcial. Conexão, template, variáveis e mídia só com a
 * campanha parada; nome, objetivo, instruções, ações, ritmo e respostas da
 * IA mudam a qualquer momento (valem já no próximo envio/resposta).
 */
export const UpdateWhatsAppAiCampaignSchema = z
  .object({
    name: name.optional(),
    objective: objective.nullable().optional(),
    connectionId: z.string().min(1).nullable().optional(),
    templateId: z.string().min(1).nullable().optional(),
    variables: AiCampaignVariablesSchema.optional(),
    headerMediaUrl: z
      .string()
      .trim()
      .url('Informe uma URL válida')
      .nullable()
      .optional(),
    instructions: z
      .string()
      .max(
        AI_CAMPAIGN_INSTRUCTIONS_MAX,
        `As instruções podem ter até ${AI_CAMPAIGN_INSTRUCTIONS_MAX} caracteres`,
      )
      .optional(),
    actions: AiCampaignActionsSchema.optional(),
    intervalSeconds: z
      .number()
      .int('Informe um número inteiro de segundos')
      .min(
        AI_CAMPAIGN_MIN_INTERVAL_SECONDS,
        `O intervalo mínimo é de ${AI_CAMPAIGN_MIN_INTERVAL_SECONDS} segundos`,
      )
      .max(
        AI_CAMPAIGN_MAX_INTERVAL_SECONDS,
        `O intervalo máximo é de ${AI_CAMPAIGN_MAX_INTERVAL_SECONDS} segundos`,
      )
      .optional(),
    aiReplies: z.boolean().optional(),
    /** Pula contatos que a checagem "tem zap?" marcou sem WhatsApp. */
    skipNoWhatsapp: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Informe ao menos um campo para alterar',
  })

export type UpdateWhatsAppAiCampaignDTO = z.infer<
  typeof UpdateWhatsAppAiCampaignSchema
>

// ─── Contatos da campanha ─────────────────────────────────────────────────

export const AiCampaignImportRowSchema = z.object({
  phone: z.string().trim().min(8, 'Telefone inválido').max(30),
  name: z.string().trim().max(200).optional(),
  /** Colunas extras (nome da coluna → valor), usadas nas variáveis. */
  values: z.record(z.string().max(100), z.string().max(1000)).default({}),
})

export type AiCampaignImportRow = z.infer<typeof AiCampaignImportRowSchema>

/** Uma das três formas: `all`, `contactIds` ou `rows` (planilha). */
export const QueueWhatsAppAiCampaignSchema = z
  .object({
    all: z.boolean().optional(),
    contactIds: z
      .array(z.string().min(1))
      .max(
        AI_CAMPAIGN_MAX_QUEUE,
        `Adicione até ${AI_CAMPAIGN_MAX_QUEUE} contatos por vez`,
      )
      .optional(),
    rows: z
      .array(AiCampaignImportRowSchema)
      .max(
        AI_CAMPAIGN_MAX_IMPORT_ROWS,
        `Importe até ${AI_CAMPAIGN_MAX_IMPORT_ROWS} linhas por vez`,
      )
      .optional(),
  })
  .refine(
    (value) =>
      [
        value.all === true,
        Boolean(value.contactIds?.length),
        Boolean(value.rows?.length),
      ].filter(Boolean).length === 1,
    { message: 'Escolha os contatos, marque todos ou importe uma planilha' },
  )

export type QueueWhatsAppAiCampaignDTO = z.infer<
  typeof QueueWhatsAppAiCampaignSchema
>

export const ListWhatsAppAiCampaignRecipientsSchema = z.object({
  status: z.enum(['PENDING', 'SENT', 'FAILED', 'SKIPPED']).optional(),
  search: z.string().trim().max(100).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

export type ListWhatsAppAiCampaignRecipientsDTO = z.infer<
  typeof ListWhatsAppAiCampaignRecipientsSchema
>
