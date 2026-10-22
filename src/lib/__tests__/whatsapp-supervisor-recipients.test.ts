import { describe, expect, it } from 'vitest'
import type { WhatsAppTeamSnapshot } from '@/src/lib/whatsapp/conversation-scope'
import { queueEntry } from '@/src/lib/whatsapp/queue-entry'
import {
  filterSupervisorRecipients,
  teamLeaderIds,
} from '@/src/lib/whatsapp/supervisor-recipients'

const TEAMS: WhatsAppTeamSnapshot[] = [
  {
    id: 'sales',
    members: [
      { userId: 'lia', role: 'LEADER' },
      { userId: 'ana', role: 'AGENT' },
    ],
  },
  { id: 'support', members: [{ userId: 'sam', role: 'LEADER' }] },
]

const MEMBERS = [
  { userId: 'owner', role: 'OWNER' as const },
  { userId: 'admin', role: 'ADMIN' as const },
  { userId: 'teamAdmin', role: 'ADMIN' as const },
  { userId: 'lia', role: 'MEMBER' as const },
  { userId: 'ana', role: 'MEMBER' as const },
  { userId: 'sam', role: 'MEMBER' as const },
]

const ids = (list: { userId: string }[]) => list.map((m) => m.userId)

describe('filterSupervisorRecipients()', () => {
  it('defaults to every OWNER and ADMIN when no list is configured', () => {
    const result = filterSupervisorRecipients({
      members: MEMBERS,
      configuredIds: [],
      target: { assignedUserId: null, teamId: null },
      teams: TEAMS,
    })
    expect(ids(result)).toEqual(['owner', 'admin', 'teamAdmin'])
  })

  it('uses the configured list instead of the admins when it is set', () => {
    const result = filterSupervisorRecipients({
      members: MEMBERS,
      configuredIds: ['ana', 'owner'],
      target: { assignedUserId: null, teamId: null },
      teams: TEAMS,
    })
    expect(ids(result)).toEqual(['owner', 'ana'])
  })

  it('adds the extra users (team leaders)', () => {
    const result = filterSupervisorRecipients({
      members: MEMBERS,
      configuredIds: [],
      extraUserIds: ['lia'],
      target: { assignedUserId: null, teamId: 'sales' },
      teams: TEAMS,
    })
    expect(ids(result)).toEqual(['owner', 'admin', 'teamAdmin', 'lia'])
  })

  it('never reaches someone who cannot see the conversation', () => {
    // sam leads "support": the queue of "sales" is not his to see.
    const result = filterSupervisorRecipients({
      members: MEMBERS,
      configuredIds: ['sam', 'lia'],
      target: { assignedUserId: null, teamId: 'sales' },
      teams: TEAMS,
    })
    expect(ids(result)).toEqual(['lia'])
  })

  it('hides a team conversation from an admin who sits in another team', () => {
    const teams: WhatsAppTeamSnapshot[] = [
      ...TEAMS,
      { id: 'ops', members: [{ userId: 'teamAdmin', role: 'AGENT' }] },
    ]
    const result = filterSupervisorRecipients({
      members: MEMBERS,
      configuredIds: [],
      target: { assignedUserId: null, teamId: 'sales' },
      teams,
    })
    expect(ids(result)).toEqual(['owner', 'admin'])
  })
})

describe('teamLeaderIds()', () => {
  it('lists the leaders of the team only', () => {
    expect(teamLeaderIds(TEAMS, 'sales')).toEqual(['lia'])
  })

  it('is empty without a team or for an unknown team', () => {
    expect(teamLeaderIds(TEAMS, null)).toEqual([])
    expect(teamLeaderIds(TEAMS, 'ghost')).toEqual([])
  })
})

describe('queueEntry()', () => {
  it('restarts the queue clock and forgets the previous reminder', () => {
    const now = new Date('2026-10-22T12:00:00Z')
    expect(queueEntry(now)).toEqual({
      queuedAt: now,
      unassignedReminderAt: null,
    })
  })

  it('defaults to the current time', () => {
    expect(queueEntry().queuedAt).toBeInstanceOf(Date)
  })
})
