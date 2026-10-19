import { z } from 'zod'
import { FEATURE_KEYS } from '@/src/config/features'
import { AnalyticsResultSchema } from '@/src/schemas/admin-analytics.schema'
import { dto } from '../common'

/** DTOs do painel admin global (`types/admin-*.d.ts`, `types/changelog.d.ts`). */

const dateTime = () => z.iso.datetime()
const nullableDateTime = () => z.iso.datetime().nullable()

const PLAN = z.enum(['FREE', 'PRO', 'BUSINESS', 'ENTERPRISE'])
const WORKSPACE_STATUS = z.enum(['ACTIVE', 'SUSPENDED', 'DELETING'])
const MODULE = z.enum(['SERVICE_DESK', 'CRM', 'COMMUNICATION'])

export const AdminWorkspaceSummaryDTO = dto(
  'AdminWorkspaceSummary',
  z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    activePlan: PLAN,
    status: WORKSPACE_STATUS,
    memberCount: z.number().int(),
    createdAt: dateTime(),
  }),
)

export const AdminWorkspaceDetailDTO = dto(
  'AdminWorkspaceDetail',
  z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    activePlan: PLAN,
    status: WORKSPACE_STATUS,
    memberCount: z.number().int(),
    createdAt: dateTime(),
    trialEndsAt: nullableDateTime(),
    suspendedAt: nullableDateTime(),
    suspendedReason: z.string().nullable(),
    updatedAt: dateTime(),
  }),
)

export const AdminWorkspaceRecordDTO = dto(
  'AdminWorkspaceRecord',
  z
    .object({
      id: z.string(),
      name: z.string(),
      slug: z.string(),
      activePlan: PLAN,
      trialEndsAt: nullableDateTime(),
      status: WORKSPACE_STATUS,
      suspendedAt: nullableDateTime(),
      suspendedReason: z.string().nullable(),
      suspendedById: z.string().nullable(),
      createdAt: dateTime(),
      updatedAt: dateTime(),
    })
    .meta({ description: 'Registro do workspace como está no banco.' }),
)

export const AdminOperationDTO = dto(
  'AdminOperation',
  z
    .object({
      id: z.string(),
      kind: z.enum(['WORKSPACE_DELETE', 'WORKSPACE_RESTORE']),
      status: z.enum(['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED']),
      step: z.string().meta({
        description:
          'Etapa atual: `queued` → `backup` → `purge_database` → `purge_files` → `done` (exclusão), etc.',
        example: 'backup',
      }),
      workspaceId: z.string(),
      workspaceSlug: z.string(),
      workspaceName: z.string(),
      backupId: z.string().nullable(),
      requestedByEmail: z.string(),
      reason: z.string(),
      error: z.string().nullable(),
      subscriptionsCancelled: z
        .array(z.object({ billId: z.string(), plan: z.string() }))
        .meta({
          description:
            'Assinaturas canceladas automaticamente na AbacatePay (exclusão).',
        }),
      subscriptionsToCancel: z
        .array(z.object({ billId: z.string(), plan: z.string() }))
        .meta({
          description:
            'Assinaturas que a AbacatePay recusou cancelar numa exclusão forçada: exigem cancelamento manual. Vazio no caminho normal.',
        }),
      filesDeleted: z.number().int().nullable(),
      filesError: z.string().nullable(),
      safetyBackupId: z.string().nullable(),
      createdAt: dateTime(),
      updatedAt: dateTime(),
      completedAt: nullableDateTime(),
    })
    .meta({
      description:
        'Exclusão ou restauração de workspace executada pelo worker.',
    }),
)

export const AdminBackupDTO = dto(
  'AdminBackup',
  z.object({
    id: z.string(),
    scope: z.enum(['FULL', 'WORKSPACE']),
    status: z.enum(['RUNNING', 'COMPLETED', 'FAILED']),
    workspaceId: z.string().nullable(),
    workspaceSlug: z.string().nullable(),
    workspaceExists: z.boolean().meta({
      description: '`false` quando o workspace do backup não existe mais.',
    }),
    sizeBytes: z.number().int().nullable(),
    errorMessage: z.string().nullable(),
    locations: z.object({ local: z.boolean(), offsite: z.boolean() }),
    offsiteCopiedAt: nullableDateTime(),
    triggeredBy: z.enum(['admin', 'system']),
    startedAt: dateTime(),
    completedAt: nullableDateTime(),
    expiresAt: nullableDateTime(),
  }),
)

export const AdminAuditEntryDTO = dto(
  'AdminAuditEntry',
  z.object({
    id: z.string(),
    actorEmail: z.string(),
    action: z.string().meta({ example: 'workspace.suspend' }),
    targetType: z.string(),
    targetId: z.string().nullable(),
    targetLabel: z.string().nullable(),
    reason: z.string().nullable(),
    failed: z.boolean(),
    createdAt: dateTime(),
  }),
)

const ComponentStatus = z.enum([
  'OPERATIONAL',
  'DEGRADED',
  'PARTIAL_OUTAGE',
  'MAJOR_OUTAGE',
  'MAINTENANCE',
])

export const AdminOverviewDTO = dto(
  'AdminOverview',
  z.object({
    generatedAt: dateTime(),
    workspaces: z.object({
      total: z.number().int(),
      active: z.number().int(),
      suspended: z.number().int(),
      deleting: z.number().int(),
      trial: z.number().int(),
      createdLast30d: z.number().int(),
      createdPrev30d: z.number().int(),
    }),
    users: z.object({
      total: z.number().int(),
      createdLast7d: z.number().int(),
      createdPrev7d: z.number().int(),
    }),
    mrr: z.object({
      cents: z.number().int().meta({ description: 'MRR em centavos (BRL).' }),
      payingWorkspaces: z.number().int(),
    }),
    recentSignups: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        email: z.string(),
        createdAt: dateTime(),
      }),
    ),
    recentActions: z.array(AdminAuditEntryDTO),
    queues: z
      .array(
        z.object({
          name: z.string(),
          waiting: z.number().int(),
          active: z.number().int(),
          delayed: z.number().int(),
          failed: z.number().int(),
          completed: z.number().int(),
        }),
      )
      .nullable()
      .meta({ description: '`null` quando o Redis das filas não respondeu.' }),
    status: z.array(
      z.object({
        componentKey: z.string(),
        name: z.string(),
        status: ComponentStatus,
        latencyMs: z.number(),
        checkedAt: dateTime(),
      }),
    ),
    recentBackups: z.array(AdminBackupDTO),
    operations: z.array(AdminOperationDTO),
  }),
)

export const AdminMetricsDTO = dto(
  'AdminMetrics',
  z.object({
    generatedAt: dateTime(),
    windowDays: z.number().int(),
    totalWorkspaces: z.number().int(),
    activeClients: z
      .number()
      .int()
      .meta({ description: 'Workspaces com uso de módulo na janela.' }),
    workspacesWithLogin: z.number().int(),
    mrr: z.object({
      cents: z.number().int(),
      payingWorkspaces: z.number().int(),
    }),
    churnByMonth: z.array(
      z.object({
        month: z.string().meta({ example: '2026-08' }),
        cancelled: z.number().int(),
        expired: z.number().int(),
        lostMrrCents: z.number().int(),
      }),
    ),
    usage: z.object({
      totals: z.array(
        z.object({
          module: MODULE,
          requests: z.number().int(),
          mutations: z.number().int(),
          workspaces: z.number().int(),
        }),
      ),
      daily: z.array(
        z.object({
          day: z.string(),
          module: MODULE,
          requests: z.number().int(),
          mutations: z.number().int(),
        }),
      ),
      topWorkspaces: z.array(
        z.object({
          workspaceId: z.string(),
          name: z.string(),
          slug: z.string(),
          requests: z.number().int(),
          mutations: z.number().int(),
        }),
      ),
      trackedSince: z.string().nullable(),
    }),
  }),
)

export const AdminFeatureDTO = dto(
  'AdminWorkspaceFeature',
  z.object({
    key: z.enum(FEATURE_KEYS),
    module: MODULE,
    label: z.string(),
    description: z.string(),
    planDefault: z.boolean(),
    override: z
      .object({
        enabled: z.boolean(),
        note: z.string().nullable(),
        expiresAt: nullableDateTime(),
        expired: z.boolean(),
        updatedById: z.string().nullable(),
        updatedAt: dateTime(),
      })
      .nullable(),
    enabled: z.boolean(),
  }),
)

const CHANGELOG_STATUS = z.enum([
  'DRAFT',
  'QUEUED',
  'RUNNING',
  'DONE',
  'FAILED',
])

export const ChangelogSummaryDTO = dto(
  'ChangelogSummary',
  z.object({
    id: z.string(),
    subject: z.string(),
    status: CHANGELOG_STATUS,
    createdById: z.string(),
    recipientCount: z.number().int(),
    sentCount: z.number().int(),
    failedCount: z.number().int(),
    createdAt: dateTime(),
    updatedAt: dateTime(),
  }),
)

export const ChangelogDetailDTO = dto(
  'ChangelogDetail',
  z.object({
    id: z.string(),
    subject: z.string(),
    status: CHANGELOG_STATUS,
    createdById: z.string(),
    recipientCount: z.number().int(),
    sentCount: z.number().int(),
    failedCount: z.number().int(),
    createdAt: dateTime(),
    updatedAt: dateTime(),
    items: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        body: z.string(),
        imageUrl: z.string().nullable(),
        position: z.number().int(),
      }),
    ),
    recipients: z.array(
      z.object({
        id: z.string(),
        email: z.string(),
        userId: z.string().nullable(),
        status: z.enum(['PENDING', 'SENT', 'FAILED']),
        errorMessage: z.string().nullable(),
        sentAt: nullableDateTime(),
      }),
    ),
  }),
)

export const ChangelogReleaseDraftDTO = dto(
  'ChangelogReleaseDraft',
  z.object({
    subject: z.string(),
    items: z.array(z.object({ title: z.string(), body: z.string() })),
    skipped: z.number().int().meta({
      description: 'Linhas internas (ci, chore, test...) descartadas.',
    }),
    release: z
      .object({
        tag: z.string(),
        name: z.string().nullable(),
        url: z.string(),
        publishedAt: nullableDateTime(),
        fromCommits: z.boolean().meta({
          description:
            '`true` quando as notas eram vazias e os itens vieram dos commits.',
        }),
      })
      .nullable(),
  }),
)

export const AdminAnalyticsDTO = dto(
  'AdminAnalytics',
  AnalyticsResultSchema.meta({
    description:
      'Uma aba do painel Analytics (`view`). Cada painel é `{ ok: true, data }` ou `{ ok: false, error }`; sem `AXIOM_QUERY_TOKEN` vem `unconfigured: true` (exceto `jobs`, que lê o Redis).',
  }),
)

export const PlatformAiSettingsDTO = dto(
  'PlatformAiSettings',
  z.object({
    costMargin: z.number().meta({
      description: 'Multiplicador sobre o preço do provedor (1 = custo).',
    }),
    updatedAt: nullableDateTime(),
    models: z.array(
      z.object({
        key: z.string(),
        provider: z.enum(['openai', 'anthropic']),
        label: z.string(),
        inputUsdPer1M: z.number(),
        outputUsdPer1M: z.number(),
        cachedInputUsdPer1M: z.number().nullable(),
        chargedInputUsdPer1M: z.number(),
        chargedOutputUsdPer1M: z.number(),
      }),
    ),
    embeddingsEnabled: z.boolean().meta({
      description:
        'Embeddings da busca de conhecimento do Steel AI (ADR 0037). Desligado = busca só por texto.',
    }),
    knowledgeSearch: z
      .object({
        providerConfigured: z.boolean(),
        vectorIndexReady: z.boolean(),
        mode: z.enum(['hybrid', 'text']),
      })
      .meta({
        description:
          'Estado da busca de conhecimento neste ambiente: chave do provedor de embeddings, pgvector instalado e o modo que uma busca usa agora.',
      }),
    taskModels: z
      .object({
        CLASSIFICATION: z.string().nullable(),
        CONVERSATION: z.string().nullable(),
        ASSISTANT: z.string().nullable(),
        AGENT: z.string().nullable(),
      })
      .meta({
        description:
          'Modelo padrão de cada classe de tarefa (ADR 0042) para workspaces que não escolheram. `null` = padrão da plataforma (agentes: o do assistente).',
      }),
    failoverEnabled: z.boolean().meta({
      description:
        'Contingência automática de provedor (ADR 0042) em toda a plataforma.',
    }),
  }),
)
