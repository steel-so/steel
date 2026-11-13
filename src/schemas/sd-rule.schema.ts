import z from 'zod'

/**
 * Contrato compartilhado das regras do ServiceDesk: condições (usadas por
 * políticas de SLA, regras de escalonamento e de automação) e ações (regras
 * de automação e de escalonamento). A avaliação mora em
 * `src/lib/servicedesk/conditions.ts`; aqui só a forma.
 */

export const SD_TICKET_TYPES = [
  'INCIDENT',
  'SERVICE_REQUEST',
  'CHANGE',
  'PROBLEM',
] as const
export const SdTicketTypeEnum = z.enum(SD_TICKET_TYPES)

/** Campos do chamado que uma condição pode testar. */
export const SD_CONDITION_FIELDS = [
  'type',
  'channel',
  'phaseId',
  'phaseCategory',
  'priorityId',
  'priorityLevel',
  'severityId',
  'impactId',
  'urgencyId',
  'categoryId',
  'subcategoryId',
  'serviceId',
  'classificationId',
  'customerId',
  'companyId',
  'contactId',
  'configItemId',
  'departmentId',
  'assigneeId',
  'requesterId',
  'tags',
  'title',
  'description',
  'escalationLevel',
  /** Mudanças: alimentam as condições do comitê (CAB). */
  'changeType',
  'changeRisk',
] as const

export const SD_CONDITION_OPERATORS = [
  'equals',
  'not_equals',
  'in',
  'not_in',
  'contains',
  'is_empty',
  'is_not_empty',
  'gt',
  'lt',
] as const

const CUSTOM_FIELD_PATH = /^customFields\.[a-zA-Z][a-zA-Z0-9_]{0,63}$/

export const SdConditionFieldSchema = z.union([
  z.enum(SD_CONDITION_FIELDS),
  z.string().regex(CUSTOM_FIELD_PATH, 'Campo customizado inválido'),
])

const ConditionValue = z.union([
  z.string().max(500),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string().max(500), z.number()])).max(200),
  z.null(),
])

export const SdConditionSchema = z
  .object({
    field: SdConditionFieldSchema,
    operator: z.enum(SD_CONDITION_OPERATORS),
    value: ConditionValue.optional(),
  })
  .refine(
    (c) =>
      c.operator === 'is_empty' ||
      c.operator === 'is_not_empty' ||
      c.value !== undefined,
    { message: 'Informe o valor da condição', path: ['value'] },
  )
  .refine(
    (c) =>
      (c.operator !== 'in' && c.operator !== 'not_in') ||
      Array.isArray(c.value),
    {
      message: 'Os operadores "in"/"not_in" exigem uma lista',
      path: ['value'],
    },
  )

export type SdCondition = z.infer<typeof SdConditionSchema>

/** Todas as condições precisam casar (AND). Lista vazia = sempre casa. */
export const SdConditionsSchema = z.array(SdConditionSchema).max(50)

const id = z.string().min(1).max(64)

/** O que preenche cada {{n}} do modelo de WhatsApp de uma ação. */
export const SD_WHATSAPP_VARIABLES = [
  'code',
  'title',
  'requester',
  'phase',
] as const
export type SdWhatsappVariable = (typeof SD_WHATSAPP_VARIABLES)[number]

export const SdAutomationActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('set_field'),
    params: z.object({
      field: SdConditionFieldSchema,
      value: ConditionValue,
    }),
  }),
  z.object({
    type: z.literal('assign_department'),
    params: z.object({ departmentId: id }),
  }),
  z.object({
    type: z.literal('assign_user'),
    params: z.object({ userId: id }),
  }),
  z.object({
    type: z.literal('round_robin'),
    params: z.object({ departmentId: id.optional() }),
  }),
  z.object({
    type: z.literal('add_participant'),
    params: z.object({ userId: id }),
  }),
  z.object({
    type: z.literal('add_tag'),
    params: z.object({ tag: z.string().min(1).max(50) }),
  }),
  z.object({
    type: z.literal('notify'),
    params: z.object({
      userIds: z.array(id).max(50).default([]),
      assignee: z.boolean().default(false),
      requester: z.boolean().default(false),
      departmentLeads: z.boolean().default(false),
      email: z.boolean().default(false),
      title: z.string().min(1).max(200),
      message: z.string().max(2000).default(''),
    }),
  }),
  z.object({
    type: z.literal('post_message'),
    params: z.object({
      body: z.string().min(1).max(5000),
      visibility: z.enum(['PUBLIC', 'INTERNAL']).default('INTERNAL'),
    }),
  }),
  z.object({
    type: z.literal('create_task'),
    params: z.object({
      title: z.string().min(1).max(200),
      description: z.string().max(5000).optional(),
      assigneeId: id.optional(),
      dueInMinutes: z.number().int().min(1).max(525_600).optional(),
    }),
  }),
  z.object({
    type: z.literal('apply_template'),
    params: z.object({ templateId: id }),
  }),
  z.object({
    type: z.literal('send_whatsapp_template'),
    params: z.object({
      connectionId: id,
      /** Modelo aprovado (Meta). Vale a qualquer hora. */
      templateId: id.optional(),
      /** Valores de {{1}}, {{2}}…, na ordem. */
      variables: z.array(z.enum(SD_WHATSAPP_VARIABLES)).max(20).default([]),
      /** Texto livre: Z-API, ou Meta dentro da janela de 24 horas. */
      text: z.string().max(2000).optional(),
    }),
  }),
  z.object({
    type: z.literal('create_crm_task'),
    params: z.object({
      title: z.string().min(1).max(200),
      description: z.string().max(5000).optional(),
      assigneeId: id.optional(),
      dueInMinutes: z.number().int().min(1).max(525_600).optional(),
    }),
  }),
  z.object({
    type: z.literal('create_crm_lead'),
    params: z.object({
      /** Origem exibida no lead. */
      origin: z.string().min(1).max(100).default('ServiceDesk'),
    }),
  }),
  z.object({
    type: z.literal('escalate'),
    params: z.object({
      kind: z.enum(['FUNCTIONAL', 'HIERARCHICAL']),
      toDepartmentId: id.optional(),
      toUserId: id.optional(),
      reason: z.string().min(1).max(500),
    }),
  }),
])

export type SdAutomationAction = z.infer<typeof SdAutomationActionSchema>

export const SdAutomationActionsSchema = z
  .array(SdAutomationActionSchema)
  .min(1, 'Adicione ao menos uma ação')
  .max(20)

/** Ações de uma regra de escalonamento (`SdEscalationRule.actions`). */
export const SdEscalationActionsSchema = z
  .object({
    kind: z.enum(['FUNCTIONAL', 'HIERARCHICAL']).default('HIERARCHICAL'),
    notifyUserIds: z.array(id).max(50).default([]),
    notifyAssignee: z.boolean().default(true),
    notifyDepartmentLeads: z.boolean().default(true),
    reassignDepartmentId: id.nullable().default(null),
    reassignUserId: id.nullable().default(null),
    raisePriority: z.boolean().default(false),
    email: z.boolean().default(false),
    /**
     * Plantão (on-call) do departamento do chamado: avisa quem está de
     * plantão na camada do nível escalonado (e na retaguarda acima dela).
     */
    notifyOnCall: z.boolean().default(false),
    /**
     * Passa o chamado para quem está de plantão: camada 1 no primeiro
     * escalonamento, camada seguinte a cada nível. Sem ninguém de plantão
     * (ou dentro do expediente, quando a escala tem calendário), vale o
     * destino normal da regra.
     */
    reassignToOnCall: z.boolean().default(false),
  })
  .refine(
    (a) =>
      a.kind !== 'FUNCTIONAL' ||
      a.reassignDepartmentId !== null ||
      a.reassignUserId !== null ||
      a.reassignToOnCall,
    {
      message:
        'Escalonamento funcional exige um departamento, um responsável ou o plantão',
      path: ['reassignDepartmentId'],
    },
  )

export type SdEscalationActions = z.infer<typeof SdEscalationActionsSchema>
