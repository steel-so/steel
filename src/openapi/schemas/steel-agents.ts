import { z } from 'zod'
import { dto } from '../common'
import { AiPendingActionDTO } from './steel-ai'

/** DTOs dos Steel Agents (`types/steel-agent.d.ts`). */

const dateTime = () => z.iso.datetime()
const AiModule = z.enum(['SERVICE_DESK', 'CRM', 'COMMUNICATION'])
const TriggerType = z.enum(['SCHEDULE', 'EVENT', 'MANUAL'])
const ToolMode = z.enum(['AUTO', 'APPROVAL'])
const RunStatus = z.enum([
  'QUEUED',
  'RUNNING',
  'WAITING_APPROVAL',
  'SUCCEEDED',
  'FAILED',
  'SKIPPED',
])

export const SteelAgentDTO = dto(
  'SteelAgent',
  z
    .object({
      id: z.string().meta({ example: 'ckw1agnt0000ab7d3k1e5xyz' }),
      name: z.string().meta({ example: 'Triagem de chamados' }),
      description: z.string().nullable(),
      instructions: z.string(),
      triggerType: TriggerType,
      cron: z.string().nullable().meta({ example: '0 8 * * 1-5' }),
      timezone: z.string().meta({ example: 'America/Sao_Paulo' }),
      eventKey: z.string().nullable().meta({ example: 'sd.ticket.created' }),
      enabled: z.boolean(),
      owner: z
        .object({
          id: z.string(),
          name: z.string(),
          email: z.string(),
          image: z.string().nullable(),
        })
        .nullable()
        .meta({
          description:
            'Responsável: o agente roda com as permissões desta pessoa. `null` = conta excluída (o agente não roda).',
        }),
      createdById: z.string().nullable(),
      maxToolRounds: z.number().int(),
      monthlyRunCap: z.number().int().nullable(),
      lastRunAt: dateTime()
        .nullable()
        .meta({ description: 'Última ocorrência do cron já disparada.' }),
      nextRunAt: dateTime().nullable(),
      tools: z.array(
        z.object({
          toolName: z.string().meta({ example: 'sd_list_tickets' }),
          mode: ToolMode.meta({
            description:
              'Modo efetivo: ferramentas de exclusão sempre voltam como `APPROVAL`.',
          }),
        }),
      ),
      lastRun: z
        .object({
          id: z.string(),
          status: RunStatus,
          triggerType: TriggerType,
          createdAt: dateTime(),
          finishedAt: dateTime().nullable(),
        })
        .nullable(),
      createdAt: dateTime(),
      updatedAt: dateTime(),
    })
    .meta({ description: 'Agente autônomo do Steel AI.' }),
)

export const SteelAgentCatalogDTO = dto(
  'SteelAgentCatalog',
  z.object({
    tools: z.array(
      z.object({
        name: z.string(),
        label: z.string(),
        description: z.string(),
        module: AiModule.nullable(),
        kind: z.enum(['READ', 'CREATE', 'UPDATE', 'DELETE', 'ACTION']),
      }),
    ),
    events: z.array(
      z.object({
        key: z.string(),
        module: AiModule,
        label: z.string(),
        description: z.string(),
      }),
    ),
    agentModeEnabled: z.boolean(),
    canManage: z.boolean(),
  }),
)

export const SteelAgentRunDTO = dto(
  'SteelAgentRun',
  z.object({
    id: z.string(),
    agentId: z.string(),
    status: RunStatus,
    triggerType: TriggerType,
    triggerPayload: z.unknown(),
    startedById: z.string().nullable(),
    startedAt: dateTime().nullable(),
    finishedAt: dateTime().nullable(),
    summary: z.string().nullable(),
    error: z.string().nullable(),
    modelKey: z.string().nullable(),
    rounds: z.number().int(),
    inputTokens: z.number().int(),
    outputTokens: z.number().int(),
    costUsd: z.number(),
    isTest: z.boolean().meta({
      description:
        '"Testar agente": leituras reais, escritas simuladas, sem aprovações.',
    }),
    rerunOfId: z.string().nullable().meta({
      description:
        'Execução de origem quando este teste veio de "Reexecutar como teste".',
    }),
    createdAt: dateTime(),
  }),
)

export const SteelAgentRunDetailDTO = dto(
  'SteelAgentRunDetail',
  SteelAgentRunDTO.extend({
    agent: z.object({
      id: z.string(),
      name: z.string(),
      ownerId: z.string().nullable(),
    }),
    steps: z.array(
      z.object({
        id: z.string(),
        kind: z.enum(['MODEL', 'TOOL', 'APPROVAL', 'GUARDRAIL']).meta({
          description:
            'MODEL: raciocínio da rodada (`output.text`, `round`, tokens). TOOL: chamada com `input` e, nas consultas, `output.context` (trecho recuperado, só para responsável/admin). GUARDRAIL: regra acionada (`output.rule`, `title`, `detail`).',
        }),
        toolName: z.string().nullable(),
        toolLabel: z.string().nullable(),
        pendingActionId: z.string().nullable(),
        input: z.unknown(),
        output: z.unknown(),
        status: z.enum([
          'OK',
          'FAILED',
          'PENDING',
          'APPROVED',
          'REJECTED',
          'EXPIRED',
          'SIMULATED',
        ]),
        error: z.string().nullable(),
        createdAt: dateTime(),
      }),
    ),
    pendingActions: z.array(AiPendingActionDTO),
    canApprove: z.boolean(),
  }),
)

export const SteelAgentAssignmentDTO = dto(
  'SteelAgentAssignment',
  z.object({
    entityType: z.enum(['SD_TICKET', 'CRM_LEAD']),
    entityId: z.string(),
    agent: z
      .object({
        id: z.string(),
        name: z.string().meta({ example: 'Triagem de chamados' }),
        enabled: z.boolean(),
      })
      .nullable()
      .meta({ description: 'Agente atribuído; `null` = ninguém.' }),
    assignedAt: dateTime().nullable(),
  }),
)
