import { z } from 'zod'
import { FIELD_TARGETS, TARGET_ATTRIBUTES } from './crm-form.schema'

/**
 * WhatsApp Flow contract (Z3). A flow is a short list of screens, each with
 * fields; `src/lib/whatsapp/flows/meta-json.ts` turns it into the Flow JSON
 * Meta renders natively. Field keys are the keys of the answer.
 */

export const FLOW_FIELD_TYPES = [
  'text',
  'email',
  'phone',
  'number',
  'textarea',
  'select',
  'radio',
  'multiselect',
  'checkbox',
  'date',
] as const
export type FlowFieldType = (typeof FLOW_FIELD_TYPES)[number]

export const FLOW_CATEGORIES = [
  'SIGN_UP',
  'SIGN_IN',
  'APPOINTMENT_BOOKING',
  'LEAD_GENERATION',
  'CONTACT_US',
  'CUSTOMER_SUPPORT',
  'SURVEY',
  'OTHER',
] as const
export type FlowCategory = (typeof FLOW_CATEGORIES)[number]

export const FLOW_STATUSES = ['DRAFT', 'PUBLISHED', 'DEPRECATED'] as const
export const FLOW_CRM_ACTIONS = ['NONE', 'LEAD', 'PERSON', 'COMPANY'] as const
export type FlowCrmAction = (typeof FLOW_CRM_ACTIONS)[number]

/** Limits imposed by Meta (labels per component) and by us (sizes). */
export const FLOW_LIMITS = {
  screens: 8,
  fieldsPerScreen: 8,
  fieldsTotal: 30,
  options: 20,
  screenTitle: 30,
  heading: 80,
  description: 600,
  submitLabel: 35,
  ctaLabel: 30,
  bodyText: 1024,
  confirmationText: 1024,
  perWorkspace: 50,
  /** Max label length by component, from the Flow JSON reference. */
  label: {
    text: 20,
    email: 20,
    phone: 20,
    number: 20,
    textarea: 20,
    select: 20,
    radio: 30,
    multiselect: 30,
    checkbox: 80,
    date: 40,
  } satisfies Record<FlowFieldType, number>,
} as const

/** Contact attributes a flow field can fill (the WhatsApp contact card). */
export const FLOW_CONTACT_ATTRIBUTES = ['name'] as const

export const FLOW_MAPPING_TARGETS = ['contact', ...FIELD_TARGETS] as const
export type FlowMappingTarget = (typeof FLOW_MAPPING_TARGETS)[number]

/** Attributes allowed per mapping target (CRM ones come from the CRM form). */
export const FLOW_TARGET_ATTRIBUTES = {
  contact: FLOW_CONTACT_ATTRIBUTES,
  ...TARGET_ATTRIBUTES,
} as const

const OptionSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1, 'Informe o valor da opção')
    .max(60)
    .regex(/^[A-Za-z0-9_-]+$/, 'Use letras, números, _ ou -'),
  title: z.string().trim().min(1, 'Informe o texto da opção').max(30),
})

const MappingSchema = z
  .object({
    target: z.enum(FLOW_MAPPING_TARGETS),
    attribute: z.string().trim().min(1),
  })
  .refine(
    (m) =>
      (FLOW_TARGET_ATTRIBUTES[m.target] as readonly string[]).includes(
        m.attribute,
      ),
    { message: 'Atributo inválido para o destino selecionado' },
  )

export const FlowFieldSchema = z
  .object({
    key: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(/^[a-z][a-z0-9_]*$/, 'Use apenas letras minúsculas, números e _'),
    label: z.string().trim().min(1, 'Informe o rótulo do campo').max(80),
    type: z.enum(FLOW_FIELD_TYPES),
    required: z.boolean().default(false),
    helperText: z.string().trim().max(80).optional(),
    options: z.array(OptionSchema).max(FLOW_LIMITS.options).optional(),
    mapping: MappingSchema.optional(),
  })
  .superRefine((field, ctx) => {
    const max = FLOW_LIMITS.label[field.type]
    if (field.label.length > max) {
      ctx.addIssue({
        code: 'custom',
        path: ['label'],
        message: `O rótulo deste tipo de campo aceita até ${max} caracteres`,
      })
    }
    const needsOptions = ['select', 'radio', 'multiselect'].includes(field.type)
    if (needsOptions && (field.options?.length ?? 0) === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'Campos de escolha exigem ao menos uma opção',
      })
    }
    if (field.options) {
      const ids = new Set<string>()
      for (const option of field.options) {
        if (ids.has(option.id)) {
          ctx.addIssue({
            code: 'custom',
            path: ['options'],
            message: `Opção repetida: "${option.id}"`,
          })
        }
        ids.add(option.id)
      }
    }
  })
export type FlowField = z.infer<typeof FlowFieldSchema>

export const FlowScreenSchema = z.object({
  title: z.string().trim().min(1, 'Informe o título da tela').max(30),
  heading: z.string().trim().max(FLOW_LIMITS.heading).optional(),
  description: z.string().trim().max(FLOW_LIMITS.description).optional(),
  /** Label of the screen button ("Continuar" / "Enviar"). */
  submitLabel: z.string().trim().max(FLOW_LIMITS.submitLabel).optional(),
  fields: z
    .array(FlowFieldSchema)
    .min(1, 'Cada tela precisa de ao menos um campo')
    .max(FLOW_LIMITS.fieldsPerScreen),
})
export type FlowScreen = z.infer<typeof FlowScreenSchema>

export const FlowDefinitionSchema = z
  .object({
    screens: z
      .array(FlowScreenSchema)
      .min(1, 'O formulário precisa de ao menos uma tela')
      .max(FLOW_LIMITS.screens),
  })
  .superRefine((definition, ctx) => {
    const keys = new Set<string>()
    let total = 0
    definition.screens.forEach((screen, s) => {
      screen.fields.forEach((field, f) => {
        total += 1
        if (keys.has(field.key)) {
          ctx.addIssue({
            code: 'custom',
            path: ['screens', s, 'fields', f, 'key'],
            message: `Chave duplicada: "${field.key}"`,
          })
        }
        keys.add(field.key)
      })
    })
    if (total > FLOW_LIMITS.fieldsTotal) {
      ctx.addIssue({
        code: 'custom',
        path: ['screens'],
        message: `No máximo ${FLOW_LIMITS.fieldsTotal} campos no formulário`,
      })
    }
  })
export type FlowDefinition = z.infer<typeof FlowDefinitionSchema>

export const FLOW_PRESETS = [
  'BLANK',
  'SIGN_UP',
  'APPOINTMENT',
  'SURVEY',
] as const
export type FlowPreset = (typeof FLOW_PRESETS)[number]

const NameSchema = z.string().trim().min(1, 'Informe o nome').max(120)

export const CreateWhatsAppFlowSchema = z.object({
  name: NameSchema,
  description: z.string().trim().max(500).optional(),
  connectionId: z.string().min(1),
  category: z.enum(FLOW_CATEGORIES).default('OTHER'),
  preset: z.enum(FLOW_PRESETS).default('BLANK'),
  /** Copies fields, mapping and action from a CRM form (wins over preset). */
  crmFormId: z.string().min(1).optional(),
})
export type CreateWhatsAppFlowDTO = z.infer<typeof CreateWhatsAppFlowSchema>

export const UpdateWhatsAppFlowSchema = z
  .object({
    name: NameSchema,
    description: z.string().trim().max(500).nullable(),
    category: z.enum(FLOW_CATEGORIES),
    definition: FlowDefinitionSchema,
    bodyText: z.string().trim().min(1).max(FLOW_LIMITS.bodyText),
    ctaLabel: z.string().trim().min(1).max(FLOW_LIMITS.ctaLabel),
    confirmationText: z
      .string()
      .trim()
      .max(FLOW_LIMITS.confirmationText)
      .nullable(),
    crmAction: z.enum(FLOW_CRM_ACTIONS),
  })
  .partial()
export type UpdateWhatsAppFlowDTO = z.infer<typeof UpdateWhatsAppFlowSchema>

export const PublishWhatsAppFlowSchema = z.object({
  /** false = upload to Meta as a draft only (test sends allowed). */
  publish: z.boolean().default(true),
})
export type PublishWhatsAppFlowDTO = z.infer<typeof PublishWhatsAppFlowSchema>

export const SendWhatsAppFlowSchema = z
  .object({
    conversationId: z.string().min(1),
    /** Overrides the flow body / button label for this send. */
    bodyText: z.string().trim().min(1).max(FLOW_LIMITS.bodyText).optional(),
    ctaLabel: z.string().trim().min(1).max(FLOW_LIMITS.ctaLabel).optional(),
    /** Send through an approved template that carries a FLOW button. */
    templateName: z.string().trim().min(1).max(512).optional(),
    language: z.string().trim().min(1).max(10).optional(),
  })
  .refine((v) => !v.templateName || Boolean(v.language), {
    path: ['language'],
    message: 'Informe o idioma do template',
  })
export type SendWhatsAppFlowDTO = z.infer<typeof SendWhatsAppFlowSchema>

export const CreateWhatsAppFlowTemplateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(512)
    .regex(/^[a-z0-9_]+$/, 'Use apenas letras minúsculas, números e "_"'),
  language: z.string().trim().min(1).max(10).default('pt_BR'),
  category: z.enum(['UTILITY', 'MARKETING']).default('UTILITY'),
  body: z.string().trim().min(1).max(1024),
  buttonText: z.string().trim().min(1).max(25).default('Preencher'),
})
export type CreateWhatsAppFlowTemplateDTO = z.infer<
  typeof CreateWhatsAppFlowTemplateSchema
>

export const ListWhatsAppFlowResponsesSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
})
export type ListWhatsAppFlowResponsesDTO = z.infer<
  typeof ListWhatsAppFlowResponsesSchema
>
