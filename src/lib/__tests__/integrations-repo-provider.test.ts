import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeGitlabIntegration,
  createFakeSdGithubIntegration,
  createFakeSdIntegration,
} from '@/src/__tests__/factories/sd-integration.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { sdIntegrationRequestFailed } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/lib/servicedesk/github-client', () => ({
  GithubClient: { getItem: vi.fn(), createIssue: vi.fn() },
}))
vi.mock('../integrations/gitlab-client', () => ({
  GitlabClient: { getItem: vi.fn(), createIssue: vi.fn() },
}))

import { GithubClient } from '@/src/lib/servicedesk/github-client'
import { GitlabClient } from '../integrations/gitlab-client'
import {
  inferRepoProvider,
  isForeignRef,
  parseRepoRef,
  RepoProvider,
  repoTarget,
} from '../integrations/repo-provider'

const github = vi.mocked(GithubClient)
const gitlab = vi.mocked(GitlabClient)

const GH = {
  provider: 'GITHUB' as const,
  project: 'o/r',
  baseUrl: 'https://github.com',
}
const GL = {
  provider: 'GITLAB' as const,
  project: 'g/p',
  baseUrl: 'https://gitlab.com',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('repoTarget', () => {
  it('reads the connected repository/project', () => {
    expect(repoTarget(createFakeSdGithubIntegration())).toEqual({
      provider: 'GITHUB',
      project: 'steel-so/steel',
      baseUrl: 'https://github.com',
    })
    expect(repoTarget(createFakeGitlabIntegration())).toEqual({
      provider: 'GITLAB',
      project: 'stratus/steel',
      baseUrl: 'https://gitlab.com',
    })
    expect(
      repoTarget(createFakeGitlabIntegration({ baseUrl: null }))?.baseUrl,
    ).toBe('https://gitlab.com')
  })

  it('is null for Slack and corrupt rows', () => {
    expect(repoTarget(createFakeSdIntegration())).toBeNull()
    expect(
      repoTarget(createFakeSdGithubIntegration({ externalId: 'x' })),
    ).toBeNull()
    expect(
      repoTarget(createFakeGitlabIntegration({ externalId: 'x' })),
    ).toBeNull()
  })
})

describe('parseRepoRef / inferRepoProvider / isForeignRef', () => {
  it('parses per provider', () => {
    expect(parseRepoRef('GITHUB', 'o/r#4')).toEqual({
      project: 'o/r',
      number: 4,
      kind: null,
    })
    expect(parseRepoRef('GITHUB', '#4')).toEqual({
      project: null,
      number: 4,
      kind: null,
    })
    expect(parseRepoRef('GITHUB', 'nada')).toBeNull()
    expect(parseRepoRef('GITLAB', 'g/p!2')).toEqual({
      project: 'g/p',
      number: 2,
      kind: 'GITLAB_MERGE_REQUEST',
    })
    expect(parseRepoRef('GITLAB', 'nada')).toBeNull()
  })

  it('infers the provider from the shape only', () => {
    expect(inferRepoProvider('https://github.com/o/r/pull/1')).toBe('GITHUB')
    expect(inferRepoProvider('https://git.acme.com/g/p/-/issues/1')).toBe(
      'GITLAB',
    )
    expect(inferRepoProvider('!3')).toBe('GITLAB')
    expect(inferRepoProvider('#3')).toBeNull()
  })

  it('flags references to another repository', () => {
    expect(isForeignRef(GH, { project: null, number: 1, kind: null })).toBe(
      false,
    )
    expect(isForeignRef(GH, { project: 'O/R', number: 1, kind: null })).toBe(
      false,
    )
    expect(isForeignRef(GH, { project: 'x/y', number: 1, kind: null })).toBe(
      true,
    )
  })
})

describe('RepoProvider.getItem', () => {
  it('reads a GitHub item and builds the shared key', async () => {
    github.getItem.mockResolvedValue(
      ok({
        number: 9,
        title: 'PR',
        kind: 'GITHUB_PULL_REQUEST',
        state: 'merged',
        htmlUrl: 'https://github.com/o/r/pull/9',
      }),
    )
    expect(
      expectOk(
        await RepoProvider.getItem(GH, 'tok', {
          project: null,
          number: 9,
          kind: null,
        }),
      ),
    ).toEqual({
      number: 9,
      title: 'PR',
      kind: 'GITHUB_PULL_REQUEST',
      state: 'merged',
      url: 'https://github.com/o/r/pull/9',
      key: 'o/r#9',
    })
    expect(github.getItem).toHaveBeenCalledWith(
      'tok',
      { owner: 'o', repo: 'r' },
      9,
    )
    github.getItem.mockResolvedValue(err(sdIntegrationRequestFailed()))
    expectErr(
      await RepoProvider.getItem(GH, 'tok', {
        project: null,
        number: 9,
        kind: null,
      }),
      'SD_INTEGRATION_REQUEST_FAILED',
    )
  })

  it('reads a GitLab issue by default and a merge request when asked', async () => {
    gitlab.getItem.mockResolvedValue(
      ok({
        iid: 5,
        title: 'Issue',
        kind: 'GITLAB_ISSUE',
        state: 'open',
        webUrl: 'https://gitlab.com/g/p/-/issues/5',
      }),
    )
    expect(
      expectOk(
        await RepoProvider.getItem(GL, 'tok', {
          project: null,
          number: 5,
          kind: null,
        }),
      ).key,
    ).toBe('g/p#5')
    expect(gitlab.getItem).toHaveBeenLastCalledWith(
      'https://gitlab.com',
      'tok',
      'g/p',
      5,
      'GITLAB_ISSUE',
    )
    await RepoProvider.getItem(GL, 'tok', {
      project: null,
      number: 5,
      kind: 'GITLAB_MERGE_REQUEST',
    })
    expect(gitlab.getItem).toHaveBeenLastCalledWith(
      'https://gitlab.com',
      'tok',
      'g/p',
      5,
      'GITLAB_MERGE_REQUEST',
    )
    gitlab.getItem.mockResolvedValue(err(sdIntegrationRequestFailed()))
    expectErr(
      await RepoProvider.getItem(GL, 'tok', {
        project: null,
        number: 5,
        kind: null,
      }),
      'SD_INTEGRATION_REQUEST_FAILED',
    )
  })
})

describe('RepoProvider.createIssue', () => {
  it('opens a GitHub issue', async () => {
    github.createIssue.mockResolvedValue(
      ok({
        number: 10,
        title: 'T',
        kind: 'GITHUB_ISSUE',
        state: 'open',
        htmlUrl: 'https://github.com/o/r/issues/10',
      }),
    )
    expect(
      expectOk(
        await RepoProvider.createIssue(GH, 'tok', { title: 'T', body: 'B' }),
      ).key,
    ).toBe('o/r#10')
    expect(github.createIssue).toHaveBeenCalledWith(
      'tok',
      { owner: 'o', repo: 'r' },
      { title: 'T', body: 'B' },
    )
    github.createIssue.mockResolvedValue(err(sdIntegrationRequestFailed()))
    expectErr(
      await RepoProvider.createIssue(GH, 'tok', { title: 'T', body: 'B' }),
      'SD_INTEGRATION_REQUEST_FAILED',
    )
  })

  it('opens a GitLab issue with the body as description', async () => {
    gitlab.createIssue.mockResolvedValue(
      ok({
        iid: 11,
        title: 'T',
        kind: 'GITLAB_ISSUE',
        state: 'open',
        webUrl: 'https://gitlab.com/g/p/-/issues/11',
      }),
    )
    expect(
      expectOk(
        await RepoProvider.createIssue(GL, 'tok', { title: 'T', body: 'B' }),
      ),
    ).toMatchObject({ number: 11, key: 'g/p#11' })
    expect(gitlab.createIssue).toHaveBeenCalledWith(
      'https://gitlab.com',
      'tok',
      'g/p',
      { title: 'T', description: 'B' },
    )
  })
})
