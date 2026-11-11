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
import { WhatsAppMetaSpendCache } from '@/src/cache/whatsapp-meta-spend.cache'
import * as redisModule from '@/src/lib/redis'
import { ensureRedisConnected, redis } from '@/src/lib/redis'

const used: string[] = []

function connectionId() {
  const id = createId()
  used.push(id)
  return id
}

beforeAll(async () => {
  await ensureRedisConnected()
})

afterEach(async () => {
  vi.restoreAllMocks()
  for (const id of used.splice(0)) {
    await redis.del(`whatsapp:meta-spend:fresh:${id}`)
  }
})

afterAll(async () => {
  if (redis.isOpen) await redis.disconnect()
})

describe('WhatsAppMetaSpendCache', () => {
  it('lets one reader per minute go to Meta', async () => {
    const id = connectionId()
    expect(await WhatsAppMetaSpendCache.claim(id)).toBe(true)
    expect(await WhatsAppMetaSpendCache.claim(id)).toBe(false)
    expect(await WhatsAppMetaSpendCache.claim(connectionId())).toBe(true)
  })

  it('expires the marker after 60 s', async () => {
    const id = connectionId()
    await WhatsAppMetaSpendCache.claim(id)
    const ttl = await redis.ttl(`whatsapp:meta-spend:fresh:${id}`)
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(60)
  })

  it('release makes the next read go to Meta again', async () => {
    const id = connectionId()
    await WhatsAppMetaSpendCache.claim(id)
    await WhatsAppMetaSpendCache.release(id)
    expect(await WhatsAppMetaSpendCache.claim(id)).toBe(true)
  })

  it('reads Meta anyway when Redis is down', async () => {
    vi.spyOn(redisModule, 'ensureRedisConnected').mockRejectedValue(
      new Error('down'),
    )
    expect(await WhatsAppMetaSpendCache.claim('c1')).toBe(true)
    await expect(WhatsAppMetaSpendCache.release('c1')).resolves.toBeUndefined()
  })

  it('also handles a rejection that is not an Error', async () => {
    vi.spyOn(redisModule, 'ensureRedisConnected').mockRejectedValue('down')
    expect(await WhatsAppMetaSpendCache.claim('c2')).toBe(true)
    await expect(WhatsAppMetaSpendCache.release('c2')).resolves.toBeUndefined()
  })
})
