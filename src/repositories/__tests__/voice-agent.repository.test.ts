import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedSdTicket } from '@/src/__tests__/factories/sd-kb.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import {
  VOICE_SESSION_CLAIM_WINDOW_MS,
  VoiceAgentRepository,
} from '../voice-agent.repository'

let counter = 0

async function seedConversation(workspaceId: string, userId: string) {
  counter += 1
  const connection = await prisma.whatsAppConnection.create({
    data: {
      workspaceId,
      provider: 'ZAPI',
      label: 'Suporte',
      phoneNumber: `55119999800${String(counter).padStart(2, '0')}`,
      zapiInstanceId: `voice-instance-${counter}`,
      encryptedZapiToken: 'enc:token',
      createdById: userId,
    },
  })
  const contact = await prisma.whatsAppContact.create({
    data: {
      workspaceId,
      waId: `5511977766${String(counter).padStart(3, '0')}`,
    },
  })
  return prisma.whatsAppConversation.create({
    data: { workspaceId, connectionId: connection.id, contactId: contact.id },
  })
}

async function seedVoiceCall(
  workspaceId: string,
  userId: string,
  overrides: Record<string, unknown> = {},
) {
  const conversation = await seedConversation(workspaceId, userId)
  counter += 1
  return prisma.whatsAppPhoneCall.create({
    data: {
      workspaceId,
      conversationId: conversation.id,
      deviceId: 'voice-agent',
      extension: 'suporte',
      destination: '5511999998888',
      callbackTokenHash: `${counter}`.padStart(64, 'a'),
      voiceAgent: true,
      ...overrides,
    },
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('VoiceAgentRepository — settings', () => {
  it('reads nothing before the first save, then upserts', async () => {
    const workspace = await seedWorkspace()
    expect(
      expectOk(await VoiceAgentRepository.findSettings(workspace.id)),
    ).toBeNull()

    const created = expectOk(
      await VoiceAgentRepository.upsertSettings(workspace.id, {
        enabled: true,
        voice: 'ash',
      }),
    )
    expect(created).toMatchObject({
      workspaceId: workspace.id,
      enabled: true,
      voice: 'ash',
      maxCallSeconds: 300,
      monthlyMinutesCap: 300,
      pabxSecretHash: null,
    })

    const updated = expectOk(
      await VoiceAgentRepository.upsertSettings(workspace.id, {
        pabxSecretHash: 'f'.repeat(64),
        pabxSecretHint: 'abcd',
      }),
    )
    expect(updated).toMatchObject({
      enabled: true,
      voice: 'ash',
      pabxSecretHash: 'f'.repeat(64),
    })
  })

  it('returns database errors', async () => {
    vi.spyOn(prisma.voiceAgentSettings, 'findUnique').mockRejectedValue(
      new Error('down'),
    )
    vi.spyOn(prisma.voiceAgentSettings, 'upsert').mockRejectedValue(
      new Error('down'),
    )
    expectErr(await VoiceAgentRepository.findSettings('ws'), 'DATABASE_ERROR')
    expectErr(
      await VoiceAgentRepository.upsertSettings('ws', {}),
      'DATABASE_ERROR',
    )
  })
})

describe('VoiceAgentRepository — routes', () => {
  it('creates, lists, finds, updates and deletes inside the workspace', async () => {
    const [workspace, other] = await Promise.all([
      seedWorkspace(),
      seedWorkspace(),
    ])
    const queue = expectOk(
      await VoiceAgentRepository.createRoute({
        workspaceId: workspace.id,
        kind: 'QUEUE',
        value: 'suporte',
      }),
    )
    const did = expectOk(
      await VoiceAgentRepository.createRoute({
        workspaceId: workspace.id,
        kind: 'DID',
        value: '1140041234',
        label: 'Comercial',
        transferTarget: '300',
      }),
    )
    await VoiceAgentRepository.createRoute({
      workspaceId: other.id,
      kind: 'QUEUE',
      value: 'suporte',
    })

    expect(
      expectOk(await VoiceAgentRepository.listRoutes(workspace.id)).map(
        (route) => route.id,
      ),
    ).toEqual([queue.id, did.id])

    expect(
      expectOk(await VoiceAgentRepository.findRoute(did.id, workspace.id)),
    ).toMatchObject({ value: '1140041234' })
    expect(
      expectOk(await VoiceAgentRepository.findRoute(did.id, other.id)),
    ).toBeNull()

    expect(
      expectOk(
        await VoiceAgentRepository.updateRoute(queue.id, { enabled: false }),
      ).enabled,
    ).toBe(false)

    expectOk(await VoiceAgentRepository.deleteRoute(queue.id))
    expect(
      expectOk(await VoiceAgentRepository.listRoutes(workspace.id)),
    ).toHaveLength(1)
  })

  it('refuses the same queue or number twice in a workspace', async () => {
    const workspace = await seedWorkspace()
    const route = {
      workspaceId: workspace.id,
      kind: 'QUEUE' as const,
      value: 'suporte',
    }
    expectOk(await VoiceAgentRepository.createRoute(route))
    expectErr(await VoiceAgentRepository.createRoute(route), 'DATABASE_ERROR')
  })

  it('matches the enabled route, preferring the dialed number over the queue', async () => {
    const workspace = await seedWorkspace()
    await VoiceAgentRepository.createRoute({
      workspaceId: workspace.id,
      kind: 'QUEUE',
      value: 'suporte',
    })
    const did = expectOk(
      await VoiceAgentRepository.createRoute({
        workspaceId: workspace.id,
        kind: 'DID',
        value: '1140041234',
      }),
    )
    await VoiceAgentRepository.createRoute({
      workspaceId: workspace.id,
      kind: 'QUEUE',
      value: 'financeiro',
      enabled: false,
    })

    expect(
      expectOk(
        await VoiceAgentRepository.findEnabledRoute(workspace.id, {
          queue: 'suporte',
          did: '1140041234',
        }),
      )?.id,
    ).toBe(did.id)
    expect(
      expectOk(
        await VoiceAgentRepository.findEnabledRoute(workspace.id, {
          queue: 'suporte',
        }),
      )?.value,
    ).toBe('suporte')
    expect(
      expectOk(
        await VoiceAgentRepository.findEnabledRoute(workspace.id, {
          queue: 'financeiro',
        }),
      ),
    ).toBeNull()
    expect(
      expectOk(await VoiceAgentRepository.findEnabledRoute(workspace.id, {})),
    ).toBeNull()
  })

  it('returns database errors', async () => {
    vi.spyOn(prisma.voiceAgentRoute, 'findMany').mockRejectedValue(
      new Error('x'),
    )
    vi.spyOn(prisma.voiceAgentRoute, 'findFirst').mockRejectedValue(
      new Error('x'),
    )
    vi.spyOn(prisma.voiceAgentRoute, 'create').mockRejectedValue(new Error('x'))
    vi.spyOn(prisma.voiceAgentRoute, 'update').mockRejectedValue(new Error('x'))
    vi.spyOn(prisma.voiceAgentRoute, 'delete').mockRejectedValue(new Error('x'))
    expectErr(await VoiceAgentRepository.listRoutes('ws'))
    expectErr(await VoiceAgentRepository.findRoute('r', 'ws'))
    expectErr(await VoiceAgentRepository.findEnabledRoute('ws', { queue: 'q' }))
    expectErr(
      await VoiceAgentRepository.createRoute({
        workspaceId: 'ws',
        kind: 'QUEUE',
        value: 'q',
      }),
    )
    expectErr(await VoiceAgentRepository.updateRoute('r', {}))
    expectErr(await VoiceAgentRepository.deleteRoute('r'))
  })
})

describe('VoiceAgentRepository — usage and sessions', () => {
  it('sums the seconds and counts the voice calls since a date', async () => {
    const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
    await seedVoiceCall(workspace.id, user.id, { durationSeconds: 90 })
    await seedVoiceCall(workspace.id, user.id, { durationSeconds: 30 })
    await seedVoiceCall(workspace.id, user.id, {
      durationSeconds: 500,
      createdAt: new Date('2020-01-01T00:00:00.000Z'),
    })
    await seedVoiceCall(workspace.id, user.id, {
      durationSeconds: 700,
      voiceAgent: false,
    })

    expect(
      expectOk(
        await VoiceAgentRepository.usageSince(
          workspace.id,
          new Date('2026-01-01T00:00:00.000Z'),
        ),
      ),
    ).toEqual({ seconds: 120, calls: 2 })

    const empty = await seedWorkspace()
    expect(
      expectOk(await VoiceAgentRepository.usageSince(empty.id, new Date(0))),
    ).toEqual({ seconds: 0, calls: 0 })
  })

  it('claims a fresh session exactly once', async () => {
    const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
    const hash = 'b'.repeat(64)
    await seedVoiceCall(workspace.id, user.id, { callbackTokenHash: hash })
    const now = new Date()

    const claimed = expectOk(await VoiceAgentRepository.claimSession(hash, now))
    expect(claimed).toMatchObject({ status: 'IN_PROGRESS', voiceAgent: true })
    expect(claimed?.answeredAt?.getTime()).toBe(now.getTime())

    expect(
      expectOk(await VoiceAgentRepository.claimSession(hash, now)),
    ).toBeNull()
    expect(
      expectOk(await VoiceAgentRepository.claimSession('c'.repeat(64), now)),
    ).toBeNull()
  })

  it('does not claim an expired session, a plain call or a finished one', async () => {
    const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
    const old = 'd'.repeat(64)
    await seedVoiceCall(workspace.id, user.id, { callbackTokenHash: old })
    const later = new Date(Date.now() + VOICE_SESSION_CLAIM_WINDOW_MS + 5_000)
    expect(
      expectOk(await VoiceAgentRepository.claimSession(old, later)),
    ).toBeNull()

    const plain = 'e'.repeat(64)
    await seedVoiceCall(workspace.id, user.id, {
      callbackTokenHash: plain,
      voiceAgent: false,
    })
    expect(
      expectOk(await VoiceAgentRepository.claimSession(plain, new Date())),
    ).toBeNull()

    const done = '1'.repeat(64)
    await seedVoiceCall(workspace.id, user.id, {
      callbackTokenHash: done,
      status: 'COMPLETED',
    })
    expect(
      expectOk(await VoiceAgentRepository.claimSession(done, new Date())),
    ).toBeNull()
  })

  it('fails the voice calls a dead worker left open', async () => {
    const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
    const hour = 60 * 60 * 1000
    const stale = await seedVoiceCall(workspace.id, user.id, {
      status: 'IN_PROGRESS',
      createdAt: new Date(Date.now() - 3 * hour),
    })
    const fresh = await seedVoiceCall(workspace.id, user.id, {
      status: 'IN_PROGRESS',
    })
    const done = await seedVoiceCall(workspace.id, user.id, {
      status: 'COMPLETED',
      createdAt: new Date(Date.now() - 3 * hour),
    })

    const now = new Date()
    expect(
      expectOk(
        await VoiceAgentRepository.failStaleSessions(
          new Date(now.getTime() - hour),
          now,
        ),
      ),
    ).toBe(1)

    const [s, f, d] = await Promise.all(
      [stale, fresh, done].map((call) =>
        prisma.whatsAppPhoneCall.findUniqueOrThrow({ where: { id: call.id } }),
      ),
    )
    expect(s).toMatchObject({
      status: 'FAILED',
      voiceEndReason: 'worker_restart',
    })
    expect(f.status).toBe('IN_PROGRESS')
    expect(d.status).toBe('COMPLETED')
  })

  it('returns database errors', async () => {
    vi.spyOn(prisma.whatsAppPhoneCall, 'aggregate').mockRejectedValue(
      new Error('x'),
    )
    vi.spyOn(prisma.whatsAppPhoneCall, 'updateMany').mockRejectedValue(
      new Error('x'),
    )
    vi.spyOn(prisma, '$queryRaw').mockRejectedValue(new Error('x'))
    expectErr(await VoiceAgentRepository.usageSince('ws', new Date()))
    expectErr(await VoiceAgentRepository.claimSession('h', new Date()))
    expectErr(
      await VoiceAgentRepository.failStaleSessions(new Date(), new Date()),
    )
    expectErr(
      await VoiceAgentRepository.findTicketIdsForCaller('ws', '1199998888'),
    )
  })
})

describe('VoiceAgentRepository.findTicketIdsForCaller()', () => {
  it('finds only the tickets that belong to the caller’s phone', async () => {
    const [workspace, other, user] = await Promise.all([
      seedWorkspace(),
      seedWorkspace(),
      seedUser(),
    ])
    const contact = await prisma.sdContact.create({
      data: {
        workspaceId: workspace.id,
        name: 'Maria',
        phone: '(11) 3333-4444',
        whatsapp: '+55 11 99999-8888',
        createdById: user.id,
      },
    })
    const stranger = await prisma.sdContact.create({
      data: {
        workspaceId: workspace.id,
        name: 'João',
        phone: '(21) 3333-4444',
        createdById: user.id,
      },
    })
    const removed = await prisma.sdContact.create({
      data: {
        workspaceId: workspace.id,
        name: 'Removido',
        whatsapp: '11999998888',
        createdById: user.id,
        deletedAt: new Date(),
      },
    })
    const noPhone = await prisma.sdContact.create({
      data: {
        workspaceId: workspace.id,
        name: 'Sem telefone',
        createdById: user.id,
      },
    })

    const byWhatsapp = await seedSdTicket(workspace.id, { number: 1 })
    const byPhone = await seedSdTicket(workspace.id, { number: 2 })
    const others = await seedSdTicket(workspace.id, { number: 3 })
    const gone = await seedSdTicket(workspace.id, {
      number: 4,
      deletedAt: new Date(),
    })
    const fromCall = await seedSdTicket(workspace.id, { number: 5 })
    const unrelated = await seedSdTicket(workspace.id, { number: 6 })
    const otherWorkspace = await seedSdTicket(other.id, { number: 1 })
    const pairs: [string, string][] = [
      [byWhatsapp.id, contact.id],
      [byPhone.id, contact.id],
      [others.id, stranger.id],
      [gone.id, contact.id],
      [unrelated.id, noPhone.id],
      [otherWorkspace.id, removed.id],
    ]
    for (const [id, contactId] of pairs) {
      await prisma.sdTicket.update({ where: { id }, data: { contactId } })
    }
    await prisma.sdTicket.update({
      where: { id: byPhone.id },
      data: { createdAt: new Date(Date.now() + 1_000) },
    })

    // An earlier voice call from the same number that opened a ticket.
    await seedVoiceCall(workspace.id, user.id, {
      destination: '5511999998888',
      sdTicketId: fromCall.id,
    })
    await seedVoiceCall(workspace.id, user.id, {
      destination: '5521999998888',
      sdTicketId: unrelated.id,
    })

    const found = expectOk(
      await VoiceAgentRepository.findTicketIdsForCaller(
        workspace.id,
        '1199998888',
      ),
    )
    expect(found.map((ticket) => ticket.number).sort()).toEqual([1, 2, 5])
    expect(found[0].number).toBe(2)

    const landline = expectOk(
      await VoiceAgentRepository.findTicketIdsForCaller(
        workspace.id,
        '1133334444',
      ),
    )
    expect(landline.map((ticket) => ticket.number).sort()).toEqual([1, 2])

    expect(
      expectOk(
        await VoiceAgentRepository.findTicketIdsForCaller(
          workspace.id,
          '3199990000',
        ),
      ),
    ).toEqual([])
  })
})
