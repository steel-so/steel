import { describe, expect, it, vi } from 'vitest'
import {
  seedCrmCampaign,
  seedCrmCampaignRecipient,
} from '@/src/__tests__/factories/crm-campaign.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import {
  CrmCampaignConversionRepository,
  CrmCampaignRecipientRepository,
  CrmCampaignRepository,
  channelKey,
} from '../crm-campaign.repository'
import { CrmCampaignAudienceRepository } from '../crm-campaign-audience.repository'

async function setup() {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  return { workspace, user }
}

describe('CrmCampaignRepository', () => {
  it('should create, find, list, update and soft delete', async () => {
    const { workspace, user } = await setup()
    const created = expectOk(
      await CrmCampaignRepository.create({
        workspaceId: workspace.id,
        createdById: user.id,
        name: 'BF',
        slug: 'bf',
      }),
    )
    expect(created.status).toBe('DRAFT')

    expect(
      expectOk(await CrmCampaignRepository.findById(created.id, workspace.id))
        .id,
    ).toBe(created.id)
    expect(
      expectOk(await CrmCampaignRepository.findByIdUnscoped(created.id))?.id,
    ).toBe(created.id)
    expect(
      expectOk(await CrmCampaignRepository.findBySlug(workspace.id, 'bf'))?.id,
    ).toBe(created.id)
    expect(
      expectOk(await CrmCampaignRepository.listSlugsLike(workspace.id, 'b')),
    ).toEqual(['bf'])

    const updated = expectOk(
      await CrmCampaignRepository.update(created.id, { emailSubject: 'Oi' }),
    )
    expect(updated.emailSubject).toBe('Oi')

    expect(
      expectOk(await CrmCampaignRepository.listByWorkspace(workspace.id)),
    ).toHaveLength(1)
    expectOk(await CrmCampaignRepository.softDelete(created.id))
    expect(
      expectOk(await CrmCampaignRepository.listByWorkspace(workspace.id)),
    ).toHaveLength(0)
    const gone = expectErr(
      await CrmCampaignRepository.findById(created.id, workspace.id),
    )
    expect(gone.code).toBe('CRM_CAMPAIGN_NOT_FOUND')
  })

  it('should not find a campaign of another workspace', async () => {
    const { workspace, user } = await setup()
    const other = await seedWorkspace()
    const campaign = await seedCrmCampaign(workspace.id, user.id)
    expectErr(await CrmCampaignRepository.findById(campaign.id, other.id))
  })

  it('should transition only from the expected statuses', async () => {
    const { workspace, user } = await setup()
    const campaign = await seedCrmCampaign(workspace.id, user.id, {
      status: 'SENDING',
    })
    expect(
      expectOk(
        await CrmCampaignRepository.transition(campaign.id, ['DRAFT'], {
          status: 'SCHEDULED',
        }),
      ),
    ).toBeNull()
    const paused = expectOk(
      await CrmCampaignRepository.transition(campaign.id, ['SENDING'], {
        status: 'PAUSED',
      }),
    )
    expect(paused?.status).toBe('PAUSED')
  })

  it('should list runnable campaigns', async () => {
    const { workspace, user } = await setup()
    const now = new Date()
    const sending = await seedCrmCampaign(workspace.id, user.id, {
      status: 'SENDING',
    })
    const due = await seedCrmCampaign(workspace.id, user.id, {
      status: 'SCHEDULED',
      startAt: new Date(now.getTime() - 1000),
    })
    await seedCrmCampaign(workspace.id, user.id, {
      status: 'SCHEDULED',
      startAt: new Date(now.getTime() + 60_000),
    })
    await seedCrmCampaign(workspace.id, user.id, { status: 'PAUSED' })
    const ids = expectOk(await CrmCampaignRepository.listRunnable(now)).map(
      (c) => c.id,
    )
    expect(ids.sort()).toEqual([sending.id, due.id].sort())
  })

  it('should count the funnel per campaign', async () => {
    const { workspace, user } = await setup()
    const campaign = await seedCrmCampaign(workspace.id, user.id)
    const empty = await seedCrmCampaign(workspace.id, user.id)
    const now = new Date()
    const a = await seedCrmCampaignRecipient(campaign, {
      emailStatus: 'SENT',
      emailSentAt: now,
      emailOpenedAt: now,
      emailClickedAt: now,
      whatsappStatus: 'SENT',
      whatsappSentAt: now,
      whatsappReadAt: now,
      whatsappRepliedAt: now,
    })
    await seedCrmCampaignRecipient(campaign, { emailStatus: 'FAILED' })
    await seedCrmCampaignRecipient(campaign, {
      emailStatus: 'SKIPPED',
      unsubscribedAt: now,
    })
    await prisma.crmCampaignConversion.create({
      data: {
        campaignId: campaign.id,
        recipientId: a.id,
        kind: 'FORM_SUBMISSION',
        sourceRef: 's1',
      },
    })

    const funnel = expectOk(
      await CrmCampaignRepository.funnel([campaign.id, empty.id]),
    )
    const counts = funnel.get(campaign.id)
    expect(counts?.recipients).toBe(3)
    expect(counts?.email).toMatchObject({
      SENT: 1,
      FAILED: 1,
      SKIPPED: 1,
      opened: 1,
      clicked: 1,
      unsubscribed: 1,
    })
    expect(counts?.whatsapp).toMatchObject({
      SENT: 1,
      NONE: 2,
      read: 1,
      replied: 1,
    })
    expect(counts?.conversions).toBe(1)
    expect(funnel.get(empty.id)?.recipients).toBe(0)
    expect(expectOk(await CrmCampaignRepository.funnel([])).size).toBe(0)
  })

  it('should map database failures to DATABASE_ERROR', async () => {
    const spies = [
      vi
        .spyOn(prisma.crmCampaign, 'findMany')
        .mockRejectedValue(new Error('x')),
      vi
        .spyOn(prisma.crmCampaign, 'findFirst')
        .mockRejectedValue(new Error('x')),
      vi.spyOn(prisma.crmCampaign, 'create').mockRejectedValue(new Error('x')),
      vi.spyOn(prisma.crmCampaign, 'update').mockRejectedValue(new Error('x')),
      vi
        .spyOn(prisma.crmCampaign, 'updateMany')
        .mockRejectedValue(new Error('x')),
      vi
        .spyOn(prisma.crmCampaignRecipient, 'groupBy')
        .mockRejectedValue(new Error('x') as never),
    ]
    const calls = [
      CrmCampaignRepository.listByWorkspace('w'),
      CrmCampaignRepository.findById('c', 'w'),
      CrmCampaignRepository.findByIdUnscoped('c'),
      CrmCampaignRepository.findBySlug('w', 's'),
      CrmCampaignRepository.listSlugsLike('w', 's'),
      CrmCampaignRepository.create({
        workspaceId: 'w',
        createdById: 'u',
        name: 'n',
        slug: 's',
      }),
      CrmCampaignRepository.update('c', {}),
      CrmCampaignRepository.softDelete('c'),
      CrmCampaignRepository.transition('c', ['DRAFT'], {}),
      CrmCampaignRepository.listRunnable(new Date()),
      CrmCampaignRepository.funnel(['c']),
    ]
    for (const result of await Promise.all(calls)) {
      expect(expectErr(result).code).toBe('DATABASE_ERROR')
    }
    for (const spy of spies) spy.mockRestore()
  })
})

describe('CrmCampaignRecipientRepository', () => {
  it('should map channels to keys', () => {
    expect(channelKey('EMAIL')).toBe('email')
    expect(channelKey('WHATSAPP')).toBe('whatsapp')
  })

  it('should snapshot, page and search recipients', async () => {
    const { workspace, user } = await setup()
    const campaign = await seedCrmCampaign(workspace.id, user.id)
    const base = {
      personId: null,
      leadId: null,
      emailSkipReason: null,
      whatsappSkipReason: null,
    }
    expect(
      expectOk(
        await CrmCampaignRecipientRepository.createMany(
          campaign.id,
          workspace.id,
          [
            {
              ...base,
              name: 'Ana',
              email: 'ana@example.com',
              waId: '5511999990000',
              emailStatus: 'PENDING',
              whatsappStatus: 'PENDING',
            },
            {
              ...base,
              name: 'Bruno',
              email: 'bruno@example.com',
              waId: null,
              emailStatus: 'PENDING',
              whatsappStatus: 'NONE',
            },
          ],
        ),
      ),
    ).toBe(2)

    const page = expectOk(
      await CrmCampaignRecipientRepository.listPage(campaign.id, {
        page: 1,
        pageSize: 1,
      }),
    )
    expect(page.total).toBe(2)
    expect(page.items.map((r) => r.name)).toEqual(['Ana'])

    const byName = expectOk(
      await CrmCampaignRecipientRepository.listPage(campaign.id, {
        page: 1,
        pageSize: 10,
        search: 'brU',
      }),
    )
    expect(byName.items.map((r) => r.name)).toEqual(['Bruno'])
    const byPhone = expectOk(
      await CrmCampaignRecipientRepository.listPage(campaign.id, {
        page: 1,
        pageSize: 10,
        search: '99999',
      }),
    )
    expect(byPhone.items.map((r) => r.name)).toEqual(['Ana'])
  })

  it('should claim once, release, and track sends', async () => {
    const { workspace, user } = await setup()
    const campaign = await seedCrmCampaign(workspace.id, user.id)
    const r = await seedCrmCampaignRecipient(campaign, {
      whatsappStatus: 'PENDING',
      waId: '5511999990000',
    })

    expect(
      expectOk(
        await CrmCampaignRecipientRepository.listPendingIds(
          campaign.id,
          'EMAIL',
          10,
        ),
      ),
    ).toEqual([r.id])
    expect(
      expectOk(await CrmCampaignRecipientRepository.claim(r.id, 'EMAIL')),
    ).toBe(true)
    expect(
      expectOk(await CrmCampaignRecipientRepository.claim(r.id, 'EMAIL')),
    ).toBe(false)
    expect(
      expectOk(
        await CrmCampaignRecipientRepository.countOpen(campaign.id, 'EMAIL'),
      ),
    ).toBe(1)
    expectOk(await CrmCampaignRecipientRepository.release(r.id, 'EMAIL'))
    expect(
      expectOk(await CrmCampaignRecipientRepository.claim(r.id, 'EMAIL')),
    ).toBe(true)

    const at = new Date()
    expectOk(
      await CrmCampaignRecipientRepository.markSent(r.id, 'EMAIL', 'em-1', at),
    )
    expectOk(
      await CrmCampaignRecipientRepository.markSent(
        r.id,
        'WHATSAPP',
        'wa-1',
        at,
      ),
    )
    expect(
      expectOk(
        await CrmCampaignRecipientRepository.findByProviderMessageId(
          'EMAIL',
          'em-1',
        ),
      )?.id,
    ).toBe(r.id)
    expect(
      expectOk(
        await CrmCampaignRecipientRepository.findByProviderMessageId(
          'WHATSAPP',
          'wa-1',
        ),
      )?.whatsappStatus,
    ).toBe('SENT')
    expect(
      expectOk(
        await CrmCampaignRecipientRepository.countOpen(campaign.id, 'EMAIL'),
      ),
    ).toBe(0)

    // First-time timestamps.
    expect(
      expectOk(
        await CrmCampaignRecipientRepository.markFirst(
          { id: r.id },
          'emailOpenedAt',
          at,
        ),
      ),
    ).toBe(true)
    expect(
      expectOk(
        await CrmCampaignRecipientRepository.markFirst(
          { id: r.id },
          'emailOpenedAt',
          new Date(),
        ),
      ),
    ).toBe(false)

    const withCampaign = expectOk(
      await CrmCampaignRecipientRepository.findWithCampaign(r.id),
    )
    expect(withCampaign?.campaign.id).toBe(campaign.id)
    expect(
      expectOk(await CrmCampaignRecipientRepository.findById(r.id))
        ?.emailOpenedAt,
    ).toEqual(at)
  })

  it('should mark failures, skips and cancel open rows', async () => {
    const { workspace, user } = await setup()
    const campaign = await seedCrmCampaign(workspace.id, user.id)
    const a = await seedCrmCampaignRecipient(campaign)
    const b = await seedCrmCampaignRecipient(campaign, {
      whatsappStatus: 'PENDING',
    })
    const c = await seedCrmCampaignRecipient(campaign, {
      whatsappStatus: 'PENDING',
    })
    expectOk(
      await CrmCampaignRecipientRepository.markFailed(
        a.id,
        'EMAIL',
        'x'.repeat(600),
      ),
    )
    expectOk(
      await CrmCampaignRecipientRepository.markFailed(b.id, 'WHATSAPP', 'no'),
    )
    expectOk(
      await CrmCampaignRecipientRepository.markSkipped(
        b.id,
        'EMAIL',
        'opted_out',
      ),
    )
    expectOk(
      await CrmCampaignRecipientRepository.markSkipped(
        c.id,
        'WHATSAPP',
        'opted_out',
      ),
    )
    const failed = expectOk(await CrmCampaignRecipientRepository.findById(a.id))
    expect(failed?.emailError).toHaveLength(500)

    const d = await seedCrmCampaignRecipient(campaign, {
      whatsappStatus: 'SENDING',
    })
    expect(
      expectOk(await CrmCampaignRecipientRepository.skipAllOpen(campaign.id)),
    ).toBe(3) // c.email, d.email, d.whatsapp
    const skipped = expectOk(
      await CrmCampaignRecipientRepository.findById(d.id),
    )
    expect(skipped).toMatchObject({
      emailStatus: 'SKIPPED',
      whatsappStatus: 'SKIPPED',
      whatsappSkipReason: 'canceled',
    })
  })

  it('should release rows stuck in SENDING', async () => {
    const { workspace, user } = await setup()
    const campaign = await seedCrmCampaign(workspace.id, user.id)
    await seedCrmCampaignRecipient(campaign, {
      emailStatus: 'SENDING',
      whatsappStatus: 'SENDING',
    })
    expect(
      expectOk(
        await CrmCampaignRecipientRepository.releaseStuck(
          new Date(Date.now() - 60_000),
        ),
      ),
    ).toBe(0)
    expect(
      expectOk(
        await CrmCampaignRecipientRepository.releaseStuck(
          new Date(Date.now() + 60_000),
        ),
      ),
    ).toBe(2)
  })

  it('should count WhatsApp sends per connection and find replies', async () => {
    const { workspace, user } = await setup()
    const campaign = await seedCrmCampaign(workspace.id, user.id, {
      whatsappConnectionId: 'conn-1',
    })
    const now = new Date()
    const r = await seedCrmCampaignRecipient(campaign, {
      waId: '5511999990000',
      whatsappStatus: 'SENT',
      whatsappSentAt: now,
    })
    expect(
      expectOk(
        await CrmCampaignRecipientRepository.countWhatsAppSentSince(
          'conn-1',
          new Date(now.getTime() - 1000),
        ),
      ),
    ).toBe(1)
    expect(
      expectOk(
        await CrmCampaignRecipientRepository.countWhatsAppSentSince(
          'other',
          new Date(0),
        ),
      ),
    ).toBe(0)

    const awaiting = expectOk(
      await CrmCampaignRecipientRepository.listAwaitingReply(
        workspace.id,
        '5511999990000',
        new Date(now.getTime() - 60_000),
      ),
    )
    expect(awaiting.map((x) => x.id)).toEqual([r.id])
    expectOk(
      await CrmCampaignRecipientRepository.markReplied(r.id, {
        at: now,
        conversationId: 'conv-1',
      }),
    )
    expect(
      expectOk(
        await CrmCampaignRecipientRepository.listAwaitingReply(
          workspace.id,
          '5511999990000',
          new Date(0),
        ),
      ),
    ).toHaveLength(0)
  })

  it('should map database failures to DATABASE_ERROR', async () => {
    const spies = [
      vi
        .spyOn(prisma.crmCampaignRecipient, 'createMany')
        .mockRejectedValue(new Error('x')),
      vi
        .spyOn(prisma.crmCampaignRecipient, 'findUnique')
        .mockRejectedValue(new Error('x')),
      vi
        .spyOn(prisma.crmCampaignRecipient, 'findMany')
        .mockRejectedValue(new Error('x')),
      vi
        .spyOn(prisma.crmCampaignRecipient, 'count')
        .mockRejectedValue(new Error('x')),
      vi
        .spyOn(prisma.crmCampaignRecipient, 'updateMany')
        .mockRejectedValue(new Error('x')),
      vi
        .spyOn(prisma.crmCampaignRecipient, 'update')
        .mockRejectedValue(new Error('x')),
      vi.spyOn(prisma, '$transaction').mockRejectedValue(new Error('x')),
    ]
    const R = CrmCampaignRecipientRepository
    const calls = [
      R.createMany('c', 'w', []),
      R.findById('r'),
      R.findWithCampaign('r'),
      R.listPage('c', { page: 1, pageSize: 10 }),
      R.listPendingIds('c', 'WHATSAPP', 1),
      R.countOpen('c', 'EMAIL'),
      R.claim('r', 'EMAIL'),
      R.release('r', 'EMAIL'),
      R.markSent('r', 'EMAIL', 'p', new Date()),
      R.markFailed('r', 'EMAIL', 'm'),
      R.markSkipped('r', 'EMAIL', 'm'),
      R.skipAllOpen('c'),
      R.releaseStuck(new Date()),
      R.countWhatsAppSentSince('c', new Date()),
      R.markFirst({ id: 'r' }, 'emailOpenedAt', new Date()),
      R.findByProviderMessageId('EMAIL', 'p'),
      R.listAwaitingReply('w', 'x', new Date()),
      R.markReplied('r', { at: new Date(), conversationId: 'c' }),
    ]
    for (const result of await Promise.all(calls)) {
      expect(expectErr(result).code).toBe('DATABASE_ERROR')
    }
    for (const spy of spies) spy.mockRestore()
  })
})

describe('CrmCampaignConversionRepository', () => {
  it('should record idempotently, list and count', async () => {
    const { workspace, user } = await setup()
    const campaign = await seedCrmCampaign(workspace.id, user.id)
    const r = await seedCrmCampaignRecipient(campaign, { name: 'Ana' })
    const input = {
      campaignId: campaign.id,
      recipientId: r.id,
      channel: 'EMAIL' as const,
      kind: 'FORM_SUBMISSION' as const,
      sourceRef: 'sub-1',
      leadId: 'lead-1',
    }
    expect(
      expectOk(await CrmCampaignConversionRepository.record(input)),
    ).not.toBeNull()
    expect(
      expectOk(await CrmCampaignConversionRepository.record(input)),
    ).toBeNull()
    expectOk(
      await CrmCampaignConversionRepository.record({
        ...input,
        recipientId: null,
        channel: null,
        kind: 'LANDING_VIEW',
        sourceRef: 'view-1',
      }),
    )

    const recent = expectOk(
      await CrmCampaignConversionRepository.listRecent(campaign.id, 10),
    )
    expect(recent).toHaveLength(2)
    expect(
      recent.find((c) => c.kind === 'FORM_SUBMISSION')?.recipient?.name,
    ).toBe('Ana')
    const counts = expectOk(
      await CrmCampaignConversionRepository.countBy(campaign.id),
    )
    expect(counts).toEqual(
      expect.arrayContaining([
        { kind: 'FORM_SUBMISSION', channel: 'EMAIL', count: 1 },
        { kind: 'LANDING_VIEW', channel: null, count: 1 },
      ]),
    )
  })

  it('should count site conversions per campaign in a window', async () => {
    const { workspace, user } = await setup()
    const bf = await seedCrmCampaign(workspace.id, user.id, { name: 'BF' })
    const natal = await seedCrmCampaign(workspace.id, user.id, {
      name: 'Natal',
    })
    const at = new Date('2026-10-14T12:00:00.000Z')
    const row = (
      campaignId: string,
      kind: 'SITE_VIEW' | 'SITE_FORM_SUBMISSION' | 'FORM_SUBMISSION',
      sourceRef: string,
      siteId = 'site1',
      createdAt = at,
    ) =>
      prisma.crmCampaignConversion.create({
        data: { campaignId, kind, sourceRef, siteId, createdAt },
      })
    await Promise.all([
      row(bf.id, 'SITE_VIEW', 'v1'),
      row(bf.id, 'SITE_VIEW', 'v2'),
      row(bf.id, 'SITE_FORM_SUBMISSION', 's1'),
      row(natal.id, 'SITE_VIEW', 'v3'),
      // Not this site, not a site kind, out of the window.
      row(natal.id, 'SITE_VIEW', 'v4', 'site2'),
      row(natal.id, 'FORM_SUBMISSION', 's2'),
      row(natal.id, 'SITE_VIEW', 'v5', 'site1', new Date('2026-09-01')),
    ])
    const window = {
      start: new Date('2026-10-01T00:00:00.000Z'),
      end: new Date('2026-10-31T00:00:00.000Z'),
    }
    expect(
      expectOk(
        await CrmCampaignConversionRepository.countBySite('site1', window),
      ),
    ).toEqual([
      {
        campaignId: bf.id,
        name: 'BF',
        slug: bf.slug,
        views: 2,
        formSubmissions: 1,
      },
      {
        campaignId: natal.id,
        name: 'Natal',
        slug: natal.slug,
        views: 1,
        formSubmissions: 0,
      },
    ])
    expect(
      expectOk(
        await CrmCampaignConversionRepository.countBySite('none', window),
      ),
    ).toEqual([])
  })

  it('should map database failures to DATABASE_ERROR', async () => {
    const spies = [
      vi
        .spyOn(prisma.crmCampaignConversion, 'create')
        .mockRejectedValue(new Error('x')),
      vi
        .spyOn(prisma.crmCampaignConversion, 'findMany')
        .mockRejectedValue(new Error('x')),
      vi
        .spyOn(prisma.crmCampaignConversion, 'groupBy')
        .mockRejectedValue(new Error('x') as never),
    ]
    const results = await Promise.all([
      CrmCampaignConversionRepository.record({
        campaignId: 'c',
        recipientId: null,
        channel: null,
        kind: 'LANDING_VIEW',
        sourceRef: 's',
      }),
      CrmCampaignConversionRepository.listRecent('c', 1),
      CrmCampaignConversionRepository.countBy('c'),
      CrmCampaignConversionRepository.countBySite('s', {
        start: new Date(),
        end: new Date(),
      }),
    ])
    for (const result of results) {
      expect(expectErr(result).code).toBe('DATABASE_ERROR')
    }
    for (const spy of spies) spy.mockRestore()
  })
})

describe('CrmCampaignAudienceRepository', () => {
  it('should collect mailing list members, people and leads in order', async () => {
    const { workspace, user } = await setup()
    const person = await prisma.crmPerson.create({
      data: {
        workspaceId: workspace.id,
        createdById: user.id,
        name: 'Ana Pessoa',
        emails: ['ana@example.com'],
        phones: ['11999990000'],
      },
    })
    await prisma.crmPerson.create({
      data: {
        workspaceId: workspace.id,
        createdById: user.id,
        name: 'Removida',
        emails: ['x@example.com'],
        deletedAt: new Date(),
      },
    })
    await prisma.crmPerson.create({
      data: {
        workspaceId: workspace.id,
        createdById: user.id,
        name: 'Sem contato',
      },
    })
    const list = await prisma.crmMailingList.create({
      data: { workspaceId: workspace.id, createdById: user.id, name: 'L' },
    })
    await prisma.crmMailingListMember.createMany({
      data: [
        {
          mailingListId: list.id,
          email: 'ana@example.com',
          personId: person.id,
        },
        { mailingListId: list.id, email: 'avulso@example.com', name: 'Avulso' },
        { mailingListId: list.id, email: 'semnome@example.com' },
      ],
    })
    await prisma.crmLead.create({
      data: {
        workspaceId: workspace.id,
        createdById: user.id,
        name: 'Lead Q',
        emails: ['lead@example.com'],
        phones: ['11988880000'],
        stage: 'QUALIFIED',
      },
    })
    await prisma.crmLead.create({
      data: {
        workspaceId: workspace.id,
        createdById: user.id,
        name: 'Lead R',
        stage: 'RECEIVED',
      },
    })

    const candidates = expectOk(
      await CrmCampaignAudienceRepository.collectCandidates(workspace.id, {
        mailingListIds: [list.id],
        allPeople: true,
        leadStages: ['QUALIFIED', 'RECEIVED'],
      }),
    )
    expect(candidates.map((c) => c.name)).toEqual([
      'Ana Pessoa',
      'Avulso',
      'semnome@example.com',
      'Ana Pessoa',
      'Sem contato',
      'Lead Q',
      'Lead R',
    ])
    expect(candidates[0]).toMatchObject({
      personId: person.id,
      phone: '11999990000',
    })
    expect(candidates[5]).toMatchObject({
      phone: '11988880000',
      personId: null,
    })

    expect(
      expectOk(
        await CrmCampaignAudienceRepository.collectCandidates(workspace.id, {
          mailingListIds: [],
          allPeople: false,
          leadStages: [],
        }),
      ),
    ).toEqual([])

    // Lists of another workspace are ignored.
    const other = await seedWorkspace()
    expect(
      expectOk(
        await CrmCampaignAudienceRepository.collectCandidates(other.id, {
          mailingListIds: [list.id],
          allPeople: false,
          leadStages: [],
        }),
      ),
    ).toEqual([])
  })

  it('should read opt-outs of both channels', async () => {
    const { workspace } = await setup()
    await prisma.crmEmailOptOut.create({
      data: {
        workspaceId: workspace.id,
        email: 'out@example.com',
        personId: 'p1',
        source: 'LINK',
      },
    })
    await prisma.crmEmailOptOut.create({
      data: {
        workspaceId: workspace.id,
        email: 'out2@example.com',
        source: 'LINK',
      },
    })
    await prisma.whatsAppContact.createMany({
      data: [
        {
          workspaceId: workspace.id,
          waId: '5511999990000',
          broadcastOptedOutAt: new Date(),
        },
        { workspaceId: workspace.id, waId: '5511999990001' },
      ],
    })
    const email = expectOk(
      await CrmCampaignAudienceRepository.emailOptOuts(workspace.id),
    )
    expect([...email.emails].sort()).toEqual([
      'out2@example.com',
      'out@example.com',
    ])
    expect([...email.personIds]).toEqual(['p1'])
    expect([
      ...expectOk(
        await CrmCampaignAudienceRepository.whatsappOptOuts(workspace.id),
      ),
    ]).toEqual(['5511999990000'])

    const R = CrmCampaignAudienceRepository
    expect(
      expectOk(await R.isWhatsAppOptedOut(workspace.id, '5511999990000')),
    ).toBe(true)
    expect(
      expectOk(await R.isWhatsAppOptedOut(workspace.id, '5511999990001')),
    ).toBe(false)
    expect(expectOk(await R.isWhatsAppOptedOut(workspace.id, '1'))).toBe(false)
    expect(
      expectOk(await R.isEmailOptedOut(workspace.id, 'OUT@example.com', null)),
    ).toBe(true)
    expect(
      expectOk(await R.isEmailOptedOut(workspace.id, 'new@example.com', 'p1')),
    ).toBe(true)
    expect(
      expectOk(await R.isEmailOptedOut(workspace.id, 'new@example.com', null)),
    ).toBe(false)
  })

  it('should map database failures to DATABASE_ERROR', async () => {
    const spies = [
      vi.spyOn(prisma.crmPerson, 'findMany').mockRejectedValue(new Error('x')),
      vi
        .spyOn(prisma.crmEmailOptOut, 'findMany')
        .mockRejectedValue(new Error('x')),
      vi
        .spyOn(prisma.crmEmailOptOut, 'findFirst')
        .mockRejectedValue(new Error('x')),
      vi
        .spyOn(prisma.whatsAppContact, 'findMany')
        .mockRejectedValue(new Error('x')),
      vi
        .spyOn(prisma.whatsAppContact, 'findUnique')
        .mockRejectedValue(new Error('x')),
    ]
    const R = CrmCampaignAudienceRepository
    const results = await Promise.all([
      R.collectCandidates('w', {
        mailingListIds: [],
        allPeople: true,
        leadStages: [],
      }),
      R.emailOptOuts('w'),
      R.whatsappOptOuts('w'),
      R.isWhatsAppOptedOut('w', '1'),
      R.isEmailOptedOut('w', 'a@b.c', null),
    ])
    for (const result of results) {
      expect(expectErr(result).code).toBe('DATABASE_ERROR')
    }
    for (const spy of spies) spy.mockRestore()
  })
})
