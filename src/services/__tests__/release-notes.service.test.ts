import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeUser } from '@/src/__tests__/factories/user.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { ok } from '@/src/lib/result'

vi.mock('@/src/repositories/user.repository')
vi.mock('@/src/lib/github-releases', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/src/lib/github-releases')>()
  return {
    ...actual,
    fetchLatestRelease: vi.fn(),
    fetchCompareCommitMessages: vi.fn(),
  }
})

import {
  fetchCompareCommitMessages,
  fetchLatestRelease,
  GithubReleasesError,
} from '@/src/lib/github-releases'
import { UserRepository } from '@/src/repositories/user.repository'
import { ReleaseNotesService } from '../release-notes.service'

const mockedUserRepo = vi.mocked(UserRepository)
const mockedLatest = vi.mocked(fetchLatestRelease)
const mockedCompare = vi.mocked(fetchCompareCommitMessages)

const platformAdmin = createFakeUser({
  isPlatformAdmin: true,
  email: 'admin@stratustelecom.com.br',
})

const release = (body: string) => ({
  tag: '2026.08.31',
  name: '2026.08.31',
  body,
  url: 'https://github.com/steel-so/steel/releases/tag/2026.08.31',
  publishedAt: '2026-08-31T21:03:37Z',
})

beforeEach(() => {
  mockedUserRepo.findById.mockResolvedValue(ok(platformAdmin))
})

describe('ReleaseNotesService.draft()', () => {
  it('should deny a non-platform-admin', async () => {
    mockedUserRepo.findById.mockResolvedValue(
      ok(createFakeUser({ email: 'x@example.com' })),
    )
    expectErr(
      await ReleaseNotesService.draft('u1', { source: 'github' }),
      'FORBIDDEN',
    )
    expect(mockedLatest).not.toHaveBeenCalled()
  })

  it('should convert pasted notes without calling GitHub', async () => {
    const draft = expectOk(
      await ReleaseNotesService.draft(platformAdmin.id, {
        source: 'manual',
        markdown: '- feat(crm): novo funil\n- chore: deps',
      }),
    )
    expect(draft.items).toEqual([
      { title: 'Novidades', body: '• CRM: Novo funil' },
    ])
    expect(draft.release).toBeNull()
    expect(mockedLatest).not.toHaveBeenCalled()
  })

  it('should build the draft from the latest release notes', async () => {
    mockedLatest.mockResolvedValue(release('## Features\n- feat: métricas'))

    const draft = expectOk(
      await ReleaseNotesService.draft(platformAdmin.id, { source: 'github' }),
    )

    expect(draft.subject).toBe('Novidades no Steel — 2026.08.31')
    expect(draft.items).toHaveLength(1)
    expect(draft.release).toMatchObject({
      tag: '2026.08.31',
      fromCommits: false,
    })
    expect(mockedCompare).not.toHaveBeenCalled()
  })

  it('should fall back to the commits of the compare range for empty generated notes', async () => {
    mockedLatest.mockResolvedValue(
      release(
        '**Full Changelog**: https://github.com/steel-so/steel/compare/2026.08.28.4...2026.08.31',
      ),
    )
    mockedCompare.mockResolvedValue([
      'feat(crm): add lead triggers to the workflow editor\n\nbody',
      'test(crm): add factory',
    ])

    const draft = expectOk(
      await ReleaseNotesService.draft(platformAdmin.id, { source: 'github' }),
    )

    expect(mockedCompare).toHaveBeenCalledWith('2026.08.28.4', '2026.08.31')
    expect(draft.items).toEqual([
      {
        title: 'Novidades',
        body: '• CRM: Add lead triggers to the workflow editor',
      },
    ])
    expect(draft.skipped).toBe(1)
    expect(draft.release?.fromCommits).toBe(true)
  })

  it('should map GitHub failures to RELEASE_NOTES_UNAVAILABLE', async () => {
    mockedLatest.mockRejectedValue(
      new GithubReleasesError('GitHub API 404', 404),
    )
    const error = expectErr(
      await ReleaseNotesService.draft(platformAdmin.id, { source: 'github' }),
      'RELEASE_NOTES_UNAVAILABLE',
    )
    expect(error.message).toMatch(/Nenhuma release/)
  })
})

describe('ReleaseNotesService.draft() GitHub failure mapping', () => {
  beforeEach(() => {
    mockedUserRepo.findById.mockResolvedValue(ok(platformAdmin))
  })

  it.each([401, 403])(
    'should explain a refused token for HTTP %i',
    async (status) => {
      mockedLatest.mockRejectedValue(
        new GithubReleasesError(`GitHub API ${status}`, status),
      )

      const error = expectErr(
        await ReleaseNotesService.draft(platformAdmin.id, { source: 'github' }),
        'RELEASE_NOTES_UNAVAILABLE',
      )
      expect(error.message).toMatch(/GitHub recusou o acesso/)
    },
  )

  it.each([
    ['a server error', new GithubReleasesError('GitHub API 502', 502)],
    ['a network error', new Error('fetch failed')],
    ['a non-Error rejection', 'socket closed'],
  ])(
    'should fall back to the generic message for %s',
    async (_label, cause) => {
      mockedLatest.mockRejectedValue(cause)

      const error = expectErr(
        await ReleaseNotesService.draft(platformAdmin.id, { source: 'github' }),
        'RELEASE_NOTES_UNAVAILABLE',
      )
      expect(error.message).not.toMatch(/Nenhuma release|recusou/)
    },
  )
})
