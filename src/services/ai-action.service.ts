import type { AiActionConnector, Prisma } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logFields } from '@/lib/axiom/log-fields'
import { logger } from '@/lib/axiom/logger'
import {
  type AppError,
  aiActionConnectorFailed,
  aiActionConnectorInvalid,
  aiActionConnectorLimitReached,
  aiActionConnectorNotFound,
  aiActionInProgress,
  aiActionsDisabled,
} from '@/src/errors/app-error'
import {
  buildConnectorRequest,
  callConnector,
  deriveIdempotencyKey,
  guardConnectorUrl,
} from '@/src/lib/ai-actions/http-connector'
import type { AiToolContext, AiToolOutput } from '@/src/lib/ai/tools/types'
import {
  decryptConnectionSecret,
  encryptConnectionSecret,
} from '@/src/lib/crypto'
import { err, ok, type Result } from '@/src/lib/result'
import {
  connectorParamsOf,
  toAiActionConnectorDTO,
  toAiActionSettingsDTO,
  zapToolsOf,
} from '@/src/mappers/ai-action.mapper'
import { AiActionConnectorRepository } from '@/src/repositories/ai-action-connector.repository'
import { AiActionExecutionRepository } from '@/src/repositories/ai-action-execution.repository'
import { AiActionSettingsRepository } from '@/src/repositories/ai-action-settings.repository'
import {
  AI_ACTION_CONNECTOR_LIMIT,
  type CreateAiActionConnectorDTO,
  connectorProblem,
  type UpdateAiActionConnectorDTO,
  type UpdateAiActionSettingsDTO,
} from '@/src/schemas/ai-action.schema'
import type {
  AiActionConnectorDTO,
  AiActionConnectorsDTO,
  AiActionSettingsDTO,
} from '@/types/ai-action'
import { assertMember, assertPrivileged } from './authz'

/**
 * AI actions on customer systems (T3): the workspace registers HTTP
 * connectors (allow-list of what the AI may reach), an OWNER/ADMIN switches
 * the feature on, and the `act_*` tools call them. Writes carry an
 * idempotency key (header + ledger), so a retried run never repeats a
 * password reset. Connector management is OWNER/ADMIN only; calling one
 * needs workspace membership and the tool's own mode (AUTO/APPROVAL).
 */

/** A PENDING claim older than this is considered abandoned. */
export const ACTION_PENDING_STALE_MS = 2 * 60_000
/** The same write inside this window replays the stored outcome. */
export const ACTION_REPLAY_WINDOW_MS = 24 * 60 * 60_000

type Scalar = string | number | boolean

async function readHeaders(
  connector: AiActionConnector,
): Promise<Record<string, string>> {
  if (!connector.encryptedHeaders) return {}
  try {
    const parsed = JSON.parse(
      await decryptConnectionSecret(connector.encryptedHeaders),
    ) as Record<string, string>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

async function toDTO(
  connector: AiActionConnector,
): Promise<AiActionConnectorDTO> {
  return toAiActionConnectorDTO(
    connector,
    Object.keys(await readHeaders(connector)),
  )
}

async function loadConnector(
  workspaceId: string,
  connectorId: string,
): Promise<Result<AiActionConnector>> {
  const found = await AiActionConnectorRepository.findById(
    connectorId,
    workspaceId,
  )
  if (!found.ok) return found
  if (!found.value) return err(aiActionConnectorNotFound())
  return ok(found.value)
}

function audit(
  entity: 'ai_action_connector' | 'ai_action_settings',
  action: 'create' | 'update' | 'delete' | 'send',
  actorId: string,
  workspaceId: string,
  targetId: string,
  meta: Record<string, unknown> = {},
  failure?: string,
): void {
  auditMutation({
    entity,
    action,
    actorId,
    targetId,
    ...(failure && { outcome: 'failure' as const, reason: failure }),
    meta: { workspaceId, ...meta },
  })
}

/** SSRF guard on save (checked again before every call). */
async function guardTemplate(urlTemplate: string): Promise<Result<true>> {
  const guarded = await guardConnectorUrl(
    urlTemplate.replaceAll(/\{[^}]*\}/g, 'x'),
  )
  return guarded.ok ? ok(true) : guarded
}

async function enabledSettings(workspaceId: string): Promise<Result<true>> {
  const settings = await AiActionSettingsRepository.find(workspaceId)
  if (!settings.ok) return settings
  if (!settings.value?.enabled) return err(aiActionsDisabled())
  return ok(true)
}

export const AiActionService = {
  async list(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<AiActionConnectorsDTO>> {
    const member = await assertPrivileged(actorId, workspaceId)
    if (!member.ok) return member
    const [connectors, settings] = await Promise.all([
      AiActionConnectorRepository.listByWorkspace(workspaceId),
      AiActionSettingsRepository.find(workspaceId),
    ])
    if (!connectors.ok) return connectors
    if (!settings.ok) return settings
    return ok({
      connectors: await Promise.all(connectors.value.map(toDTO)),
      settings: toAiActionSettingsDTO(settings.value),
      limit: AI_ACTION_CONNECTOR_LIMIT,
    })
  },

  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateAiActionConnectorDTO,
  ): Promise<Result<AiActionConnectorDTO>> {
    const member = await assertPrivileged(actorId, workspaceId)
    if (!member.ok) return member
    const safe = await guardTemplate(dto.urlTemplate)
    if (!safe.ok) return safe
    const count = await AiActionConnectorRepository.count(workspaceId)
    if (!count.ok) return count
    if (count.value >= AI_ACTION_CONNECTOR_LIMIT) {
      return err(aiActionConnectorLimitReached(AI_ACTION_CONNECTOR_LIMIT))
    }
    const hasHeaders = Object.keys(dto.headers).length > 0
    const created = await AiActionConnectorRepository.create({
      workspaceId,
      key: dto.key,
      name: dto.name,
      description: dto.description,
      kind: dto.kind,
      method: dto.method,
      urlTemplate: dto.urlTemplate,
      params: dto.params,
      enabled: dto.enabled,
      encryptedHeaders: hasHeaders
        ? await encryptConnectionSecret(JSON.stringify(dto.headers))
        : null,
    })
    if (!created.ok) return created
    audit('ai_action_connector', 'create', actorId, workspaceId, created.value.id, {
      key: dto.key,
      kind: dto.kind,
    })
    return ok(await toDTO(created.value))
  },

  async update(
    actorId: string,
    workspaceId: string,
    connectorId: string,
    dto: UpdateAiActionConnectorDTO,
  ): Promise<Result<AiActionConnectorDTO>> {
    const member = await assertPrivileged(actorId, workspaceId)
    if (!member.ok) return member
    const current = await loadConnector(workspaceId, connectorId)
    if (!current.ok) return current

    const merged = {
      kind: dto.kind ?? current.value.kind,
      method: dto.method ?? current.value.method,
      urlTemplate: dto.urlTemplate ?? current.value.urlTemplate,
      params: dto.params ?? connectorParamsOf(current.value.params),
    }
    const problem = connectorProblem(merged)
    if (problem) return err(aiActionConnectorInvalid(problem))
    if (dto.urlTemplate !== undefined) {
      const safe = await guardTemplate(dto.urlTemplate)
      if (!safe.ok) return safe
    }

    const { headers, ...rest } = dto
    const updated = await AiActionConnectorRepository.update(connectorId, {
      ...rest,
      ...(headers !== undefined && {
        encryptedHeaders:
          Object.keys(headers).length > 0
            ? await encryptConnectionSecret(JSON.stringify(headers))
            : null,
      }),
    })
    if (!updated.ok) return updated
    audit('ai_action_connector', 'update', actorId, workspaceId, connectorId, {
      fields: Object.keys(dto),
    })
    return ok(await toDTO(updated.value))
  },

  async remove(
    actorId: string,
    workspaceId: string,
    connectorId: string,
  ): Promise<Result<true>> {
    const member = await assertPrivileged(actorId, workspaceId)
    if (!member.ok) return member
    const current = await loadConnector(workspaceId, connectorId)
    if (!current.ok) return current
    const removed = await AiActionConnectorRepository.delete(connectorId)
    if (!removed.ok) return removed
    audit('ai_action_connector', 'delete', actorId, workspaceId, connectorId, {
      key: current.value.key,
    })
    return ok(true)
  },

  async updateSettings(
    actorId: string,
    workspaceId: string,
    dto: UpdateAiActionSettingsDTO,
  ): Promise<Result<AiActionSettingsDTO>> {
    const member = await assertPrivileged(actorId, workspaceId)
    if (!member.ok) return member

    if (dto.zapTools && dto.zapTools.length > 0) {
      const { findTool } = await import('@/src/lib/ai/tools/registry')
      for (const entry of dto.zapTools) {
        const tool = findTool(entry.toolName)
        if (!tool) {
          return err(
            aiActionConnectorInvalid(`Ferramenta desconhecida: ${entry.toolName}`),
          )
        }
      }
    }
    if (dto.zapActorId) {
      const actor = await assertPrivileged(dto.zapActorId, workspaceId)
      if (!actor.ok) {
        return err(
          aiActionConnectorInvalid(
            'A identidade da resposta automática precisa ser dono ou administrador do workspace.',
          ),
        )
      }
    }

    const saved = await AiActionSettingsRepository.upsert(workspaceId, {
      ...(dto.enabled !== undefined && { enabled: dto.enabled }),
      ...(dto.zapTools !== undefined && { zapTools: dto.zapTools }),
      ...(dto.zapActorId !== undefined && { zapActorId: dto.zapActorId }),
    })
    if (!saved.ok) return saved
    audit('ai_action_settings', 'update', actorId, workspaceId, workspaceId, {
      fields: Object.keys(dto),
      enabled: saved.value.enabled,
    })
    return ok(toAiActionSettingsDTO(saved.value))
  },

  /** Raw settings for the WhatsApp auto-reply (no actor: background job). */
  async zapConfig(workspaceId: string): Promise<
    Result<{
      enabled: boolean
      tools: { toolName: string; mode: 'AUTO' | 'APPROVAL' }[]
      actorId: string | null
    }>
  > {
    const settings = await AiActionSettingsRepository.find(workspaceId)
    if (!settings.ok) return settings
    return ok({
      enabled: settings.value?.enabled ?? false,
      tools: zapToolsOf(settings.value?.zapTools),
      actorId: settings.value?.zapActorId ?? null,
    })
  },

  /** Enabled connectors the model may use (empty while the switch is off). */
  async listForAi(
    ctx: AiToolContext,
  ): Promise<Result<AiActionConnectorDTO[]>> {
    const member = await assertMember(ctx.actorId, ctx.workspaceId)
    if (!member.ok) return member
    const on = await enabledSettings(ctx.workspaceId)
    if (!on.ok) return on
    const connectors = await AiActionConnectorRepository.listByWorkspace(
      ctx.workspaceId,
    )
    if (!connectors.ok) return connectors
    return ok(
      connectors.value
        .filter((c) => c.enabled)
        .map((c) => toAiActionConnectorDTO(c, [])),
    )
  },

  /** What the human approves before an ACTION runs (no mutation). */
  async describe(
    ctx: AiToolContext,
    connectorKey: string,
    kind: 'LOOKUP' | 'ACTION',
  ): Promise<Result<AiActionConnector>> {
    const member = await assertMember(ctx.actorId, ctx.workspaceId)
    if (!member.ok) return member
    const on = await enabledSettings(ctx.workspaceId)
    if (!on.ok) return on
    const found = await AiActionConnectorRepository.findByKey(
      ctx.workspaceId,
      connectorKey,
    )
    if (!found.ok) return found
    if (!found.value?.enabled || found.value.kind !== kind) {
      return err(aiActionConnectorNotFound())
    }
    return ok(found.value)
  },

  /**
   * Calls a connector. LOOKUP = read; ACTION = write with idempotency
   * (header + ledger). Never throws.
   */
  async invoke(
    ctx: AiToolContext,
    input: { connector: string; params: Record<string, Scalar> },
    kind: 'LOOKUP' | 'ACTION',
    options: { fetchImpl?: typeof fetch; now?: Date } = {},
  ): Promise<Result<AiToolOutput, AppError>> {
    const connector = await AiActionService.describe(ctx, input.connector, kind)
    if (!connector.ok) return connector
    const row = connector.value
    const built = buildConnectorRequest(
      {
        method: row.method,
        urlTemplate: row.urlTemplate,
        params: connectorParamsOf(row.params),
      },
      input.params,
    )
    if (!built.ok) return built
    const headers = await readHeaders(row)
    const target = { type: 'ai_action_connector', id: row.id, label: row.name }

    if (kind === 'LOOKUP') {
      const response = await callConnector({
        request: built.value,
        headers,
        idempotencyKey: null,
        fetchImpl: options.fetchImpl,
      })
      return finish(ctx, row, response, false, target)
    }

    const key = deriveIdempotencyKey({
      workspaceId: ctx.workspaceId,
      connectorKey: row.key,
      params: input.params,
      scope: ctx.agentId ?? ctx.conversationId ?? null,
    })
    const now = options.now ?? new Date()
    const claim = await AiActionExecutionRepository.claim(
      ctx.workspaceId,
      key,
      row.key,
      {
        staleBefore: new Date(now.getTime() - ACTION_PENDING_STALE_MS),
        replayBefore: new Date(now.getTime() - ACTION_REPLAY_WINDOW_MS),
      },
    )
    if (!claim.ok) return claim
    if (claim.value.kind === 'existing') {
      if (claim.value.row.status === 'SUCCESS') {
        return ok({
          summary: `“${row.name}” já havia sido executada com estes dados; resultado repetido.`,
          data: {
            replayed: true,
            status: claim.value.row.httpStatus,
            response: claim.value.row.response,
          },
          target,
        })
      }
      return err(aiActionInProgress())
    }

    const response = await callConnector({
      request: built.value,
      headers,
      idempotencyKey: key,
      fetchImpl: options.fetchImpl,
    })
    const completed = await AiActionExecutionRepository.complete(
      claim.value.id,
      response.ok && response.value.ok
        ? {
            status: 'SUCCESS',
            httpStatus: response.value.status,
            response: (response.value.body ?? null) as Prisma.InputJsonValue,
          }
        : {
            status: 'FAILURE',
            httpStatus: response.ok ? response.value.status : null,
            response: null,
          },
    )
    if (!completed.ok) {
      logger.error(
        'ai_actions.ledger_update_failed',
        logFields(
          { component: 'AiActionService', workspaceId: ctx.workspaceId },
          { connectorKey: row.key },
        ),
      )
    }
    return finish(ctx, row, response, true, target)
  },
}

function finish(
  ctx: AiToolContext,
  connector: AiActionConnector,
  response: Result<{ ok: boolean; status: number; body: unknown }, AppError>,
  isWrite: boolean,
  target: { type: string; id: string; label: string },
): Result<AiToolOutput, AppError> {
  const outcome = response.ok && response.value.ok ? 'success' : 'failure'
  if (isWrite) {
    auditMutation({
      entity: 'ai_action_connector',
      action: 'send',
      actorId: ctx.actorId,
      targetId: connector.id,
      outcome,
      ...(outcome === 'failure' && {
        reason: response.ok ? `http_${response.value.status}` : response.error.code,
      }),
      meta: {
        workspaceId: ctx.workspaceId,
        connectorKey: connector.key,
        source: ctx.source,
        agentId: ctx.agentId,
      },
    })
  }
  if (!response.ok) return response
  if (!response.value.ok) {
    return err(
      aiActionConnectorFailed(
        `O sistema respondeu com erro (HTTP ${response.value.status}).`,
      ),
    )
  }
  return ok({
    summary: isWrite
      ? `Ação “${connector.name}” executada (HTTP ${response.value.status}).`
      : `Consulta “${connector.name}” concluída.`,
    data: { status: response.value.status, response: response.value.body },
    target,
  })
}
