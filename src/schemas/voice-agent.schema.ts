import { z } from 'zod'

/** Voices of the Realtime API the attendant may use. */
export const VOICE_AGENT_VOICES = [
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'sage',
  'shimmer',
  'verse',
  'marin',
  'cedar',
] as const

export const VOICE_AGENT_MAX_CALL_SECONDS = { min: 30, max: 900 } as const
export const VOICE_AGENT_MONTHLY_MINUTES = { min: 1, max: 100_000 } as const
export const VOICE_AGENT_SILENCE_SECONDS = { min: 5, max: 60 } as const

/** Extension, queue name or number the dialplan can `Goto`/`Dial`. */
const TARGET_PATTERN = /^[A-Za-z0-9_.#*+-]{1,40}$/
const targetSchema = z
  .string()
  .trim()
  .regex(TARGET_PATTERN, 'Use letras, números e _ . # * + -')

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => (value ? value : null))

export const UpdateVoiceAgentSettingsSchema = z
  .object({
    enabled: z.boolean(),
    noticeText: nullableText(500),
    instructions: nullableText(2000),
    voice: z.enum(VOICE_AGENT_VOICES),
    maxCallSeconds: z
      .number()
      .int()
      .min(VOICE_AGENT_MAX_CALL_SECONDS.min)
      .max(VOICE_AGENT_MAX_CALL_SECONDS.max),
    monthlyMinutesCap: z
      .number()
      .int()
      .min(VOICE_AGENT_MONTHLY_MINUTES.min)
      .max(VOICE_AGENT_MONTHLY_MINUTES.max),
    silenceTimeoutSeconds: z
      .number()
      .int()
      .min(VOICE_AGENT_SILENCE_SECONDS.min)
      .max(VOICE_AGENT_SILENCE_SECONDS.max),
    runAsUserId: z.string().min(1).nullable(),
    canOpenTickets: z.boolean(),
    canLookupTickets: z.boolean(),
    fallbackTarget: targetSchema.nullable(),
  })
  .partial()
export type UpdateVoiceAgentSettingsDTO = z.infer<
  typeof UpdateVoiceAgentSettingsSchema
>

const ROUTE_VALUE_PATTERN = /^[A-Za-z0-9_.#*+-]{1,40}$/

export const CreateVoiceAgentRouteSchema = z.object({
  kind: z.enum(['QUEUE', 'DID']),
  value: z
    .string()
    .trim()
    .regex(ROUTE_VALUE_PATTERN, 'Use letras, números e _ . # * + -'),
  label: nullableText(80).optional(),
  enabled: z.boolean().optional(),
  transferTarget: targetSchema.nullable().optional(),
})
export type CreateVoiceAgentRouteDTO = z.infer<
  typeof CreateVoiceAgentRouteSchema
>

export const UpdateVoiceAgentRouteSchema = z
  .object({
    label: nullableText(80),
    enabled: z.boolean(),
    transferTarget: targetSchema.nullable(),
  })
  .partial()
export type UpdateVoiceAgentRouteDTO = z.infer<
  typeof UpdateVoiceAgentRouteSchema
>

/** Form body the dialplan posts to open a session (`CURL()`). */
export const PabxVoiceSessionSchema = z.object({
  workspace: z.string().min(1).max(64),
  secret: z.string().min(16).max(128),
  /** Caller id as the PABX has it (digits, maybe with `+`). */
  caller: z.string().trim().min(3).max(32),
  /** Queue the call came from. */
  queue: z.string().trim().max(40).optional(),
  /** Number the caller dialed. */
  did: z.string().trim().max(40).optional(),
})
export type PabxVoiceSessionDTO = z.infer<typeof PabxVoiceSessionSchema>

/** Form body of the post-`AudioSocket()` question: where does the call go? */
export const PabxVoiceOutcomeSchema = z.object({
  workspace: z.string().min(1).max(64),
  secret: z.string().min(16).max(128),
  session: z.uuid(),
})
export type PabxVoiceOutcomeDTO = z.infer<typeof PabxVoiceOutcomeSchema>
