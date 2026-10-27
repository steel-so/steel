import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import {
  seedWhatsAppArchive,
  seedWhatsAppArchiveSettings,
} from '@/src/__tests__/factories/whatsapp-archive.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { WhatsAppArchiveRepository as Repo } from '../whatsapp-archive.repository'

const END = new Date('2026-10-26T02:59:59.999Z')

async function setup() {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  return { workspace, user }
}

/** A conversation with messages at the given instants. */
async function seedConversation(
  workspaceId: string,
  userId: string,
  times: Date[],
  extra: { senderUserId?: string } = {},
) {
  const connection = await prisma.whatsAppConnection.create({
    data: {
      workspaceId,
      provider: 'ZAPI',
      label: 'Cobrança',
      phoneNumber: `5511${Math.floor(Math.random() * 1e9)}`,
      createdById: userId,
    },
  })
  const contact = await prisma.whatsAppContact.create({
    data: {
      workspaceId,
      waId: `5511${Math.floor(Math.random() * 1e9)}`,
      name: 'Maria',
    },
  })
  const conversation = await prisma.whatsAppConversation.create({
    data: {
      workspaceId,
      connectionId: connection.id,
      contactId: contact.id,
      assignedUserId: userId,
    },
  })
  for (const createdAt of times) {
    await prisma.whatsAppMessage.create({
      data: {
        workspaceId,
        conversationId: conversation.id,
        direction: extra.senderUserId ? 'OUT' : 'IN',
        type: 'TEXT',
        text: 'oi',
        senderUserId: extra.senderUserId ?? null,
        createdAt,
      },
    })
  }
  return conversation
}

describe('WhatsAppArchiveRepository — settings', () => {
  it('reads null, then upserts and lists only active opted-in workspaces', async () => {
    const { workspace, user } = await setup()
    const suspended = await seedWorkspace({ status: 'SUSPENDED' })
    const off = await seedWorkspace()

    expect(expectOk(await Repo.getSettings(workspace.id))).toBeNull()
    const saved = expectOk(
      await Repo.upsertSettings(workspace.id, {
        enabled: true,
        updatedById: user.id,
      }),
    )
    expect(saved).toMatchObject({ enabled: true, rootFolderName: null })
    const renamed = expectOk(
      await Repo.upsertSettings(workspace.id, {
        rootFolderName: 'BANCO',
        updatedById: user.id,
      }),
    )
    expect(renamed).toMatchObject({ enabled: true, rootFolderName: 'BANCO' })

    await seedWhatsAppArchiveSettings(suspended.id)
    await seedWhatsAppArchiveSettings(off.id, { enabled: false })
    const enabled = expectOk(await Repo.listEnabledWorkspaces()).map(
      (row) => row.workspaceId,
    )
    expect(enabled).toContain(workspace.id)
    expect(enabled).not.toContain(suspended.id)
    expect(enabled).not.toContain(off.id)
  })
})

describe('WhatsAppArchiveRepository — packages', () => {
  it('creates, finds, lists and moves a package through its states', async () => {
    const { workspace, user } = await setup()
    const created = expectOk(
      await Repo.create({
        workspaceId: workspace.id,
        kind: 'WEEKLY',
        periodStart: new Date('2026-10-19T03:00:00.000Z'),
        periodEnd: END,
        triggeredById: user.id,
      }),
    )
    expect(created).toMatchObject({ status: 'QUEUED' })
    expect(created.triggeredBy?.email).toBe(user.email)

    expect(expectOk(await Repo.findActive(workspace.id, 'WEEKLY'))?.id).toBe(
      created.id,
    )
    expect(expectOk(await Repo.findActive(workspace.id, 'MONTHLY_FULL'))).toBe(
      null,
    )
    expect(
      expectOk(await Repo.findForPeriod(workspace.id, 'WEEKLY', END))?.id,
    ).toBe(created.id)

    const startedAt = new Date('2026-10-26T05:00:00.000Z')
    expect(
      expectOk(await Repo.markRunning(created.id, 'BANCO', startedAt)),
    ).toMatchObject({ status: 'RUNNING', rootFolderName: 'BANCO' })

    const done = expectOk(
      await Repo.markDone(created.id, {
        objectKey: `${workspace.id}/${created.id}.zip`,
        sizeBytes: 5_000_000_000,
        sha256: 'ab'.repeat(32),
        fileCount: 3,
        atendimentoCount: 2,
        completedAt: startedAt,
        expiresAt: new Date('2027-01-24T05:00:00.000Z'),
      }),
    )
    // Bigger than 32 bits: kept as BigInt.
    expect(done.sizeBytes).toBe(BigInt(5_000_000_000))
    expect(done.status).toBe('DONE')

    expectOk(await Repo.markOffsiteCopied(created.id, 'off/key', startedAt))
    const found = expectOk(await Repo.findById(created.id, workspace.id))
    expect(found.offsiteKey).toBe('off/key')
    expectErr(
      await Repo.findById(created.id, 'other-workspace'),
      'WHATSAPP_ARCHIVE_NOT_FOUND',
    )
    expect(expectOk(await Repo.findById(created.id)).id).toBe(created.id)

    await seedWhatsAppArchive(workspace.id, { kind: 'MONTHLY_FULL' })
    const list = expectOk(await Repo.listByWorkspace(workspace.id))
    expect(list).toHaveLength(2)
    expect(expectOk(await Repo.listByWorkspace(workspace.id, 1))).toHaveLength(
      1,
    )
  })

  it('keeps failed packages out of the period lookup', async () => {
    const { workspace } = await setup()
    const row = await seedWhatsAppArchive(workspace.id)
    expectOk(await Repo.markFailed(row.id, 'x'.repeat(2000)))
    const failed = expectOk(await Repo.findById(row.id))
    expect(failed.status).toBe('FAILED')
    expect(failed.error).toHaveLength(1000)
    expect(
      expectOk(await Repo.findForPeriod(workspace.id, 'WEEKLY', END)),
    ).toBe(null)
    expect(expectOk(await Repo.findActive(workspace.id, 'WEEKLY'))).toBe(null)
  })

  it('lists expired packages and forgets their files', async () => {
    const { workspace } = await setup()
    const now = new Date('2027-02-01T00:00:00.000Z')
    const expired = await seedWhatsAppArchive(workspace.id, {
      status: 'DONE',
      objectKey: 'a.zip',
      offsiteKey: 'off/a.zip',
      expiresAt: new Date('2027-01-01T00:00:00.000Z'),
    })
    await seedWhatsAppArchive(workspace.id, {
      status: 'DONE',
      objectKey: 'b.zip',
      expiresAt: new Date('2027-06-01T00:00:00.000Z'),
    })
    const running = await seedWhatsAppArchive(workspace.id, {
      status: 'RUNNING',
    })

    expect(expectOk(await Repo.listExpired(now)).map((r) => r.id)).toEqual([
      expired.id,
    ])
    expect(expectOk(await Repo.markExpired([expired.id]))).toBe(1)
    expect(expectOk(await Repo.markExpired([]))).toBe(0)
    expect(expectOk(await Repo.listExpired(now))).toEqual([])

    const live = expectOk(await Repo.listLiveObjects())
    expect(live.map((r) => r.objectKey ?? r.id).sort()).toEqual(
      ['b.zip', running.id].sort(),
    )
  })
})

describe('WhatsAppArchiveRepository — source reads', () => {
  it('pages conversations with messages in the range', async () => {
    const { workspace, user } = await setup()
    const inRange = new Date('2026-10-20T12:00:00.000Z')
    const a = await seedConversation(workspace.id, user.id, [inRange])
    const b = await seedConversation(workspace.id, user.id, [inRange])
    // Only messages outside the range: not listed.
    await seedConversation(workspace.id, user.id, [
      new Date('2026-10-27T12:00:00.000Z'),
    ])
    const range = { start: new Date('2026-10-19T03:00:00.000Z'), end: END }

    const ids = [a.id, b.id].sort()
    const first = expectOk(
      await Repo.listConversationBatch(workspace.id, range, null, 1),
    )
    expect(first.map((c) => c.id)).toEqual([ids[0]])
    expect(first[0]).toMatchObject({
      connection: { label: 'Cobrança' },
      contact: { name: 'Maria' },
      assignedUser: { id: user.id },
    })
    const second = expectOk(
      await Repo.listConversationBatch(workspace.id, range, ids[0], 10),
    )
    expect(second.map((c) => c.id)).toEqual([ids[1]])

    // Without a lower bound, the later one is included only up to `end`.
    const all = expectOk(
      await Repo.listConversationBatch(
        workspace.id,
        { start: null, end: new Date('2027-01-01T00:00:00.000Z') },
        null,
        10,
      ),
    )
    expect(all).toHaveLength(3)
  })

  it('pages messages oldest first, ties broken by id', async () => {
    const { workspace, user } = await setup()
    const same = new Date('2026-10-20T12:00:00.000Z')
    const conversation = await seedConversation(
      workspace.id,
      user.id,
      [same, same, new Date('2026-10-21T12:00:00.000Z')],
      { senderUserId: user.id },
    )
    const range = { start: null, end: END }

    const page1 = expectOk(
      await Repo.listMessagePage(conversation.id, range, null, 2),
    )
    expect(page1).toHaveLength(2)
    expect(page1[0].senderUser?.name).toBe(user.name)
    expect(page1[0].id < page1[1].id).toBe(true)
    const last = page1[1]
    const page2 = expectOk(
      await Repo.listMessagePage(
        conversation.id,
        range,
        { createdAt: last.createdAt, id: last.id },
        2,
      ),
    )
    expect(page2.map((m) => m.createdAt.toISOString())).toEqual([
      '2026-10-21T12:00:00.000Z',
    ])
  })
})

describe('WhatsAppArchiveRepository — database failures', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns DATABASE_ERROR when Prisma throws', async () => {
    const boom = () => Promise.reject(new Error('boom'))
    for (const method of ['findUnique', 'upsert', 'findMany'] as const) {
      vi.spyOn(prisma.whatsAppArchiveSettings, method).mockImplementation(
        boom as never,
      )
    }
    for (const method of [
      'findMany',
      'findFirst',
      'create',
      'update',
      'updateMany',
    ] as const) {
      vi.spyOn(prisma.whatsAppArchive, method).mockImplementation(boom as never)
    }
    vi.spyOn(prisma.whatsAppConversation, 'findMany').mockImplementation(
      boom as never,
    )
    vi.spyOn(prisma.whatsAppMessage, 'findMany').mockImplementation(
      boom as never,
    )
    const range = { start: null, end: END }
    const results = [
      await Repo.getSettings('w'),
      await Repo.upsertSettings('w', { updatedById: 'u' }),
      await Repo.listEnabledWorkspaces(),
      await Repo.listByWorkspace('w'),
      await Repo.findById('a'),
      await Repo.findActive('w', 'WEEKLY'),
      await Repo.findForPeriod('w', 'WEEKLY', END),
      await Repo.create({
        workspaceId: 'w',
        kind: 'WEEKLY',
        periodStart: null,
        periodEnd: END,
        triggeredById: null,
      }),
      await Repo.markRunning('a', 'R', END),
      await Repo.markDone('a', {
        objectKey: 'k',
        sizeBytes: 1,
        sha256: 's',
        fileCount: 1,
        atendimentoCount: 1,
        completedAt: END,
        expiresAt: END,
      }),
      await Repo.markFailed('a', 'm'),
      await Repo.markOffsiteCopied('a', 'k', END),
      await Repo.listExpired(END),
      await Repo.markExpired(['a']),
      await Repo.listLiveObjects(),
      await Repo.listConversationBatch('w', range, null, 1),
      await Repo.listMessagePage('c', range, null, 1),
    ]
    for (const result of results) expectErr(result, 'DATABASE_ERROR')
  })
})
