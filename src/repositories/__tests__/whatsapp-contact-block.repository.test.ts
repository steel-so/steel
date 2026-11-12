import { describe, expect, it, vi } from 'vitest'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import {
  type CreateContactBlockInput,
  WhatsAppContactBlockRepository,
} from '../whatsapp-contact-block.repository'

let counter = 0

async function seedFixtures() {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  counter += 1
  const suffix = String(counter).padStart(5, '0')
  const meta = await prisma.whatsAppConnection.create({
    data: {
      workspaceId: workspace.id,
      provider: 'META',
      label: 'Oficial',
      phoneNumber: `55117777${suffix}`,
      metaPhoneNumberId: `pn-blk-${counter}`,
      createdById: user.id,
    },
  })
  const zapi = await prisma.whatsAppConnection.create({
    data: {
      workspaceId: workspace.id,
      provider: 'ZAPI',
      label: 'Z-API',
      phoneNumber: `55116666${suffix}`,
      zapiInstanceId: `inst-blk-${counter}`,
      encryptedZapiToken: 'enc:token',
      createdById: user.id,
    },
  })
  const contact = await prisma.whatsAppContact.create({
    data: {
      workspaceId: workspace.id,
      waId: `5511988${suffix}`,
      name: 'Maria',
    },
  })
  return { workspace, user, meta, zapi, contact }
}

function input(
  base: { workspaceId: string; connectionId: string },
  overrides: Partial<CreateContactBlockInput> = {},
): CreateContactBlockInput {
  return {
    ...base,
    contactId: null,
    waId: '5511900000000',
    reason: null,
    blockedById: null,
    origin: 'STEEL',
    providerStatus: 'APPLIED',
    providerError: null,
    at: new Date('2026-11-12T15:00:00Z'),
    ...overrides,
  }
}

describe('WhatsAppContactBlockRepository', () => {
  it('creates a block and finds it by connection + wa_id variants', async () => {
    const { workspace, user, meta, contact } = await seedFixtures()
    const created = expectOk(
      await WhatsAppContactBlockRepository.create(
        input(
          { workspaceId: workspace.id, connectionId: meta.id },
          {
            contactId: contact.id,
            waId: contact.waId,
            reason: 'Spam',
            blockedById: user.id,
          },
        ),
      ),
    )
    expect(created).toMatchObject({
      providerStatus: 'APPLIED',
      reason: 'Spam',
      origin: 'STEEL',
      droppedCount: 0,
      connection: { id: meta.id, label: 'Oficial', provider: 'META' },
      contact: { id: contact.id, name: 'Maria' },
    })
    expect(created.appliedAt?.toISOString()).toBe('2026-11-12T15:00:00.000Z')
    expect(created.lastAttemptAt?.toISOString()).toBe(
      '2026-11-12T15:00:00.000Z',
    )

    const found = expectOk(
      await WhatsAppContactBlockRepository.findActive(meta.id, [
        'other',
        contact.waId,
      ]),
    )
    expect(found?.id).toBe(created.id)
    expect(
      expectOk(await WhatsAppContactBlockRepository.findActive(meta.id, [])),
    ).toBeNull()
    expect(
      expectOk(
        await WhatsAppContactBlockRepository.findWithRefs(meta.id, [
          contact.waId,
        ]),
      )?.contact?.name,
    ).toBe('Maria')
    expect(
      expectOk(await WhatsAppContactBlockRepository.findWithRefs(meta.id, [])),
    ).toBeNull()
    expect(
      expectOk(
        await WhatsAppContactBlockRepository.findById(created.id, workspace.id),
      )?.id,
    ).toBe(created.id)
    expect(
      expectOk(
        await WhatsAppContactBlockRepository.findById(created.id, 'other-ws'),
      ),
    ).toBeNull()
  })

  it('keeps a PENDING block without appliedAt and imports without lastAttemptAt', async () => {
    const { workspace, meta } = await seedFixtures()
    const pending = expectOk(
      await WhatsAppContactBlockRepository.create(
        input(
          { workspaceId: workspace.id, connectionId: meta.id },
          { providerStatus: 'PENDING', providerError: 'janela' },
        ),
      ),
    )
    expect(pending.appliedAt).toBeNull()
    expect(pending.providerError).toBe('janela')

    const imported = expectOk(
      await WhatsAppContactBlockRepository.create(
        input(
          { workspaceId: workspace.id, connectionId: meta.id },
          { waId: '5511911111111', origin: 'PROVIDER' },
        ),
      ),
    )
    expect(imported.lastAttemptAt).toBeNull()
  })

  it('refuses a second block of the same number on the same connection', async () => {
    const { workspace, meta, zapi } = await seedFixtures()
    const base = { workspaceId: workspace.id, connectionId: meta.id }
    expectOk(await WhatsAppContactBlockRepository.create(input(base)))
    expectErr(
      await WhatsAppContactBlockRepository.create(input(base)),
      'DATABASE_ERROR',
    )
    // Another number of the workspace can block the same person.
    expectOk(
      await WhatsAppContactBlockRepository.create(
        input({ workspaceId: workspace.id, connectionId: zapi.id }),
      ),
    )
  })

  it('lists by workspace and number, newest first, and the blocked contacts', async () => {
    const { workspace, meta, zapi, contact } = await seedFixtures()
    const other = await seedFixtures()
    await WhatsAppContactBlockRepository.create(
      input(
        { workspaceId: workspace.id, connectionId: meta.id },
        {
          waId: '5511900000001',
          contactId: contact.id,
          at: new Date('2026-11-10T00:00:00Z'),
        },
      ),
    )
    await WhatsAppContactBlockRepository.create(
      input(
        { workspaceId: workspace.id, connectionId: zapi.id },
        { waId: '5511900000002', at: new Date('2026-11-11T00:00:00Z') },
      ),
    )
    await WhatsAppContactBlockRepository.create(
      input({ workspaceId: other.workspace.id, connectionId: other.meta.id }),
    )

    const all = expectOk(
      await WhatsAppContactBlockRepository.listByWorkspace(workspace.id),
    )
    expect(all.map((row) => row.waId)).toEqual([
      '5511900000002',
      '5511900000001',
    ])
    const onMeta = expectOk(
      await WhatsAppContactBlockRepository.listByWorkspace(
        workspace.id,
        meta.id,
      ),
    )
    expect(onMeta).toHaveLength(1)

    const blocked = expectOk(
      await WhatsAppContactBlockRepository.listBlockedContactIds(
        workspace.id,
        [contact.id, other.contact.id],
      ),
    )
    expect([...blocked]).toEqual([contact.id])
    expect(
      expectOk(
        await WhatsAppContactBlockRepository.listBlockedContactIds(
          workspace.id,
          [],
        ),
      ).size,
    ).toBe(0)
    expect([
      ...expectOk(await WhatsAppContactBlockRepository.listWaIds(zapi.id)),
    ]).toEqual(['5511900000002'])
  })

  it('lists unapplied blocks, updates the provider status and counts drops', async () => {
    const { workspace, meta } = await seedFixtures()
    const base = { workspaceId: workspace.id, connectionId: meta.id }
    const pending = expectOk(
      await WhatsAppContactBlockRepository.create(
        input(base, { waId: '5511900000003', providerStatus: 'PENDING' }),
      ),
    )
    await WhatsAppContactBlockRepository.create(
      input(base, { waId: '5511900000004', providerStatus: 'FAILED' }),
    )
    await WhatsAppContactBlockRepository.create(
      input(base, { waId: '5511900000005' }),
    )
    const unapplied = expectOk(
      await WhatsAppContactBlockRepository.listUnapplied(meta.id),
    )
    expect(unapplied.map((row) => row.providerStatus).sort()).toEqual([
      'FAILED',
      'PENDING',
    ])

    const at = new Date('2026-11-12T18:00:00Z')
    const stillPending = expectOk(
      await WhatsAppContactBlockRepository.updateProviderStatus(pending.id, {
        providerStatus: 'PENDING',
        providerError: 'ainda fora',
        at,
      }),
    )
    expect(stillPending.appliedAt).toBeNull()
    expect(stillPending.lastAttemptAt?.toISOString()).toBe(at.toISOString())
    const applied = expectOk(
      await WhatsAppContactBlockRepository.updateProviderStatus(pending.id, {
        providerStatus: 'APPLIED',
        providerError: null,
        at,
      }),
    )
    expect(applied.appliedAt?.toISOString()).toBe(at.toISOString())
    expect(applied.providerError).toBeNull()

    expectOk(await WhatsAppContactBlockRepository.recordDropped(pending.id, at))
    expectOk(await WhatsAppContactBlockRepository.recordDropped(pending.id, at))
    const counted = await prisma.whatsAppContactBlock.findUnique({
      where: { id: pending.id },
    })
    expect(counted?.droppedCount).toBe(2)
    expect(counted?.lastDroppedAt?.toISOString()).toBe(at.toISOString())
  })

  it('imports many blocks, skipping numbers already blocked', async () => {
    const { workspace, meta } = await seedFixtures()
    const base = { workspaceId: workspace.id, connectionId: meta.id }
    await WhatsAppContactBlockRepository.create(
      input(base, { waId: '5511900000006' }),
    )
    expect(expectOk(await WhatsAppContactBlockRepository.createMany([]))).toBe(0)
    const count = expectOk(
      await WhatsAppContactBlockRepository.createMany([
        input(base, { waId: '5511900000006', origin: 'PROVIDER' }),
        input(base, { waId: '5511900000007', origin: 'PROVIDER' }),
        input(base, {
          waId: '5511900000008',
          origin: 'PROVIDER',
          providerStatus: 'PENDING',
        }),
      ]),
    )
    expect(count).toBe(2)
    const rows = await prisma.whatsAppContactBlock.findMany({
      where: { connectionId: meta.id, origin: 'PROVIDER' },
      orderBy: { waId: 'asc' },
    })
    expect(rows.map((row) => [row.waId, row.appliedAt !== null])).toEqual([
      ['5511900000007', true],
      ['5511900000008', false],
    ])
  })

  it('deletes only inside the workspace', async () => {
    const { workspace, meta } = await seedFixtures()
    const created = expectOk(
      await WhatsAppContactBlockRepository.create(
        input({ workspaceId: workspace.id, connectionId: meta.id }),
      ),
    )
    expect(
      expectOk(
        await WhatsAppContactBlockRepository.delete(created.id, 'other-ws'),
      ),
    ).toBe(false)
    expect(
      expectOk(
        await WhatsAppContactBlockRepository.delete(created.id, workspace.id),
      ),
    ).toBe(true)
  })

  it('keeps the block when the contact is deleted (wa_id stays)', async () => {
    const { workspace, meta, contact } = await seedFixtures()
    const created = expectOk(
      await WhatsAppContactBlockRepository.create(
        input(
          { workspaceId: workspace.id, connectionId: meta.id },
          { contactId: contact.id, waId: contact.waId },
        ),
      ),
    )
    await prisma.whatsAppContact.delete({ where: { id: contact.id } })
    const after = await prisma.whatsAppContactBlock.findUnique({
      where: { id: created.id },
    })
    expect(after).toMatchObject({ contactId: null, waId: contact.waId })
  })

  it('lists only the Comunicação phone lines a block can live on', async () => {
    const { workspace, user, meta, zapi } = await seedFixtures()
    await prisma.whatsAppConnection.create({
      data: {
        workspaceId: workspace.id,
        provider: 'WIDGET',
        label: 'Site',
        phoneNumber: `widget-${counter}`,
        createdById: user.id,
      },
    })
    await prisma.whatsAppConnection.create({
      data: {
        workspaceId: workspace.id,
        provider: 'ZAPI',
        module: 'SERVICE_DESK',
        label: 'Chamados',
        phoneNumber: `55115555${counter}`,
        createdById: user.id,
      },
    })
    const lines = expectOk(
      await WhatsAppContactBlockRepository.listBlockableConnections(
        workspace.id,
      ),
    )
    expect(lines.map((line) => line.id)).toEqual([meta.id, zapi.id])
    const one = expectOk(
      await WhatsAppContactBlockRepository.listBlockableConnections(
        workspace.id,
        zapi.id,
      ),
    )
    expect(one.map((line) => line.id)).toEqual([zapi.id])
  })

  it('resolves the names of the members who blocked', async () => {
    const { user } = await seedFixtures()
    const names = expectOk(
      await WhatsAppContactBlockRepository.findUserNames([
        user.id,
        user.id,
        'gone',
      ]),
    )
    expect(names.get(user.id)).toBe(user.name || user.email)
    expect(names.has('gone')).toBe(false)
    expect(
      expectOk(await WhatsAppContactBlockRepository.findUserNames([])).size,
    ).toBe(0)
  })

  describe('database failures', () => {
    const base = { workspaceId: 'w', connectionId: 'c' }
    it.each([
      [
        'findActive',
        () => WhatsAppContactBlockRepository.findActive('c', ['1']),
        () => vi.spyOn(prisma.whatsAppContactBlock, 'findFirst'),
      ],
      [
        'findById',
        () => WhatsAppContactBlockRepository.findById('b', 'w'),
        () => vi.spyOn(prisma.whatsAppContactBlock, 'findFirst'),
      ],
      [
        'findWithRefs',
        () => WhatsAppContactBlockRepository.findWithRefs('c', ['1']),
        () => vi.spyOn(prisma.whatsAppContactBlock, 'findFirst'),
      ],
      [
        'listByWorkspace',
        () => WhatsAppContactBlockRepository.listByWorkspace('w'),
        () => vi.spyOn(prisma.whatsAppContactBlock, 'findMany'),
      ],
      [
        'listBlockedContactIds',
        () => WhatsAppContactBlockRepository.listBlockedContactIds('w', ['x']),
        () => vi.spyOn(prisma.whatsAppContactBlock, 'findMany'),
      ],
      [
        'listUnapplied',
        () => WhatsAppContactBlockRepository.listUnapplied('c'),
        () => vi.spyOn(prisma.whatsAppContactBlock, 'findMany'),
      ],
      [
        'listWaIds',
        () => WhatsAppContactBlockRepository.listWaIds('c'),
        () => vi.spyOn(prisma.whatsAppContactBlock, 'findMany'),
      ],
      [
        'create',
        () => WhatsAppContactBlockRepository.create(input(base)),
        () => vi.spyOn(prisma.whatsAppContactBlock, 'create'),
      ],
      [
        'createMany',
        () => WhatsAppContactBlockRepository.createMany([input(base)]),
        () => vi.spyOn(prisma.whatsAppContactBlock, 'createMany'),
      ],
      [
        'updateProviderStatus',
        () =>
          WhatsAppContactBlockRepository.updateProviderStatus('b', {
            providerStatus: 'APPLIED',
            providerError: null,
            at: new Date(),
          }),
        () => vi.spyOn(prisma.whatsAppContactBlock, 'update'),
      ],
      [
        'recordDropped',
        () => WhatsAppContactBlockRepository.recordDropped('b', new Date()),
        () => vi.spyOn(prisma.whatsAppContactBlock, 'update'),
      ],
      [
        'delete',
        () => WhatsAppContactBlockRepository.delete('b', 'w'),
        () => vi.spyOn(prisma.whatsAppContactBlock, 'deleteMany'),
      ],
      [
        'listBlockableConnections',
        () => WhatsAppContactBlockRepository.listBlockableConnections('w'),
        () => vi.spyOn(prisma.whatsAppConnection, 'findMany'),
      ],
      [
        'findUserNames',
        () => WhatsAppContactBlockRepository.findUserNames(['u']),
        () => vi.spyOn(prisma.user, 'findMany'),
      ],
    ] as const)(
      '%s maps a thrown error to DATABASE_ERROR',
      async (_name, run, spy) => {
        ;(
          spy() as unknown as { mockRejectedValueOnce: (e: Error) => void }
        ).mockRejectedValueOnce(new Error('boom'))
        expectErr(await run(), 'DATABASE_ERROR')
      },
    )
  })
})
