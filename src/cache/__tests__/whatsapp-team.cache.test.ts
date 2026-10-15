import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { WhatsAppTeamSnapshotCache } from '@/src/cache/whatsapp-team.cache'
import { ensureRedisConnected, redis } from '@/src/lib/redis'

const snapshot = [
  {
    id: 'team1',
    members: [
      { userId: 'lia', role: 'LEADER' as const },
      { userId: 'ana', role: 'AGENT' as const },
    ],
  },
]

beforeAll(async () => {
  await ensureRedisConnected()
})

afterEach(async () => {
  const keys = await redis.keys('whatsapp-team-snapshot:*')
  if (keys.length > 0) await redis.del(keys)
})

afterAll(async () => {
  if (redis.isOpen) await redis.disconnect()
})

describe('WhatsAppTeamSnapshotCache', () => {
  it('stores and reads the team snapshot of a workspace', async () => {
    await WhatsAppTeamSnapshotCache.set('ws-team-1', snapshot)
    expect(await WhatsAppTeamSnapshotCache.get('ws-team-1')).toEqual(snapshot)
  })

  it('drops it on invalidate', async () => {
    await WhatsAppTeamSnapshotCache.set('ws-team-2', snapshot)
    await WhatsAppTeamSnapshotCache.invalidate('ws-team-2')
    expect(await WhatsAppTeamSnapshotCache.get('ws-team-2')).toBeNull()
  })

  it('expires within five minutes', async () => {
    await WhatsAppTeamSnapshotCache.set('ws-team-3', snapshot)
    const ttl = await redis.ttl('whatsapp-team-snapshot:ws-team-3')
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(300)
  })
})
