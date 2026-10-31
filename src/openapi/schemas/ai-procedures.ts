import { z } from 'zod'
import { ProcedureStepSchema } from '@/src/schemas/ai-procedure.schema'
import { dto } from '../common'

/** DTOs dos Procedimentos da IA (`types/ai-procedure.d.ts`). */

const dateTime = () => z.iso.datetime()
const RunStatus = z.enum([
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'HANDED_OFF',
  'CANCELED',
])

export const AiProcedureDTO = dto(
  'AiProcedure',
  z.object({
    id: z.string().meta({ example: 'ckw1proc0000ab7d3k1e5xyz' }),
    name: z.string().meta({ example: 'Segunda via de boleto' }),
    description: z.string().nullable(),
    whenToUse: z.string().meta({
      example: 'O cliente pede a segunda via ou o código de barras de um boleto',
    }),
    status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']),
    steps: z.array(ProcedureStepSchema),
    maxAttempts: z.number().int(),
    handoffMessage: z.string().nullable(),
    whatsappEnabled: z.boolean(),
    agentIds: z.array(z.string()),
    ownerId: z.string().nullable(),
    currentVersion: z.number().int(),
    runsThisMonth: z.number().int().meta({
      description: 'Execuções iniciadas no mês corrente (contagem de cota).',
    }),
    createdAt: dateTime(),
    updatedAt: dateTime(),
  }),
)

export const AiProcedureVersionDTO = dto(
  'AiProcedureVersion',
  z.object({
    id: z.string(),
    number: z.number().int(),
    whenToUse: z.string(),
    steps: z.array(ProcedureStepSchema),
    maxAttempts: z.number().int(),
    handoffMessage: z.string().nullable(),
    changeNote: z.string().nullable(),
    createdById: z.string().nullable(),
    createdAt: dateTime(),
    current: z.boolean(),
  }),
)

const RunFields = {
  id: z.string(),
  procedureId: z.string(),
  procedureName: z.string(),
  versionNumber: z.number().int(),
  subjectType: z.enum(['WHATSAPP_CONVERSATION', 'STEEL_AGENT_RUN', 'TEST']),
  subjectId: z.string(),
  status: RunStatus,
  failureReason: z.string().nullable(),
  startedAt: dateTime(),
  finishedAt: dateTime().nullable(),
}

export const AiProcedureRunDTO = dto('AiProcedureRun', z.object(RunFields))

export const AiProcedureRunDetailDTO = dto(
  'AiProcedureRunDetail',
  z.object({
    ...RunFields,
    steps: z.array(
      z.object({
        id: z.string(),
        position: z.number().int(),
        stepKey: z.string(),
        kind: z.string(),
        title: z.string(),
        status: z.enum(['OK', 'FAILED', 'SKIPPED', 'REJECTED']),
        input: z.unknown(),
        output: z.unknown(),
        error: z.string().nullable(),
        createdAt: dateTime(),
      }),
    ),
  }),
)

export const AiProcedureCatalogDTO = dto(
  'AiProcedureCatalog',
  z.object({
    validations: z.array(z.string()),
    operators: z.array(z.string()),
    tools: z.array(
      z.object({
        name: z.string(),
        label: z.string(),
        description: z.string(),
      }),
    ),
    agents: z.array(z.object({ id: z.string(), name: z.string() })),
    presetVariables: z.array(z.string()),
    limits: z.object({
      procedures: z.number().int(),
      steps: z.number().int(),
    }),
    canManage: z.boolean(),
  }),
)

export const AiProcedurePreviewDTO = dto(
  'AiProcedurePreview',
  z.object({
    problems: z.array(z.string()),
    plan: z.array(
      z.object({
        key: z.string(),
        title: z.string(),
        kind: z.enum(['COLLECT', 'HTTP', 'TOOL', 'MESSAGE', 'HANDOFF']),
        required: z.boolean(),
        applies: z.boolean(),
      }),
    ),
  }),
)
