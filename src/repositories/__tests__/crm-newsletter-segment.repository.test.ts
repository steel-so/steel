import { describe, expect, it, vi } from 'vitest'
import { seedCrmCompany } from '@/src/__tests__/factories/crm-company.factory'
import {
  seedCrmCustomFieldDefinition,
  seedCrmCustomFieldValue,
} from '@/src/__tests__/factories/crm-custom-field.factory'
import { seedCrmLead } from '@/src/__tests__/factories/crm-lead.factory'
import { seedCrmOpportunity } from '@/src/__tests__/factories/crm-opportunity.factory'
import { seedCrmPerson } from '@/src/__tests__/factories/crm-person.factory'
import {
  seedCrmPipeline,
  seedCrmPipelineStage,
} from '@/src/__tests__/factories/crm-pipeline.factory'
import {
  seedNewsletterIssue,
  seedNewsletterScope,
} from '@/src/__tests__/factories/newsletter-nl-issues.factory'
import {
  SAMPLE_SEGMENT,
  seedNewsletterSegment,
  seedSegmentSubscriber,
} from '@/src/__tests__/factories/newsletter2-segments.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import type {
  NewsletterSegment,
  NewsletterSegmentCondition,
} from '@/src/schemas/crm-newsletter-segment.schema'
import { resolveSegmentWhere } from '@/src/services/crm-newsletter-audience'
import { CrmNewsletterIssueRepository } from '../crm-newsletter-issue.repository'
import {
  CrmNewsletterSegmentRepository as Repo,
  segmentSubscriberIds,
} from '../crm-newsletter-segment.repository'

const NOW = new Date('2026-10-28T13:00:00.000Z')

/**
 * A newsletter with a realistic CRM around it — every segment condition is
 * compiled by the real compiler and run against Postgres.
 */
async function seedWorld() {
  const { workspaceId, userId, newsletter } = await seedNewsletterScope()
  const acme = await seedCrmCompany(workspaceId, userId, { name: 'Acme' })
  const beta = await seedCrmCompany(workspaceId, userId, { name: 'Beta' })
  const pipeline = await seedCrmPipeline(workspaceId, userId)
  const open = await seedCrmPipelineStage(pipeline.id, { category: 'OPEN' })
  const won = await seedCrmPipelineStage(pipeline.id, { category: 'WON' })

  const ana = await seedCrmPerson(workspaceId, userId, {
    name: 'Ana',
    city: 'Campinas',
    jobTitle: 'Diretora Comercial',
    companyId: acme.id,
  })
  const bia = await seedCrmPerson(workspaceId, userId, {
    name: 'Bia',
    city: 'São Paulo',
    jobTitle: 'Analista',
    companyId: beta.id,
  })
  const del = await seedCrmPerson(workspaceId, userId, {
    name: 'Del',
    city: 'Campinas',
    deletedAt: NOW,
  })
  const opportunity = await seedCrmOpportunity(
    workspaceId,
    userId,
    pipeline.id,
    open.id,
  )
  await prisma.crmOpportunity.update({
    where: { id: opportunity.id },
    data: { pointOfContactId: ana.id },
  })
  await seedCrmOpportunity(workspaceId, userId, pipeline.id, won.id, {
    companyId: beta.id,
  })
  const lead = await seedCrmLead(workspaceId, userId, { stage: 'QUALIFIED' })
  await prisma.crmLead.update({
    where: { id: lead.id },
    data: { convertedPersonId: bia.id },
  })
  const plan = await seedCrmCustomFieldDefinition(workspaceId, userId, {
    entity: 'PERSON',
    key: 'plano',
    label: 'Plano',
  })
  await seedCrmCustomFieldValue(plan.id, ana.id, 'Enterprise')
  await seedCrmCustomFieldValue(plan.id, bia.id, 'Pro')

  const s = {
    ana: await seedSegmentSubscriber(newsletter, 'ana@x.com', {
      personId: ana.id,
      source: 'FORM',
      createdAt: new Date('2026-09-01T12:00:00Z'),
      confirmedAt: new Date('2026-09-01T12:00:00Z'),
      lastOpenedAt: new Date('2026-10-20T12:00:00Z'),
    }),
    bia: await seedSegmentSubscriber(newsletter, 'bia@x.com', {
      personId: bia.id,
      source: 'IMPORT',
      createdAt: new Date('2026-10-10T12:00:00Z'),
      lastOpenedAt: new Date('2026-08-01T12:00:00Z'),
    }),
    cris: await seedSegmentSubscriber(newsletter, 'cris@x.com', {
      source: 'FORM',
      createdAt: new Date('2026-10-15T12:00:00Z'),
    }),
    del: await seedSegmentSubscriber(newsletter, 'del@x.com', {
      personId: del.id,
      createdAt: new Date('2026-10-16T12:00:00Z'),
    }),
  }
  // Never in the audience: opted out and unsubscribed.
  await seedSegmentSubscriber(newsletter, 'opt@x.com', { source: 'FORM' })
  await prisma.crmEmailOptOut.create({
    data: { workspaceId, email: 'opt@x.com', source: 'LINK' },
  })
  await seedSegmentSubscriber(newsletter, 'out@x.com', {
    source: 'FORM',
    status: 'UNSUBSCRIBED',
  })

  const older = await seedNewsletterIssue(newsletter, userId, {
    status: 'SENT',
    number: 1,
    sentAt: new Date('2026-09-01T12:00:00Z'),
  })
  const newer = await seedNewsletterIssue(newsletter, userId, {
    status: 'SENT',
    number: 2,
    sentAt: new Date('2026-10-01T12:00:00Z'),
  })
  const delivery = (
    issueId: string,
    subscriber: { id: string; email: string },
    data: { openedAt?: Date; clickedAt?: Date },
  ) =>
    prisma.crmNewsletterIssueRecipient.create({
      data: {
        issueId,
        workspaceId,
        subscriberId: subscriber.id,
        email: subscriber.email,
        status: 'SENT',
        ...data,
      },
    })
  await delivery(newer.id, s.ana, { openedAt: NOW })
  await delivery(older.id, s.bia, { openedAt: NOW, clickedAt: NOW })
  await delivery(newer.id, s.bia, {})

  return { workspaceId, userId, newsletter, s, acme, plan, older, newer }
}

type World = Awaited<ReturnType<typeof seedWorld>>

async function emails(world: World, segment: NewsletterSegment) {
  const where = expectOk(
    await resolveSegmentWhere(world.workspaceId, world.newsletter.id, segment),
  )
  const preview = expectOk(
    await Repo.previewAudience(
      world.workspaceId,
      world.newsletter.id,
      where,
      50,
    ),
  )
  expect(preview.count).toBe(preview.sample.length)
  return preview.sample.map((row) => row.email.split('@')[0]).sort()
}

const only = (condition: NewsletterSegmentCondition): NewsletterSegment => ({
  conditions: [condition],
  groups: [],
})

describe('CrmNewsletterSegmentRepository', () => {
  it('compiles every condition to the right subscribers', async () => {
    const world = await seedWorld()
    const cases: [NewsletterSegmentCondition, string[]][] = [
      [{ type: 'source', sources: ['FORM'] }, ['ana', 'cris']],
      [{ type: 'subscribed', op: 'before', date: '2026-10-10' }, ['ana']],
      [
        { type: 'subscribed', op: 'onOrAfter', date: '2026-10-10' },
        ['bia', 'cris', 'del'],
      ],
      [{ type: 'confirmed', value: true }, ['ana']],
      [{ type: 'confirmed', value: false }, ['bia', 'cris', 'del']],
      [{ type: 'opened', op: 'any', lastIssues: 1 }, ['ana']],
      [{ type: 'opened', op: 'any', lastIssues: 2 }, ['ana', 'bia']],
      [{ type: 'opened', op: 'none', lastIssues: 1 }, ['bia', 'cris', 'del']],
      [{ type: 'clicked', op: 'any', lastIssues: 2 }, ['bia']],
      [{ type: 'neverOpened' }, ['cris', 'del']],
      [{ type: 'lastOpenedBefore', date: '2026-09-01' }, ['bia']],
      [{ type: 'linkedPerson', value: true }, ['ana', 'bia']],
      [{ type: 'linkedPerson', value: false }, ['cris', 'del']],
      [{ type: 'company', companyIds: [world.acme.id] }, ['ana']],
      [{ type: 'jobTitle', op: 'contains', value: 'diretora' }, ['ana']],
      [{ type: 'jobTitle', op: 'equals', value: 'analista' }, ['bia']],
      [{ type: 'city', op: 'equals', value: 'campinas' }, ['ana']],
      [
        {
          type: 'customField',
          definitionId: world.plan.id,
          op: 'equals',
          value: 'Pro',
        },
        ['bia'],
      ],
      [
        {
          type: 'customField',
          definitionId: world.plan.id,
          op: 'contains',
          value: 'Enter',
        },
        ['ana'],
      ],
      [
        { type: 'customField', definitionId: world.plan.id, op: 'isSet' },
        ['ana', 'bia'],
      ],
      [
        { type: 'customField', definitionId: world.plan.id, op: 'isNotSet' },
        ['cris', 'del'],
      ],
      [{ type: 'openOpportunity', value: true }, ['ana']],
      [{ type: 'openOpportunity', value: false }, ['bia', 'cris', 'del']],
      [{ type: 'leadStage', stages: ['QUALIFIED'] }, ['bia']],
      [{ type: 'leadStage', stages: ['CLOSED'] }, []],
    ]
    for (const [condition, expected] of cases) {
      expect(
        await emails(world, only(condition)),
        JSON.stringify(condition),
      ).toEqual(expected)
    }
  })

  it('combines AND conditions with OR groups', async () => {
    const world = await seedWorld()
    expect(
      await emails(world, {
        conditions: [{ type: 'source', sources: ['FORM', 'IMPORT'] }],
        groups: [
          {
            conditions: [
              { type: 'city', op: 'equals', value: 'São Paulo' },
              { type: 'neverOpened' },
            ],
          },
        ],
      }),
    ).toEqual(['bia', 'cris'])
    expect(await emails(world, SAMPLE_SEGMENT)).toEqual(['ana', 'cris'])
  })

  it('previews everyone without a segment, with the total', async () => {
    const world = await seedWorld()
    const all = expectOk(
      await Repo.previewAudience(
        world.workspaceId,
        world.newsletter.id,
        null,
        2,
      ),
    )
    expect(all.total).toBe(4)
    expect(all.count).toBe(4)
    expect(all.sample).toHaveLength(2)
    expect(all.sample[0]).toEqual({
      id: world.s.del.id,
      email: 'del@x.com',
      name: 'del',
    })
  })

  it('restricts the audience count and the send snapshot to the segment', async () => {
    const world = await seedWorld()
    const where = expectOk(
      await resolveSegmentWhere(
        world.workspaceId,
        world.newsletter.id,
        only({ type: 'source', sources: ['FORM'] }),
      ),
    )
    expect(where).not.toBeNull()
    expect(
      expectOk(
        await CrmNewsletterIssueRepository.countAudience(
          world.workspaceId,
          world.newsletter.id,
          where ?? undefined,
        ),
      ),
    ).toBe(2)
    const issue = await seedNewsletterIssue(world.newsletter, world.userId)
    const started = expectOk(
      await CrmNewsletterIssueRepository.startSending(issue.id, {
        webHtml: '',
        excerpt: '',
        now: NOW,
        segmentWhere: where ?? undefined,
      }),
    )
    expect(started?.recipients).toBe(2)
    const rows = await prisma.crmNewsletterIssueRecipient.findMany({
      where: { issueId: issue.id },
      orderBy: { email: 'asc' },
    })
    expect(rows.map((row) => row.email)).toEqual(['ana@x.com', 'cris@x.com'])
    expect(
      await segmentSubscriberIds(prisma, world.workspaceId, 'other', {}),
    ).toEqual([])
  })

  it('creates, lists, finds, renames and deletes saved segments', async () => {
    const { workspaceId, userId, newsletter } = await seedNewsletterScope()
    const created = expectOk(
      await Repo.create({
        workspaceId,
        newsletterId: newsletter.id,
        name: 'Zeta',
        definition: SAMPLE_SEGMENT,
        createdById: userId,
      }),
    )
    await seedNewsletterSegment(newsletter, userId, { name: 'Alfa' })
    expectErr(
      await Repo.create({
        workspaceId,
        newsletterId: newsletter.id,
        name: 'Zeta',
        definition: {},
        createdById: userId,
      }),
      'CRM_NEWSLETTER_SEGMENT_NAME_TAKEN',
    )
    const list = expectOk(await Repo.list(workspaceId, newsletter.id))
    expect(list.map((row) => row.name)).toEqual(['Alfa', 'Zeta'])
    expect(expectOk(await Repo.count(newsletter.id))).toBe(2)
    expect(
      expectOk(await Repo.findById(workspaceId, newsletter.id, created.id))
        ?.name,
    ).toBe('Zeta')
    expect(
      expectOk(await Repo.findById('other', newsletter.id, created.id)),
    ).toBeNull()

    const renamed = expectOk(
      await Repo.update(created.id, { name: 'Ômega', updatedById: userId }),
    )
    expect(renamed).toMatchObject({ name: 'Ômega', updatedById: userId })
    expectErr(
      await Repo.update(created.id, { name: 'Alfa', updatedById: userId }),
      'CRM_NEWSLETTER_SEGMENT_NAME_TAKEN',
    )
    expectOk(await Repo.delete(created.id))
    expect(expectOk(await Repo.count(newsletter.id))).toBe(1)
  })

  it('reads recent issues, person fields, matches and companies', async () => {
    const world = await seedWorld()
    expect(
      expectOk(await Repo.recentSentIssueIds(world.newsletter.id, 5)),
    ).toEqual([world.newer.id, world.older.id])
    expect(
      expectOk(await Repo.recentSentIssueIds(world.newsletter.id, 0)),
    ).toEqual([])
    await seedCrmCustomFieldDefinition(world.workspaceId, world.userId, {
      entity: 'COMPANY',
      key: 'porte',
      label: 'Porte',
    })
    const fields = expectOk(await Repo.personCustomFields(world.workspaceId))
    expect(fields.map((field) => field.label)).toEqual(['Plano'])
    expect(
      expectOk(await Repo.personCustomFields(world.workspaceId, ['nope'])),
    ).toEqual([])

    const companies = expectOk(
      await Repo.companies(world.workspaceId, 'ac', 10),
    )
    expect(companies.map((company) => company.name)).toEqual(['Acme'])
    const withSelected = expectOk(
      await Repo.companies(world.workspaceId, 'zzz', 10, [world.acme.id]),
    )
    expect(withSelected.map((company) => company.name)).toEqual(['Acme'])
    expect(
      expectOk(await Repo.companies(world.workspaceId, undefined, 1, [])),
    ).toHaveLength(1)
  })

  it('stores the issue segment only while editable', async () => {
    const { userId, newsletter } = await seedNewsletterScope()
    const draft = await seedNewsletterIssue(newsletter, userId)
    const sent = await seedNewsletterIssue(newsletter, userId, {
      status: 'SENT',
      number: 1,
    })
    const updated = expectOk(
      await Repo.setIssueSegment(draft.id, { conditions: [] }, userId),
    )
    expect(updated?.segment).toEqual({ conditions: [] })
    expect(expectOk(await Repo.setIssueSegment(sent.id, {}, userId))).toBeNull()
  })

  it('returns DATABASE_ERROR when Prisma fails', async () => {
    const spies = [
      vi
        .spyOn(prisma.crmNewsletterSegment, 'findMany')
        .mockRejectedValue(new Error('down')),
      vi
        .spyOn(prisma.crmNewsletterSegment, 'count')
        .mockRejectedValue(new Error('down')),
      vi
        .spyOn(prisma.crmNewsletterSegment, 'findFirst')
        .mockRejectedValue(new Error('down')),
      vi
        .spyOn(prisma.crmNewsletterSegment, 'create')
        .mockRejectedValue(new Error('down')),
      vi
        .spyOn(prisma.crmNewsletterSegment, 'update')
        .mockRejectedValue(new Error('down')),
      vi
        .spyOn(prisma.crmNewsletterSegment, 'delete')
        .mockRejectedValue(new Error('down')),
      vi
        .spyOn(prisma.crmNewsletterIssue, 'findMany')
        .mockRejectedValue(new Error('down')),
      vi
        .spyOn(prisma.crmNewsletterIssue, 'updateMany')
        .mockRejectedValue(new Error('down')),
      vi
        .spyOn(prisma.crmCustomFieldDefinition, 'findMany')
        .mockRejectedValue(new Error('down')),
      vi
        .spyOn(prisma.crmCustomFieldValue, 'findMany')
        .mockRejectedValue(new Error('down')),
      vi
        .spyOn(prisma.crmCompany, 'findMany')
        .mockRejectedValue(new Error('down')),
      vi.spyOn(prisma, '$queryRaw').mockRejectedValue(new Error('down')),
    ]
    const code = 'DATABASE_ERROR'
    expectErr(await Repo.list('w', 'n'), code)
    expectErr(await Repo.count('n'), code)
    expectErr(await Repo.findById('w', 'n', 's'), code)
    expectErr(
      await Repo.create({
        workspaceId: 'w',
        newsletterId: 'n',
        name: 'x',
        definition: {},
        createdById: 'u',
      }),
      code,
    )
    expectErr(await Repo.update('s', { updatedById: 'u' }), code)
    expectErr(await Repo.delete('s'), code)
    expectErr(await Repo.recentSentIssueIds('n', 3), code)
    expectErr(await Repo.personCustomFields('w'), code)
    expectErr(
      await Repo.customFieldPersonIds('w', {
        type: 'customField',
        definitionId: 'd',
        op: 'isSet',
      }),
      code,
    )
    expectErr(await Repo.companies('w', undefined, 5), code)
    expectErr(await Repo.previewAudience('w', 'n', null, 5), code)
    expectErr(await Repo.setIssueSegment('i', {}, 'u'), code)
    for (const spy of spies) spy.mockRestore()
  })
})
