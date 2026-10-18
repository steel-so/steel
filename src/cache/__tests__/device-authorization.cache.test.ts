import { createId } from '@paralleldrive/cuid2'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  DeviceAuthorizationCache,
  type DeviceAuthorizationEntry,
  hashDeviceCode,
} from '@/src/cache/device-authorization.cache'
import * as redisModule from '@/src/lib/redis'
import { ensureRedisConnected, redis } from '@/src/lib/redis'

const created: { hash: string; userCode: string }[] = []

function entry(
  overrides?: Partial<DeviceAuthorizationEntry>,
): DeviceAuthorizationEntry {
  const now = new Date()
  return {
    userCode: createId().slice(0, 8).toUpperCase(),
    deviceName: 'notebook',
    status: 'pending',
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 600_000).toISOString(),
    interval: 5,
    lastPolledAt: null,
    approval: null,
    decidedBy: null,
    ...overrides,
  }
}

async function seed(overrides?: Partial<DeviceAuthorizationEntry>) {
  const hash = hashDeviceCode(createId())
  const value = entry(overrides)
  created.push({ hash, userCode: value.userCode })
  expect(
    expectOk(await DeviceAuthorizationCache.create(hash, value, 720)),
  ).toBe(true)
  return { hash, value }
}

beforeAll(async () => {
  await ensureRedisConnected()
})

afterEach(async () => {
  vi.restoreAllMocks()
  for (const { hash, userCode } of created.splice(0)) {
    await redis.del([
      `device:auth:${hash}`,
      `device:user:${userCode}`,
      `device:decided:${hash}`,
    ])
  }
})

afterAll(async () => {
  if (redis.isOpen) await redis.disconnect()
})

describe('hashDeviceCode', () => {
  it('is a hex SHA-256', () => {
    expect(hashDeviceCode('abc')).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('DeviceAuthorizationCache', () => {
  it('stores an entry readable by device code and by user code, with a TTL', async () => {
    const { hash, value } = await seed()

    expect(
      expectOk(await DeviceAuthorizationCache.findByDeviceCodeHash(hash)),
    ).toEqual(value)
    expect(
      expectOk(await DeviceAuthorizationCache.findByUserCode(value.userCode)),
    ).toEqual({ deviceCodeHash: hash, entry: value })

    const ttl = await redis.ttl(`device:auth:${hash}`)
    expect(ttl).toBeGreaterThan(700)
    expect(ttl).toBeLessThanOrEqual(720)
    // Only the hash is a key: the device code itself is never stored.
    expect(await redis.get(`device:user:${value.userCode}`)).toBe(hash)
  })

  it('refuses a user code that is already taken', async () => {
    const { value } = await seed()
    const other = hashDeviceCode(createId())
    expect(
      expectOk(
        await DeviceAuthorizationCache.create(
          other,
          entry({ userCode: value.userCode }),
          720,
        ),
      ),
    ).toBe(false)
    expect(
      expectOk(await DeviceAuthorizationCache.findByDeviceCodeHash(other)),
    ).toBeNull()
  })

  it('reads missing and unreadable entries as null', async () => {
    expect(
      expectOk(await DeviceAuthorizationCache.findByDeviceCodeHash('nope')),
    ).toBeNull()
    expect(
      expectOk(await DeviceAuthorizationCache.findByUserCode('NOPE0000')),
    ).toBeNull()

    const { hash, value } = await seed()
    await redis.set(`device:auth:${hash}`, 'not json', { KEEPTTL: true })
    expect(
      expectOk(await DeviceAuthorizationCache.findByDeviceCodeHash(hash)),
    ).toBeNull()
    expect(
      expectOk(await DeviceAuthorizationCache.findByUserCode(value.userCode)),
    ).toBeNull()
    await redis.set(`device:auth:${hash}`, '{"other":1}', { KEEPTTL: true })
    expect(
      expectOk(await DeviceAuthorizationCache.findByDeviceCodeHash(hash)),
    ).toBeNull()
  })

  it('updates keeping the TTL, and never resurrects a gone entry', async () => {
    const { hash, value } = await seed()
    expectOk(
      await DeviceAuthorizationCache.update(hash, {
        ...value,
        status: 'denied',
      }),
    )
    expect(
      expectOk(await DeviceAuthorizationCache.findByDeviceCodeHash(hash))
        ?.status,
    ).toBe('denied')
    expect(await redis.ttl(`device:auth:${hash}`)).toBeGreaterThan(700)

    const gone = hashDeviceCode(createId())
    expectOk(await DeviceAuthorizationCache.update(gone, value))
    expect(await redis.exists(`device:auth:${gone}`)).toBe(0)
  })

  it('lets only the first caller decide', async () => {
    const { hash } = await seed()
    expect(
      expectOk(await DeviceAuthorizationCache.claimDecision(hash, 60)),
    ).toBe(true)
    expect(
      expectOk(await DeviceAuthorizationCache.claimDecision(hash, 60)),
    ).toBe(false)
  })

  it('consumes an entry once and drops its user code', async () => {
    const { hash, value } = await seed({ status: 'approved' })
    const [first, second] = await Promise.all([
      DeviceAuthorizationCache.consume(hash),
      DeviceAuthorizationCache.consume(hash),
    ])
    const winners = [expectOk(first), expectOk(second)].filter(Boolean)
    expect(winners).toEqual([value])
    expect(await redis.exists(`device:user:${value.userCode}`)).toBe(0)
    expect(expectOk(await DeviceAuthorizationCache.consume(hash))).toBeNull()
  })

  it('reports Redis failures as INTERNAL_SERVER_ERROR', async () => {
    vi.spyOn(redisModule, 'ensureRedisConnected').mockRejectedValue(
      new Error('down'),
    )
    const hash = hashDeviceCode('x')
    expectErr(
      await DeviceAuthorizationCache.create(hash, entry(), 10),
      'INTERNAL_SERVER_ERROR',
    )
    expectErr(
      await DeviceAuthorizationCache.findByDeviceCodeHash(hash),
      'INTERNAL_SERVER_ERROR',
    )
    expectErr(
      await DeviceAuthorizationCache.findByUserCode('X'),
      'INTERNAL_SERVER_ERROR',
    )
    expectErr(
      await DeviceAuthorizationCache.update(hash, entry()),
      'INTERNAL_SERVER_ERROR',
    )
    expectErr(
      await DeviceAuthorizationCache.claimDecision(hash, 10),
      'INTERNAL_SERVER_ERROR',
    )
    expectErr(
      await DeviceAuthorizationCache.consume(hash),
      'INTERNAL_SERVER_ERROR',
    )
  })

  it('handles non-Error failures', async () => {
    vi.spyOn(redisModule, 'ensureRedisConnected').mockRejectedValue('down')
    expectErr(
      await DeviceAuthorizationCache.consume('x'),
      'INTERNAL_SERVER_ERROR',
    )
  })
})
