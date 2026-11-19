import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeUser } from '@/src/__tests__/factories/user.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { ok } from '@/src/lib/result'

vi.mock('@/src/repositories/user.repository')
vi.mock('@/src/lib/prisma', () => ({
  prisma: { $queryRaw: vi.fn() },
}))
vi.mock('@/src/lib/redis', () => ({ ensureRedisConnected: vi.fn() }))
vi.mock('@/src/lib/server-stats/docker', () => ({
  collectDocker: vi.fn(),
}))

import { prisma } from '@/src/lib/prisma'
import { ensureRedisConnected } from '@/src/lib/redis'
import { collectDocker } from '@/src/lib/server-stats/docker'
import { UserRepository } from '@/src/repositories/user.repository'
import {
  AdminServerService,
  collectPostgres,
  collectRedis,
  parseRedisInfo,
} from '../admin-server.service'

const mockedUserRepo = vi.mocked(UserRepository)
const admin = createFakeUser({ isPlatformAdmin: true })

beforeEach(() => {
  vi.clearAllMocks()
  mockedUserRepo.findById.mockResolvedValue(ok(admin))
  vi.mocked(collectDocker).mockResolvedValue({
    available: false,
    reason: 'Indisponível: monte /var/run/docker.sock:ro no container do app.',
    containers: [],
  })
  vi.mocked(prisma.$queryRaw).mockResolvedValue([
    { size: 1024n, connections: 7n, max_connections: '100' },
  ])
  vi.mocked(ensureRedisConnected).mockResolvedValue({
    ping: vi.fn().mockResolvedValue('PONG'),
    info: vi
      .fn()
      .mockResolvedValue(
        '# Server\r\nredis_version:8.6.3\r\nuptime_in_seconds:99\r\n# Memory\r\nused_memory:2048\r\nconnected_clients:3\r\n',
      ),
  } as never)
})

describe('AdminServerService.getSnapshot()', () => {
  it('should deny a non-platform-admin', async () => {
    mockedUserRepo.findById.mockResolvedValue(
      ok(createFakeUser({ isPlatformAdmin: false })),
    )
    const result = await AdminServerService.getSnapshot('u1')
    expectErr(result)
    expect(collectDocker).not.toHaveBeenCalled()
  })

  it('should assemble host, docker, postgres and redis', async () => {
    const result = await AdminServerService.getSnapshot(
      'u1',
      new Date('2026-11-19T12:00:00Z'),
    )
    const snap = expectOk(result)
    expect(snap.generatedAt).toBe('2026-11-19T12:00:00.000Z')
    expect(snap.host.cpuCount).toBeGreaterThan(0)
    expect(snap.docker.available).toBe(false)
    expect(snap.postgres).toMatchObject({
      ok: true,
      databaseSizeBytes: 1024,
      connections: 7,
      maxConnections: 100,
    })
    expect(snap.redis).toMatchObject({
      ok: true,
      version: '8.6.3',
      usedMemoryBytes: 2048,
      connectedClients: 3,
    })
  })
})

describe('collectors', () => {
  it('should report postgres failure without throwing', async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValue(new Error('conn refused'))
    expect(await collectPostgres()).toMatchObject({
      ok: false,
      error: 'conn refused',
    })
  })

  it('should report redis failure without throwing', async () => {
    vi.mocked(ensureRedisConnected).mockRejectedValue(new Error('tls'))
    expect(await collectRedis()).toMatchObject({ ok: false, error: 'tls' })
  })

  it('should parse redis INFO ignoring section headers', () => {
    expect(parseRedisInfo('# A\r\nk:v\r\nx:y:z\r\n')).toEqual({
      k: 'v',
      x: 'y:z',
    })
  })
})
