import { describe, expect, it } from 'vitest'
import {
  type DistributionCandidate,
  type DistributionPickInput,
  pickAssignee,
} from '@/src/lib/whatsapp/distribution-picker'

function agent(
  userId: string,
  overrides: Partial<DistributionCandidate> = {},
): DistributionCandidate {
  return {
    userId,
    openCount: 0,
    available: true,
    lastAssignedAt: null,
    ...overrides,
  }
}

function input(
  overrides: Partial<DistributionPickInput> & {
    candidates: DistributionCandidate[]
  },
): DistributionPickInput {
  return {
    mode: 'ROUND_ROBIN',
    maxOpenPerAgent: null,
    onlyAvailable: true,
    lastAssignedUserId: null,
    ...overrides,
  }
}

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 22, 12, minutes))

describe('pickAssignee()', () => {
  describe('pool filters', () => {
    it.each(['ROUND_ROBIN', 'LEAST_LOADED'] as const)(
      'reports an empty pool (%s)',
      (mode) => {
        expect(pickAssignee(input({ mode, candidates: [] }))).toEqual({
          userId: null,
          reason: 'empty_pool',
        })
      },
    )

    it('reports nobody available when everyone is away', () => {
      const result = pickAssignee(
        input({
          candidates: [
            agent('a', { available: false }),
            agent('b', { available: false }),
          ],
        }),
      )
      expect(result).toEqual({ userId: null, reason: 'nobody_available' })
    })

    it('ignores presence when onlyAvailable is off', () => {
      const result = pickAssignee(
        input({
          onlyAvailable: false,
          candidates: [agent('a', { available: false })],
        }),
      )
      expect(result).toEqual({ userId: 'a' })
    })

    it('skips agents who are away and picks among the rest', () => {
      const result = pickAssignee(
        input({
          candidates: [
            agent('a', { available: false }),
            agent('b'),
            agent('c', { available: false }),
          ],
        }),
      )
      expect(result).toEqual({ userId: 'b' })
    })

    it('reports all at capacity when everyone present reached the cap', () => {
      const result = pickAssignee(
        input({
          maxOpenPerAgent: 2,
          candidates: [
            agent('a', { openCount: 2 }),
            agent('b', { openCount: 5 }),
          ],
        }),
      )
      expect(result).toEqual({ userId: null, reason: 'all_at_capacity' })
    })

    it('an away agent below the cap does not rescue the pool', () => {
      const result = pickAssignee(
        input({
          maxOpenPerAgent: 2,
          candidates: [
            agent('a', { openCount: 2 }),
            agent('b', { openCount: 0, available: false }),
          ],
        }),
      )
      expect(result).toEqual({ userId: null, reason: 'all_at_capacity' })
    })

    it('treats the cap as exclusive of the agent right below it', () => {
      const result = pickAssignee(
        input({
          maxOpenPerAgent: 3,
          candidates: [
            agent('a', { openCount: 3 }),
            agent('b', { openCount: 2 }),
          ],
        }),
      )
      expect(result).toEqual({ userId: 'b' })
    })

    it('has no ceiling when maxOpenPerAgent is null', () => {
      const result = pickAssignee(
        input({ candidates: [agent('a', { openCount: 9999 })] }),
      )
      expect(result).toEqual({ userId: 'a' })
    })

    it('counts a repeated user once', () => {
      const result = pickAssignee(
        input({
          lastAssignedUserId: 'a',
          candidates: [agent('a'), agent('a'), agent('b')],
        }),
      )
      expect(result).toEqual({ userId: 'b' })
    })
  })

  describe('ROUND_ROBIN', () => {
    const pool = [agent('c'), agent('a'), agent('b')]

    it('starts with the first agent in id order', () => {
      expect(pickAssignee(input({ candidates: pool }))).toEqual({ userId: 'a' })
    })

    it('moves to the agent after the pointer', () => {
      expect(
        pickAssignee(input({ candidates: pool, lastAssignedUserId: 'a' })),
      ).toEqual({ userId: 'b' })
      expect(
        pickAssignee(input({ candidates: pool, lastAssignedUserId: 'b' })),
      ).toEqual({ userId: 'c' })
    })

    it('wraps around after the last agent', () => {
      expect(
        pickAssignee(input({ candidates: pool, lastAssignedUserId: 'c' })),
      ).toEqual({ userId: 'a' })
    })

    it('walks the whole pool in order, one turn each', () => {
      let pointer: string | null = null
      const order: string[] = []
      for (let turn = 0; turn < 6; turn += 1) {
        const pick = pickAssignee(
          input({ candidates: pool, lastAssignedUserId: pointer }),
        )
        if (pick.userId === null) throw new Error('expected an agent')
        order.push(pick.userId)
        pointer = pick.userId
      }
      expect(order).toEqual(['a', 'b', 'c', 'a', 'b', 'c'])
    })

    it('goes on from a pointer whose agent left the pool', () => {
      expect(
        pickAssignee(
          input({
            candidates: [agent('a'), agent('c')],
            lastAssignedUserId: 'b',
          }),
        ),
      ).toEqual({ userId: 'c' })
    })

    it('skips the away or full agent whose turn it is', () => {
      expect(
        pickAssignee(
          input({
            lastAssignedUserId: 'a',
            maxOpenPerAgent: 1,
            candidates: [agent('a'), agent('b', { openCount: 1 }), agent('c')],
          }),
        ),
      ).toEqual({ userId: 'c' })
    })

    it('hands everything to the only eligible agent', () => {
      expect(
        pickAssignee(
          input({
            lastAssignedUserId: 'a',
            candidates: [agent('a'), agent('b', { available: false })],
          }),
        ),
      ).toEqual({ userId: 'a' })
    })

    it('ignores the load while rotating', () => {
      expect(
        pickAssignee(
          input({
            candidates: [agent('a', { openCount: 9 }), agent('b')],
          }),
        ),
      ).toEqual({ userId: 'a' })
    })
  })

  describe('LEAST_LOADED', () => {
    it('picks the agent with the fewest open conversations', () => {
      expect(
        pickAssignee(
          input({
            mode: 'LEAST_LOADED',
            candidates: [
              agent('a', { openCount: 4 }),
              agent('b', { openCount: 1 }),
              agent('c', { openCount: 3 }),
            ],
          }),
        ),
      ).toEqual({ userId: 'b' })
    })

    it('breaks a tie by the oldest last assignment', () => {
      expect(
        pickAssignee(
          input({
            mode: 'LEAST_LOADED',
            candidates: [
              agent('a', { openCount: 2, lastAssignedAt: at(30) }),
              agent('b', { openCount: 2, lastAssignedAt: at(10) }),
              agent('c', { openCount: 2, lastAssignedAt: at(20) }),
            ],
          }),
        ),
      ).toEqual({ userId: 'b' })
    })

    it('treats "never assigned" as the oldest', () => {
      expect(
        pickAssignee(
          input({
            mode: 'LEAST_LOADED',
            candidates: [
              agent('a', { openCount: 1, lastAssignedAt: at(1) }),
              agent('b', { openCount: 1, lastAssignedAt: null }),
            ],
          }),
        ),
      ).toEqual({ userId: 'b' })
    })

    it('falls back to the id when load and history tie', () => {
      expect(
        pickAssignee(
          input({
            mode: 'LEAST_LOADED',
            candidates: [agent('b'), agent('a'), agent('c')],
          }),
        ),
      ).toEqual({ userId: 'a' })
      expect(
        pickAssignee(
          input({
            mode: 'LEAST_LOADED',
            candidates: [
              agent('b', { lastAssignedAt: at(5) }),
              agent('a', { lastAssignedAt: at(5) }),
            ],
          }),
        ),
      ).toEqual({ userId: 'a' })
    })

    it('does not pick a lighter agent who is away or at the cap', () => {
      expect(
        pickAssignee(
          input({
            mode: 'LEAST_LOADED',
            maxOpenPerAgent: 3,
            candidates: [
              agent('a', { openCount: 0, available: false }),
              agent('b', { openCount: 3 }),
              agent('c', { openCount: 2 }),
            ],
          }),
        ),
      ).toEqual({ userId: 'c' })
    })

    it('is not affected by the round-robin pointer', () => {
      expect(
        pickAssignee(
          input({
            mode: 'LEAST_LOADED',
            lastAssignedUserId: 'a',
            candidates: [agent('a'), agent('b', { openCount: 1 })],
          }),
        ),
      ).toEqual({ userId: 'a' })
    })

    it('keeps the load balanced across consecutive picks', () => {
      const pool = [agent('a'), agent('b'), agent('c')]
      const picks: string[] = []
      let clock = 0
      for (let turn = 0; turn < 6; turn += 1) {
        const pick = pickAssignee(
          input({ mode: 'LEAST_LOADED', candidates: pool }),
        )
        if (pick.userId === null) throw new Error('expected an agent')
        picks.push(pick.userId)
        const winner = pool.find((c) => c.userId === pick.userId)
        if (winner) {
          winner.openCount += 1
          clock += 1
          winner.lastAssignedAt = at(clock)
        }
      }
      expect(picks).toEqual(['a', 'b', 'c', 'a', 'b', 'c'])
    })
  })

  it('does not mutate its input', () => {
    const candidates = [agent('b'), agent('a')]
    pickAssignee(input({ candidates }))
    expect(candidates.map((c) => c.userId)).toEqual(['b', 'a'])
  })
})
