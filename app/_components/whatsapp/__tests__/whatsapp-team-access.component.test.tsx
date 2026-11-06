import { describe, expect, it } from 'vitest'
import { matchesInboxFilter } from '../whatsapp-team-access'

const teams = [
  {
    id: 't1',
    members: [
      { userId: 'leader', role: 'LEADER' as const },
      { userId: 'agent', role: 'AGENT' as const },
    ],
  },
  { id: 't2', members: [{ userId: 'other', role: 'AGENT' as const }] },
]

const conv = (assignedUserId: string | null, teamId: string | null) => ({
  assignedUserId,
  teamId,
})

describe('matchesInboxFilter', () => {
  it('handles all, mine and queue', () => {
    expect(matchesInboxFilter(conv('a', null), 'all', 'me')).toBe(true)
    expect(matchesInboxFilter(conv('me', null), 'mine', 'me')).toBe(true)
    expect(matchesInboxFilter(conv('a', null), 'mine', 'me')).toBe(false)
    expect(matchesInboxFilter(conv(null, null), 'queue', 'me')).toBe(true)
    expect(matchesInboxFilter(conv('a', null), 'queue', 'me')).toBe(false)
  })

  it('matches a conversation placed in the team', () => {
    expect(matchesInboxFilter(conv(null, 't1'), 'team:t1', 'me', teams)).toBe(
      true,
    )
    expect(matchesInboxFilter(conv(null, 't2'), 'team:t1', 'me', teams)).toBe(
      false,
    )
  })

  it('matches a conversation assigned to a member of the team with no team set', () => {
    expect(
      matchesInboxFilter(conv('agent', null), 'team:t1', 'me', teams),
    ).toBe(true)
    expect(
      matchesInboxFilter(conv('leader', null), 'team:t1', 'me', teams),
    ).toBe(true)
    expect(
      matchesInboxFilter(conv('other', null), 'team:t1', 'me', teams),
    ).toBe(false)
  })

  it('does not match an unassigned conversation without a team', () => {
    expect(matchesInboxFilter(conv(null, null), 'team:t1', 'me', teams)).toBe(
      false,
    )
  })

  it('falls back to the team id when the teams are not loaded yet', () => {
    expect(matchesInboxFilter(conv('agent', 't1'), 'team:t1', 'me')).toBe(true)
    expect(matchesInboxFilter(conv('agent', null), 'team:t1', 'me')).toBe(false)
  })
})
