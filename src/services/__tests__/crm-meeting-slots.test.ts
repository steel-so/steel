import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeMeetingAvailability,
  createFakeMeetingHost,
  createFakeMeetingPage,
} from '@/src/__tests__/factories/nov-crm-ops.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/crm-meeting.repository')
vi.mock('@/lib/axiom/logger')
vi.mock('@/src/lib/redis', () => ({
  ensureRedisConnected: vi.fn(async () => undefined),
  redis: { get: vi.fn(), set: vi.fn() },
}))
vi.mock('@/src/lib/crypto', () => ({
  decryptConnectionSecret: vi.fn(async (v: string) => v.replace('enc:', '')),
}))
vi.mock('@/src/lib/crm-meetings/ics-fetch', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/src/lib/crm-meetings/ics-fetch')
  >()),
  fetchIcs: vi.fn(),
}))

import { fetchIcs } from '@/src/lib/crm-meetings/ics-fetch'
import { decryptConnectionSecret } from '@/src/lib/crypto'
import { ensureRedisConnected, redis } from '@/src/lib/redis'
import { CrmMeetingRepository } from '@/src/repositories/crm-meeting.repository'
import {
  freeHostsAt,
  planPageSlots,
  roundRobinOrder,
} from '../crm-meeting-slots'

const repo = vi.mocked(CrmMeetingRepository)
const fetchFeed = vi.mocked(fetchIcs)
const cache = vi.mocked(redis)

// Monday 2026-11-09 12:00 UTC = 09:00 in São Paulo (UTC-3).
const NOW = new Date('2026-11-08T12:00:00Z')
const FROM = new Date('2026-11-09T00:00:00Z')
const TO = new Date('2026-11-10T00:00:00Z')

const weekly = { '1': [{ start: '09:00', end: '11:00' }] }

const ICS = (start: string, end: string) =>
  [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:1',
    `DTSTART:${start}`,
    `DTEND:${end}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(ensureRedisConnected).mockResolvedValue(undefined)
  vi.mocked(decryptConnectionSecret).mockImplementation(async (v: string) =>
    v.replace('enc:', ''),
  )
  cache.get.mockResolvedValue(null)
  cache.set.mockResolvedValue('OK' as never)
  repo.busyOf.mockResolvedValue(ok(new Map()))
  repo.recordIcsCheck.mockResolvedValue(undefined)
})

const page = createFakeMeetingPage()

describe('planPageSlots()', () => {
  it('should return nothing for a page without sellers', async () => {
    const plan = expectOk(
      await planPageSlots(createFakeMeetingPage({ hosts: [] }), FROM, TO, NOW),
    )

    expect(plan.slots.size).toBe(0)
    expect(repo.availabilityOf).not.toHaveBeenCalled()
  })

  it('should use the seller weekly hours and drop bookings busy time', async () => {
    repo.availabilityOf.mockResolvedValue(
      ok([createFakeMeetingAvailability({ weeklyHours: weekly })]),
    )
    repo.busyOf.mockResolvedValue(
      ok(
        new Map([
          [
            'host1',
            [
              {
                start: new Date('2026-11-09T12:00:00Z'),
                end: new Date('2026-11-09T12:30:00Z'),
              },
            ],
          ],
        ]),
      ),
    )

    const plan = expectOk(await planPageSlots(page, FROM, TO, NOW))

    expect([...plan.slots.keys()].sort((a, b) => a - b)).toEqual([
      new Date('2026-11-09T12:30:00Z').getTime(),
      new Date('2026-11-09T13:00:00Z').getTime(),
      new Date('2026-11-09T13:30:00Z').getTime(),
    ])
  })

  it('should fall back to the default hours and timezone without a setup', async () => {
    repo.availabilityOf.mockResolvedValue(ok([]))

    const plan = expectOk(await planPageSlots(page, FROM, TO, NOW))

    expect(plan.slots.has(new Date('2026-11-09T12:00:00Z').getTime())).toBe(
      true,
    )
  })

  it('should merge several sellers into the same slot', async () => {
    const two = createFakeMeetingPage({
      hosts: [
        createFakeMeetingHost({ userId: 'host1' }),
        createFakeMeetingHost({ userId: 'host2', position: 1 }),
      ],
    })
    repo.availabilityOf.mockResolvedValue(ok([]))

    const plan = expectOk(await planPageSlots(two, FROM, TO, NOW))

    expect(plan.slots.get(new Date('2026-11-09T12:00:00Z').getTime())).toEqual([
      'host1',
      'host2',
    ])
  })

  it('should propagate repository errors', async () => {
    repo.availabilityOf.mockResolvedValue(err(databaseError('x')))
    expectErr(await planPageSlots(page, FROM, TO, NOW), 'DATABASE_ERROR')

    repo.availabilityOf.mockResolvedValue(ok([]))
    repo.busyOf.mockResolvedValue(err(databaseError('x')))
    expectErr(await planPageSlots(page, FROM, TO, NOW), 'DATABASE_ERROR')
  })

  describe('calendar feed', () => {
    const withFeed = () =>
      repo.availabilityOf.mockResolvedValue(
        ok([
          createFakeMeetingAvailability({
            weeklyHours: weekly,
            icsUrlEnc: 'enc:https://cal.example.com/a.ics',
          }),
        ]),
      )

    it('should block the feed busy time, cache the text and note the check', async () => {
      withFeed()
      fetchFeed.mockResolvedValue({
        ok: true,
        text: ICS('20261109T120000Z', '20261109T130000Z'),
      })

      const plan = expectOk(await planPageSlots(page, FROM, TO, NOW))

      expect(plan.slots.has(new Date('2026-11-09T12:00:00Z').getTime())).toBe(
        false,
      )
      expect(plan.slots.has(new Date('2026-11-09T13:00:00Z').getTime())).toBe(
        true,
      )
      expect(cache.set).toHaveBeenCalledWith(
        expect.stringContaining('crm-meetings:ics:'),
        expect.any(String),
        { EX: 300 },
      )
      expect(repo.recordIcsCheck).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ error: null }),
      )
    })

    it('should read the feed from the cache when present', async () => {
      withFeed()
      cache.get.mockResolvedValue(ICS('20261109T120000Z', '20261109T130000Z'))

      const plan = expectOk(await planPageSlots(page, FROM, TO, NOW))

      expect(fetchFeed).not.toHaveBeenCalled()
      expect(plan.slots.has(new Date('2026-11-09T12:00:00Z').getTime())).toBe(
        false,
      )
    })

    it('should still work when Redis is down', async () => {
      withFeed()
      vi.mocked(ensureRedisConnected).mockRejectedValue(new Error('down'))
      cache.set.mockRejectedValue(new Error('down'))
      fetchFeed.mockResolvedValue({
        ok: true,
        text: ICS('20261109T120000Z', '20261109T130000Z'),
      })

      const plan = expectOk(await planPageSlots(page, FROM, TO, NOW))

      expect(plan.slots.has(new Date('2026-11-09T12:00:00Z').getTime())).toBe(
        false,
      )
    })

    it('should ignore the feed and record the failure when the fetch fails', async () => {
      withFeed()
      fetchFeed.mockResolvedValue({ ok: false, reason: 'timeout' })

      const plan = expectOk(await planPageSlots(page, FROM, TO, NOW))

      expect(plan.slots.has(new Date('2026-11-09T12:00:00Z').getTime())).toBe(
        true,
      )
      expect(repo.recordIcsCheck).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ error: expect.stringContaining('demorou') }),
      )
    })

    it('should ignore a feed whose secret cannot be decrypted', async () => {
      withFeed()
      vi.mocked(decryptConnectionSecret).mockRejectedValue(new Error('bad'))

      const plan = expectOk(await planPageSlots(page, FROM, TO, NOW))

      expect(fetchFeed).not.toHaveBeenCalled()
      expect(plan.slots.has(new Date('2026-11-09T12:00:00Z').getTime())).toBe(
        true,
      )
    })
  })
})

describe('freeHostsAt()', () => {
  const start = new Date('2026-11-09T12:00:00Z')

  it('should return the free sellers in round-robin order', async () => {
    const two = createFakeMeetingPage({
      hosts: [
        createFakeMeetingHost({
          userId: 'host1',
          lastAssignedAt: new Date('2026-11-01'),
        }),
        createFakeMeetingHost({
          userId: 'host2',
          position: 1,
          lastAssignedAt: null,
        }),
      ],
    })
    repo.availabilityOf.mockResolvedValue(ok([]))

    expect(expectOk(await freeHostsAt(two, start, NOW))).toEqual([
      'host2',
      'host1',
    ])
  })

  it('should return nothing when the instant is not free', async () => {
    repo.availabilityOf.mockResolvedValue(ok([]))

    expect(
      expectOk(await freeHostsAt(page, new Date('2026-11-09T04:00:00Z'), NOW)),
    ).toEqual([])
  })

  it('should propagate planning errors', async () => {
    repo.availabilityOf.mockResolvedValue(err(databaseError('x')))

    expectErr(await freeHostsAt(page, start, NOW), 'DATABASE_ERROR')
  })
})

describe('roundRobinOrder()', () => {
  it('should put the longest idle first and break ties by position', () => {
    const hosts = [
      createFakeMeetingHost({
        userId: 'a',
        position: 2,
        lastAssignedAt: new Date('2026-11-05'),
      }),
      createFakeMeetingHost({
        userId: 'b',
        position: 1,
        lastAssignedAt: new Date('2026-11-05'),
      }),
      createFakeMeetingHost({
        userId: 'c',
        position: 0,
        lastAssignedAt: new Date('2026-11-06'),
      }),
      createFakeMeetingHost({ userId: 'd', position: 3, lastAssignedAt: null }),
    ]

    expect(roundRobinOrder({ hosts }, ['a', 'b', 'c', 'd'])).toEqual([
      'd',
      'b',
      'a',
      'c',
    ])
    expect(roundRobinOrder({ hosts }, ['c'])).toEqual(['c'])
  })
})
