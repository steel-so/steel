import z from 'zod'
import { clearableText } from '@/src/schemas/clearable.schema'

export const CRM_CADENCE_MAX_STEPS = 20
export const CRM_CADENCE_MAX_ENROLL_BATCH = 200

const StepTypeEnum = z.enum(['EMAIL', 'WHATSAPP', 'TASK'])
const DelayUnitEnum = z.enum(['MINUTES', 'HOURS', 'DAYS'])
const hour = z.number().int().min(0).max(23)

export const CrmCadenceStepSchema = z
  .object({
    type: StepTypeEnum,
    delayValue: z.number().int().min(0).max(365).default(0),
    delayUnit: DelayUnitEnum.default('DAYS'),
    subject: z.string().trim().max(200).nullish(),
    body: z.string().max(10000).default(''),
    whatsappTemplateId: z.string().nullish(),
    templateVariables: z.array(z.string().max(500)).max(10).default([]),
  })
  .superRefine((step, ctx) => {
    if (step.type === 'EMAIL') {
      if (!step.subject) {
        ctx.addIssue({
          code: 'custom',
          path: ['subject'],
          message: 'Informe o assunto do e-mail',
        })
      }
      if (!step.body.trim()) {
        ctx.addIssue({
          code: 'custom',
          path: ['body'],
          message: 'Escreva a mensagem do e-mail',
        })
      }
    }
    if (
      step.type === 'WHATSAPP' &&
      !step.body.trim() &&
      !step.whatsappTemplateId
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['body'],
        message: 'Escreva a mensagem ou escolha um template',
      })
    }
    if (step.type === 'TASK' && !step.subject) {
      ctx.addIssue({
        code: 'custom',
        path: ['subject'],
        message: 'Informe o título da tarefa',
      })
    }
  })

export type CrmCadenceStepInput = z.infer<typeof CrmCadenceStepSchema>

const windowRefine = (
  value: { windowStartHour?: number | null; windowEndHour?: number | null },
  ctx: z.RefinementCtx,
) => {
  const start = value.windowStartHour ?? null
  const end = value.windowEndHour ?? null
  if ((start === null) !== (end === null)) {
    ctx.addIssue({
      code: 'custom',
      path: ['windowEndHour'],
      message: 'Informe o início e o fim da janela de envio',
    })
  }
}

const cadenceFields = {
  name: z.string().trim().min(1, 'Nome é obrigatório').max(120),
  description: z.string().trim().max(1000).nullish(),
  emailFrom: z.email().max(200).nullish(),
  emailReplyTo: z.email().max(200).nullish(),
  whatsappConnectionId: z.string().nullish(),
  stopOnReply: z.boolean().default(true),
  stopOnClick: z.boolean().default(false),
  windowStartHour: hour.nullish(),
  windowEndHour: hour.nullish(),
  weekdaysOnly: z.boolean().default(true),
}

export const CreateCrmCadenceSchema = z
  .object({
    ...cadenceFields,
    steps: z
      .array(CrmCadenceStepSchema)
      .min(1, 'Adicione ao menos um passo')
      .max(CRM_CADENCE_MAX_STEPS),
  })
  .superRefine(windowRefine)

export type CreateCrmCadenceDTO = z.infer<typeof CreateCrmCadenceSchema>

export const UpdateCrmCadenceSchema = z
  .object({
    name: cadenceFields.name.optional(),
    description: clearableText(1000),
    emailFrom: z.email().max(200).nullish(),
    emailReplyTo: z.email().max(200).nullish(),
    whatsappConnectionId: z.string().nullish(),
    stopOnReply: z.boolean().optional(),
    stopOnClick: z.boolean().optional(),
    windowStartHour: hour.nullish(),
    windowEndHour: hour.nullish(),
    weekdaysOnly: z.boolean().optional(),
    status: z.enum(['ACTIVE', 'PAUSED']).optional(),
    steps: z
      .array(CrmCadenceStepSchema)
      .min(1, 'Adicione ao menos um passo')
      .max(CRM_CADENCE_MAX_STEPS)
      .optional(),
  })
  .superRefine(windowRefine)

export type UpdateCrmCadenceDTO = z.infer<typeof UpdateCrmCadenceSchema>

export const ListCrmCadenceEnrollmentsSchema = z.object({
  cadenceId: z.string().optional(),
  leadId: z.string().optional(),
  status: z
    .enum(['ACTIVE', 'PAUSED', 'REPLIED', 'COMPLETED', 'STOPPED'])
    .optional(),
})

export type ListCrmCadenceEnrollmentsDTO = z.infer<
  typeof ListCrmCadenceEnrollmentsSchema
>

export const EnrollCrmCadenceSchema = z.object({
  cadenceId: z.string().min(1),
  leadIds: z
    .array(z.string().min(1))
    .min(1, 'Escolha ao menos um lead')
    .max(CRM_CADENCE_MAX_ENROLL_BATCH),
})

export type EnrollCrmCadenceDTO = z.infer<typeof EnrollCrmCadenceSchema>

export const CrmCadenceEnrollmentActionSchema = z.object({
  action: z.enum(['stop', 'pause', 'resume', 'replied']),
})

export type CrmCadenceEnrollmentActionDTO = z.infer<
  typeof CrmCadenceEnrollmentActionSchema
>
