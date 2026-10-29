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
      evalSetId: z.string().nullable().meta({
        description:
          'Conjunto de avaliação (`target: STEEL_AGENT`) que trava a publicação de versões. `null` = edições publicam na hora.',
      }),
      evalMinPassRate: z.number().meta({
        description: 'Parcela mínima (0 a 1) de casos aprovados para publicar.',
        example: 0.8,
      }),
      publishedVersionId: z.string().nullable().meta({
        description:
          'Versão que o agente executa; os campos `instructions`, `tools` e `maxToolRounds` espelham essa versão.',
      }),
      challengerVersionId: z.string().nullable().meta({
        description: 'Versão em teste A/B dividindo o tráfego com a publicada.',
      }),
      createdAt: dateTime(),
      updatedAt: dateTime(),
    })
    .meta({ description: 'Agente autônomo do Steel AI.' }),
)

const VersionStatus = z.enum([
  'PENDING_EVAL',
  'REJECTED',
  'PUBLISHED',
  'CHALLENGER',
  'SUPERSEDED',
  'DISCARDED',
])

export const SteelAgentVersionRefDTO = dto(
  'SteelAgentVersionRef',
  z.object({
    id: z.string(),
    number: z.number().int(),
    status: VersionStatus,
  }),
)

export const SteelAgentUpdateResultDTO = dto(
  'SteelAgentUpdateResult',
  SteelAgentDTO.extend({
    version: SteelAgentVersionRefDTO.nullable().meta({
      description:
        'Versão criada pela edição; `null` quando nada versionado mudou (nome, gatilho, pausa...).',
    }),
  }),
)

const VersionStats = z.object({
  runs: z.number().int(),
  succeeded: z.number().int(),
  failed: z.number().int(),
  skipped: z.number().int(),
  successRate: z.number().nullable(),
  avgCostUsd: z.number().nullable(),
  avgRounds: z.number().nullable(),
  approvalsDecided: z.number().int(),
  approvalsApproved: z.number().int(),
  approvalRate: z.number().nullable(),
})

export const SteelAgentVersionDTO = dto(
  'SteelAgentVersion',
  z.object({
    id: z.string(),
    agentId: z.string(),
    number: z.number().int().meta({ description: 'Sequencial por agente.' }),
    status: VersionStatus,
    instructions: z.string(),
    maxToolRounds: z.number().int(),
    tools: z.array(z.object({ toolName: z.string(), mode: ToolMode })),
    changeNote: z.string().nullable(),
    rolloutPercent: z.number().int().nullable().meta({
      description: 'Parcela (1 a 99) das execuções do teste A/B.',
    }),
    evalRunId: z.string().nullable(),
    evalPassed: z.number().int().nullable(),
    evalTotal: z.number().int().nullable(),
    evalPassRate: z.number().nullable(),
    evalNote: z.string().nullable(),
    createdById: z.string().nullable(),
    publishedAt: dateTime().nullable(),
    resolvedAt: dateTime().nullable(),
    createdAt: dateTime(),
    stats: VersionStats.meta({
      description: 'Métricas das execuções reais (testes não contam).',
    }),
  }),
)

export const SteelAgentVersionListDTO = dto(
  'SteelAgentVersionList',
  z.object({
    versions: z.array(SteelAgentVersionDTO),
    publishedVersionId: z.string().nullable(),
    challengerVersionId: z.string().nullable(),
    evalSetId: z.string().nullable(),
    evalMinPassRate: z.number(),
    canManage: z.boolean(),
  }),
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
    versionId: z.string().nullable().meta({
      description:
        'Versão do agente que atendeu a execução (`null` em testes e execuções anteriores às versões).',
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
