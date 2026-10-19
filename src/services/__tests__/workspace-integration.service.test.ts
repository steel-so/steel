import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeGitlabIntegration,
  createFakeSdGithubIntegration,
  createFakeSdIntegration,
} from '@/src/__tests__/factories/sd-integration.factory'
import { fakeGitlabToken } from '@/src/__tests__/helpers/fake-tokens'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  databaseError,
  forbidden,
  sdIntegrationNotFound,
  sdIntegrationRequestFailed,
} from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import { createSdSlackOauthState } from '@/src/lib/servicedesk/slack-oauth-state'

vi.mock('@/lib/axiom/audit', () => ({
  auditMutation: vi.fn(),
  auditAuth: vi.fn(),
}))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/lib/crypto', () => ({
  encryptConnectionSecret: vi.fn(async (value: string) => `enc:${value}`),
  decryptConnectionSecret: vi.fn(async (value: string) =>
    value.replace(/^enc:/, ''),
  ),
}))
vi.mock('../authz', () => ({ assertPrivileged: vi.fn() }))
vi.mock('@/src/repositories/workspace-integration.repository')
vi.mock('@/src/repositories/workspace-module-access.repository')
vi.mock('@/src/repositories/workspace.repository')
vi.mock('@/src/lib/servicedesk/slack-client', () => ({
  getSlackAppConfig: vi.fn(),
  slackAuthorizeUrl: vi.fn(
    (_config, state: string) => `https://slack.test/oauth?state=${state}`,
  ),
  SLACK_EVENTS_PATH: '/api/servicedesk/integrations/slack',
  SlackClient: {
    exchangeCode: vi.fn(),
    listChannels: vi.fn(),
    authTest: vi.fn(),
  },
}))
vi.mock('@/src/lib/servicedesk/github-client', () => ({
  GithubClient: { checkRepo: vi.fn() },
}))
vi.mock('@/src/lib/integrations/apollo-client', () => ({
  ApolloClient: { health: vi.fn() },
}))
vi.mock('@/src/lib/integrations/gitlab-client', () => ({
  GitlabClient: { checkProject: vi.fn() },
}))

import { auditAuth, auditMutation } from '@/lib/axiom/audit'
import { createFakeApolloIntegration } from '@/src/__tests__/factories/crm-apollo.factory'
import { ApolloClient } from '@/src/lib/integrations/apollo-client'
import { GitlabClient } from '@/src/lib/integrations/gitlab-client'
import { GithubClient } from '@/src/lib/servicedesk/github-client'
import {
  getSlackAppConfig,
  SlackClient,
} from '@/src/lib/servicedesk/slack-client'
import { WorkspaceRepository } from '@/src/repositories/workspace.repository'
import { WorkspaceIntegrationRepository } from '@/src/repositories/workspace-integration.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { assertPrivileged } from '../authz'
import { WorkspaceIntegrationService } from '../workspace-integration.service'

const repo = vi.mocked(WorkspaceIntegrationRepository)
const modules = vi.mocked(WorkspaceModuleAccessRepository)
const workspaces = vi.mocked(WorkspaceRepository)
const privileged = vi.mocked(assertPrivileged)
const slackApp = vi.mocked(getSlackAppConfig)
const slack = vi.mocked(SlackClient)
const github = vi.mocked(GithubClient)
const gitlab = vi.mocked(GitlabClient)
const audit = vi.mocked(auditMutation)
const authAudit = vi.mocked(auditAuth)

const WS = 'ws1'
const TOKEN = 'github_pat_11ABCDEFG0123456789'
const GL_TOKEN = fakeGitlabToken('0123456789abcdefghij')
const APP = {
  clientId: 'id',
  clientSecret: 'secret',
  signingSecret: 'signing',
  redirectUri: 'https://steel.test/cb',
  eventsUrl: 'https://steel.test/ev',
}

beforeEach(() => {
  vi.clearAllMocks()
  privileged.mockResolvedValue(ok({} as never))
  slackApp.mockReturnValue(APP)
  repo.list.mockResolvedValue(ok([]))
  repo.findByKind.mockResolvedValue(ok(null))
  repo.requireByKind.mockResolvedValue(ok(createFakeSdIntegration()))
  repo.connect.mockImplementation(async (_ws, kind, externalId, data) =>
    ok(
      createFakeSdIntegration({
        id: `int-${kind}`,
        kind,
        externalId,
        externalName: data.externalName ?? null,
        baseUrl: data.baseUrl ?? null,
        encryptedToken: data.encryptedToken,
        encryptedSigningSecret: data.encryptedSigningSecret ?? null,
        config: data.config as never,
      }),
    ),
  )
  repo.update.mockImplementation(async (id, _ws, data) =>
    ok(
      createFakeSdIntegration({
        id,
        status: data.status ?? 'ACTIVE',
        statusError: data.statusError ?? null,
        config: (data.config as never) ?? {},
      }),
    ),
  )
  repo.disconnect.mockResolvedValue(ok(undefined))
  repo.markError.mockResolvedValue(ok(undefined))
  modules.listByWorkspace.mockResolvedValue(
    ok([
      { module: 'SERVICE_DESK', enabled: true },
      { module: 'CRM', enabled: false },
      { module: 'COMMUNICATION', enabled: true },
    ] as never),
  )
  workspaces.findById.mockResolvedValue(ok({ id: WS, slug: 'acme' } as never))
})

describe('WorkspaceIntegrationService — authorization', () => {
  it('every operation refuses who is not OWNER/ADMIN', async () => {
    privileged.mockResolvedValue(err(forbidden()))
    const calls = [
      WorkspaceIntegrationService.overview('u1', WS),
      WorkspaceIntegrationService.beginSlackConnect('u1', WS),
      WorkspaceIntegrationService.listSlackChannels('u1', WS),
      WorkspaceIntegrationService.updateSlack('u1', WS, { waitingMinutes: 10 }),
      WorkspaceIntegrationService.connectGithub('u1', WS, {
        repo: 'o/r',
        token: TOKEN,
      }),
      WorkspaceIntegrationService.connectGitlab('u1', WS, {
        project: 'g/p',
        token: GL_TOKEN,
      }),
      WorkspaceIntegrationService.updateRepoCredentials('u1', WS, 'GITHUB', {
        webhookSecret: null,
      }),
      WorkspaceIntegrationService.test('u1', WS, 'GITHUB'),
      WorkspaceIntegrationService.disconnect('u1', WS, 'SLACK'),
    ]
    for (const result of await Promise.all(calls)) {
      expectErr(result, 'FORBIDDEN')
    }
    expect(repo.connect).not.toHaveBeenCalled()
    expect(repo.update).not.toHaveBeenCalled()
  })
})

describe('WorkspaceIntegrationService.overview', () => {
  it('lists the three providers with availability, URLs and enabled modules', async () => {
    repo.list.mockResolvedValue(
      ok([createFakeSdIntegration(), createFakeGitlabIntegration()]),
    )
    const view = expectOk(await WorkspaceIntegrationService.overview('u1', WS))
    expect(view.providers.map((p) => p.kind)).toEqual([
      'SLACK',
      'GITHUB',
      'GITLAB',
      'APOLLO',
    ])
    const [slackP, githubP, gitlabP, apolloP] = view.providers
    expect(apolloP).toMatchObject({ available: true, webhookUrl: null })
    expect(slackP.available).toBe(true)
    expect(slackP.webhookUrl).toMatch(
      /\/api\/servicedesk\/integrations\/slack$/,
    )
    expect(slackP.connection?.externalName).toBe('Stratus')
    expect(githubP.connection).toBeNull()
    expect(githubP.webhookUrl).toMatch(/\/api\/integrations\/github\/webhook$/)
    expect(gitlabP.webhookUrl).toMatch(/\/api\/integrations\/gitlab\/webhook$/)
    expect(gitlabP.connection?.baseUrl).toBe('https://gitlab.com')
    expect(view.enabledModules).toEqual(['SERVICE_DESK', 'COMMUNICATION'])
    expect(JSON.stringify(view)).not.toContain('xoxb-token')
  })

  it('shows Slack disabled with the reason when the app is not configured', async () => {
    slackApp.mockReturnValue(null)
    const view = expectOk(await WorkspaceIntegrationService.overview('u1', WS))
    expect(view.providers[0]).toMatchObject({
      available: false,
      webhookUrl: null,
    })
    expect(view.providers[0].unavailableReason).toContain('SLACK_CLIENT_ID')
  })

  it('propagates database errors', async () => {
    repo.list.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await WorkspaceIntegrationService.overview('u1', WS),
      'DATABASE_ERROR',
    )
    modules.listByWorkspace.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await WorkspaceIntegrationService.overview('u1', WS),
      'DATABASE_ERROR',
    )
  })
})

describe('WorkspaceIntegrationService — Slack OAuth', () => {
  it('builds the authorize URL with the signed state', async () => {
    const begun = expectOk(
      await WorkspaceIntegrationService.beginSlackConnect('u1', WS),
    )
    expect(begun.authorizeUrl).toContain('https://slack.test/oauth?state=')
  })

  it('refuses without the Slack app and propagates the workspace lookup', async () => {
    slackApp.mockReturnValueOnce(null)
    expectErr(
      await WorkspaceIntegrationService.beginSlackConnect('u1', WS),
      'SD_INTEGRATION_NOT_CONFIGURED',
    )
    workspaces.findById.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await WorkspaceIntegrationService.beginSlackConnect('u1', WS),
      'DATABASE_ERROR',
    )
  })

  it('completes: encrypts the bot token, keeps the rules and audits the grant', async () => {
    slack.exchangeCode.mockResolvedValue(
      ok({
        accessToken: 'xoxb-novo',
        teamId: 'T9',
        teamName: 'Stratus',
        botUserId: 'B1',
      }),
    )
    repo.findByKind.mockResolvedValue(
      ok(
        createFakeSdIntegration({
          config: {
            routes: [{ event: 'crm.deal.won', channelId: 'C1' }],
            servicedesk: { mirrorThreadReplies: false },
          },
        }),
      ),
    )
    const done = expectOk(
      await WorkspaceIntegrationService.completeSlackConnect(
        'u1',
        createSdSlackOauthState(WS, 'acme'),
        'code-1',
      ),
    )
    expect(done).toEqual({ workspaceSlug: 'acme', teamName: 'Stratus' })
    const [, kind, externalId, data] = repo.connect.mock.calls[0]
    expect(kind).toBe('SLACK')
    expect(externalId).toBe('T9')
    expect(data.encryptedToken).toBe('enc:xoxb-novo')
    expect(data.config).toMatchObject({
      routes: [{ event: 'crm.deal.won', channelId: 'C1', channelName: null }],
      servicedesk: { mirrorThreadReplies: false },
    })
    expect(authAudit).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'auth.oauth_grant.workspace_slack' }),
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'workspace_integration',
        action: 'connect',
      }),
    )
  })

  it('refuses an invalid state, Slack refusals and database errors', async () => {
    expectErr(
      await WorkspaceIntegrationService.completeSlackConnect('u1', 'x', 'c'),
      'VALIDATION_ERROR',
    )
    expect(authAudit).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failure', reason: 'STATE_INVALID' }),
    )
    const state = createSdSlackOauthState(WS, 'acme')
    slack.exchangeCode.mockResolvedValueOnce(err(sdIntegrationRequestFailed()))
    expectErr(
      await WorkspaceIntegrationService.completeSlackConnect('u1', state, 'c'),
      'SD_INTEGRATION_REQUEST_FAILED',
    )
    slack.exchangeCode.mockResolvedValue(
      ok({ accessToken: 'x', teamId: 'T', teamName: null, botUserId: null }),
    )
    repo.findByKind.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await WorkspaceIntegrationService.completeSlackConnect('u1', state, 'c'),
      'DATABASE_ERROR',
    )
    repo.connect.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await WorkspaceIntegrationService.completeSlackConnect('u1', state, 'c'),
      'DATABASE_ERROR',
    )
    slackApp.mockReturnValueOnce(null)
    expectErr(
      await WorkspaceIntegrationService.completeSlackConnect('u1', state, 'c'),
      'SD_INTEGRATION_NOT_CONFIGURED',
    )
    privileged.mockResolvedValueOnce(err(forbidden()))
    expectErr(
      await WorkspaceIntegrationService.completeSlackConnect('u1', state, 'c'),
      'FORBIDDEN',
    )
  })
})

describe('WorkspaceIntegrationService — Slack channels and rules', () => {
  it('lists channels and stamps Slack errors on the connection', async () => {
    slack.listChannels.mockResolvedValueOnce(
      ok([{ id: 'C1', name: 'geral', isPrivate: false }]),
    )
    expect(
      expectOk(await WorkspaceIntegrationService.listSlackChannels('u1', WS)),
    ).toHaveLength(1)
    slack.listChannels.mockResolvedValueOnce(
      err(sdIntegrationRequestFailed('invalid_auth')),
    )
    expectErr(
      await WorkspaceIntegrationService.listSlackChannels('u1', WS),
      'SD_INTEGRATION_REQUEST_FAILED',
    )
    expect(repo.markError).toHaveBeenCalledWith('int-slack-1', 'invalid_auth')
    repo.requireByKind.mockResolvedValueOnce(
      ok(createFakeSdIntegration({ encryptedToken: '' })),
    )
    expectErr(
      await WorkspaceIntegrationService.listSlackChannels('u1', WS),
      'SD_INTEGRATION_NOT_CONFIGURED',
    )
    repo.requireByKind.mockResolvedValueOnce(err(sdIntegrationNotFound()))
    expectErr(
      await WorkspaceIntegrationService.listSlackChannels('u1', WS),
      'SD_INTEGRATION_NOT_FOUND',
    )
  })

  it('replaces the rules, keeps the ServiceDesk block and audits', async () => {
    repo.requireByKind.mockResolvedValue(
      ok(
        createFakeSdIntegration({
          config: {
            events: ['sla.breached'],
            channels: [{ departmentId: 'dep-1', channelId: 'C-team' }],
          },
        }),
      ),
    )
    const dto = expectOk(
      await WorkspaceIntegrationService.updateSlack('u1', WS, {
        routes: [
          { event: 'crm.lead.created', channelId: 'C2', channelName: 'vendas' },
        ],
      }),
    )
    const saved = repo.update.mock.calls[0][2].config as Record<string, unknown>
    expect(saved.routes).toEqual([
      { event: 'crm.lead.created', channelId: 'C2', channelName: 'vendas' },
    ])
    expect(saved.waitingMinutes).toBe(15)
    expect(saved.servicedesk).toMatchObject({
      channels: [{ departmentId: 'dep-1', channelId: 'C-team' }],
    })
    expect(dto.slack?.routes).toHaveLength(1)
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'workspace_integration',
        action: 'update',
        meta: expect.objectContaining({ routes: 1 }),
      }),
    )

    expectOk(
      await WorkspaceIntegrationService.updateSlack('u1', WS, {
        waitingMinutes: 45,
      }),
    )
    expect(
      (repo.update.mock.calls[1][2].config as Record<string, unknown>)
        .waitingMinutes,
    ).toBe(45)
  })

  it('propagates a missing connection and a database error', async () => {
    repo.requireByKind.mockResolvedValueOnce(err(sdIntegrationNotFound()))
    expectErr(
      await WorkspaceIntegrationService.updateSlack('u1', WS, {
        waitingMinutes: 10,
      }),
      'SD_INTEGRATION_NOT_FOUND',
    )
    repo.update.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await WorkspaceIntegrationService.updateSlack('u1', WS, {
        waitingMinutes: 10,
      }),
      'DATABASE_ERROR',
    )
  })
})

describe('WorkspaceIntegrationService.connectGithub', () => {
  it('checks the repository, stores the canonical name and encrypts everything', async () => {
    github.checkRepo.mockResolvedValue(
      ok({ fullName: 'Steel-SO/Steel', private: true }),
    )
    repo.findByKind.mockResolvedValue(
      ok(
        createFakeSdGithubIntegration({
          config: { suggestPhaseOnClose: false },
        }),
      ),
    )
    const dto = expectOk(
      await WorkspaceIntegrationService.connectGithub('u1', WS, {
        repo: 'https://github.com/steel-so/steel',
        token: TOKEN,
        webhookSecret: 'segredo-de-webhook-1',
      }),
    )
    const [, kind, externalId, data] = repo.connect.mock.calls[0]
    expect(kind).toBe('GITHUB')
    expect(externalId).toBe('Steel-SO/Steel')
    expect(data.encryptedToken).toBe(`enc:${TOKEN}`)
    expect(data.encryptedSigningSecret).toBe('enc:segredo-de-webhook-1')
    // Reconnecting keeps the ServiceDesk switches.
    expect(data.config).toEqual({
      servicedesk: { suggestPhaseOnClose: false, allowIssueFromTicket: true },
    })
    expect(dto.hasWebhookSecret).toBe(true)
    expect(JSON.stringify(dto)).not.toContain(TOKEN)
  })

  it('keeps the parsed repository when GitHub returns an odd name, without secret', async () => {
    github.checkRepo.mockResolvedValue(
      ok({ fullName: 'estranho', private: false }),
    )
    expectOk(
      await WorkspaceIntegrationService.connectGithub('u1', WS, {
        repo: 'o/r',
        token: TOKEN,
      }),
    )
    expect(repo.connect.mock.calls[0][2]).toBe('o/r')
    expect(repo.connect.mock.calls[0][3].encryptedSigningSecret).toBeNull()
  })

  it('refuses an invalid repository, a GitHub refusal and database errors', async () => {
    expectErr(
      await WorkspaceIntegrationService.connectGithub('u1', WS, {
        repo: 'sem barra',
        token: TOKEN,
      }),
      'VALIDATION_ERROR',
    )
    github.checkRepo.mockResolvedValueOnce(err(sdIntegrationRequestFailed()))
    expectErr(
      await WorkspaceIntegrationService.connectGithub('u1', WS, {
        repo: 'o/r',
        token: TOKEN,
      }),
      'SD_INTEGRATION_REQUEST_FAILED',
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'connect', outcome: 'failure' }),
    )
    github.checkRepo.mockResolvedValue(ok({ fullName: 'o/r', private: false }))
    repo.findByKind.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await WorkspaceIntegrationService.connectGithub('u1', WS, {
        repo: 'o/r',
        token: TOKEN,
      }),
      'DATABASE_ERROR',
    )
    repo.connect.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await WorkspaceIntegrationService.connectGithub('u1', WS, {
        repo: 'o/r',
        token: TOKEN,
      }),
      'DATABASE_ERROR',
    )
  })
})

describe('WorkspaceIntegrationService.connectGitlab', () => {
  it('connects a self-managed project by URL', async () => {
    gitlab.checkProject.mockResolvedValue(
      ok({
        id: 1,
        pathWithNamespace: 'grupo/projeto',
        name: 'projeto',
        webUrl: 'https://git.acme.com/grupo/projeto',
      }),
    )
    const dto = expectOk(
      await WorkspaceIntegrationService.connectGitlab('u1', WS, {
        baseUrl: 'https://git.acme.com/',
        project: 'https://git.acme.com/grupo/projeto',
        token: GL_TOKEN,
        webhookSecret: 'segredo-gitlab-123',
      }),
    )
    expect(gitlab.checkProject).toHaveBeenCalledWith(
      'https://git.acme.com',
      GL_TOKEN,
      'grupo/projeto',
    )
    const [, kind, externalId, data] = repo.connect.mock.calls[0]
    expect(kind).toBe('GITLAB')
    expect(externalId).toBe('grupo/projeto')
    expect(data.baseUrl).toBe('https://git.acme.com')
    expect(data.encryptedSigningSecret).toBe('enc:segredo-gitlab-123')
    expect(dto.baseUrl).toBe('https://git.acme.com')
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({ host: 'git.acme.com' }),
      }),
    )
  })

  it('defaults to gitlab.com and stores no secret when none is given', async () => {
    gitlab.checkProject.mockResolvedValue(
      ok({
        id: 1,
        pathWithNamespace: 'g/p',
        name: 'p',
        webUrl: 'https://gitlab.com/g/p',
      }),
    )
    expectOk(
      await WorkspaceIntegrationService.connectGitlab('u1', WS, {
        project: 'g/p',
        token: GL_TOKEN,
      }),
    )
    expect(gitlab.checkProject.mock.calls[0][0]).toBe('https://gitlab.com')
    expect(repo.connect.mock.calls[0][3].encryptedSigningSecret).toBeNull()
  })

  it('refuses private hosts, invalid projects, refusals and database errors', async () => {
    expectErr(
      await WorkspaceIntegrationService.connectGitlab('u1', WS, {
        baseUrl: 'http://10.0.0.1',
        project: 'g/p',
        token: GL_TOKEN,
      }),
      'VALIDATION_ERROR',
    )
    expectErr(
      await WorkspaceIntegrationService.connectGitlab('u1', WS, {
        project: 'so-um',
        token: GL_TOKEN,
      }),
      'VALIDATION_ERROR',
    )
    gitlab.checkProject.mockResolvedValueOnce(err(sdIntegrationRequestFailed()))
    expectErr(
      await WorkspaceIntegrationService.connectGitlab('u1', WS, {
        project: 'g/p',
        token: GL_TOKEN,
      }),
      'SD_INTEGRATION_REQUEST_FAILED',
    )
    gitlab.checkProject.mockResolvedValue(
      ok({ id: 1, pathWithNamespace: 'g/p', name: 'p', webUrl: 'x' }),
    )
    repo.findByKind.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await WorkspaceIntegrationService.connectGitlab('u1', WS, {
        project: 'g/p',
        token: GL_TOKEN,
      }),
      'DATABASE_ERROR',
    )
    repo.connect.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await WorkspaceIntegrationService.connectGitlab('u1', WS, {
        project: 'g/p',
        token: GL_TOKEN,
      }),
      'DATABASE_ERROR',
    )
  })
})

describe('WorkspaceIntegrationService.updateRepoCredentials', () => {
  it('rotates a GitHub token after checking it, and the secret', async () => {
    repo.requireByKind.mockResolvedValue(ok(createFakeSdGithubIntegration()))
    github.checkRepo.mockResolvedValue(ok({ fullName: 'o/r', private: false }))
    expectOk(
      await WorkspaceIntegrationService.updateRepoCredentials(
        'u1',
        WS,
        'GITHUB',
        { token: TOKEN, webhookSecret: 'novo-segredo-de-teste' },
      ),
    )
    const data = repo.update.mock.calls[0][2]
    expect(data.encryptedToken).toBe(`enc:${TOKEN}`)
    expect(data.encryptedSigningSecret).toBe('enc:novo-segredo-de-teste')
    expect(data.status).toBe('ACTIVE')
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({ fields: ['token', 'webhookSecret'] }),
      }),
    )
    expect(JSON.stringify(audit.mock.calls)).not.toContain(TOKEN)
  })

  it('removes the secret and checks a GitLab token', async () => {
    repo.requireByKind.mockResolvedValue(ok(createFakeGitlabIntegration()))
    expectOk(
      await WorkspaceIntegrationService.updateRepoCredentials(
        'u1',
        WS,
        'GITLAB',
        { webhookSecret: null },
      ),
    )
    expect(repo.update.mock.calls[0][2]).toEqual({
      encryptedSigningSecret: null,
    })

    gitlab.checkProject.mockResolvedValueOnce(err(sdIntegrationRequestFailed()))
    expectErr(
      await WorkspaceIntegrationService.updateRepoCredentials(
        'u1',
        WS,
        'GITLAB',
        { token: GL_TOKEN },
      ),
      'SD_INTEGRATION_REQUEST_FAILED',
    )
  })

  it('propagates a missing connection, a corrupt repo and database errors', async () => {
    repo.requireByKind.mockResolvedValueOnce(err(sdIntegrationNotFound()))
    expectErr(
      await WorkspaceIntegrationService.updateRepoCredentials(
        'u1',
        WS,
        'GITHUB',
        { webhookSecret: null },
      ),
      'SD_INTEGRATION_NOT_FOUND',
    )
    repo.requireByKind.mockResolvedValueOnce(
      ok(createFakeSdGithubIntegration({ externalId: 'x' })),
    )
    expectErr(
      await WorkspaceIntegrationService.updateRepoCredentials(
        'u1',
        WS,
        'GITHUB',
        { token: TOKEN },
      ),
      'SD_INTEGRATION_REQUEST_FAILED',
    )
    repo.requireByKind.mockResolvedValueOnce(
      ok(createFakeSdGithubIntegration()),
    )
    repo.update.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await WorkspaceIntegrationService.updateRepoCredentials(
        'u1',
        WS,
        'GITHUB',
        { webhookSecret: 'segredo-de-teste-123' },
      ),
      'DATABASE_ERROR',
    )
  })
})

describe('WorkspaceIntegrationService.test', () => {
  it('confirms Slack with auth.test and stamps the check', async () => {
    slack.authTest.mockResolvedValue(ok({ teamId: 'T1', teamName: 'Acme' }))
    const result = expectOk(
      await WorkspaceIntegrationService.test('u1', WS, 'SLACK'),
    )
    expect(result.ok).toBe(true)
    expect(result.message).toContain('Acme')
    expect(repo.update.mock.calls[0][2]).toMatchObject({
      status: 'ACTIVE',
      statusError: null,
      lastCheckedAt: expect.any(Date),
    })
    slack.authTest.mockResolvedValue(ok({ teamId: null, teamName: null }))
    expect(
      expectOk(await WorkspaceIntegrationService.test('u1', WS, 'SLACK'))
        .message,
    ).toContain('Stratus')
  })

  it('reports a provider failure as a normal answer and stamps the error', async () => {
    repo.requireByKind.mockResolvedValue(ok(createFakeSdGithubIntegration()))
    github.checkRepo.mockResolvedValue(
      err(sdIntegrationRequestFailed('O GitHub recusou a chamada (401)')),
    )
    const result = expectOk(
      await WorkspaceIntegrationService.test('u1', WS, 'GITHUB'),
    )
    expect(result).toMatchObject({
      ok: false,
      message: 'O GitHub recusou a chamada (401)',
    })
    expect(repo.update.mock.calls[0][2]).toMatchObject({
      status: 'ERROR',
      statusError: 'O GitHub recusou a chamada (401)',
    })
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'test', outcome: 'failure' }),
    )
  })

  it('flags a repository without webhook secret even with a valid token', async () => {
    repo.requireByKind.mockResolvedValue(
      ok(createFakeGitlabIntegration({ encryptedSigningSecret: null })),
    )
    gitlab.checkProject.mockResolvedValue(
      ok({ id: 1, pathWithNamespace: 'stratus/steel', name: 's', webUrl: 'x' }),
    )
    const result = expectOk(
      await WorkspaceIntegrationService.test('u1', WS, 'GITLAB'),
    )
    expect(result.ok).toBe(false)
    expect(result.message).toContain('sem segredo de webhook')

    repo.requireByKind.mockResolvedValue(
      ok(createFakeGitlabIntegration({ baseUrl: null })),
    )
    expect(
      expectOk(await WorkspaceIntegrationService.test('u1', WS, 'GITLAB')),
    ).toMatchObject({ ok: true, message: 'Acesso confirmado a stratus/steel' })
    expect(gitlab.checkProject).toHaveBeenLastCalledWith(
      'https://gitlab.com',
      'gitlab-token',
      'stratus/steel',
    )
  })

  it('a valid GitHub token with secret passes; an unreadable token fails', async () => {
    repo.requireByKind.mockResolvedValue(ok(createFakeSdGithubIntegration()))
    github.checkRepo.mockResolvedValue(ok({ fullName: 'o/r', private: false }))
    expect(
      expectOk(await WorkspaceIntegrationService.test('u1', WS, 'GITHUB')),
    ).toMatchObject({ ok: true, message: 'Acesso confirmado a o/r' })
    repo.requireByKind.mockResolvedValue(
      ok(createFakeSdGithubIntegration({ encryptedToken: '' })),
    )
    expect(
      expectOk(await WorkspaceIntegrationService.test('u1', WS, 'GITHUB')).ok,
    ).toBe(false)
  })

  it('errors without the Slack app, a connection or on database failure', async () => {
    slackApp.mockReturnValueOnce(null)
    expectErr(
      await WorkspaceIntegrationService.test('u1', WS, 'SLACK'),
      'SD_INTEGRATION_NOT_CONFIGURED',
    )
    repo.requireByKind.mockResolvedValueOnce(err(sdIntegrationNotFound()))
    expectErr(
      await WorkspaceIntegrationService.test('u1', WS, 'GITHUB'),
      'SD_INTEGRATION_NOT_FOUND',
    )
    slack.authTest.mockResolvedValue(ok({ teamId: 'T', teamName: 'A' }))
    repo.update.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await WorkspaceIntegrationService.test('u1', WS, 'SLACK'),
      'DATABASE_ERROR',
    )
  })
})

describe('WorkspaceIntegrationService.test — Apollo', () => {
  it('validates the key without needing a webhook secret', async () => {
    repo.requireByKind.mockResolvedValue(
      ok(createFakeApolloIntegration({ encryptedSigningSecret: null })),
    )
    vi.mocked(ApolloClient.health).mockResolvedValue(
      ok({ data: { healthy: true }, rateLimit: {} as never }),
    )
    const result = expectOk(
      await WorkspaceIntegrationService.test('u1', WS, 'APOLLO'),
    )
    expect(result.ok).toBe(true)
    expect(result.message).toContain('Apollo')
  })

  it('reports a rejected key as a failed test', async () => {
    repo.requireByKind.mockResolvedValue(ok(createFakeApolloIntegration()))
    vi.mocked(ApolloClient.health).mockResolvedValue(
      err({ code: 'CRM_APOLLO_INVALID_KEY', message: 'chave recusada' }),
    )
    const result = expectOk(
      await WorkspaceIntegrationService.test('u1', WS, 'APOLLO'),
    )
    expect(result).toMatchObject({ ok: false, message: 'chave recusada' })
  })
})

describe('WorkspaceIntegrationService.disconnect', () => {
  it('erases the connection and audits', async () => {
    expectOk(await WorkspaceIntegrationService.disconnect('u1', WS, 'SLACK'))
    expect(repo.disconnect).toHaveBeenCalledWith('int-slack-1', WS)
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'workspace_integration',
        action: 'disconnect',
      }),
    )
  })

  it('propagates a missing connection and a database error', async () => {
    repo.requireByKind.mockResolvedValueOnce(err(sdIntegrationNotFound()))
    expectErr(
      await WorkspaceIntegrationService.disconnect('u1', WS, 'GITLAB'),
      'SD_INTEGRATION_NOT_FOUND',
    )
    repo.disconnect.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await WorkspaceIntegrationService.disconnect('u1', WS, 'SLACK'),
      'DATABASE_ERROR',
    )
  })
})
