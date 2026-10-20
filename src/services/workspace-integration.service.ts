import type {
  Prisma,
  WorkspaceIntegration,
  WorkspaceIntegrationKind,
} from '@prisma/client'
import { auditAuth, auditMutation } from '@/lib/axiom/audit'
import { logFields } from '@/lib/axiom/log-fields'
import { logger } from '@/lib/axiom/logger'
import { BETTER_AUTH_URL } from '@/lib/env/server'
import {
  sdIntegrationNotConfigured,
  sdIntegrationRequestFailed,
  validationError,
} from '@/src/errors'
import type { AppError } from '@/src/errors/app-error'
import { encryptConnectionSecret } from '@/src/lib/crypto'
import { ApolloClient } from '@/src/lib/integrations/apollo-client'
import {
  type RepoIntegrationKind,
  WORKSPACE_INTEGRATION_KINDS,
} from '@/src/lib/integrations/catalog'
import {
  parseWorkspaceRepoConfig,
  parseWorkspaceSlackConfig,
  type WorkspaceSlackConfig,
} from '@/src/lib/integrations/config'
import {
  normalizeGitlabBaseUrl,
  parseGitlabProject,
} from '@/src/lib/integrations/gitlab'
import { GitlabClient } from '@/src/lib/integrations/gitlab-client'
import { err, ok, type Result } from '@/src/lib/result'
import { GithubClient } from '@/src/lib/servicedesk/github-client'
import {
  parseSdGithubRepo,
  sdGithubRepoKey,
} from '@/src/lib/servicedesk/integrations'
import {
  getSlackAppConfig,
  SLACK_EVENTS_PATH,
  SlackClient,
  slackAuthorizeUrl,
} from '@/src/lib/servicedesk/slack-client'
import {
  createSdSlackOauthState,
  verifySdSlackOauthState,
} from '@/src/lib/servicedesk/slack-oauth-state'
import { toWorkspaceIntegrationDTO } from '@/src/mappers/workspace-integration.mapper'
import { WorkspaceRepository } from '@/src/repositories/workspace.repository'
import { WorkspaceIntegrationRepository } from '@/src/repositories/workspace-integration.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import type {
  ConnectGithubDTO,
  ConnectGitlabDTO,
  UpdateRepoCredentialsDTO,
  UpdateWorkspaceSlackDTO,
} from '@/src/schemas/workspace-integration.schema'
import type {
  IntegrationModuleDTO,
  SlackChannelOptionDTO,
  WorkspaceIntegrationDTO,
  WorkspaceIntegrationProviderDTO,
  WorkspaceIntegrationsOverviewDTO,
  WorkspaceIntegrationTestDTO,
} from '@/types/workspace-integration'
import { assertPrivileged } from './authz'
import { decryptSdIntegrationToken } from './sd-integration-credentials'

/**
 * Workspace-level integrations (Ajustes > Integrações, ADR 0024): Slack,
 * GitHub and GitLab, connected once per workspace and used by every module.
 * **OWNER/ADMIN only** (`assertPrivileged`).
 *
 * - Slack: OAuth of the Steel Slack app. Without `SLACK_CLIENT_ID`/`SECRET`/
 *   `SIGNING_SECRET` the provider shows as unavailable with the reason.
 * - GitHub: repository + token (fine-grained PAT) + webhook secret.
 * - GitLab: instance URL (gitlab.com or self-managed) + project + personal/
 *   project/group access token + webhook secret token.
 *
 * Tokens and secrets are encrypted with `CONNECTION_SECRETS` and never come
 * back in a DTO, a log or an API response. Every change is audited.
 */

/** Public webhook paths (the same for every workspace). */
export const GITHUB_WEBHOOK_PATH = '/api/integrations/github/webhook'
export const GITLAB_WEBHOOK_PATH = '/api/integrations/gitlab/webhook'

const SLACK_UNAVAILABLE_REASON =
  'O app do Slack não está configurado neste servidor (SLACK_CLIENT_ID, SLACK_CLIENT_SECRET e SLACK_SIGNING_SECRET). Até lá a integração fica desligada: nada é enviado nem recebido.'

const MODULES: IntegrationModuleDTO[] = ['SERVICE_DESK', 'CRM', 'COMMUNICATION']

function absolute(path: string): string {
  return `${BETTER_AUTH_URL.replace(/\/$/, '')}${path}`
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue
}

function audit(
  actorId: string,
  workspaceId: string,
  action: 'connect' | 'update' | 'test' | 'disconnect',
  kind: WorkspaceIntegrationKind,
  targetId: string | null,
  extra: {
    outcome?: 'success' | 'failure'
    reason?: string
    meta?: Record<string, unknown>
  } = {},
): void {
  auditMutation({
    entity: 'workspace_integration',
    action,
    actorId,
    targetId,
    outcome: extra.outcome,
    reason: extra.reason,
    meta: { workspaceId, kind, ...(extra.meta ?? {}) },
  })
}

/** Writes the Slack config in the new shape (keeps the module settings). */
function slackConfigJson(config: WorkspaceSlackConfig): Prisma.InputJsonValue {
  return asJson({
    routes: config.routes,
    waitingMinutes: config.waitingMinutes,
    servicedesk: config.servicedesk,
  })
}

async function requirePrivileged(
  actorId: string,
  workspaceId: string,
): Promise<Result<true>> {
  const ctx = await assertPrivileged(actorId, workspaceId)
  if (!ctx.ok) return ctx
  return ok(true)
}

/**
 * Validates a token against the provider for an existing connection
 * (rotation and "Testar conexão").
 */
async function probe(
  integration: WorkspaceIntegration,
  token: string,
): Promise<Result<string>> {
  if (integration.kind === 'SLACK') {
    const result = await SlackClient.authTest(token)
    if (!result.ok) return result
    return ok(
      `Token válido no workspace do Slack ${result.value.teamName ?? integration.externalName ?? integration.externalId}`,
    )
  }
  if (integration.kind === 'GITHUB') {
    const ref = parseSdGithubRepo(integration.externalId)
    if (!ref) return err(sdIntegrationRequestFailed('Repositório inválido'))
    const result = await GithubClient.checkRepo(token, ref)
    if (!result.ok) return result
    return ok(`Acesso confirmado a ${result.value.fullName}`)
  }
  if (integration.kind === 'APOLLO') {
    const result = await ApolloClient.health(token)
    if (!result.ok) return result
    return ok('Chave válida: a Apollo respondeu normalmente')
  }
  const result = await GitlabClient.checkProject(
    integration.baseUrl ?? normalizeGitlabBaseUrl(null) ?? '',
    token,
    integration.externalId,
  )
  if (!result.ok) return result
  return ok(`Acesso confirmado a ${result.value.pathWithNamespace}`)
}

export const WorkspaceIntegrationService = {
  /** State of the page: availability, connection and URLs per provider. */
  async overview(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<WorkspaceIntegrationsOverviewDTO>> {
    const allowed = await requirePrivileged(actorId, workspaceId)
    if (!allowed.ok) return allowed

    const [rows, modules] = await Promise.all([
      WorkspaceIntegrationRepository.list(workspaceId),
      WorkspaceModuleAccessRepository.listByWorkspace(workspaceId),
    ])
    if (!rows.ok) return rows
    if (!modules.ok) return modules

    const slackReady = getSlackAppConfig() !== null
    const providers: WorkspaceIntegrationProviderDTO[] =
      WORKSPACE_INTEGRATION_KINDS.map((kind) => {
        const found = rows.value.find((row) => row.kind === kind)
        const connection = found ? toWorkspaceIntegrationDTO(found) : null
        if (kind === 'SLACK') {
          return {
            kind,
            available: slackReady,
            unavailableReason: slackReady ? null : SLACK_UNAVAILABLE_REASON,
            webhookUrl: slackReady ? absolute(SLACK_EVENTS_PATH) : null,
            connection,
          }
        }
        if (kind === 'APOLLO') {
          return {
            kind,
            available: true,
            unavailableReason: null,
            webhookUrl: null,
            connection,
          }
        }
        return {
          kind,
          available: true,
          unavailableReason: null,
          webhookUrl: absolute(
            kind === 'GITHUB' ? GITHUB_WEBHOOK_PATH : GITLAB_WEBHOOK_PATH,
          ),
          connection,
        }
      })

    const enabled = new Set(
      modules.value.filter((m) => m.enabled).map((m) => m.module as string),
    )
    return ok({
      providers,
      enabledModules: MODULES.filter((module) => enabled.has(module)),
    })
  },

  /* ---------------------------------- Slack ---------------------------------- */

  /** Slack authorization URL (the workspace travels in the signed `state`). */
  async beginSlackConnect(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<{ authorizeUrl: string }>> {
    const allowed = await requirePrivileged(actorId, workspaceId)
    if (!allowed.ok) return allowed

    const app = getSlackAppConfig()
    if (!app) return err(sdIntegrationNotConfigured(SLACK_UNAVAILABLE_REASON))

    const workspace = await WorkspaceRepository.findById(workspaceId)
    if (!workspace.ok) return workspace

    const state = createSdSlackOauthState(workspaceId, workspace.value.slug)
    return ok({ authorizeUrl: slackAuthorizeUrl(app, state) })
  },

  /**
   * Closes the OAuth: checks the `state`, exchanges the `code` for the bot
   * token and stores the encrypted connection. Audited as an access grant
   * (`auditAuth`) and as a mutation.
   */
  async completeSlackConnect(
    actorId: string,
    state: string,
    code: string,
  ): Promise<Result<{ workspaceSlug: string; teamName: string | null }>> {
    const app = getSlackAppConfig()
    if (!app) return err(sdIntegrationNotConfigured(SLACK_UNAVAILABLE_REASON))

    const parsed = verifySdSlackOauthState(state)
    if (!parsed.ok) {
      auditAuth({
        event: 'auth.oauth_grant.workspace_slack',
        userId: actorId,
        outcome: 'failure',
        reason: 'STATE_INVALID',
      })
      return err(validationError('Pedido de conexão inválido ou expirado'))
    }
    const { workspaceId, slug } = parsed.value

    const allowed = await requirePrivileged(actorId, workspaceId)
    if (!allowed.ok) return allowed

    const exchanged = await SlackClient.exchangeCode(app, code)
    if (!exchanged.ok) {
      auditAuth({
        event: 'auth.oauth_grant.workspace_slack',
        userId: actorId,
        outcome: 'failure',
        reason: exchanged.error.code,
        meta: { workspaceId },
      })
      return exchanged
    }

    // Reconnecting keeps the rules and the module settings.
    const current = await WorkspaceIntegrationRepository.findByKind(
      workspaceId,
      'SLACK',
    )
    if (!current.ok) return current
    const config = parseWorkspaceSlackConfig(current.value?.config ?? {})

    const saved = await WorkspaceIntegrationRepository.connect(
      workspaceId,
      'SLACK',
      exchanged.value.teamId,
      {
        externalName: exchanged.value.teamName,
        encryptedToken: await encryptConnectionSecret(
          exchanged.value.accessToken,
        ),
        config: slackConfigJson(config),
        createdById: actorId,
        status: 'ACTIVE',
        statusError: null,
      },
    )
    if (!saved.ok) return saved

    auditAuth({
      event: 'auth.oauth_grant.workspace_slack',
      userId: actorId,
      meta: { workspaceId, teamId: exchanged.value.teamId },
    })
    audit(actorId, workspaceId, 'connect', 'SLACK', saved.value.id, {
      meta: { teamId: exchanged.value.teamId },
    })
    return ok({ workspaceSlug: slug, teamName: exchanged.value.teamName })
  },

  /** Channels the bot can see (rule editor and team channels). */
  async listSlackChannels(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<SlackChannelOptionDTO[]>> {
    const allowed = await requirePrivileged(actorId, workspaceId)
    if (!allowed.ok) return allowed

    const integration = await WorkspaceIntegrationRepository.requireByKind(
      workspaceId,
      'SLACK',
    )
    if (!integration.ok) return integration

    const token = await decryptSdIntegrationToken(integration.value)
    if (!token.ok) return token

    const channels = await SlackClient.listChannels(token.value)
    if (!channels.ok) {
      await WorkspaceIntegrationRepository.markError(
        integration.value.id,
        channels.error.message,
      )
      return channels
    }
    return ok(channels.value)
  },

  /** Notification rules (event → channel) and the waiting threshold. */
  async updateSlack(
    actorId: string,
    workspaceId: string,
    dto: UpdateWorkspaceSlackDTO,
  ): Promise<Result<WorkspaceIntegrationDTO>> {
    const allowed = await requirePrivileged(actorId, workspaceId)
    if (!allowed.ok) return allowed

    const integration = await WorkspaceIntegrationRepository.requireByKind(
      workspaceId,
      'SLACK',
    )
    if (!integration.ok) return integration

    const current = parseWorkspaceSlackConfig(integration.value.config)
    const next: WorkspaceSlackConfig = {
      ...current,
      routes: dto.routes ?? current.routes,
      waitingMinutes: dto.waitingMinutes ?? current.waitingMinutes,
    }
    const updated = await WorkspaceIntegrationRepository.update(
      integration.value.id,
      workspaceId,
      { config: slackConfigJson(next) },
    )
    if (!updated.ok) return updated

    audit(actorId, workspaceId, 'update', 'SLACK', updated.value.id, {
      meta: { fields: Object.keys(dto), routes: next.routes.length },
    })
    return ok(toWorkspaceIntegrationDTO(updated.value))
  },

  /* --------------------------------- GitHub --------------------------------- */

  /** Connects the repository: the token is checked before anything is saved. */
  async connectGithub(
    actorId: string,
    workspaceId: string,
    dto: ConnectGithubDTO,
  ): Promise<Result<WorkspaceIntegrationDTO>> {
    const allowed = await requirePrivileged(actorId, workspaceId)
    if (!allowed.ok) return allowed

    const ref = parseSdGithubRepo(dto.repo)
    if (!ref) {
      return err(
        validationError(
          'Repositório inválido — use `owner/repo` ou a URL do GitHub',
        ),
      )
    }

    const check = await GithubClient.checkRepo(dto.token, ref)
    if (!check.ok) {
      audit(actorId, workspaceId, 'connect', 'GITHUB', null, {
        outcome: 'failure',
        reason: check.error.code,
      })
      return check
    }
    // The canonical name GitHub returns is what `repository.full_name` of
    // the webhook will match.
    const canonical = parseSdGithubRepo(check.value.fullName) ?? ref
    const current = await WorkspaceIntegrationRepository.findByKind(
      workspaceId,
      'GITHUB',
    )
    if (!current.ok) return current

    const saved = await WorkspaceIntegrationRepository.connect(
      workspaceId,
      'GITHUB',
      sdGithubRepoKey(canonical),
      {
        externalName: check.value.fullName,
        baseUrl: null,
        encryptedToken: await encryptConnectionSecret(dto.token),
        encryptedSigningSecret: dto.webhookSecret
          ? await encryptConnectionSecret(dto.webhookSecret)
          : null,
        config: asJson(parseWorkspaceRepoConfig(current.value?.config ?? {})),
        createdById: actorId,
        status: 'ACTIVE',
        statusError: null,
        lastCheckedAt: new Date(),
      },
    )
    if (!saved.ok) return saved

    audit(actorId, workspaceId, 'connect', 'GITHUB', saved.value.id, {
      meta: { repo: saved.value.externalId },
    })
    return ok(toWorkspaceIntegrationDTO(saved.value))
  },

  /* --------------------------------- GitLab --------------------------------- */

  /** Connects the project (gitlab.com or self-managed), checked first. */
  async connectGitlab(
    actorId: string,
    workspaceId: string,
    dto: ConnectGitlabDTO,
  ): Promise<Result<WorkspaceIntegrationDTO>> {
    const allowed = await requirePrivileged(actorId, workspaceId)
    if (!allowed.ok) return allowed

    const baseUrl = normalizeGitlabBaseUrl(dto.baseUrl)
    if (!baseUrl) {
      return err(
        validationError(
          'Endereço do GitLab inválido — use HTTPS e um domínio público (ex.: https://gitlab.suaempresa.com)',
        ),
      )
    }
    const project = parseGitlabProject(dto.project, baseUrl)
    if (!project) {
      return err(
        validationError(
          'Projeto inválido — use `grupo/projeto` ou a URL do projeto nesta instância',
        ),
      )
    }

    const check = await GitlabClient.checkProject(baseUrl, dto.token, project)
    if (!check.ok) {
      audit(actorId, workspaceId, 'connect', 'GITLAB', null, {
        outcome: 'failure',
        reason: check.error.code,
      })
      return check
    }
    const current = await WorkspaceIntegrationRepository.findByKind(
      workspaceId,
      'GITLAB',
    )
    if (!current.ok) return current

    const saved = await WorkspaceIntegrationRepository.connect(
      workspaceId,
      'GITLAB',
      check.value.pathWithNamespace,
      {
        externalName: check.value.pathWithNamespace,
        baseUrl,
        encryptedToken: await encryptConnectionSecret(dto.token),
        encryptedSigningSecret: dto.webhookSecret
          ? await encryptConnectionSecret(dto.webhookSecret)
          : null,
        config: asJson(parseWorkspaceRepoConfig(current.value?.config ?? {})),
        createdById: actorId,
        status: 'ACTIVE',
        statusError: null,
        lastCheckedAt: new Date(),
      },
    )
    if (!saved.ok) return saved

    audit(actorId, workspaceId, 'connect', 'GITLAB', saved.value.id, {
      meta: { project: saved.value.externalId, host: new URL(baseUrl).host },
    })
    return ok(toWorkspaceIntegrationDTO(saved.value))
  },

  /* ---------------------------- GitHub and GitLab ---------------------------- */

  /** Rotates the token (checked first) and/or the webhook secret. */
  async updateRepoCredentials(
    actorId: string,
    workspaceId: string,
    kind: RepoIntegrationKind,
    dto: UpdateRepoCredentialsDTO,
  ): Promise<Result<WorkspaceIntegrationDTO>> {
    const allowed = await requirePrivileged(actorId, workspaceId)
    if (!allowed.ok) return allowed

    const integration = await WorkspaceIntegrationRepository.requireByKind(
      workspaceId,
      kind,
    )
    if (!integration.ok) return integration

    const data: Parameters<typeof WorkspaceIntegrationRepository.update>[2] = {}
    if (dto.token !== undefined) {
      const checked = await probe(integration.value, dto.token)
      if (!checked.ok) return checked
      data.encryptedToken = await encryptConnectionSecret(dto.token)
      data.status = 'ACTIVE'
      data.statusError = null
      data.lastCheckedAt = new Date()
    }
    if (dto.webhookSecret !== undefined) {
      data.encryptedSigningSecret = dto.webhookSecret
        ? await encryptConnectionSecret(dto.webhookSecret)
        : null
    }

    const updated = await WorkspaceIntegrationRepository.update(
      integration.value.id,
      workspaceId,
      data,
    )
    if (!updated.ok) return updated

    // Only the field names: never the token nor the secret.
    audit(actorId, workspaceId, 'update', kind, updated.value.id, {
      meta: { fields: Object.keys(dto) },
    })
    return ok(toWorkspaceIntegrationDTO(updated.value))
  },

  /* ------------------------------ test / remove ------------------------------ */

  /**
   * "Testar conexão": calls the provider with the stored token. A failure is
   * a normal answer (`ok: false` + reason) and stamps the connection with
   * the error; a missing connection or unreadable token is an error.
   */
  async test(
    actorId: string,
    workspaceId: string,
    kind: WorkspaceIntegrationKind,
  ): Promise<Result<WorkspaceIntegrationTestDTO>> {
    const allowed = await requirePrivileged(actorId, workspaceId)
    if (!allowed.ok) return allowed

    if (kind === 'SLACK' && !getSlackAppConfig()) {
      return err(sdIntegrationNotConfigured(SLACK_UNAVAILABLE_REASON))
    }

    const integration = await WorkspaceIntegrationRepository.requireByKind(
      workspaceId,
      kind,
    )
    if (!integration.ok) return integration

    const token = await decryptSdIntegrationToken(integration.value)
    let outcome: Result<string, AppError> = token.ok
      ? await probe(integration.value, token.value)
      : token

    if (
      outcome.ok &&
      kind !== 'SLACK' &&
      kind !== 'APOLLO' &&
      !integration.value.encryptedSigningSecret
    ) {
      outcome = err(
        sdIntegrationNotConfigured(
          'Token válido, mas sem segredo de webhook: as atualizações vindas do repositório são recusadas',
        ),
      )
    }

    const now = new Date()
    const updated = await WorkspaceIntegrationRepository.update(
      integration.value.id,
      workspaceId,
      outcome.ok
        ? { status: 'ACTIVE', statusError: null, lastCheckedAt: now }
        : {
            status: 'ERROR',
            statusError: outcome.error.message.slice(0, 500),
            lastCheckedAt: now,
          },
    )
    if (!updated.ok) return updated

    audit(actorId, workspaceId, 'test', kind, integration.value.id, {
      outcome: outcome.ok ? 'success' : 'failure',
      reason: outcome.ok ? undefined : outcome.error.code,
    })
    return ok({
      ok: outcome.ok,
      message: outcome.ok ? outcome.value : outcome.error.message,
      integration: toWorkspaceIntegrationDTO(updated.value),
    })
  },

  /**
   * Disconnects: the token is erased and the webhooks stop being accepted.
   * Ticket links already recorded stay in the ticket history.
   */
  async disconnect(
    actorId: string,
    workspaceId: string,
    kind: WorkspaceIntegrationKind,
  ): Promise<Result<void>> {
    const allowed = await requirePrivileged(actorId, workspaceId)
    if (!allowed.ok) return allowed

    const integration = await WorkspaceIntegrationRepository.requireByKind(
      workspaceId,
      kind,
    )
    if (!integration.ok) return integration
    const removed = await WorkspaceIntegrationRepository.disconnect(
      integration.value.id,
      workspaceId,
    )
    if (!removed.ok) return removed

    audit(actorId, workspaceId, 'disconnect', kind, integration.value.id)
    logger.info(
      'integrations.disconnected',
      logFields(
        { component: 'WorkspaceIntegrationService', workspaceId },
        { kind, integrationId: integration.value.id },
      ),
    )
    return ok(undefined)
  },
}
