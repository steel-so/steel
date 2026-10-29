import z from 'zod'

/**
 * Contrato de Workflows — motor de grafo (trigger + nodes + edges),
 * espelhando o CRM original. Um CrmWorkflow é um container estável (id+nome)
 * com N CrmWorkflowVersions — cada versão tem `definition` e um status
 * (DRAFT/ACTIVE/ARCHIVED). Edição sempre acontece no draft; "Activate"
 * congela o draft (vira ACTIVE), arquiva a versão anterior e cria um novo
 * draft a partir dela.
 */

/** Entidades CRM que nodes podem criar/atualizar/buscar/deletar. */
export const CRM_WORKFLOW_ENTITIES = [
  'company',
  'person',
  'opportunity',
  'task',
  'note',
] as const
export type CrmWorkflowEntity = (typeof CRM_WORKFLOW_ENTITIES)[number]

/**
 * Entidades que podem *disparar* um workflow. Superconjunto das entidades de
 * node: o lead dispara eventos (criado, etapa alterada, ganho, perdido), mas
 * não é criado/editado por nodes — o painel de leads tem gates de etapa que
 * um node genérico de update ignoraria.
 */
export const CRM_WORKFLOW_TRIGGER_ENTITIES = [
  ...CRM_WORKFLOW_ENTITIES,
  'lead',
] as const
export type CrmWorkflowTriggerEntity =
  (typeof CRM_WORKFLOW_TRIGGER_ENTITIES)[number]

/**
 * Eventos de domínio do lead além do CRUD. Um trigger de update com
 * `entity: 'lead'` pode restringir a um deles via `leadEvent`. Ganho/perdido
 * também são mudança de etapa (-> CLOSED), então disparam `stage-changed`.
 */
export const CRM_WORKFLOW_LEAD_EVENTS = [
  'stage-changed',
  'won',
  'lost',
] as const
export type CrmWorkflowLeadEvent = (typeof CRM_WORKFLOW_LEAD_EVENTS)[number]

export const CRM_WORKFLOW_STATUSES = ['DRAFT', 'ACTIVE', 'DEACTIVATED'] as const
export type CrmWorkflowStatus = (typeof CRM_WORKFLOW_STATUSES)[number]

export const CRM_WORKFLOW_VERSION_STATUSES = [
  'DRAFT',
  'ACTIVE',
  'ARCHIVED',
] as const
export type CrmWorkflowVersionStatus =
  (typeof CRM_WORKFLOW_VERSION_STATUSES)[number]

export const CRM_WORKFLOW_RUN_STATUSES = [
  'PENDING',
  'RUNNING',
  'WAITING',
  'COMPLETED',
  'FAILED',
  'CANCELED',
] as const
export type CrmWorkflowRunStatus = (typeof CRM_WORKFLOW_RUN_STATUSES)[number]

export const CRM_WORKFLOW_RUN_STEP_STATUSES = [
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'SKIPPED',
] as const
export type CrmWorkflowRunStepStatus =
  (typeof CRM_WORKFLOW_RUN_STEP_STATUSES)[number]

export const CRM_WORKFLOW_TRIGGER_TYPES = [
  'record-is-created',
  'record-is-updated',
  'record-is-deleted',
  'record-is-created-or-updated',
  'launch-manually',
  'on-a-schedule',
  'webhook',
  'newsletter-subscribed',
  'newsletter-unsubscribed',
  'newsletter-link-clicked',
  'newsletter-issue-opened',
] as const
export type CrmWorkflowTriggerType = (typeof CRM_WORKFLOW_TRIGGER_TYPES)[number]

export const CRM_WORKFLOW_NODE_TYPES = [
  'create-record',
  'update-record',
  'delete-record',
  'search-records',
  'create-or-update-record',
  'iterator',
  'filter',
  'if-else',
  'delay',
  'send-email',
  'draft-email',
  'form',
] as const
export type CrmWorkflowNodeType = (typeof CRM_WORKFLOW_NODE_TYPES)[number]

export const CRM_WORKFLOW_FILTER_OPERATORS = [
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'is_empty',
  'is_not_empty',
  'gt',
  'gte',
  'lt',
  'lte',
] as const
export type CrmWorkflowFilterOperator =
  (typeof CRM_WORKFLOW_FILTER_OPERATORS)[number]

export const CRM_WORKFLOW_FORM_FIELD_TYPES = [
  'text',
  'long_text',
  'number',
  'boolean',
  'select',
  'date',
] as const
export type CrmWorkflowFormFieldType =
  (typeof CRM_WORKFLOW_FORM_FIELD_TYPES)[number]

export const CRM_WORKFLOW_DELAY_UNITS = [
  'seconds',
  'minutes',
  'hours',
  'days',
] as const
export type CrmWorkflowDelayUnit = (typeof CRM_WORKFLOW_DELAY_UNITS)[number]

/* ============================ primitivos ================================ */

/**
 * Valor de campo: literal ou expressão `{{path}}` (resolvida em runtime
 * contra o contexto do run — `trigger.record`, `steps.<alias>.output`, etc.).
 * Mantemos como string crua aqui; o resolver/executor faz parsing.
 */
const ExpressionSchema = z.string().max(5000)

/** name → expressão. Cobre `fields`, `where`, payload do form. */
const FieldMapSchema = z.record(
  z.string().trim().min(1).max(100),
  ExpressionSchema,
)

const ConditionSchema = z.object({
  field: ExpressionSchema,
  operator: z.enum(CRM_WORKFLOW_FILTER_OPERATORS),
  value: ExpressionSchema.optional().default(''),
})

const PositionSchema = z.object({
  x: z.number(),
  y: z.number(),
})

/* =============================== triggers ================================ */

const TriggerRecordCreatedSchema = z.object({
  type: z.literal('record-is-created'),
  entity: z.enum(CRM_WORKFLOW_TRIGGER_ENTITIES),
})

const TriggerRecordUpdatedSchema = z.object({
  type: z.literal('record-is-updated'),
  entity: z.enum(CRM_WORKFLOW_TRIGGER_ENTITIES),
  /** Lista de campos observados. Vazio = qualquer campo. */
  fields: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  /** Só para `entity: 'lead'`. Ausente = qualquer atualização. */
  leadEvent: z.enum(CRM_WORKFLOW_LEAD_EVENTS).optional(),
})

const TriggerRecordDeletedSchema = z.object({
  type: z.literal('record-is-deleted'),
  entity: z.enum(CRM_WORKFLOW_TRIGGER_ENTITIES),
})

const TriggerRecordCreatedOrUpdatedSchema = z.object({
  type: z.literal('record-is-created-or-updated'),
  entity: z.enum(CRM_WORKFLOW_TRIGGER_ENTITIES),
  fields: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  /** Só para `entity: 'lead'`. Com filtro, a criação não dispara (não é um
   * evento de etapa/ganho/perda). */
  leadEvent: z.enum(CRM_WORKFLOW_LEAD_EVENTS).optional(),
})

const TriggerManualSchema = z.object({
  type: z.literal('launch-manually'),
  /** Campos do payload de entrada (formulário do botão "Run"). */
  inputs: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(50),
        label: z.string().trim().max(100).optional(),
        type: z.enum(CRM_WORKFLOW_FORM_FIELD_TYPES).default('text'),
        required: z.boolean().default(false),
      }),
    )
    .max(20)
    .default([]),
})

const TriggerScheduleSchema = z.object({
  type: z.literal('on-a-schedule'),
  /** Cron 5-campos. Resolver/scheduler valida sintaxe. */
  cron: z.string().trim().min(1).max(120),
  timezone: z.string().trim().max(64).default('America/Sao_Paulo'),
})

const TriggerWebhookSchema = z.object({
  type: z.literal('webhook'),
  /** Token público da URL `/api/crm/workflows/webhook/<token>`. Server-issued. */
  token: z.string().trim().min(8).max(64),
})

/**
 * Newsletter bridge triggers (ADR 0054 phase 2), dispatched by the
 * newsletter subscriber and tracking services. `newsletterId` absent = any
 * newsletter of the workspace.
 */
export const CRM_WORKFLOW_NEWSLETTER_TRIGGER_TYPES = [
  'newsletter-subscribed',
  'newsletter-unsubscribed',
  'newsletter-link-clicked',
  'newsletter-issue-opened',
] as const
export type CrmWorkflowNewsletterTriggerType =
  (typeof CRM_WORKFLOW_NEWSLETTER_TRIGGER_TYPES)[number]

const NewsletterFilter = z.string().trim().min(1).max(64).optional()

const TriggerNewsletterSubscribedSchema = z.object({
  type: z.literal('newsletter-subscribed'),
  newsletterId: NewsletterFilter,
})

const TriggerNewsletterUnsubscribedSchema = z.object({
  type: z.literal('newsletter-unsubscribed'),
  newsletterId: NewsletterFilter,
})

const TriggerNewsletterLinkClickedSchema = z.object({
  type: z.literal('newsletter-link-clicked'),
  newsletterId: NewsletterFilter,
  /** Only clicks on a URL containing this text (case-insensitive). */
  urlContains: z.string().trim().max(500).optional(),
})

const TriggerNewsletterIssueOpenedSchema = z.object({
  type: z.literal('newsletter-issue-opened'),
  newsletterId: NewsletterFilter,
})

export const CrmWorkflowTriggerDataSchema = z.discriminatedUnion('type', [
  TriggerRecordCreatedSchema,
  TriggerRecordUpdatedSchema,
  TriggerRecordDeletedSchema,
  TriggerRecordCreatedOrUpdatedSchema,
  TriggerManualSchema,
  TriggerScheduleSchema,
  TriggerWebhookSchema,
  TriggerNewsletterSubscribedSchema,
  TriggerNewsletterUnsubscribedSchema,
  TriggerNewsletterLinkClickedSchema,
  TriggerNewsletterIssueOpenedSchema,
])

export const CrmWorkflowTriggerSchema = z.object({
  id: z.literal('trigger'),
  position: PositionSchema,
  /** null = trigger vazio (workflow recém-criado, ainda em DRAFT). */
  data: CrmWorkflowTriggerDataSchema.nullable(),
})

/* ================================ nodes ================================= */

const BaseNodeMixin = {
  label: z.string().trim().max(120).optional(),
  /** Nome usado em `{{steps.<alias>.output}}`. */
  outputAlias: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{0,49}$/i, 'Alias inválido (use letras/números/_)')
    .max(50)
    .optional(),
}

const CreateRecordDataSchema = z.object({
  type: z.literal('create-record'),
  entity: z.enum(CRM_WORKFLOW_ENTITIES),
  fields: FieldMapSchema.default({}),
  ...BaseNodeMixin,
})

const UpdateRecordDataSchema = z.object({
  type: z.literal('update-record'),
  entity: z.enum(CRM_WORKFLOW_ENTITIES),
  recordId: ExpressionSchema,
  fields: FieldMapSchema.default({}),
  ...BaseNodeMixin,
})

const DeleteRecordDataSchema = z.object({
  type: z.literal('delete-record'),
  entity: z.enum(CRM_WORKFLOW_ENTITIES),
  recordId: ExpressionSchema,
  ...BaseNodeMixin,
})

const SearchRecordsDataSchema = z.object({
  type: z.literal('search-records'),
  entity: z.enum(CRM_WORKFLOW_ENTITIES),
  conditions: z.array(ConditionSchema).max(20).default([]),
  limit: z.number().int().min(1).max(500).default(50),
  ...BaseNodeMixin,
})

const CreateOrUpdateRecordDataSchema = z.object({
  type: z.literal('create-or-update-record'),
  entity: z.enum(CRM_WORKFLOW_ENTITIES),
  /** Campo usado pra upsert. Ex.: domain em company, emails[0] em person. */
  lookupField: z.string().trim().min(1).max(100),
  lookupValue: ExpressionSchema,
  fields: FieldMapSchema.default({}),
  ...BaseNodeMixin,
})

const IteratorDataSchema = z.object({
  type: z.literal('iterator'),
  /** Expressão que resolve para array (ex.: `{{steps.search_1.output}}`). */
  source: ExpressionSchema,
  /** Alias do item corrente — usado dentro do loop como `{{item}}`. */
  itemAlias: z.string().trim().min(1).max(50).default('item'),
  ...BaseNodeMixin,
})

const FilterDataSchema = z.object({
  type: z.literal('filter'),
  /** Continua execução só se todas as condições baterem. */
  conditions: z.array(ConditionSchema).max(20).default([]),
  ...BaseNodeMixin,
})

const IfElseDataSchema = z.object({
  type: z.literal('if-else'),
  /** Avalia conjuntivamente; ramo `true`/`false` via sourceHandle das edges. */
  conditions: z.array(ConditionSchema).max(20).default([]),
  ...BaseNodeMixin,
})

const DelayDataSchema = z.object({
  type: z.literal('delay'),
  amount: z.number().int().min(1).max(100_000),
  unit: z.enum(CRM_WORKFLOW_DELAY_UNITS).default('minutes'),
  ...BaseNodeMixin,
})

const SendEmailDataSchema = z.object({
  type: z.literal('send-email'),
  to: ExpressionSchema,
  subject: ExpressionSchema,
  /** Corpo em HTML (ou expressão que produz HTML). */
  body: ExpressionSchema,
  /** Opcional: usa template salvo como base. */
  templateId: z.string().trim().min(1).max(64).optional(),
  ...BaseNodeMixin,
})

const DraftEmailDataSchema = z.object({
  type: z.literal('draft-email'),
  to: ExpressionSchema,
  subject: ExpressionSchema,
  body: ExpressionSchema,
  templateId: z.string().trim().min(1).max(64).optional(),
  ...BaseNodeMixin,
})

const FormFieldSchema = z.object({
  name: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{0,49}$/i, 'Nome inválido')
    .max(50),
  label: z.string().trim().max(120).optional(),
  type: z.enum(CRM_WORKFLOW_FORM_FIELD_TYPES).default('text'),
  required: z.boolean().default(false),
  /** Para `select`. */
  options: z.array(z.string().max(120)).max(50).optional(),
})

const FormDataSchema = z.object({
  type: z.literal('form'),
  /** Quem deve preencher (expressão → userId). Vazio = qualquer membro. */
  assigneeId: ExpressionSchema.optional(),
  title: z.string().trim().max(200).default('Preencha o formulário'),
  fields: z.array(FormFieldSchema).min(1).max(20),
  ...BaseNodeMixin,
})

export const CrmWorkflowNodeDataSchema = z.discriminatedUnion('type', [
  CreateRecordDataSchema,
  UpdateRecordDataSchema,
  DeleteRecordDataSchema,
  SearchRecordsDataSchema,
  CreateOrUpdateRecordDataSchema,
  IteratorDataSchema,
  FilterDataSchema,
  IfElseDataSchema,
  DelayDataSchema,
  SendEmailDataSchema,
  DraftEmailDataSchema,
  FormDataSchema,
])

const NodeIdSchema = z.string().trim().min(1).max(64)
const EdgeIdSchema = z.string().trim().min(1).max(128)

export const CrmWorkflowNodeSchema = z.object({
  id: NodeIdSchema,
  position: PositionSchema,
  data: CrmWorkflowNodeDataSchema,
})

/* ================================ edges ================================= */

export const CrmWorkflowEdgeSchema = z.object({
  id: EdgeIdSchema,
  source: NodeIdSchema.or(z.literal('trigger')),
  target: NodeIdSchema,
  /** Para if-else: "true" | "false". Para outros: omitido. */
  sourceHandle: z.string().max(32).optional(),
  label: z.string().max(60).optional(),
})

/* ============================ definition ================================ */

/**
 * Forma do JSON salvo em `CrmWorkflowVersion.definition`. Validamos na
 * fronteira (route + mapper) — DB guarda Json cru.
 */
export const CrmWorkflowDefinitionSchema = z
  .object({
    trigger: CrmWorkflowTriggerSchema,
    nodes: z.array(CrmWorkflowNodeSchema).max(200).default([]),
    edges: z.array(CrmWorkflowEdgeSchema).max(500).default([]),
  })
  .superRefine((def, ctx) => {
    const trigger = def.trigger.data
    if (
      trigger &&
      'leadEvent' in trigger &&
      trigger.leadEvent &&
      trigger.entity !== 'lead'
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Evento de lead só vale para gatilhos da entidade lead',
        path: ['trigger', 'data', 'leadEvent'],
      })
    }

    const nodeIds = new Set<string>(['trigger'])
    for (const node of def.nodes) {
      if (nodeIds.has(node.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `Node id duplicado: ${node.id}`,
          path: ['nodes'],
        })
      }
      nodeIds.add(node.id)
    }
    for (const edge of def.edges) {
      if (!nodeIds.has(edge.source)) {
        ctx.addIssue({
          code: 'custom',
          message: `Edge ${edge.id}: source desconhecido (${edge.source})`,
          path: ['edges'],
        })
      }
      if (!nodeIds.has(edge.target)) {
        ctx.addIssue({
          code: 'custom',
          message: `Edge ${edge.id}: target desconhecido (${edge.target})`,
          path: ['edges'],
        })
      }
    }
  })

/* =========================== workflow CRUD =============================== */

const NameSchema = z
  .string()
  .trim()
  .min(1, 'Informe um nome')
  .max(200, 'Nome muito longo')
const DescriptionSchema = z.string().trim().max(2000)

export const CreateCrmWorkflowSchema = z.object({
  name: NameSchema,
  description: DescriptionSchema.optional(),
})

export type CreateCrmWorkflowDTO = z.infer<typeof CreateCrmWorkflowSchema>

export const UpdateCrmWorkflowSchema = z
  .object({
    name: NameSchema,
    description: DescriptionSchema.nullable(),
    status: z.enum(CRM_WORKFLOW_STATUSES),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Informe ao menos um campo para atualizar',
  })

export type UpdateCrmWorkflowDTO = z.infer<typeof UpdateCrmWorkflowSchema>

/** Patch que o editor envia a cada alteração no canvas (autosave). */
export const UpdateCrmWorkflowDraftSchema = z.object({
  definition: CrmWorkflowDefinitionSchema,
})

export type UpdateCrmWorkflowDraftDTO = z.infer<
  typeof UpdateCrmWorkflowDraftSchema
>

/** Disparo manual via botão "Test" ou trigger "launch-manually". */
export const TriggerCrmWorkflowManualRunSchema = z.object({
  payload: z.record(z.string(), z.unknown()).default({}),
  /** true = run de teste (não dispara side-effects irreversíveis). */
  test: z.boolean().default(false),
})

export type TriggerCrmWorkflowManualRunDTO = z.infer<
  typeof TriggerCrmWorkflowManualRunSchema
>

/** Payload do submit do form pausado — name → valor. */
export const ResumeCrmWorkflowRunSchema = z.object({
  payload: z.record(z.string(), z.unknown()).default({}),
})

export type ResumeCrmWorkflowRunDTO = z.infer<typeof ResumeCrmWorkflowRunSchema>

/* ================================ outputs =============================== */

export const CrmWorkflowOutputSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.enum(CRM_WORKFLOW_STATUSES),
  workspaceId: z.string(),
  createdById: z.string(),
  updatedById: z.string().nullable(),
  activeVersionId: z.string().nullable(),
  lastRunAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
})

export const CrmWorkflowVersionOutputSchema = z.object({
  id: z.string(),
  workflowId: z.string(),
  status: z.enum(CRM_WORKFLOW_VERSION_STATUSES),
  version: z.number().int(),
  definition: CrmWorkflowDefinitionSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const CrmWorkflowRunStepOutputSchema = z.object({
  id: z.string(),
  runId: z.string(),
  nodeId: z.string(),
  nodeType: z.string(),
  status: z.enum(CRM_WORKFLOW_RUN_STEP_STATUSES),
  input: z.unknown(),
  output: z.unknown(),
  error: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
})

export const CrmWorkflowRunOutputSchema = z.object({
  id: z.string(),
  workflowId: z.string(),
  versionId: z.string(),
  status: z.enum(CRM_WORKFLOW_RUN_STATUSES),
  triggerType: z.enum(CRM_WORKFLOW_TRIGGER_TYPES),
  triggerPayload: z.unknown(),
  /** Quando status = WAITING, é o id do step (form) aguardando input. */
  waitingStepId: z.string().nullable(),
  startedById: z.string().nullable(),
  error: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  createdAt: z.string(),
  steps: z.array(CrmWorkflowRunStepOutputSchema).optional(),
})

/* ================================ types ================================= */

export type CrmWorkflowTriggerData = z.infer<
  typeof CrmWorkflowTriggerDataSchema
>
export type CrmWorkflowTrigger = z.infer<typeof CrmWorkflowTriggerSchema>
export type CrmWorkflowNodeData = z.infer<typeof CrmWorkflowNodeDataSchema>
export type CrmWorkflowNode = z.infer<typeof CrmWorkflowNodeSchema>
export type CrmWorkflowEdge = z.infer<typeof CrmWorkflowEdgeSchema>
export type CrmWorkflowDefinition = z.infer<typeof CrmWorkflowDefinitionSchema>
export type CrmWorkflowCondition = z.infer<typeof ConditionSchema>
export type CrmWorkflowFormField = z.infer<typeof FormFieldSchema>

export type CrmWorkflowDTO = z.infer<typeof CrmWorkflowOutputSchema>
export type CrmWorkflowVersionDTO = z.infer<
  typeof CrmWorkflowVersionOutputSchema
>
export type CrmWorkflowRunDTO = z.infer<typeof CrmWorkflowRunOutputSchema>
export type CrmWorkflowRunStepDTO = z.infer<
  typeof CrmWorkflowRunStepOutputSchema
>
