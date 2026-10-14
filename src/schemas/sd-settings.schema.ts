import z from 'zod'
import { sdId } from './sd-config.schema'
import { SdTicketTypeEnum } from './sd-rule.schema'

export const SD_DEFAULT_TICKET_PREFIXES = {
  INCIDENT: 'INC',
  SERVICE_REQUEST: 'REQ',
  CHANGE: 'CHG',
  PROBLEM: 'PRB',
} as const

const prefix = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{1,8}$/, 'Prefixo: 1 a 8 letras/dígitos')

export const SdTicketPrefixesSchema = z.object({
  INCIDENT: prefix,
  SERVICE_REQUEST: prefix,
  CHANGE: prefix,
  PROBLEM: prefix,
})

const keyword = z.string().trim().min(1).max(60)

export const UpdateSdSettingsSchema = z
  .object({
    ticketPrefixes: SdTicketPrefixesSchema.partial().optional(),
    defaultDepartmentId: sdId.nullable().optional(),
    defaultSlaPolicyId: sdId.nullable().optional(),
    whatsappConnectionId: sdId.nullable().optional(),
    whatsappSendAcknowledgement: z.boolean().optional(),
    portalEnabled: z.boolean().optional(),
    portalTicketTypes: z
      .array(SdTicketTypeEnum)
      .max(4)
      .transform((types) => [...new Set(types)])
      .optional(),
    portalCompanyScope: z.boolean().optional(),
    requireSignatureOnClose: z.boolean().optional(),
    requireSolutionOnResolve: z.boolean().optional(),
    autoCloseResolvedAfterHours: z.number().int().min(0).max(8760).optional(),
    slaAtRiskPercent: z.number().int().min(1).max(99).optional(),
    reopenOnRequesterReply: z.boolean().optional(),
    autoAssignRoundRobin: z.boolean().optional(),
    kbReviewIntervalDays: z.number().int().min(1).max(3650).optional(),
    aiEnabled: z.boolean().optional(),
    aiPreServiceEnabled: z.boolean().optional(),
    aiAutoTriageEnabled: z.boolean().optional(),
    aiWhatsappAutoReply: z.boolean().optional(),
    aiPersona: z.string().trim().max(2000).nullable().optional(),
    aiInstructions: z.string().trim().max(10000).nullable().optional(),
    aiHandoffKeywords: z
      .array(keyword)
      .max(50)
      .transform((words) => [...new Set(words)])
      .optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Informe ao menos um campo',
  })

export type UpdateSdSettingsDTO = z.infer<typeof UpdateSdSettingsSchema>
