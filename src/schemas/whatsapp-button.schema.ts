import { z } from 'zod'

/** Meta and Z-API both cap button labels at 25 characters (Meta: 25, 20 on
 * interactive reply buttons — the stricter limit wins for portability). */
export const WHATSAPP_BUTTON_LABEL_MAX = 20
/** Product decision: at most 2 buttons per template / quick reply. */
export const WHATSAPP_BUTTONS_MAX = 2
export const WHATSAPP_BUTTON_ACTIONS_MAX = 5

export const WHATSAPP_BUTTON_ACTION_KINDS = [
  'REPLY',
  'ASSIGN_USER',
  'ASSIGN_TEAM',
  'SET_STATUS',
  'CRM_WORKFLOW',
  'HTTP_WEBHOOK',
  'AI_INSTRUCTION',
] as const
export type WhatsAppButtonActionKind =
  (typeof WHATSAPP_BUTTON_ACTION_KINDS)[number]

/** What runs when the contact clicks a REPLY button, in array order. A failing
 * action is logged and the next one still runs. */
export const WhatsAppButtonActionSchema = z.discriminatedUnion('kind', [
  /** Sends this text back to the contact (same `{{n}}`-free plain text). */
  z.object({
    kind: z.literal('REPLY'),
    text: z.string().trim().min(1).max(4096),
  }),
  z.object({ kind: z.literal('ASSIGN_USER'), userId: z.string().min(1) }),
  /** Moves the conversation to the team and clears the assignee, so it lands
   * in that team's queue. */
  z.object({ kind: z.literal('ASSIGN_TEAM'), teamId: z.string().min(1) }),
  z.object({
    kind: z.literal('SET_STATUS'),
    status: z.enum(['IN_PROGRESS', 'CLOSED']),
    reason: z.string().trim().max(500).optional(),
  }),
  /** Launches a CRM workflow (its trigger must be "launch manually"); the
   * click context goes in as the run payload. */
  z.object({ kind: z.literal('CRM_WORKFLOW'), workflowId: z.string().min(1) }),
  /** POSTs the click as JSON to an external HTTPS URL, signed with
   * HMAC-SHA256 (`X-Steel-Signature`) when a secret is set. */
  z.object({
    kind: z.literal('HTTP_WEBHOOK'),
    url: z
      .url()
      .max(2048)
      .refine((value) => value.startsWith('https://'), 'Use uma URL https'),
    secret: z.string().max(200).optional(),
  }),
  /** The WhatsApp AI answers the contact following this instruction. */
  z.object({
    kind: z.literal('AI_INSTRUCTION'),
    instruction: z.string().trim().min(1).max(2000),
  }),
])
export type WhatsAppButtonAction = z.infer<typeof WhatsAppButtonActionSchema>

const LabelSchema = z.string().trim().min(1).max(WHATSAPP_BUTTON_LABEL_MAX)

/** A button on a template or quick reply. `id` is stable and travels as the
 * button payload, so the click comes back to the same actions. URL buttons
 * open a link — providers do not report those clicks, so they carry no
 * actions. */
export const WhatsAppButtonSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string().min(1).max(64),
    type: z.literal('REPLY'),
    label: LabelSchema,
    actions: z
      .array(WhatsAppButtonActionSchema)
      .max(WHATSAPP_BUTTON_ACTIONS_MAX)
      .default([]),
  }),
  z.object({
    id: z.string().min(1).max(64),
    type: z.literal('URL'),
    label: LabelSchema,
    url: z.url().max(2000),
  }),
])
export type WhatsAppButtonInput = z.infer<typeof WhatsAppButtonSchema>

export const WhatsAppButtonsSchema = z
  .array(WhatsAppButtonSchema)
  .max(WHATSAPP_BUTTONS_MAX)
  .refine(
    (buttons) => new Set(buttons.map((b) => b.id)).size === buttons.length,
    'Os botões precisam de ids diferentes',
  )

/** PATCH /templates/[templateId]/buttons — configure actions on a template
 * (also one synced from Meta). Labels/types must match the approved template;
 * only `actions` (and missing ids) may change. */
export const UpdateWhatsAppTemplateButtonsSchema = z.object({
  buttons: WhatsAppButtonsSchema,
})
export type UpdateWhatsAppTemplateButtonsInput = z.infer<
  typeof UpdateWhatsAppTemplateButtonsSchema
>
