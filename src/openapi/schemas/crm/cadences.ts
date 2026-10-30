import { z } from 'zod'
import { dto } from '../../common'

/** DTOs das cadências de vendas (`types/crm-cadence.d.ts`). */

const dateTime = () => z.iso.datetime()
const nullableDateTime = () => z.iso.datetime().nullable()

export const CrmCadenceStepDTO = dto(
  'CrmCadenceStep',
  z.object({
    id: z.string(),
    position: z
      .number()
      .int()
      .meta({ description: 'Ordem do passo (0, 1, 2…).' }),
    type: z.enum(['EMAIL', 'WHATSAPP', 'TASK']),
    delayValue: z.number().int(),
    delayUnit: z.enum(['MINUTES', 'HOURS', 'DAYS']),
    subject: z
      .string()
      .nullable()
      .meta({ description: 'Assunto do e-mail ou título da tarefa.' }),
    body: z.string().meta({
      description:
        'Texto com campos `{{nome}}`, `{{primeiro_nome}}`, `{{empresa}}`, `{{cargo}}`, `{{cidade}}`, `{{responsavel}}`.',
    }),
    whatsappTemplateId: z.string().nullable(),
    templateVariables: z.array(z.string()),
  }),
)

export const CrmCadenceStatsDTO = dto(
  'CrmCadenceStats',
  z.object({
    enrolled: z.number().int(),
    active: z.number().int(),
    paused: z.number().int(),
    replied: z.number().int(),
    completed: z.number().int(),
    stopped: z.number().int(),
    replyRate: z.number().meta({
      description: 'Fração (0 a 1) das inscrições que terminaram com resposta.',
    }),
    stoppedByClick: z.number().int().meta({
      description: 'Inscrições encerradas por clique (`stopOnClick`).',
    }),
    sentByStep: z.array(
      z.object({
        position: z.number().int(),
        sent: z.number().int(),
        skipped: z.number().int(),
        failed: z.number().int(),
        opened: z.number().int().meta({
          description: 'E-mails distintos abertos (só passos de e-mail).',
        }),
        clicked: z.number().int().meta({
          description: 'E-mails distintos com algum link clicado.',
        }),
        reached: z.number().int().meta({
          description:
            'Inscrições que passaram pelo passo (enviado, pulado ou falho).',
        }),
      }),
    ),
  }),
)

export const CrmCadenceDTO = dto(
  'CrmCadence',
  z.object({
    id: z.string(),
    workspaceId: z.string(),
    name: z.string().meta({ example: 'Prospecção outbound' }),
    description: z.string().nullable(),
    status: z.enum(['ACTIVE', 'PAUSED', 'ARCHIVED']),
    emailFrom: z.string().nullable(),
    emailReplyTo: z.string().nullable(),
    whatsappConnectionId: z.string().nullable(),
    stopOnReply: z.boolean(),
    stopOnClick: z.boolean().meta({
      description:
        'Um clique em link rastreado de e-mail também encerra a inscrição.',
    }),
    windowStartHour: z.number().int().nullable(),
    windowEndHour: z.number().int().nullable(),
    weekdaysOnly: z.boolean(),
    steps: z.array(CrmCadenceStepDTO),
    stats: CrmCadenceStatsDTO.nullable(),
    createdById: z.string(),
    createdAt: dateTime(),
    updatedAt: dateTime(),
  }),
)

export const CrmCadenceRunDTO = dto(
  'CrmCadenceRun',
  z.object({
    id: z.string(),
    stepId: z.string().nullable(),
    position: z.number().int(),
    type: z.enum(['EMAIL', 'WHATSAPP', 'TASK']),
    status: z.enum(['SENT', 'SKIPPED', 'FAILED', 'PENDING']),
    detail: z.string().nullable(),
    openedAt: nullableDateTime(),
    clickedAt: nullableDateTime(),
    openCount: z.number().int(),
    clickCount: z.number().int(),
    createdAt: dateTime(),
  }),
)

export const CrmCadenceEnrollmentDTO = dto(
  'CrmCadenceEnrollment',
  z.object({
    id: z.string(),
    workspaceId: z.string(),
    cadenceId: z.string(),
    cadenceName: z.string().nullable(),
    leadId: z.string(),
    leadName: z.string().nullable(),
    status: z.enum(['ACTIVE', 'PAUSED', 'REPLIED', 'COMPLETED', 'STOPPED']),
    nextPosition: z.number().int(),
    totalSteps: z.number().int().nullable(),
    nextRunAt: nullableDateTime(),
    stopReason: z
      .enum([
        'REPLIED',
        'MANUAL',
        'LEAD_CLOSED',
        'LEAD_DELETED',
        'NO_CONTACT',
        'CLICKED',
        'CADENCE_ARCHIVED',
      ])
      .nullable(),
    repliedVia: z.string().nullable(),
    enrolledById: z.string(),
    enrolledAt: dateTime(),
    finishedAt: nullableDateTime(),
    runs: z.array(CrmCadenceRunDTO),
  }),
)

export const CrmCadenceEnrollResultDTO = dto(
  'CrmCadenceEnrollResult',
  z.object({
    enrolled: z.array(CrmCadenceEnrollmentDTO),
    skipped: z.array(z.object({ leadId: z.string(), reason: z.string() })),
  }),
)
