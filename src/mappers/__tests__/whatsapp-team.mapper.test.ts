import { describe, expect, it } from 'vitest'
import { createFakeWhatsAppConversationWithPreview } from '@/src/__tests__/factories/whatsapp-conversation.factory'
import { createFakeWhatsAppTeam } from '@/src/__tests__/factories/whatsapp-team.factory'
import { toWhatsAppConversationDTO } from '../whatsapp-conversation.mapper'
import { toWhatsAppTeamDTO } from '../whatsapp-team.mapper'

describe('toWhatsAppTeamDTO()', () => {
  it('maps the team with leaders first, then agents by name', () => {
    const createdAt = new Date('2026-10-14T12:00:00Z')
    const team = createFakeWhatsAppTeam({
      id: 'team1',
      workspaceId: 'ws1',
      name: 'Vendas',
      description: 'Inbound',
      createdAt,
      updatedAt: createdAt,
      members: [
        { userId: 'u3', role: 'AGENT', name: 'Zuleica' },
        { userId: 'u1', role: 'AGENT', name: 'Ágata' },
        { userId: 'u2', role: 'LEADER', name: 'Marcos' },
        { userId: 'u4', role: 'LEADER', name: 'Bruna' },
      ],
    })

    const dto = toWhatsAppTeamDTO(team)

    expect(dto).toMatchObject({
      id: 'team1',
      workspaceId: 'ws1',
      name: 'Vendas',
      description: 'Inbound',
      createdAt: '2026-10-14T12:00:00.000Z',
      updatedAt: '2026-10-14T12:00:00.000Z',
    })
    expect(dto.members.map((m) => m.name)).toEqual([
      'Bruna',
      'Marcos',
      'Ágata',
      'Zuleica',
    ])
    expect(dto.members[0]).toEqual({
      userId: 'u4',
      name: 'Bruna',
      email: 'u4@stratus.test',
      image: null,
      role: 'LEADER',
    })
  })
})

describe('toWhatsAppConversationDTO() · team', () => {
  it('exposes the team of the conversation', () => {
    const dto = toWhatsAppConversationDTO(
      createFakeWhatsAppConversationWithPreview({
        teamId: 'team1',
        team: { id: 'team1', name: 'Vendas' },
      }),
    )
    expect(dto.teamId).toBe('team1')
    expect(dto.team).toEqual({ id: 'team1', name: 'Vendas' })
  })

  it('is null without a team', () => {
    const dto = toWhatsAppConversationDTO(
      createFakeWhatsAppConversationWithPreview({ teamId: null }),
    )
    expect(dto.team).toBeNull()
  })
})
