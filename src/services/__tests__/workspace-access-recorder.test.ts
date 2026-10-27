import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeUser } from '@/src/__tests__/factories/user.factory'
import { createFakeWorkspaceAccessLog } from '@/src/__tests__/factories/workspace-access-log.factory'
import { databaseError, notFound } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/user.repository')
vi.mock('@/src/repositories/workspace-access-log.repository', () => ({
  WorkspaceAccessLogRepository: { create: vi.fn() },
}))
vi.mock('@/src/cache/workspace-access-log.cache', () => ({
  WorkspaceAccessLogCache: { claim: vi.fn(), release: vi.fn() },
}))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { logger } from '@/lib/axiom/logger'
import { WorkspaceAccessLogCache } from '@/src/cache/workspace-access-log.cache'
import { UserRepository } from '@/src/repositories/user.repository'
import { WorkspaceAccessLogRepository } from '@/src/repositories/workspace-access-log.repository'
import {
  ACCESS_LOG_TEXT_LIMIT,
  recordWorkspaceAccess,
  type WorkspaceAccessAttempt,
} from '../workspace-access-recorder'

const cache = vi.mocked(WorkspaceAccessLogCache)
const users = vi.mocked(UserRepository)
const repo = vi.mocked(WorkspaceAccessLogRepository)

const ATTEMPT: WorkspaceAccessAttempt = {
  workspaceId: 'ws_1',
  userId: 'u_ana',
  ip: '200.1.2.3',
  userAgent: 'Mozilla/5.0',
  outcome: 'BLOCKED',
  surface: 'API',
  path: '/api/workspaces/ws_1/crm/leads',
}

const KEY = {
  workspaceId: 'ws_1',
  userId: 'u_ana',
  ip: '200.1.2.3',
  outcome: 'BLOCKED',
  surface: 'API',
}

beforeEach(() => {
  vi.clearAllMocks()
  cache.claim.mockResolvedValue(true)
  users.findById.mockResolvedValue(
    ok(createFakeUser({ id: 'u_ana', name: 'Ana', email: 'ana@x.com' })),
  )
  repo.create.mockResolvedValue(ok(createFakeWorkspaceAccessLog()))
})

describe('recordWorkspaceAccess', () => {
  it('writes the attempt with a snapshot of the user', async () => {
    await recordWorkspaceAccess(ATTEMPT)
    expect(cache.claim).toHaveBeenCalledWith(KEY)
    expect(repo.create).toHaveBeenCalledWith({
      ...ATTEMPT,
      userEmail: 'ana@x.com',
      userName: 'Ana',
    })
  })

  it('skips the write inside the dedupe window', async () => {
    cache.claim.mockResolvedValue(false)
    await recordWorkspaceAccess(ATTEMPT)
    expect(users.findById).not.toHaveBeenCalled()
    expect(repo.create).not.toHaveBeenCalled()
  })

  it('still records when the user lookup fails', async () => {
    users.findById.mockResolvedValue(err(notFound('User')))
    await recordWorkspaceAccess(ATTEMPT)
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u_ana',
        userEmail: null,
        userName: null,
      }),
    )
  })

  it('clips long client-supplied text and blanks empty values', async () => {
    await recordWorkspaceAccess({
      ...ATTEMPT,
      userAgent: 'x'.repeat(ACCESS_LOG_TEXT_LIMIT + 50),
      path: '',
    })
    const data = repo.create.mock.calls[0][0]
    expect(data.userAgent).toHaveLength(ACCESS_LOG_TEXT_LIMIT)
    expect(data.path).toBeNull()
  })

  it('frees the window and logs when the write fails', async () => {
    repo.create.mockResolvedValue(err(databaseError('db down')))
    await recordWorkspaceAccess(ATTEMPT)
    expect(cache.release).toHaveBeenCalledWith(KEY)
    expect(logger.warn).toHaveBeenCalledWith(
      'workspace.access_log.write_failed',
      expect.objectContaining({ workspaceId: 'ws_1', message: 'db down' }),
    )
  })

  it('never rejects, even when a dependency throws', async () => {
    cache.claim.mockRejectedValue(new Error('boom'))
    await expect(recordWorkspaceAccess(ATTEMPT)).resolves.toBeUndefined()
    expect(logger.warn).toHaveBeenCalledWith(
      'workspace.access_log.write_failed',
      expect.objectContaining({ message: 'boom' }),
    )
  })
})
