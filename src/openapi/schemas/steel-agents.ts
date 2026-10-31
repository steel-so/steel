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
      delegateAgentIds: z.array(z.string()).meta({
        description:
          'A7: agentes a quem este pode delegar tarefas, como uma ferramenta (`delegate_to_agent`). Até 10; sem ciclos.',
      }),
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
      simGateEnabled: z.boolean().meta({
        description:
          'A3: além da avaliação, a versão precisa passar nos cenários da última simulação salva do agente. Desligado por padrão.',
      }),
      simGateMinPassRate: z.number().meta({
        description:
          'Parcela mínima (0 a 1) de cenários aprovados quando `simGateEnabled`.',
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
    simulationId: z.string().nullable().meta({
      description:
        'Simulação que travou a versão (A3), quando a trava está ligada.',
    }),
    simPassed: z.number().int().nullable(),
    simTotal: z.number().int().nullable(),
    simPassRate: z.number().nullable(),
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
    simGateEnabled: z.boolean(),
    simGateMinPassRate: z.number(),
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
        external: z.boolean().optional().meta({
          description:
            'A8: ferramenta de um servidor MCP externo (`mcp_<servidor>__<ferramenta>`).',
        }),
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
    canCreate: z.boolean().meta({
      description:
        'A8: o usuário pode criar agentes (política de criação ou matriz de permissões).',
    }),
    autoRestricted: z.boolean().meta({
      description:
        'A8: o modo automático é limitado por perfil neste workspace.',
    }),
    autoAllowedTools: z.array(z.string()).nullable().meta({
      description:
        'A8: ferramentas que o perfil do usuário pode deixar em `AUTO` (`null` = sem limite).',
    }),
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
    parentRunId: z.string().nullable().meta({
      description:
        'A7: execução que delegou esta (`null` = não é uma execução delegada).',
    }),
    depth: z.number().int().meta({
      description: 'A7: profundidade da delegação (0 = execução principal).',
    }),
    delegatedCostUsd: z.number().meta({
      description:
        'A7: custo das execuções delegadas, já incluído em `costUsd`.',
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

/* ------------------- Simulações com personas (A3) ------------------- */

const SimulationStatus = z.enum([
  'QUEUED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'SKIPPED',
])
const SimulationChannel = z.enum(['WHATSAPP', 'EMAIL', 'PORTAL', 'CHAT'])

export const SteelAgentSimulationDTO = dto(
  'SteelAgentSimulation',
  z.object({
    id: z.string(),
    agentId: z.string(),
    name: z.string().meta({ example: 'Simulação de 2026-11-06' }),
    status: SimulationStatus,
    startedById: z.string().nullable(),
    passScore: z.number().int().meta({
      description: 'Nota mínima (0-100) do avaliador para um cenário passar.',
    }),
    totalCases: z.number().int(),
    passedCases: z.number().int(),
    failedCases: z.number().int(),
    avgScore: z.number().int().nullable(),
    inputTokens: z.number().int(),
    outputTokens: z.number().int(),
    costUsd: z.number(),
    modelKey: z.string().nullable(),
    error: z.string().nullable(),
    startedAt: dateTime().nullable(),
    finishedAt: dateTime().nullable(),
    createdAt: dateTime(),
  }),
)

const SimulationCase = z.object({
  id: z.string(),
  position: z.number().int(),
  label: z.string(),
  personaKey: z.string().nullable(),
  persona: z.string(),
  scenario: z.string(),
  channel: SimulationChannel,
  openingMessage: z.string(),
  criteria: z.array(z.string()),
  maxTurns: z.number().int(),
  status: z.enum(['QUEUED', 'RUNNING', 'DONE', 'FAILED']),
  verdict: z.enum(['PASS', 'FAIL']).nullable(),
  score: z.number().int().nullable(),
  transcript: z.array(
    z.object({ role: z.enum(['customer', 'agent']), text: z.string() }),
  ),
  toolEvents: z.array(
    z.object({
      turn: z.number().int(),
      toolName: z.string(),
      kind: z.string(),
      status: z.enum(['OK', 'SIMULATED', 'FAILED']),
      title: z.string().nullable(),
      error: z.string().nullable(),
    }),
  ),
  criteriaResults: z.array(
    z.object({
      criterion: z.string(),
      met: z.boolean(),
      evidence: z.string(),
    }),
  ),
  judgeSummary: z.string().nullable(),
  endReason: z.string().nullable(),
  error: z.string().nullable(),
  costUsd: z.number(),
  startedAt: dateTime().nullable(),
  finishedAt: dateTime().nullable(),
})

export const SteelAgentSimulationDetailDTO = dto(
  'SteelAgentSimulationDetail',
  SteelAgentSimulationDTO.extend({
    agentName: z.string(),
    cases: z.array(SimulationCase),
  }),
)

export const SteelAgentSimulationScenarioDraftDTO = dto(
  'SteelAgentSimulationScenarioDraft',
  z.object({
    label: z.string(),
    persona: z.string(),
    scenario: z.string(),
    channel: SimulationChannel,
    openingMessage: z.string(),
    criteria: z.array(z.string()),
  }),
)

// nov: ai-governance — A6 painel, A7 delegação e A8 servidores MCP

const GovRole = z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'])
const AutoRule = z.object({
  mode: z.enum(['ALL', 'NONE', 'LIST']),
  tools: z.array(z.string()),
})

export const SteelAgentPolicyDTO = dto(
  'SteelAgentPolicy',
  z
    .object({
      restrictCreators: z.boolean().meta({
        description:
          'Ligado: só OWNER/ADMIN e os perfis de `creatorRoles` criam agentes. Desligado: vale a matriz de permissões.',
      }),
      creatorRoles: z.array(GovRole),
      restrictAuto: z.boolean().meta({
        description:
          'Ligado: o modo automático depende do perfil (de quem configura e do responsável do agente ao rodar). O OWNER nunca é limitado.',
      }),
      autoRules: z.object({
        OWNER: AutoRule,
        ADMIN: AutoRule,
        MEMBER: AutoRule,
        VIEWER: AutoRule,
      }),
    })
    .meta({ description: 'Política de criação e de modo automático (A8).' }),
)

export const SteelKillSwitchDTO = dto(
  'SteelKillSwitch',
  z.object({
    active: z.boolean(),
    at: dateTime().nullable(),
    byName: z.string().nullable(),
    reason: z.string().nullable(),
  }),
)

const GovTool = z.object({
  toolName: z.string(),
  label: z.string(),
  kind: z.enum(['READ', 'CREATE', 'UPDATE', 'DELETE', 'ACTION', 'UNKNOWN']),
  module: AiModule.nullable(),
  mode: ToolMode,
  external: z.boolean(),
})

export const SteelGovernanceDTO = dto(
  'SteelGovernance',
  z
    .object({
      periodDays: z.number().int(),
      since: dateTime(),
      killSwitch: SteelKillSwitchDTO,
      policy: SteelAgentPolicyDTO,
      totals: z.object({
        agents: z.number().int(),
        active: z.number().int(),
        withoutOwner: z.number().int(),
        runs: z.number().int(),
        costUsd: z.number(),
        applied: z.number().int(),
        approvalRate: z.number().nullable(),
      }),
      agents: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          description: z.string().nullable(),
          enabled: z.boolean(),
          triggerType: TriggerType,
          owner: z
            .object({
              id: z.string(),
              name: z.string(),
              email: z.string(),
              role: GovRole.nullable().meta({
                description: '`null` = já não é membro do workspace.',
              }),
            })
            .nullable(),
          createdByName: z.string().nullable(),
          tools: z.array(GovTool),
          delegates: z.array(z.object({ id: z.string(), name: z.string() })),
          modules: z.array(AiModule),
          risks: z.array(
            z.enum([
              'NO_OWNER',
              'AUTO_WRITES',
              'CONTACTS_THIRD_PARTIES',
              'DELEGATES',
            ]),
          ),
          metrics: z.object({
            runs: z.number().int(),
            succeeded: z.number().int(),
            failed: z.number().int(),
            skipped: z.number().int(),
            costUsd: z.number().meta({
              description: 'Custo próprio, sem as execuções delegadas.',
            }),
            delegatedCostUsd: z.number(),
            applied: z.number().int().meta({
              description: 'Escritas que passaram (automáticas ou aprovadas).',
            }),
            approvals: z.object({
              approved: z.number().int(),
              rejected: z.number().int(),
              expired: z.number().int(),
              pending: z.number().int(),
            }),
            approvalRate: z.number().nullable(),
            rejectionRate: z.number().nullable(),
            costPerApplied: z.number().nullable(),
            lastRunAt: dateTime().nullable(),
          }),
        }),
      ),
    })
    .meta({
      description:
        'Painel de governança: inventário de agentes com responsável, permissões, taxas de aprovação e rejeição e custo frente ao impacto.',
    }),
)

export const SteelKillResultDTO = dto(
  'SteelKillResult',
  z.object({
    killSwitch: SteelKillSwitchDTO,
    canceledRuns: z.number().int(),
    canceledActions: z.number().int(),
  }),
)

export const SteelMcpServerDTO = dto(
  'SteelMcpServer',
  z
    .object({
      id: z.string(),
      name: z.string(),
      slug: z.string().meta({ example: 'github' }),
      url: z.string().meta({ example: 'https://mcp.example.com/mcp' }),
      authHeaderName: z.string().meta({ example: 'Authorization' }),
      hasAuth: z.boolean().meta({
        description: 'Há credencial guardada; o valor nunca é devolvido.',
      }),
      enabled: z.boolean(),
      tools: z.array(
        z.object({
          name: z.string(),
          agentToolName: z
            .string()
            .meta({ example: 'mcp_github__list_issues' }),
          description: z.string(),
          readOnly: z.boolean(),
          allowed: z.boolean(),
        }),
      ),
      discoveredAt: dateTime().nullable(),
      lastError: z.string().nullable(),
      createdAt: dateTime(),
    })
    .meta({ description: 'Servidor MCP externo que os agentes podem chamar.' }),
)
