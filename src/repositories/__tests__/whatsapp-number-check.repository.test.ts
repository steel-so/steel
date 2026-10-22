import { describe, expect, it, vi } from 'vitest'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { WhatsAppAiCampaignRepository } from '../whatsapp-ai-campaign.repository'
import { WhatsAppBroadcastRepository } from '../whatsapp-broadcast.repository'
import { WhatsAppContactRepository } from '../whatsapp-contact.repository'
import { WhatsAppNumberValidationRepository } from '../whatsapp-number-validation.repository'

let counter = 0
const next = () => {
  counter += 1
  return counter
}

async function seedContact(workspaceId: string, extra = {}) {
  return prisma.whatsAppContact.create({
    data: { workspaceId, waId: `55119888${next()}`.padEnd(13, '0'), ...extra },
  })
}

async function seedBroadcast(workspaceId: string, contactIds: string[]) {
  const user = await seedUser()
  const connection = await prisma.whatsAppConnection.create({
    data: {
      workspaceId,
      provider: 'ZAPI',
      label: 'Z',
      phoneNumber: `55119999${next()}`,
      zapiInstanceId: `inst-${next()}`,
      encryptedZapiToken: 'enc:token',
      createdById: user.id,
    },
  })
  const list = await prisma.whatsAppBroadcastList.create({
    data: {
      workspaceId,
      connectionId: connection.id,
      name: 'Lista',
      messageBody: 'Oi',
      skipNoWhatsapp: true,
      createdById: user.id,
      recipients: { create: contactIds.map((contactId) => ({ contactId })) },
    },
    include: { recipients: true },
  })
  return { user, connection, list }
}

describe('WhatsAppContactRepository "tem zap?"', () => {
  it('lists the contacts of the workspace with the fields the check uses', async () => {
    const ws = await seedWorkspace()
    const other = await seedWorkspace()
    const mine = await seedContact(ws.id)
    const foreign = await seedContact(other.id)

    const rows = expectOk(
      await WhatsAppContactRepository.listForWhatsappCheck(ws.id, [
        mine.id,
        foreign.id,
      ]),
    )

    expect(rows).toEqual([
      {
        id: mine.id,
        waId: mine.waId,
        hasWhatsapp: null,
        whatsappCheckedAt: null,
      },
    ])
    expect(
      expectOk(await WhatsAppContactRepository.listForWhatsappCheck(ws.id, [])),
    ).toEqual([])
  })

  it('lists contact ids up to the cap', async () => {
    const ws = await seedWorkspace()
    await seedContact(ws.id)
    await seedContact(ws.id)
    await seedContact(ws.id)

    expect(
      expectOk(await WhatsAppContactRepository.listIds(ws.id, 2)),
    ).toHaveLength(2)
    expect(
      expectOk(await WhatsAppContactRepository.listIds(ws.id, 10)),
    ).toHaveLength(3)
  })

  it('saves the answers (with LID) only inside the workspace', async () => {
    const ws = await seedWorkspace()
    const other = await seedWorkspace()
    const yes = await seedContact(ws.id)
    const no = await seedContact(ws.id, { whatsappLid: 'old@lid' })
    const foreign = await seedContact(other.id)
    const at = new Date('2026-10-22T12:00:00.000Z')

    const saved = expectOk(
      await WhatsAppContactRepository.applyWhatsappChecks(
        ws.id,
        [
          { id: yes.id, hasWhatsapp: true, lid: '1@lid' },
          { id: no.id, hasWhatsapp: false, lid: null },
          { id: foreign.id, hasWhatsapp: true, lid: 'x@lid' },
        ],
        at,
      ),
    )

    expect(saved).toBe(3)
    const rows = await prisma.whatsAppContact.findMany({
      where: { id: { in: [yes.id, no.id, foreign.id] } },
    })
    const byId = new Map(rows.map((row) => [row.id, row]))
    expect(byId.get(yes.id)).toMatchObject({
      hasWhatsapp: true,
      whatsappLid: '1@lid',
      whatsappCheckedAt: at,
    })
    expect(byId.get(no.id)).toMatchObject({
      hasWhatsapp: false,
      whatsappLid: null,
      whatsappCheckedAt: at,
    })
    // Another workspace's contact is never touched.
    expect(byId.get(foreign.id)).toMatchObject({
      hasWhatsapp: null,
      whatsappCheckedAt: null,
    })
    expect(
      expectOk(
        await WhatsAppContactRepository.applyWhatsappChecks(ws.id, [], at),
      ),
    ).toBe(0)
  })

  it('filters the list by "tem zap?" state', async () => {
    const ws = await seedWorkspace()
    await seedContact(ws.id, { hasWhatsapp: true })
    await seedContact(ws.id, { hasWhatsapp: false })
    await seedContact(ws.id)

    const filter = async (value: 'yes' | 'no' | 'unknown') =>
      expectOk(
        await WhatsAppContactRepository.listByWorkspace(
          ws.id,
          undefined,
          value,
        ),
      ).map((contact) => contact.hasWhatsapp)

    expect(await filter('yes')).toEqual([true])
    expect(await filter('no')).toEqual([false])
    expect(await filter('unknown')).toEqual([null])
    expect(
      expectOk(await WhatsAppContactRepository.listByWorkspace(ws.id)),
    ).toHaveLength(3)
  })

  it('returns DATABASE_ERROR when the queries throw', async () => {
    vi.spyOn(prisma.whatsAppContact, 'findMany')
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'))
    vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('boom'))

    expectErr(
      await WhatsAppContactRepository.listForWhatsappCheck('w', ['c']),
      'DATABASE_ERROR',
    )
    expectErr(await WhatsAppContactRepository.listIds('w', 1), 'DATABASE_ERROR')
    expectErr(
      await WhatsAppContactRepository.applyWhatsappChecks(
        'w',
        [{ id: 'c', hasWhatsapp: false, lid: null }],
        new Date(),
      ),
      'DATABASE_ERROR',
    )
  })
})

describe('WhatsAppBroadcastRepository "tem zap?"', () => {
  it('skips only PENDING recipients whose contact has no WhatsApp', async () => {
    const ws = await seedWorkspace()
    const none = await seedContact(ws.id, { hasWhatsapp: false })
    const has = await seedContact(ws.id, { hasWhatsapp: true })
    const unknown = await seedContact(ws.id)
    const sentNone = await seedContact(ws.id, { hasWhatsapp: false })
    const { list } = await seedBroadcast(ws.id, [
      none.id,
      has.id,
      unknown.id,
      sentNone.id,
    ])
    await prisma.whatsAppBroadcastRecipient.updateMany({
      where: { broadcastListId: list.id, contactId: sentNone.id },
      data: { status: 'SENT' },
    })

    const count = expectOk(
      await WhatsAppBroadcastRepository.skipPendingWithoutWhatsapp(list.id),
    )

    expect(count).toBe(1)
    const counts = expectOk(
      await WhatsAppBroadcastRepository.countRecipientsByStatus(list.id),
    )
    expect(counts).toEqual({
      PENDING: 2,
      SENT: 1,
      FAILED: 0,
      SKIPPED: 0,
      SKIPPED_NO_WHATSAPP: 1,
    })
    const skipped = await prisma.whatsAppBroadcastRecipient.findFirst({
      where: { broadcastListId: list.id, status: 'SKIPPED_NO_WHATSAPP' },
    })
    expect(skipped?.errorMessage).toBe('Número sem WhatsApp')
  })

  it('skips one recipient at a time, only while PENDING', async () => {
    const ws = await seedWorkspace()
    const contact = await seedContact(ws.id, { hasWhatsapp: false })
    const { list } = await seedBroadcast(ws.id, [contact.id])
    const recipientId = list.recipients[0].id

    expect(
      expectOk(
        await WhatsAppBroadcastRepository.markRecipientNoWhatsapp(recipientId),
      ),
    ).toBe(1)
    expect(
      expectOk(
        await WhatsAppBroadcastRepository.markRecipientNoWhatsapp(recipientId),
      ),
    ).toBe(0)
  })

  it('lists the contact ids of a list and toggles the skip setting', async () => {
    const ws = await seedWorkspace()
    const a = await seedContact(ws.id)
    const b = await seedContact(ws.id)
    const { list } = await seedBroadcast(ws.id, [a.id, b.id])

    expect(
      expectOk(
        await WhatsAppBroadcastRepository.listRecipientContactIds(list.id),
      ).sort(),
    ).toEqual([a.id, b.id].sort())

    expectOk(
      await WhatsAppBroadcastRepository.setSkipNoWhatsapp(list.id, false),
    )
    const fresh = await prisma.whatsAppBroadcastList.findUnique({
      where: { id: list.id },
    })
    expect(fresh?.skipNoWhatsapp).toBe(false)
  })

  it('returns DATABASE_ERROR when the queries throw', async () => {
    vi.spyOn(prisma.whatsAppBroadcastRecipient, 'updateMany')
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'))
    vi.spyOn(
      prisma.whatsAppBroadcastRecipient,
      'findMany',
    ).mockRejectedValueOnce(new Error('boom'))
    vi.spyOn(prisma.whatsAppBroadcastList, 'update').mockRejectedValueOnce(
      new Error('boom'),
    )

    expectErr(
      await WhatsAppBroadcastRepository.markRecipientNoWhatsapp('r'),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppBroadcastRepository.skipPendingWithoutWhatsapp('l'),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppBroadcastRepository.listRecipientContactIds('l'),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppBroadcastRepository.setSkipNoWhatsapp('l', true),
      'DATABASE_ERROR',
    )
  })
})

describe('WhatsAppAiCampaignRepository.listRecipientContactIds()', () => {
  it('lists the contacts queued in the campaign', async () => {
    const ws = await seedWorkspace()
    const user = await seedUser()
    const a = await seedContact(ws.id)
    const campaign = await prisma.whatsAppAiCampaign.create({
      data: {
        workspaceId: ws.id,
        name: 'Campanha',
        createdById: user.id,
        recipients: { create: [{ contactId: a.id }] },
      },
    })

    expect(
      expectOk(
        await WhatsAppAiCampaignRepository.listRecipientContactIds(campaign.id),
      ),
    ).toEqual([a.id])

    vi.spyOn(
      prisma.whatsAppAiCampaignRecipient,
      'findMany',
    ).mockRejectedValueOnce(new Error('boom'))
    expectErr(
      await WhatsAppAiCampaignRepository.listRecipientContactIds(campaign.id),
      'DATABASE_ERROR',
    )
  })
})

describe('WhatsAppNumberValidationRepository', () => {
  async function seedRun(contactIds: string[] = ['c1', 'c2', 'c3']) {
    const ws = await seedWorkspace()
    const user = await seedUser()
    const connection = await prisma.whatsAppConnection.create({
      data: {
        workspaceId: ws.id,
        provider: 'ZAPI',
        label: 'Z',
        phoneNumber: `55119999${next()}`,
        zapiInstanceId: `inst-${next()}`,
        encryptedZapiToken: 'enc:token',
        createdById: user.id,
      },
    })
    const run = expectOk(
      await WhatsAppNumberValidationRepository.create({
        workspaceId: ws.id,
        connectionId: connection.id,
        requestedById: user.id,
        scope: 'CONTACTS',
        scopeId: null,
        contactIds,
        force: false,
      }),
    )
    return { ws, run }
  }

  it('creates a QUEUED run with the total and finds it by workspace', async () => {
    const { ws, run } = await seedRun()
    const other = await seedWorkspace()

    expect(run).toMatchObject({ status: 'QUEUED', total: 3, processed: 0 })
    expect(
      expectOk(await WhatsAppNumberValidationRepository.findById(run.id, ws.id))
        ?.id,
    ).toBe(run.id)
    expect(
      expectOk(
        await WhatsAppNumberValidationRepository.findById(run.id, other.id),
      ),
    ).toBeNull()
    expect(
      expectOk(await WhatsAppNumberValidationRepository.findByIdRaw(run.id))
        ?.id,
    ).toBe(run.id)
  })

  it('finds the active run of a workspace until it finishes', async () => {
    const { ws, run } = await seedRun()
    expect(
      expectOk(await WhatsAppNumberValidationRepository.findActive(ws.id))?.id,
    ).toBe(run.id)

    expectOk(
      await WhatsAppNumberValidationRepository.finish(run.id, 'DONE', null),
    )
    expect(
      expectOk(await WhatsAppNumberValidationRepository.findActive(ws.id)),
    ).toBeNull()
  })

  it('moves to RUNNING once and accumulates the progress', async () => {
    const { run } = await seedRun()

    expect(
      expectOk(await WhatsAppNumberValidationRepository.markRunning(run.id)),
    ).toBe(true)
    expectOk(
      await WhatsAppNumberValidationRepository.addProgress(run.id, {
        processed: 2,
        withWhatsapp: 1,
        withoutWhatsapp: 1,
        failed: 0,
        cached: 0,
      }),
    )
    expectOk(
      await WhatsAppNumberValidationRepository.addProgress(run.id, {
        processed: 1,
        withWhatsapp: 0,
        withoutWhatsapp: 0,
        failed: 1,
        cached: 0,
      }),
    )

    const fresh = expectOk(
      await WhatsAppNumberValidationRepository.findByIdRaw(run.id),
    )
    expect(fresh).toMatchObject({
      status: 'RUNNING',
      processed: 3,
      withWhatsapp: 1,
      withoutWhatsapp: 1,
      failed: 1,
    })
    expect(fresh?.startedAt).toBeInstanceOf(Date)
  })

  it('does not restart a finished run', async () => {
    const { run } = await seedRun()
    expectOk(
      await WhatsAppNumberValidationRepository.finish(run.id, 'FAILED', 'boom'),
    )

    expect(
      expectOk(await WhatsAppNumberValidationRepository.markRunning(run.id)),
    ).toBe(false)
    const fresh = expectOk(
      await WhatsAppNumberValidationRepository.findByIdRaw(run.id),
    )
    expect(fresh).toMatchObject({ status: 'FAILED', errorMessage: 'boom' })
    expect(fresh?.finishedAt).toBeInstanceOf(Date)
  })

  it('returns DATABASE_ERROR when the queries throw', async () => {
    const model = prisma.whatsAppNumberValidation
    vi.spyOn(model, 'create').mockRejectedValueOnce(new Error('boom'))
    vi.spyOn(model, 'findFirst')
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'))
    vi.spyOn(model, 'findUnique').mockRejectedValueOnce(new Error('boom'))
    vi.spyOn(model, 'updateMany').mockRejectedValueOnce(new Error('boom'))
    vi.spyOn(model, 'update')
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'))

    expectErr(
      await WhatsAppNumberValidationRepository.create({
        workspaceId: 'w',
        connectionId: 'c',
        requestedById: null,
        scope: 'CONTACTS',
        scopeId: null,
        contactIds: [],
        force: false,
      }),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppNumberValidationRepository.findById('r', 'w'),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppNumberValidationRepository.findActive('w'),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppNumberValidationRepository.findByIdRaw('r'),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppNumberValidationRepository.markRunning('r'),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppNumberValidationRepository.addProgress('r', {
        processed: 0,
        withWhatsapp: 0,
        withoutWhatsapp: 0,
        failed: 0,
        cached: 0,
      }),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppNumberValidationRepository.finish('r', 'DONE', null),
      'DATABASE_ERROR',
    )
  })
})
