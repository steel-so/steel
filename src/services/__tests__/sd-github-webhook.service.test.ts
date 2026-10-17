import { createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeGitlabIntegration,
  createFakeSdGithubIntegration,
  createFakeSdIntegrationLink,
} from '@/src/__tests__/factories/sd-integration.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  databaseError,
  moduleDisabled,
  sdIntegrationRequestFailed,
} from '@/src/errors'
import { err, ok } from '@/src/lib/result'

const SECRET = 'hook-secret'

vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/lib/crypto', () => ({
  encryptConnectionSecret: vi.fn(async (v: string) => `enc:${v}`),
  decryptConnectionSecret: vi.fn(async (v: string) => v.replace(/^enc:/, '')),
}))
vi.mock('@/src/cache/sd-integration-event.cache', () => ({
  SdIntegrationEventCache: { claim: vi.fn(), release: vi.fn() },
}))
vi.mock('@/src/lib/servicedesk/github-client', () => ({
  GithubClient: { checkRepo: vi.fn(), getItem: vi.fn(), createIssue: vi.fn() },
}))
vi.mock('@/src/repositories/sd-integration.repository')
vi.mock('@/src/repositories/workspace-integration.repository')
vi.mock('@/src/lib/integrations/gitlab-client', () => ({
  GitlabClient: {
    checkProject: vi.fn(),
    getItem: vi.fn(),
    createIssue: vi.fn(),
  },
}))
vi.mock('../authz', () => ({ assertModuleEnabled: vi.fn() }))
vi.mock('../sd-ticket-event-recorder', () => ({ recordSdTicketEvent: vi.fn() }))
vi.mock('../sd-ticket-reply-notify', () => ({
  notifySdTicketReply: vi.fn(async () => undefined),
}))

import { SdIntegrationEventCache } from '@/src/cache/sd-integration-event.cache'
import { decryptConnectionSecret } from '@/src/lib/crypto'
import { GitlabClient } from '@/src/lib/integrations/gitlab-client'
import { GithubClient } from '@/src/lib/servicedesk/github-client'
import { SdIntegrationRepository } from '@/src/repositories/sd-integration.repository'
import { WorkspaceIntegrationRepository } from '@/src/repositories/workspace-integration.repository'
import { assertModuleEnabled } from '../authz'
import {
  SdGithubSyncService,
  SdGithubWebhookService,
} from '../sd-github-webhook.service'
import { recordSdTicketEvent } from '../sd-ticket-event-recorder'
import { notifySdTicketReply } from '../sd-ticket-reply-notify'

const repo = vi.mocked(SdIntegrationRepository)
const wsRepo = vi.mocked(WorkspaceIntegrationRepository)
const gitlab = vi.mocked(GitlabClient)
const cache = vi.mocked(SdIntegrationEventCache)
const github = vi.mocked(GithubClient)
const moduleEnabled = vi.mocked(assertModuleEnabled)
const record = vi.mocked(recordSdTicketEvent)
const decrypt = vi.mocked(decryptConnectionSecret)

function sign(body: string, secret = SECRET): string {
  return `sha256=${createHmac('sha256', secret)
    .update(body, 'utf8')
    .digest('hex')}`
}

function call(body: unknown, event = 'issues', secret = SECRET) {
  const rawBody = JSON.stringify(body)
  return {
    rawBody,
    signature: sign(rawBody, secret),
    event,
    deliveryId: 'D1',
  }
}

const issueClosed = {
  action: 'closed',
  repository: { full_name: 'steel-so/steel' },
  issue: {
    number: 42,
    title: 'Fila travando',
    state: 'closed',
    html_url: 'https://github.com/steel-so/steel/issues/42',
  },
}

beforeEach(() => {
  cache.claim.mockResolvedValue(true)
  cache.release.mockResolvedValue(undefined)
  moduleEnabled.mockResolvedValue(ok(true as never))
  wsRepo.findManyByExternalId.mockResolvedValue(
    ok([createFakeSdGithubIntegration()]),
  )
  wsRepo.markEvent.mockResolvedValue(ok(undefined))
  repo.findRepoLinkByKey.mockResolvedValue(
    ok(createFakeSdIntegrationLink({ externalState: 'open' })),
  )
  repo.updateLink.mockResolvedValue(ok(createFakeSdIntegrationLink()))
  repo.createTicketMessage.mockResolvedValue(ok({ id: 'msg-1' }))
  record.mockResolvedValue(ok(1))
})

describe('SdGithubWebhookService.handle — eventos aceitos', () => {
  it('ignora ping e eventos fora de issues/pull_request', async () => {
    expect(
      expectOk(await SdGithubWebhookService.handle(call({}, 'ping'))).outcome,
    ).toBe('ignored')
    expect(
      expectOk(await SdGithubWebhookService.handle(call({}, 'push'))).outcome,
    ).toBe('ignored')
    expect(wsRepo.findManyByExternalId).not.toHaveBeenCalled()
  })

  it('ignora ação que não muda o estado', async () => {
    expect(
      expectOk(
        await SdGithubWebhookService.handle(
          call({ ...issueClosed, action: 'labeled' }),
        ),
      ).outcome,
    ).toBe('ignored')
  })

  it('ignora payload sem número do item', async () => {
    expect(
      expectOk(
        await SdGithubWebhookService.handle(
          call({ ...issueClosed, issue: { state: 'closed' } }),
        ),
      ).outcome,
    ).toBe('ignored')
  })
})

describe('SdGithubWebhookService.handle — assinatura', () => {
  it('recusa corpo que não é JSON e payload sem repositório', async () => {
    expectErr(
      await SdGithubWebhookService.handle({
        rawBody: 'nao-json',
        signature: sign('nao-json'),
        event: 'issues',
        deliveryId: 'D1',
      }),
      'VALIDATION_ERROR',
    )
    expectErr(
      await SdGithubWebhookService.handle(
        call({ action: 'closed', issue: { number: 1 } }),
      ),
      'VALIDATION_ERROR',
    )
    expectErr(
      await SdGithubWebhookService.handle(
        call({ ...issueClosed, repository: { full_name: 'invalido' } }),
      ),
      'VALIDATION_ERROR',
    )
  })

  it('recusa repositório não conectado ou desconectado', async () => {
    wsRepo.findManyByExternalId.mockResolvedValue(ok([]))
    expectErr(
      await SdGithubWebhookService.handle(call(issueClosed)),
      'SD_INTEGRATION_NOT_CONFIGURED',
    )
    wsRepo.findManyByExternalId.mockResolvedValue(
      ok([createFakeSdGithubIntegration({ status: 'DISCONNECTED' })]),
    )
    expectErr(
      await SdGithubWebhookService.handle(call(issueClosed)),
      'SD_INTEGRATION_NOT_CONFIGURED',
    )
    wsRepo.findManyByExternalId.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdGithubWebhookService.handle(call(issueClosed)),
      'DATABASE_ERROR',
    )
  })

  it('recusa quando o segredo guardado não decifra (chave trocada)', async () => {
    decrypt.mockRejectedValueOnce(new Error('bad key'))
    const error = expectErr(
      await SdGithubWebhookService.handle(call(issueClosed)),
      'SD_INTEGRATION_NOT_CONFIGURED',
    )
    // An unreadable secret disqualifies the candidate, like a missing one.
    expect(error.message).toContain('segredo de webhook')
    expect(repo.updateLink).not.toHaveBeenCalled()
  })

  it('recusa integração sem segredo de webhook configurado', async () => {
    wsRepo.findManyByExternalId.mockResolvedValue(
      ok([createFakeSdGithubIntegration({ encryptedSigningSecret: null })]),
    )
    const error = expectErr(
      await SdGithubWebhookService.handle(call(issueClosed)),
      'SD_INTEGRATION_NOT_CONFIGURED',
    )
    expect(error.message).toContain('segredo de webhook')
  })

  it('recusa assinatura inválida, ausente e de outro segredo', async () => {
    const good = call(issueClosed)
    expectErr(
      await SdGithubWebhookService.handle({
        ...good,
        signature: 'sha256=dead',
      }),
      'SD_INTEGRATION_SIGNATURE_INVALID',
    )
    expectErr(
      await SdGithubWebhookService.handle({ ...good, signature: null }),
      'SD_INTEGRATION_SIGNATURE_INVALID',
    )
    expectErr(
      await SdGithubWebhookService.handle(
        call(issueClosed, 'issues', 'outro-segredo'),
      ),
      'SD_INTEGRATION_SIGNATURE_INVALID',
    )
    // Nada foi gravado antes do HMAC fechar.
    expect(repo.updateLink).not.toHaveBeenCalled()
  })

  it('picks, among workspaces sharing the repository, the one whose secret verifies', async () => {
    wsRepo.findManyByExternalId.mockResolvedValue(
      ok([
        createFakeSdGithubIntegration({
          id: 'int-other',
          workspaceId: 'ws-other',
          encryptedSigningSecret: 'enc:another-secret',
        }),
        createFakeSdGithubIntegration({
          id: 'int-off',
          status: 'DISCONNECTED',
        }),
        createFakeSdGithubIntegration(),
      ]),
    )
    expect(
      expectOk(await SdGithubWebhookService.handle(call(issueClosed))).outcome,
    ).toBe('state_updated')
    expect(repo.findRepoLinkByKey).toHaveBeenCalledWith(
      'int-gh-1',
      'GITHUB',
      'steel-so/steel#42',
    )
    expect(wsRepo.markEvent).toHaveBeenCalledWith(
      'int-gh-1',
      'github:issues.closed',
    )
  })

  it('stamps the event even without an action', async () => {
    expectOk(
      await SdGithubWebhookService.handle(
        call({ repository: { full_name: 'steel-so/steel' } }),
      ),
    )
    expect(wsRepo.markEvent).toHaveBeenCalledWith('int-gh-1', 'github:issues')
  })

  it('recusa quando o módulo está desabilitado', async () => {
    moduleEnabled.mockResolvedValue(err(moduleDisabled('SERVICE_DESK')))
    expectErr(
      await SdGithubWebhookService.handle(call(issueClosed)),
      'MODULE_DISABLED',
    )
  })
})

describe('SdGithubWebhookService.handle — espelhamento', () => {
  it('atualiza o estado, registra o evento e publica a sugestão', async () => {
    const result = expectOk(
      await SdGithubWebhookService.handle(call(issueClosed)),
    )
    expect(result).toEqual({ outcome: 'state_updated', state: 'closed' })
    expect(repo.updateLink).toHaveBeenCalledWith(
      'link-1',
      expect.objectContaining({
        externalState: 'closed',
        externalUrl: 'https://github.com/steel-so/steel/issues/42',
        meta: { title: 'Fila travando' },
      }),
    )
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'integration.github_state',
        fromValue: 'open',
        toValue: 'closed',
        meta: expect.objectContaining({ via: 'webhook', suggestPhase: true }),
      }),
    )
    const [{ body }] = repo.createTicketMessage.mock.calls[0]
    expect(body).toContain('Sugestão')
  })

  it('tolera payload sem estado, título e URL do item', async () => {
    const res = expectOk(
      await SdGithubWebhookService.handle(
        call({
          action: 'closed',
          repository: { full_name: 'steel-so/steel' },
          issue: { number: 42 },
        }),
      ),
    )
    // Sem `state`, o item é tratado como aberto — e o vínculo já estava
    // aberto, então nada muda.
    expect(res).toEqual({ outcome: 'ignored', state: 'open' })
  })

  it('reconhece o pull request mesclado', async () => {
    const result = expectOk(
      await SdGithubWebhookService.handle(
        call(
          {
            action: 'closed',
            repository: { full_name: 'steel-so/steel' },
            pull_request: {
              number: 9,
              title: 'Corrige a fila',
              state: 'closed',
              merged: true,
              html_url: 'https://github.com/steel-so/steel/pull/9',
            },
          },
          'pull_request',
        ),
      ),
    )
    expect(result.state).toBe('merged')
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({ kind: 'GITHUB_PULL_REQUEST' }),
      }),
    )
  })

  it('não sugere fase quando o workspace desligou a sugestão', async () => {
    wsRepo.findManyByExternalId.mockResolvedValue(
      ok([
        createFakeSdGithubIntegration({
          config: { suggestPhaseOnClose: false, allowIssueFromTicket: true },
        }),
      ]),
    )
    expectOk(await SdGithubWebhookService.handle(call(issueClosed)))
    const [{ body }] = repo.createTicketMessage.mock.calls[0]
    expect(body).not.toContain('Sugestão')
  })

  it('reabertura volta para `open`', async () => {
    repo.findRepoLinkByKey.mockResolvedValue(
      ok(createFakeSdIntegrationLink({ externalState: 'closed' })),
    )
    const result = expectOk(
      await SdGithubWebhookService.handle(
        call({
          ...issueClosed,
          action: 'reopened',
          issue: { ...issueClosed.issue, state: 'open' },
        }),
      ),
    )
    expect(result.state).toBe('open')
  })

  it('ignora quando o estado já era o mesmo (sem mensagem repetida)', async () => {
    repo.findRepoLinkByKey.mockResolvedValue(
      ok(createFakeSdIntegrationLink({ externalState: 'closed' })),
    )
    const result = expectOk(
      await SdGithubWebhookService.handle(call(issueClosed)),
    )
    expect(result.outcome).toBe('ignored')
    expect(repo.updateLink).not.toHaveBeenCalled()
    expect(repo.createTicketMessage).not.toHaveBeenCalled()
  })

  it('responde `unlinked` para item que nenhum chamado usa', async () => {
    repo.findRepoLinkByKey.mockResolvedValue(ok(null))
    expect(
      expectOk(await SdGithubWebhookService.handle(call(issueClosed))).outcome,
    ).toBe('unlinked')
  })

  it('é idempotente por X-GitHub-Delivery', async () => {
    cache.claim.mockResolvedValue(false)
    expect(
      expectOk(await SdGithubWebhookService.handle(call(issueClosed))).outcome,
    ).toBe('duplicate')
    expect(repo.updateLink).not.toHaveBeenCalled()
  })

  it('usa repositório + número + ação como chave sem o header de entrega', async () => {
    const good = call(issueClosed)
    expectOk(await SdGithubWebhookService.handle({ ...good, deliveryId: null }))
    expect(cache.claim).toHaveBeenCalledWith(
      'github',
      'steel-so/steel:42:closed',
    )
  })

  it('libera a trava quando o banco falha', async () => {
    repo.findRepoLinkByKey.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdGithubWebhookService.handle(call(issueClosed)),
      'DATABASE_ERROR',
    )
    expect(cache.release).toHaveBeenCalledWith('github', 'D1')

    repo.findRepoLinkByKey.mockResolvedValue(
      ok(createFakeSdIntegrationLink({ externalState: 'open' })),
    )
    repo.updateLink.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdGithubWebhookService.handle(call(issueClosed)),
      'DATABASE_ERROR',
    )
  })

  it('segue quando a mensagem do chamado falha', async () => {
    repo.createTicketMessage.mockResolvedValue(err(databaseError()))
    expect(
      expectOk(await SdGithubWebhookService.handle(call(issueClosed))).outcome,
    ).toBe('state_updated')
  })
})

describe('SdGithubSyncService.runTick', () => {
  const link = (overrides = {}) => ({
    ...createFakeSdIntegrationLink({ externalState: 'open', ...overrides }),
    integration: createFakeSdGithubIntegration(),
  })

  beforeEach(() => {
    repo.listRepoLinksToSync.mockResolvedValue(ok([link()]))
    github.getItem.mockResolvedValue(
      ok({
        number: 42,
        title: 'Fila travando',
        kind: 'GITHUB_ISSUE',
        state: 'closed',
        htmlUrl: 'https://github.com/steel-so/steel/issues/42',
      }),
    )
  })

  it('reconcilia o estado dos vínculos abertos', async () => {
    const result = expectOk(await SdGithubSyncService.runTick())
    expect(result).toEqual({ checked: 1, updated: 1, failed: 0 })
    expect(repo.updateLink).toHaveBeenCalledWith(
      'link-1',
      expect.objectContaining({ externalState: 'closed' }),
    )
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({ via: 'sync' }),
      }),
    )
  })

  it('aceita o recorte por workspace', async () => {
    expectOk(await SdGithubSyncService.runTick('ws1'))
    expect(repo.listRepoLinksToSync).toHaveBeenCalledWith(200, 'ws1')
  })

  it('não conta como atualizado quando o estado já estava igual', async () => {
    github.getItem.mockResolvedValue(
      ok({
        number: 42,
        title: 'Fila travando',
        kind: 'GITHUB_ISSUE',
        state: 'open',
        htmlUrl: 'https://github.com/x',
      }),
    )
    expect(expectOk(await SdGithubSyncService.runTick())).toEqual({
      checked: 1,
      updated: 0,
      failed: 0,
    })
  })

  it('conta falha para repositório corrompido, token ilegível e número inválido', async () => {
    repo.listRepoLinksToSync.mockResolvedValue(
      ok([
        {
          ...createFakeSdIntegrationLink(),
          integration: createFakeSdGithubIntegration({
            externalId: 'invalido',
          }),
        },
        {
          ...createFakeSdIntegrationLink({ id: 'link-2' }),
          integration: createFakeSdGithubIntegration({
            id: 'int-gh-2',
            encryptedToken: '',
          }),
        },
        {
          ...createFakeSdIntegrationLink({
            id: 'link-3',
            externalKey: 'steel-so/steel#abc',
          }),
          integration: createFakeSdGithubIntegration({ id: 'int-gh-3' }),
        },
      ]),
    )
    expect(expectOk(await SdGithubSyncService.runTick())).toEqual({
      checked: 3,
      updated: 0,
      failed: 3,
    })
    expect(github.getItem).not.toHaveBeenCalled()
  })

  it('conta falha quando o GitHub recusa e quando o banco falha', async () => {
    github.getItem.mockResolvedValue(err(sdIntegrationRequestFailed()))
    expect(expectOk(await SdGithubSyncService.runTick())).toEqual({
      checked: 1,
      updated: 0,
      failed: 1,
    })

    github.getItem.mockResolvedValue(
      ok({
        number: 42,
        title: 'T',
        kind: 'GITHUB_ISSUE',
        state: 'closed',
        htmlUrl: 'https://github.com/x',
      }),
    )
    repo.updateLink.mockResolvedValue(err(databaseError()))
    expect(expectOk(await SdGithubSyncService.runTick())).toEqual({
      checked: 1,
      updated: 0,
      failed: 1,
    })
  })

  it('reaproveita o token entre vínculos da mesma integração', async () => {
    repo.listRepoLinksToSync.mockResolvedValue(
      ok([link(), { ...link({ id: 'link-9' }) }]),
    )
    expectOk(await SdGithubSyncService.runTick())
    expect(github.getItem).toHaveBeenCalledTimes(2)
  })

  it('reconciles GitLab issues and merge requests too', async () => {
    gitlab.getItem.mockResolvedValue(
      ok({
        iid: 7,
        title: 'Deploy',
        kind: 'GITLAB_MERGE_REQUEST',
        state: 'merged',
        webUrl: 'https://gitlab.com/stratus/steel/-/merge_requests/7',
      }),
    )
    repo.listRepoLinksToSync.mockResolvedValue(
      ok([
        {
          ...createFakeSdIntegrationLink({
            id: 'gl-1',
            kind: 'GITLAB_MERGE_REQUEST',
            externalKey: 'stratus/steel!7',
            integrationId: 'int-gl-1',
          }),
          integration: createFakeGitlabIntegration(),
        },
        {
          ...createFakeSdIntegrationLink({
            id: 'gl-2',
            kind: 'GITLAB_ISSUE',
            externalKey: 'corrompido',
          }),
          integration: createFakeGitlabIntegration(),
        },
      ]),
    )
    expect(expectOk(await SdGithubSyncService.runTick())).toEqual({
      checked: 2,
      updated: 1,
      failed: 1,
    })
    expect(gitlab.getItem).toHaveBeenCalledWith(
      'https://gitlab.com',
      'gitlab-token',
      'stratus/steel',
      7,
      'GITLAB_MERGE_REQUEST',
    )
    const [{ body }] = repo.createTicketMessage.mock.calls[0]
    expect(body).toContain('O merge request')
    expect(body).toContain('do GitLab')
    expect(vi.mocked(notifySdTicketReply)).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'GITLAB',
        body: 'Merge request stratus/steel!7: mesclada',
      }),
    )
  })

  it('propaga erro de banco na listagem', async () => {
    repo.listRepoLinksToSync.mockResolvedValue(err(databaseError()))
    expectErr(await SdGithubSyncService.runTick(), 'DATABASE_ERROR')
  })
})

describe('SdGithubWebhookService.handle — team notification', () => {
  const notifyReply = vi.mocked(notifySdTicketReply)

  beforeEach(() => notifyReply.mockClear())

  it('tells the ticket team about the issue state change', async () => {
    expectOk(await SdGithubWebhookService.handle(call(issueClosed)))
    expect(notifyReply).toHaveBeenCalledWith(
      expect.objectContaining({
        ticket: { id: expect.any(String) },
        channel: 'GITHUB',
        body: expect.stringMatching(/^Issue /),
      }),
    )
  })

  it('names a pull request as such', async () => {
    expectOk(
      await SdGithubWebhookService.handle(
        call(
          {
            action: 'closed',
            repository: { full_name: 'steel-so/steel' },
            pull_request: { number: 9, state: 'closed', merged: true },
          },
          'pull_request',
        ),
      ),
    )
    expect(notifyReply.mock.calls[0][0].body).toMatch(/^Pull request /)
  })

  it('does not notify when the ticket message could not be written', async () => {
    repo.createTicketMessage.mockResolvedValue(err(databaseError()))
    expectOk(await SdGithubWebhookService.handle(call(issueClosed)))
    expect(notifyReply).not.toHaveBeenCalled()
  })
})
