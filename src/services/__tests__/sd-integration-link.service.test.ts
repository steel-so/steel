import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeGitlabIntegration,
  createFakeSdGithubIntegration,
  createFakeSdIntegration,
  createFakeSdIntegrationLink,
} from '@/src/__tests__/factories/sd-integration.factory'
import { createFakeSdTicket } from '@/src/__tests__/factories/sd-ticket.factory'
import { createFakeSdSettings } from '@/src/__tests__/factories/sd-ticket-context.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  databaseError,
  sdIntegrationNotFound,
  sdIntegrationRequestFailed,
  sdNotAgent,
  sdTicketClosed,
  sdTicketForbidden,
} from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import { DEFAULT_SD_TICKET_PREFIXES } from '@/src/lib/servicedesk/ticket-code'

vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/lib/env/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/env/env')>()),
  NEXT_PUBLIC_URL: 'https://steel.test',
}))
vi.mock('@/src/lib/crypto', () => ({
  encryptConnectionSecret: vi.fn(async (v: string) => `enc:${v}`),
  decryptConnectionSecret: vi.fn(async (v: string) => v.replace(/^enc:/, '')),
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
vi.mock('@/src/repositories/sd-ticket-context.repository')
vi.mock('../sd-ticket-event-recorder', () => ({ recordSdTicketEvent: vi.fn() }))
vi.mock('../sd-ticket-tab-support', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sd-ticket-tab-support')>()),
  loadSdTicketTab: vi.fn(),
  publishSdTicketTab: vi.fn(),
}))

import { auditMutation } from '@/lib/axiom/audit'
import { GitlabClient } from '@/src/lib/integrations/gitlab-client'
import { GithubClient } from '@/src/lib/servicedesk/github-client'
import { SdIntegrationRepository } from '@/src/repositories/sd-integration.repository'
import { SdTicketContextRepository } from '@/src/repositories/sd-ticket-context.repository'
import { WorkspaceIntegrationRepository } from '@/src/repositories/workspace-integration.repository'
import { SdIntegrationLinkService } from '../sd-integration-link.service'
import { recordSdTicketEvent } from '../sd-ticket-event-recorder'
import { loadSdTicketTab, publishSdTicketTab } from '../sd-ticket-tab-support'

const repo = vi.mocked(SdIntegrationRepository)
const wsRepo = vi.mocked(WorkspaceIntegrationRepository)
const gitlab = vi.mocked(GitlabClient)
const ctxRepo = vi.mocked(SdTicketContextRepository)
const github = vi.mocked(GithubClient)
const load = vi.mocked(loadSdTicketTab)
const publish = vi.mocked(publishSdTicketTab)
const record = vi.mocked(recordSdTicketEvent)
const audit = vi.mocked(auditMutation)

const WS = 'ws1'

function scope(type: 'PROBLEM' | 'CHANGE' | 'INCIDENT' = 'PROBLEM') {
  const ticket = createFakeSdTicket({
    id: 't1',
    number: 7,
    type,
    title: 'Fila travando',
    description: '<p>Acontece ao reiniciar</p>',
  })
  return ok({
    ctx: {
      userId: 'u1',
      isAdmin: false,
      isAgent: true,
      departmentIds: ['dep-1'],
      leadDepartmentIds: [],
    } as never,
    config: {
      settings: createFakeSdSettings(),
      prefixes: DEFAULT_SD_TICKET_PREFIXES,
    },
    ticket,
    actor: { kind: 'user', userId: 'u1', isAgent: true } as never,
    code: 'PRB-000007',
  })
}

const item = {
  number: 42,
  title: 'Fila travando',
  kind: 'GITHUB_ISSUE' as const,
  state: 'open' as const,
  htmlUrl: 'https://github.com/steel-so/steel/issues/42',
}

beforeEach(() => {
  load.mockResolvedValue(scope() as never)
  publish.mockResolvedValue(undefined)
  record.mockResolvedValue(ok(1))
  repo.listLinks.mockResolvedValue(ok([createFakeSdIntegrationLink()]))
  wsRepo.requireByKind.mockImplementation(async (_ws, kind) =>
    ok(
      kind === 'GITLAB'
        ? createFakeGitlabIntegration()
        : createFakeSdGithubIntegration(),
    ),
  )
  wsRepo.list.mockResolvedValue(ok([createFakeSdGithubIntegration()]))
  gitlab.getItem.mockResolvedValue(
    ok({
      iid: 7,
      title: 'Deploy travado',
      kind: 'GITLAB_MERGE_REQUEST',
      state: 'open',
      webUrl: 'https://gitlab.com/stratus/steel/-/merge_requests/7',
    }),
  )
  gitlab.createIssue.mockResolvedValue(
    ok({
      iid: 12,
      title: '[PRB-000007] Fila travando',
      kind: 'GITLAB_ISSUE',
      state: 'open',
      webUrl: 'https://gitlab.com/stratus/steel/-/issues/12',
    }),
  )
  repo.findRepoLinkByKey.mockResolvedValue(ok(null))
  repo.createLink.mockResolvedValue(ok(createFakeSdIntegrationLink()))
  repo.findLink.mockResolvedValue(ok(createFakeSdIntegrationLink()))
  repo.removeLink.mockResolvedValue(ok(undefined))
  ctxRepo.findWorkspace.mockResolvedValue(
    ok({ id: WS, name: 'Acme', slug: 'acme' }),
  )
  github.getItem.mockResolvedValue(ok(item))
  github.createIssue.mockResolvedValue(ok({ ...item, number: 43 }))
})

describe('SdIntegrationLinkService.list', () => {
  it('lista os vínculos do chamado para agentes', async () => {
    const links = expectOk(await SdIntegrationLinkService.list('u1', WS, 't1'))
    expect(links[0].externalKey).toBe('steel-so/steel#42')
    expect(load).toHaveBeenCalledWith('u1', WS, 't1', 'VIEW', {
      agentOnly: true,
    })
  })

  it('propaga a recusa do escopo e o erro de banco', async () => {
    load.mockResolvedValue(err(sdNotAgent()))
    expectErr(
      await SdIntegrationLinkService.list('u1', WS, 't1'),
      'SD_NOT_AGENT',
    )
    load.mockResolvedValue(scope() as never)
    repo.listLinks.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdIntegrationLinkService.list('u1', WS, 't1'),
      'DATABASE_ERROR',
    )
  })
})

describe('SdIntegrationLinkService.linkGithubItem', () => {
  it('vincula o item, registra o evento e audita', async () => {
    const link = expectOk(
      await SdIntegrationLinkService.linkGithubItem('u1', WS, {
        ticketId: 't1',
        ref: '#42',
      }),
    )
    expect(link.externalKey).toBe('steel-so/steel#42')
    expect(github.getItem).toHaveBeenCalledWith(
      'github_pat',
      { owner: 'steel-so', repo: 'steel' },
      42,
    )
    expect(repo.createLink).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'GITHUB_ISSUE',
        externalKey: 'steel-so/steel#42',
        externalState: 'open',
        meta: { title: 'Fila travando' },
      }),
    )
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'integration.linked' }),
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'sd_integration_link',
        action: 'link',
      }),
    )
    expect(publish).toHaveBeenCalled()
  })

  it('aceita a URL completa e o `owner/repo#n` do repositório conectado', async () => {
    expectOk(
      await SdIntegrationLinkService.linkGithubItem('u1', WS, {
        ticketId: 't1',
        ref: 'https://github.com/Steel-SO/Steel/pull/42',
      }),
    )
    expectOk(
      await SdIntegrationLinkService.linkGithubItem('u1', WS, {
        ticketId: 't1',
        ref: 'steel-so/steel#42',
      }),
    )
    expect(github.getItem).toHaveBeenCalledTimes(2)
  })

  it('recusa referência irreconhecível e item de outro repositório', async () => {
    expectErr(
      await SdIntegrationLinkService.linkGithubItem('u1', WS, {
        ticketId: 't1',
        ref: 'nada disso',
      }),
      'VALIDATION_ERROR',
    )
    const error = expectErr(
      await SdIntegrationLinkService.linkGithubItem('u1', WS, {
        ticketId: 't1',
        ref: 'https://github.com/outro/repo/issues/1',
      }),
      'VALIDATION_ERROR',
    )
    expect(error.message).toContain('steel-so/steel')
  })

  it('recusa item já vinculado a este e a outro chamado', async () => {
    repo.findRepoLinkByKey.mockResolvedValue(
      ok(createFakeSdIntegrationLink({ ticketId: 't1' })),
    )
    expect(
      expectErr(
        await SdIntegrationLinkService.linkGithubItem('u1', WS, {
          ticketId: 't1',
          ref: '#42',
        }),
        'SD_INTEGRATION_LINK_EXISTS',
      ).message,
    ).toContain('a este chamado')

    repo.findRepoLinkByKey.mockResolvedValue(
      ok(createFakeSdIntegrationLink({ ticketId: 't9' })),
    )
    expect(
      expectErr(
        await SdIntegrationLinkService.linkGithubItem('u1', WS, {
          ticketId: 't1',
          ref: '#42',
        }),
        'SD_INTEGRATION_LINK_EXISTS',
      ).message,
    ).toContain('a outro chamado')
  })

  it('propaga escopo recusado, chamado fechado e integração ausente', async () => {
    load.mockResolvedValue(err(sdTicketClosed()))
    expectErr(
      await SdIntegrationLinkService.linkGithubItem('u1', WS, {
        ticketId: 't1',
        ref: '#42',
      }),
      'SD_TICKET_CLOSED',
    )
    load.mockResolvedValue(scope() as never)
    wsRepo.requireByKind.mockResolvedValue(err(sdIntegrationNotFound()))
    expectErr(
      await SdIntegrationLinkService.linkGithubItem('u1', WS, {
        ticketId: 't1',
        ref: '#42',
      }),
      'SD_INTEGRATION_NOT_FOUND',
    )
  })

  it('recusa integração com `externalId` corrompido', async () => {
    wsRepo.requireByKind.mockResolvedValue(
      ok(createFakeSdGithubIntegration({ externalId: 'invalido' })),
    )
    expectErr(
      await SdIntegrationLinkService.linkGithubItem('u1', WS, {
        ticketId: 't1',
        ref: '#42',
      }),
      'SD_INTEGRATION_NOT_FOUND',
    )
  })

  it('propaga token ilegível, recusa do GitHub e erros de banco', async () => {
    wsRepo.requireByKind.mockResolvedValue(
      ok(createFakeSdGithubIntegration({ encryptedToken: '' })),
    )
    expectErr(
      await SdIntegrationLinkService.linkGithubItem('u1', WS, {
        ticketId: 't1',
        ref: '#42',
      }),
      'SD_INTEGRATION_NOT_CONFIGURED',
    )

    wsRepo.requireByKind.mockResolvedValue(ok(createFakeSdGithubIntegration()))
    github.getItem.mockResolvedValue(err(sdIntegrationRequestFailed()))
    expectErr(
      await SdIntegrationLinkService.linkGithubItem('u1', WS, {
        ticketId: 't1',
        ref: '#42',
      }),
      'SD_INTEGRATION_REQUEST_FAILED',
    )

    github.getItem.mockResolvedValue(ok(item))
    repo.findRepoLinkByKey.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdIntegrationLinkService.linkGithubItem('u1', WS, {
        ticketId: 't1',
        ref: '#42',
      }),
      'DATABASE_ERROR',
    )

    repo.findRepoLinkByKey.mockResolvedValue(ok(null))
    repo.createLink.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdIntegrationLinkService.linkGithubItem('u1', WS, {
        ticketId: 't1',
        ref: '#42',
      }),
      'DATABASE_ERROR',
    )
  })
})

describe('SdIntegrationLinkService.linkGithubItem — GitLab', () => {
  it('links a merge request by its sigil, inferring the provider', async () => {
    expectOk(
      await SdIntegrationLinkService.linkGithubItem('u1', WS, {
        ticketId: 't1',
        ref: '!7',
      }),
    )
    expect(gitlab.getItem).toHaveBeenCalledWith(
      'https://gitlab.com',
      'gitlab-token',
      'stratus/steel',
      7,
      'GITLAB_MERGE_REQUEST',
    )
    expect(repo.findRepoLinkByKey).toHaveBeenCalledWith(
      'int-gl-1',
      'GITLAB',
      'stratus/steel!7',
    )
    expect(repo.createLink).toHaveBeenCalledWith(
      expect.objectContaining({
        integrationId: 'int-gl-1',
        kind: 'GITLAB_MERGE_REQUEST',
        externalKey: 'stratus/steel!7',
        externalUrl: 'https://gitlab.com/stratus/steel/-/merge_requests/7',
      }),
    )
  })

  it('uses the explicit provider, or the only connected repository', async () => {
    expectOk(
      await SdIntegrationLinkService.linkGithubItem('u1', WS, {
        ticketId: 't1',
        ref: '#3',
        provider: 'GITLAB',
      }),
    )
    expect(gitlab.getItem).toHaveBeenLastCalledWith(
      'https://gitlab.com',
      'gitlab-token',
      'stratus/steel',
      3,
      'GITLAB_ISSUE',
    )

    wsRepo.list.mockResolvedValue(
      ok([createFakeSdIntegration(), createFakeGitlabIntegration()]),
    )
    expectOk(
      await SdIntegrationLinkService.linkGithubItem('u1', WS, {
        ticketId: 't1',
        ref: '#4',
      }),
    )
    expect(wsRepo.requireByKind).toHaveBeenLastCalledWith(WS, 'GITLAB')

    // Both connected (or the list fails): GitHub by default.
    wsRepo.list.mockResolvedValue(
      ok([createFakeSdGithubIntegration(), createFakeGitlabIntegration()]),
    )
    expectOk(
      await SdIntegrationLinkService.linkGithubItem('u1', WS, {
        ticketId: 't1',
        ref: '#4',
      }),
    )
    expect(wsRepo.requireByKind).toHaveBeenLastCalledWith(WS, 'GITHUB')
    wsRepo.list.mockResolvedValue(err(databaseError()))
    expectOk(
      await SdIntegrationLinkService.linkGithubItem('u1', WS, {
        ticketId: 't1',
        ref: '#4',
      }),
    )
    expect(wsRepo.requireByKind).toHaveBeenLastCalledWith(WS, 'GITHUB')
  })

  it('refuses an unreadable GitLab reference and another project', async () => {
    const bad = expectErr(
      await SdIntegrationLinkService.linkGithubItem('u1', WS, {
        ticketId: 't1',
        ref: 'qualquer coisa',
        provider: 'GITLAB',
      }),
      'VALIDATION_ERROR',
    )
    expect(bad.message).toContain('!42')
    const foreign = expectErr(
      await SdIntegrationLinkService.linkGithubItem('u1', WS, {
        ticketId: 't1',
        ref: 'outro/grupo!2',
      }),
      'VALIDATION_ERROR',
    )
    expect(foreign.message).toContain('GitLab')
    expect(foreign.message).toContain('stratus/steel')
  })

  it('refuses a GitLab connection without a project path', async () => {
    wsRepo.requireByKind.mockResolvedValue(
      ok(createFakeGitlabIntegration({ externalId: 'sem-barra' })),
    )
    expectErr(
      await SdIntegrationLinkService.linkGithubItem('u1', WS, {
        ticketId: 't1',
        ref: '!1',
      }),
      'SD_INTEGRATION_NOT_FOUND',
    )
  })
})

describe('SdIntegrationLinkService.providers', () => {
  it('offers the live repository connections with their switch', async () => {
    wsRepo.list.mockResolvedValue(
      ok([
        createFakeSdIntegration(),
        createFakeSdGithubIntegration(),
        createFakeGitlabIntegration({
          config: {
            servicedesk: {
              suggestPhaseOnClose: true,
              allowIssueFromTicket: false,
            },
          },
        }),
      ]),
    )
    expect(
      expectOk(await SdIntegrationLinkService.providers('u1', WS, 't1')),
    ).toEqual([
      {
        provider: 'GITHUB',
        project: 'steel-so/steel',
        allowIssueFromTicket: true,
      },
      {
        provider: 'GITLAB',
        project: 'stratus/steel',
        allowIssueFromTicket: false,
      },
    ])
    expect(load).toHaveBeenCalledWith('u1', WS, 't1', 'VIEW', {
      agentOnly: true,
    })
  })

  it('skips disconnected/corrupt rows and propagates scope and db errors', async () => {
    wsRepo.list.mockResolvedValue(
      ok([
        createFakeSdGithubIntegration({ status: 'DISCONNECTED' }),
        createFakeGitlabIntegration({ externalId: 'x' }),
      ]),
    )
    expect(
      expectOk(await SdIntegrationLinkService.providers('u1', WS, 't1')),
    ).toEqual([])
    wsRepo.list.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdIntegrationLinkService.providers('u1', WS, 't1'),
      'DATABASE_ERROR',
    )
    load.mockResolvedValue(err(sdNotAgent()))
    expectErr(
      await SdIntegrationLinkService.providers('u1', WS, 't1'),
      'SD_NOT_AGENT',
    )
  })
})

describe('SdIntegrationLinkService.createGithubIssue — GitLab', () => {
  it('opens the issue in the GitLab project and links it', async () => {
    const link = expectOk(
      await SdIntegrationLinkService.createGithubIssue(
        'u1',
        WS,
        { ticketId: 't1' },
        'GITLAB',
      ),
    )
    expect(link).toBeDefined()
    expect(gitlab.createIssue).toHaveBeenCalledWith(
      'https://gitlab.com',
      'gitlab-token',
      'stratus/steel',
      expect.objectContaining({
        title: '[PRB-000007] Fila travando',
        description: expect.stringContaining('PRB-000007'),
      }),
    )
    expect(repo.createLink).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'GITLAB_ISSUE',
        externalKey: 'stratus/steel#12',
      }),
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'create',
        meta: expect.objectContaining({ provider: 'GITLAB' }),
      }),
    )
  })

  it('refuses when GitLab does not return the issue number', async () => {
    gitlab.createIssue.mockResolvedValue(
      ok({
        iid: 0,
        title: 'x',
        kind: 'GITLAB_ISSUE',
        state: 'open',
        webUrl: 'https://gitlab.com/x',
      }),
    )
    expectErr(
      await SdIntegrationLinkService.createGithubIssue(
        'u1',
        WS,
        { ticketId: 't1' },
        'GITLAB',
      ),
      'VALIDATION_ERROR',
    )
    gitlab.createIssue.mockResolvedValue(err(sdIntegrationRequestFailed()))
    expectErr(
      await SdIntegrationLinkService.createGithubIssue(
        'u1',
        WS,
        { ticketId: 't1' },
        'GITLAB',
      ),
      'SD_INTEGRATION_REQUEST_FAILED',
    )
  })
})

describe('SdIntegrationLinkService.createGithubIssue', () => {
  it('abre a issue com o contexto do chamado e grava o vínculo', async () => {
    const link = expectOk(
      await SdIntegrationLinkService.createGithubIssue('u1', WS, {
        ticketId: 't1',
      }),
    )
    expect(link.id).toBe('link-1')
    const [, , draft] = github.createIssue.mock.calls[0]
    expect(draft.title).toBe('[PRB-000007] Fila travando')
    expect(draft.body).toContain(
      'https://steel.test/acme/servicedesk/tickets/7',
    )
    expect(draft.body).toContain('Acontece ao reiniciar')
    expect(repo.createLink).toHaveBeenCalledWith(
      expect.objectContaining({
        externalKey: 'steel-so/steel#43',
        meta: expect.objectContaining({ createdFromTicket: true }),
      }),
    )
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'integration.issue_created' }),
    )
  })

  it('aceita título informado pelo agente', async () => {
    expectOk(
      await SdIntegrationLinkService.createGithubIssue('u1', WS, {
        ticketId: 't1',
        title: 'Outro título',
      }),
    )
    expect(github.createIssue.mock.calls[0][2].title).toBe('Outro título')
  })

  it('tolera chamado sem descrição e workspace não encontrado', async () => {
    const bare = scope()
    if (!bare.ok) throw new Error('escopo inválido')
    bare.value.ticket.description = null
    load.mockResolvedValue(bare as never)
    ctxRepo.findWorkspace.mockResolvedValue(ok(null))
    expectOk(
      await SdIntegrationLinkService.createGithubIssue('u1', WS, {
        ticketId: 't1',
      }),
    )
    expect(github.createIssue.mock.calls[0][2].body).toContain(
      'https://steel.test',
    )
  })

  it('tolera erro de banco ao buscar o workspace', async () => {
    ctxRepo.findWorkspace.mockResolvedValue(err(databaseError()))
    expectOk(
      await SdIntegrationLinkService.createGithubIssue('u1', WS, {
        ticketId: 't1',
      }),
    )
  })

  it('recusa chamado que não é problema nem mudança', async () => {
    load.mockResolvedValue(scope('INCIDENT') as never)
    const error = expectErr(
      await SdIntegrationLinkService.createGithubIssue('u1', WS, {
        ticketId: 't1',
      }),
      'VALIDATION_ERROR',
    )
    expect(error.message).toContain('problema e mudança')
  })

  it('recusa quando o workspace desligou a abertura de issue', async () => {
    wsRepo.requireByKind.mockResolvedValue(
      ok(
        createFakeSdGithubIntegration({
          config: { suggestPhaseOnClose: true, allowIssueFromTicket: false },
        }),
      ),
    )
    expectErr(
      await SdIntegrationLinkService.createGithubIssue('u1', WS, {
        ticketId: 't1',
      }),
      'VALIDATION_ERROR',
    )
  })

  it('propaga escopo recusado, integração corrompida, token e GitHub', async () => {
    load.mockResolvedValue(err(sdTicketForbidden()))
    expectErr(
      await SdIntegrationLinkService.createGithubIssue('u1', WS, {
        ticketId: 't1',
      }),
      'SD_TICKET_FORBIDDEN',
    )
    load.mockResolvedValue(scope() as never)

    wsRepo.requireByKind.mockResolvedValue(
      ok(createFakeSdGithubIntegration({ externalId: 'invalido' })),
    )
    expectErr(
      await SdIntegrationLinkService.createGithubIssue('u1', WS, {
        ticketId: 't1',
      }),
      'SD_INTEGRATION_NOT_FOUND',
    )

    wsRepo.requireByKind.mockResolvedValue(
      ok(createFakeSdGithubIntegration({ encryptedToken: '' })),
    )
    expectErr(
      await SdIntegrationLinkService.createGithubIssue('u1', WS, {
        ticketId: 't1',
      }),
      'SD_INTEGRATION_NOT_CONFIGURED',
    )

    wsRepo.requireByKind.mockResolvedValue(ok(createFakeSdGithubIntegration()))
    github.createIssue.mockResolvedValue(err(sdIntegrationRequestFailed()))
    expectErr(
      await SdIntegrationLinkService.createGithubIssue('u1', WS, {
        ticketId: 't1',
      }),
      'SD_INTEGRATION_REQUEST_FAILED',
    )

    github.createIssue.mockResolvedValue(ok({ ...item, number: 43 }))
    repo.createLink.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdIntegrationLinkService.createGithubIssue('u1', WS, {
        ticketId: 't1',
      }),
      'DATABASE_ERROR',
    )
  })
})

describe('SdIntegrationLinkService.remove', () => {
  it('desvincula, registra o evento e audita', async () => {
    expectOk(await SdIntegrationLinkService.remove('u1', WS, 'link-1'))
    expect(repo.removeLink).toHaveBeenCalledWith('link-1', WS)
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'integration.unlinked' }),
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'sd_integration_link',
        action: 'unlink',
      }),
    )
  })

  it('propaga vínculo ausente, escopo recusado e erro de banco', async () => {
    repo.findLink.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdIntegrationLinkService.remove('u1', WS, 'link-1'),
      'DATABASE_ERROR',
    )
    repo.findLink.mockResolvedValue(ok(createFakeSdIntegrationLink()))
    load.mockResolvedValue(err(sdTicketForbidden()))
    expectErr(
      await SdIntegrationLinkService.remove('u1', WS, 'link-1'),
      'SD_TICKET_FORBIDDEN',
    )
    load.mockResolvedValue(scope() as never)
    repo.removeLink.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdIntegrationLinkService.remove('u1', WS, 'link-1'),
      'DATABASE_ERROR',
    )
  })
})
