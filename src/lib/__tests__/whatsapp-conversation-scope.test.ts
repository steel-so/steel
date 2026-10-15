import { describe, expect, it } from 'vitest'
import {
  canAssignConversation,
  canChangeConversationTeam,
  canSeeConversation,
  scopeFromSnapshot,
  scopeVisibility,
  toWhatsAppConversationScopeDTO,
  type WhatsAppTeamSnapshot,
} from '@/src/lib/whatsapp/conversation-scope'

// Workspace: team "sales" (leader Lia, agents Ana and Adm) and team
// "support" (agent Bia). Owner, outsider admin and a teamless member too.
const TEAMS: WhatsAppTeamSnapshot[] = [
  {
    id: 'sales',
    members: [
      { userId: 'lia', role: 'LEADER' },
      { userId: 'ana', role: 'AGENT' },
      { userId: 'adm-in', role: 'AGENT' },
    ],
  },
  { id: 'support', members: [{ userId: 'bia', role: 'AGENT' }] },
]

const conv = (assignedUserId: string | null, teamId: string | null) => ({
  assignedUserId,
  teamId,
})

describe('scopeFromSnapshot()', () => {
  it('gives the owner every conversation, even inside a team', () => {
    const scope = scopeFromSnapshot('lia', 'OWNER', TEAMS)
    expect(scope.mode).toBe('ALL')
    expect(scope.leadsTeamIds).toEqual(['sales'])
  })

  it('gives an admin outside any team every conversation', () => {
    expect(scopeFromSnapshot('adm-out', 'ADMIN', TEAMS).mode).toBe('ALL')
  })

  it('scopes an admin who belongs to a team', () => {
    const scope = scopeFromSnapshot('adm-in', 'ADMIN', TEAMS)
    expect(scope).toMatchObject({
      mode: 'SCOPED',
      memberTeamIds: ['sales'],
      leadsTeamIds: [],
    })
  })

  it('lists the agents and members a leader leads (never themselves)', () => {
    const scope = scopeFromSnapshot('lia', 'MEMBER', TEAMS)
    expect(scope.ledAgentIds.sort()).toEqual(['adm-in', 'ana'])
    expect(scope.ledTeamMemberIds.sort()).toEqual(['adm-in', 'ana', 'lia'])
  })

  it('scopes a member without a team to their own conversations and the queue', () => {
    expect(scopeFromSnapshot('zed', 'MEMBER', TEAMS)).toEqual({
      mode: 'SCOPED',
      userId: 'zed',
      leadsTeamIds: [],
      memberTeamIds: [],
      ledAgentIds: [],
      ledTeamMemberIds: [],
    })
  })
})

describe('canSeeConversation() — authz matrix', () => {
  const owner = scopeFromSnapshot('own', 'OWNER', TEAMS)
  const adminOut = scopeFromSnapshot('adm-out', 'ADMIN', TEAMS)
  const adminIn = scopeFromSnapshot('adm-in', 'ADMIN', TEAMS)
  const leader = scopeFromSnapshot('lia', 'MEMBER', TEAMS)
  const agent = scopeFromSnapshot('ana', 'MEMBER', TEAMS)
  const supportAgent = scopeFromSnapshot('bia', 'MEMBER', TEAMS)
  const teamless = scopeFromSnapshot('zed', 'MEMBER', TEAMS)

  it.each([
    ['owner', owner, conv('bia', 'support'), true],
    ['admin outside teams', adminOut, conv('bia', 'support'), true],
    ['admin in a team: other team', adminIn, conv('bia', 'support'), false],
    ['admin in a team: own queue', adminIn, conv(null, 'sales'), true],
    ['leader: their agent', leader, conv('ana', null), true],
    [
      'leader: their team, outsider assignee',
      leader,
      conv('zed', 'sales'),
      true,
    ],
    ['leader: another team agent', leader, conv('bia', 'support'), false],
    ['agent: own', agent, conv('ana', 'support'), true],
    ['agent: teammate', agent, conv('adm-in', 'sales'), false],
    ['agent: own team queue', agent, conv(null, 'sales'), true],
    ['agent: other team queue', agent, conv(null, 'support'), false],
    ['agent: queue without team', supportAgent, conv(null, null), true],
    ['member without team: queue', teamless, conv(null, null), true],
    ['member without team: team queue', teamless, conv(null, 'sales'), false],
    ['member without team: someone else', teamless, conv('ana', null), false],
  ])('%s → %s', (_label, scope, target, expected) => {
    expect(canSeeConversation(scope, target)).toBe(expected)
  })
})

describe('scopeVisibility() / toWhatsAppConversationScopeDTO()', () => {
  it('does not restrict an unscoped viewer', () => {
    expect(
      scopeVisibility(scopeFromSnapshot('own', 'OWNER', TEAMS)),
    ).toBeUndefined()
  })

  it('carries the scoped viewer filter', () => {
    expect(scopeVisibility(scopeFromSnapshot('lia', 'MEMBER', TEAMS))).toEqual({
      userId: 'lia',
      ledAgentIds: expect.arrayContaining(['ana', 'adm-in']),
      leadsTeamIds: ['sales'],
      memberTeamIds: ['sales'],
    })
  })

  it('maps to the public DTO', () => {
    expect(
      toWhatsAppConversationScopeDTO(scopeFromSnapshot('bia', 'MEMBER', TEAMS)),
    ).toEqual({ mode: 'SCOPED', leadsTeamIds: [], memberTeamIds: ['support'] })
  })
})

describe('canAssignConversation()', () => {
  const leader = scopeFromSnapshot('lia', 'MEMBER', TEAMS)
  const agent = scopeFromSnapshot('ana', 'MEMBER', TEAMS)

  it('lets an unscoped viewer assign anything', () => {
    const admin = scopeFromSnapshot('adm-out', 'ADMIN', TEAMS)
    expect(canAssignConversation(admin, conv('bia', 'support'), 'ana')).toBe(
      true,
    )
  })

  it('lets an agent take a queue item and hand their own back', () => {
    expect(canAssignConversation(agent, conv(null, 'sales'), 'ana')).toBe(true)
    expect(canAssignConversation(agent, conv('ana', 'sales'), null)).toBe(true)
  })

  it('stops an agent from assigning to someone else or grabbing a taken one', () => {
    expect(canAssignConversation(agent, conv(null, 'sales'), 'adm-in')).toBe(
      false,
    )
    expect(canAssignConversation(agent, conv('ana', 'sales'), 'adm-in')).toBe(
      false,
    )
  })

  it('stops anyone from touching a conversation they cannot see', () => {
    expect(canAssignConversation(agent, conv(null, 'support'), 'ana')).toBe(
      false,
    )
  })

  it('lets a leader assign inside the teams they lead only', () => {
    expect(canAssignConversation(leader, conv(null, 'sales'), 'ana')).toBe(true)
    expect(canAssignConversation(leader, conv('ana', 'sales'), 'lia')).toBe(
      true,
    )
    expect(canAssignConversation(leader, conv('ana', 'sales'), null)).toBe(true)
    expect(canAssignConversation(leader, conv('ana', 'sales'), 'bia')).toBe(
      false,
    )
  })
})

describe('canChangeConversationTeam()', () => {
  const leader = scopeFromSnapshot('lia', 'MEMBER', TEAMS)

  it('lets an unscoped viewer move between any teams', () => {
    const owner = scopeFromSnapshot('own', 'OWNER', TEAMS)
    expect(
      canChangeConversationTeam(owner, conv(null, 'support'), 'sales'),
    ).toBe(true)
  })

  it('lets a leader move between no team and the teams they lead', () => {
    expect(canChangeConversationTeam(leader, conv(null, null), 'sales')).toBe(
      true,
    )
    expect(canChangeConversationTeam(leader, conv(null, 'sales'), null)).toBe(
      true,
    )
  })

  it('stops a leader from moving to or from a team they do not lead', () => {
    expect(
      canChangeConversationTeam(leader, conv(null, 'sales'), 'support'),
    ).toBe(false)
    expect(
      canChangeConversationTeam(leader, conv('ana', 'support'), 'sales'),
    ).toBe(false)
  })

  it('stops an agent from moving conversations between teams', () => {
    const agent = scopeFromSnapshot('ana', 'MEMBER', TEAMS)
    expect(canChangeConversationTeam(agent, conv('ana', null), 'sales')).toBe(
      false,
    )
  })

  it('hides a conversation the leader cannot see', () => {
    expect(
      canChangeConversationTeam(leader, conv('bia', 'support'), null),
    ).toBe(false)
  })
})
