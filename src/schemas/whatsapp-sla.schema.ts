import { z } from 'zod'

/** Largest target accepted: 30 days, in minutes. */
export const WHATSAPP_SLA_MAX_MINUTES = 30 * 24 * 60
export const WHATSAPP_SLA_SUPERVISORS_MAX = 20

const minutes = (label: string) =>
  z
    .number({ message: `Informe ${label}` })
    .int(`${label} deve ser um número inteiro de minutos`)
    .min(1, `${label} deve ser de pelo menos 1 minuto`)
    .max(WHATSAPP_SLA_MAX_MINUTES, `${label} deve ser de no máximo 30 dias`)

const firstResponseMinutes = minutes('o prazo da primeira resposta')
const resolutionMinutes = minutes('o prazo de resolução').nullable()

const warnAtPercent = z
  .number()
  .int('O aviso deve ser um número inteiro')
  .min(10, 'O aviso deve ser de pelo menos 10% do prazo')
  .max(99, 'O aviso deve ser de no máximo 99% do prazo')

const supervisorIds = z
  .array(z.string().min(1))
  .max(
    WHATSAPP_SLA_SUPERVISORS_MAX,
    `Escolha até ${WHATSAPP_SLA_SUPERVISORS_MAX} supervisores`,
  )

const flags = {
  enabled: z.boolean(),
  businessHoursOnly: z.boolean(),
  countAiAsResponse: z.boolean(),
  notifyAssignee: z.boolean(),
  notifyTeamLeaders: z.boolean(),
  notifySupervisors: z.boolean(),
  notifyInApp: z.boolean(),
  notifyEmail: z.boolean(),
}

export const CreateWhatsAppSlaPolicySchema = z.object({
  /** Null/absent = the workspace default; an id = override for that team. */
  teamId: z.string().min(1).nullable().optional(),
  enabled: flags.enabled.optional(),
  firstResponseMinutes: firstResponseMinutes.optional(),
  resolutionMinutes: resolutionMinutes.optional(),
  businessHoursOnly: flags.businessHoursOnly.optional(),
  warnAtPercent: warnAtPercent.optional(),
  countAiAsResponse: flags.countAiAsResponse.optional(),
  notifyAssignee: flags.notifyAssignee.optional(),
  notifyTeamLeaders: flags.notifyTeamLeaders.optional(),
  notifySupervisors: flags.notifySupervisors.optional(),
  supervisorIds: supervisorIds.optional(),
  notifyInApp: flags.notifyInApp.optional(),
  notifyEmail: flags.notifyEmail.optional(),
})

export type CreateWhatsAppSlaPolicyDTO = z.infer<
  typeof CreateWhatsAppSlaPolicySchema
>

export const UpdateWhatsAppSlaPolicySchema = CreateWhatsAppSlaPolicySchema.omit(
  { teamId: true },
).refine((value) => Object.keys(value).length > 0, {
  message: 'Informe ao menos um campo para alterar',
})

export type UpdateWhatsAppSlaPolicyDTO = z.infer<
  typeof UpdateWhatsAppSlaPolicySchema
>

/** ISO date (`YYYY-MM-DD`) or full ISO datetime. */
const isoDate = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Data inválida')

export const WhatsAppSlaReportQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  teamId: z.string().min(1).optional(),
  format: z.enum(['json', 'csv']).optional(),
})

export type WhatsAppSlaReportQuery = z.infer<
  typeof WhatsAppSlaReportQuerySchema
>

export const WhatsAppSlaOpenQuerySchema = z.object({
  state: z.enum(['AT_RISK', 'BREACHED']).optional(),
})
