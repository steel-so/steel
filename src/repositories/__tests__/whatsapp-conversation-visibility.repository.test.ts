import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWhatsAppTeam } from '@/src/__tests__/factories/whatsapp-team.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import {
  canSeeConversation,
  scopeFromSnapshot,
  scopeVisibility,
} from '@/src/lib/whatsapp/conversation-scope'
import { WhatsAppConversationRepository } from '../whatsapp-conversation.repository'
import { WhatsAppTeamRepository } from '../whatsapp-team.repository'

afterEach(() => {
  vi.restoreAllMocks()
})

let counter = 0

/**
 * Equipes: the Prisma filter of the list must select exactly what the pure
 * rule (`canSeeConversation`) allows, for every kind of viewer.
 */
async function arrange() {
  const workspace = await seedWorkspace()
  const [lia, ana, bia, zed] = await Promise.all([
    seedUser(),
    seedUser(),
    seedUser(),
    seedUser(),
  ])
  const sales = await seedWhatsAppTeam({
    workspaceId: workspace.id,
    name: 'Vendas',
    members: [
      { userId: lia.id, role: 'LEADER' },
      { userId: ana.id, role: 'AGENT' },
    ],
  })
  const support = await seedWhatsAppTeam({
    workspaceId: workspace.id,
    name: 'Suporte',
    members: [{ userId: bia.id, role: 'AGENT' }],
  })
  counter += 1
  const connection = await prisma.whatsAppConnection.create({
    data: {
      workspaceId: workspace.id,
      provider: 'ZAPI',
      label: 'Zap',
      phoneNumber: `55119${counter}`,
      zapiInstanceId: `inst-vis-${counter}-${workspace.id}`,
      encryptedZapiToken: 'enc:token',
      createdById: lia.id,
    },
  })

  const rows: [string, string | null, string | null][] = [
    ['mine-ana', ana.id, null],
    ['bia-support', bia.id, support.id],
    ['zed-sales', zed.id, sales.id],
    ['queue', null, null],
    ['queue-sales', null, sales.id],
    ['queue-support', null, support.id],
  ]
  const ids = new Map<string, string>()
  for (const [label, assignedUserId, teamId] of rows) {
    const contact = await prisma.whatsAppContact.create({
      data: { workspaceId: workspace.id, waId: `55${counter}${label}` },
    })
    const conversation = await prisma.whatsAppConversation.create({
      data: {
        workspaceId: workspace.id,
        connectionId: connection.id,
        contactId: contact.id,
        assignedUserId,
        teamId,
      },
    })
    ids.set(conversation.id, label)
  }
  return { workspace, users: { lia, ana, bia, zed }, ids }
}

describe('WhatsAppConversationRepository · Equipes visibility', () => {
  it('lists, for every viewer, exactly what the rule allows', async () => {
    const { workspace, users, ids } = await arrange()
    const snapshot = expectOk(
      await WhatsAppTeamRepository.listMembershipSnapshot(workspace.id),
    )
    const all = expectOk(
      await WhatsAppConversationRepository.listByWorkspace(workspace.id),
    )
    expect(all).toHaveLength(6)
    expect(all[0].team === null || typeof all[0].team?.name === 'string').toBe(
      true,
    )

    const expected: Record<string, string[]> = {
      lia: ['mine-ana', 'zed-sales', 'queue', 'queue-sales'],
      ana: ['mine-ana', 'queue', 'queue-sales'],
      bia: ['bia-support', 'queue', 'queue-support'],
      zed: ['zed-sales', 'queue'],
    }

    for (const [name, user] of Object.entries(users)) {
      const scope = scopeFromSnapshot(user.id, 'MEMBER', snapshot)
      const listed = expectOk(
        await WhatsAppConversationRepository.listByWorkspace(
          workspace.id,
          {},
          scopeVisibility(scope),
        ),
      )
      const labels = listed.map((c) => ids.get(c.id)).sort()
      expect(labels, name).toEqual([...expected[name]].sort())
      // Same answer as the pure rule.
      expect(all.filter((c) => canSeeConversation(scope, c)).length, name).toBe(
        listed.length,
      )
    }
  })

  it('reads assignee and team of given conversations', async () => {
    const { workspace, ids } = await arrange()
    const [first] = [...ids.keys()]

    const targets = expectOk(
      await WhatsAppConversationRepository.listVisibilityTargets(workspace.id, [
        first,
        'missing',
      ]),
    )
    expect(targets).toEqual([
      expect.objectContaining({ id: first, teamId: null }),
    ])
    expect(
      expectOk(
        await WhatsAppConversationRepository.listVisibilityTargets(
          workspace.id,
          [],
        ),
      ),
    ).toEqual([])
  })

  it('maps a failure of the visibility read to DATABASE_ERROR', async () => {
    vi.spyOn(prisma.whatsAppConversation, 'findMany').mockRejectedValueOnce(
      new Error('db down'),
    )
    expectErr(
      await WhatsAppConversationRepository.listVisibilityTargets('ws', ['c']),
      'DATABASE_ERROR',
    )
  })
})
