import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeNewsletter,
  createFakeNewsletterIssue,
} from '@/src/__tests__/factories/newsletter-nl-issues.factory'
import {
  createFakeNewsletterSegment,
  SAMPLE_SEGMENT,
} from '@/src/__tests__/factories/newsletter2-segments.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, forbidden } from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import type { NewsletterSegment } from '@/src/schemas/crm-newsletter-segment.schema'

vi.mock('@/src/services/authz', () => ({ assertModuleMember: vi.fn() }))
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock(
  '@/src/repositories/crm-newsletter-issue.repository',
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    CrmNewsletterIssueRepository: {
      findNewsletter: vi.fn(),
      findById: vi.fn(),
    },
  }),
)
vi.mock('@/src/repositories/crm-newsletter-segment.repository', () => ({
  CrmNewsletterSegmentRepository: {
    list: vi.fn(),
    count: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    recentSentIssueIds: vi.fn(),
    personCustomFields: vi.fn(),
    customFieldPersonIds: vi.fn(),
    companies: vi.fn(),
    previewAudience: vi.fn(),
    setIssueSegment: vi.fn(),
  },
}))

import { auditMutation } from '@/lib/axiom/audit'
import { CrmNewsletterIssueRepository } from '@/src/repositories/crm-newsletter-issue.repository'
import { CrmNewsletterSegmentRepository } from '@/src/repositories/crm-newsletter-segment.repository'
import { assertModuleMember } from '../authz'
import {
  issueAudienceWhere,
  resolveSegmentWhere,
} from '../crm-newsletter-audience'
import {
  SEGMENT_COMPANY_OPTIONS,
  CrmNewsletterSegmentService as Service,
} from '../crm-newsletter-segment.service'

const issues = vi.mocked(CrmNewsletterIssueRepository)
const segments = vi.mocked(CrmNewsletterSegmentRepository)
const authz = vi.mocked(assertModuleMember)
const A = ['u1', 'ws1', 'nl1'] as const

const FIELD = {
  id: 'd1',
  workspaceId: 'ws1',
  entity: 'PERSON' as const,
  key: 'plano',
  label: 'Plano',
  type: 'TEXT' as const,
  options: [],
  required: false,
  position: 0,
  createdById: 'u1',
  updatedById: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
}

const WITH_FIELD: NewsletterSegment = {
  conditions: [
    { type: 'customField', definitionId: 'd1', op: 'equals', value: 'Pro' },
    { type: 'opened', op: 'any', lastIssues: 2 },
  ],
  groups: [],
}

function withIssue(
  overrides?: Parameters<typeof createFakeNewsletterIssue>[0],
) {
  const issue = createFakeNewsletterIssue(overrides)
  issues.findById.mockResolvedValue(ok(issue))
  return issue
}

describe('crm-newsletter-audience', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    segments.recentSentIssueIds.mockResolvedValue(ok(['i2', 'i1']))
    segments.personCustomFields.mockResolvedValue(ok([FIELD]))
    segments.customFieldPersonIds.mockResolvedValue(ok(['p1']))
  })

  it('resolves nothing for an empty segment', async () => {
    expect(
      expectOk(
        await resolveSegmentWhere('ws1', 'nl1', { conditions: [], groups: [] }),
      ),
    ).toBeNull()
    expect(segments.recentSentIssueIds).not.toHaveBeenCalled()
  })

  it('resolves custom fields and recent issues, then compiles', async () => {
    const where = expectOk(await resolveSegmentWhere('ws1', 'nl1', WITH_FIELD))
    expect(segments.personCustomFields).toHaveBeenCalledWith('ws1', ['d1'])
    expect(segments.recentSentIssueIds).toHaveBeenCalledWith('nl1', 2)
    expect(JSON.stringify(where)).toContain('"p1"')
    expect(JSON.stringify(where)).toContain('"i2"')
  })

  it('refuses a custom field that is gone and propagates failures', async () => {
    segments.personCustomFields.mockResolvedValueOnce(ok([]))
    expectErr(
      await resolveSegmentWhere('ws1', 'nl1', WITH_FIELD),
      'CRM_NEWSLETTER_SEGMENT_INVALID',
    )
    segments.personCustomFields.mockResolvedValueOnce(err(databaseError()))
    expectErr(await resolveSegmentWhere('ws1', 'nl1', WITH_FIELD))
    segments.customFieldPersonIds.mockResolvedValueOnce(err(databaseError()))
    expectErr(await resolveSegmentWhere('ws1', 'nl1', WITH_FIELD))
    segments.recentSentIssueIds.mockResolvedValueOnce(err(databaseError()))
    expectErr(await resolveSegmentWhere('ws1', 'nl1', WITH_FIELD))
  })

  it('gives the send flow the issue filter (undefined = everyone)', async () => {
    expect(
      expectOk(await issueAudienceWhere(createFakeNewsletterIssue())),
    ).toBeUndefined()
    const where = expectOk(
      await issueAudienceWhere(
        createFakeNewsletterIssue({ segment: SAMPLE_SEGMENT }),
      ),
    )
    expect(where).toHaveProperty('AND')
    expectErr(
      await issueAudienceWhere(
        createFakeNewsletterIssue({ segment: { conditions: [{ type: 'x' }] } }),
      ),
      'CRM_NEWSLETTER_SEGMENT_INVALID',
    )
    segments.personCustomFields.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await issueAudienceWhere(
        createFakeNewsletterIssue({ segment: WITH_FIELD }),
      ),
      'DATABASE_ERROR',
    )
  })
})

describe('CrmNewsletterSegmentService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authz.mockResolvedValue(
      ok({ role: 'MEMBER', isPrivileged: false, permissions: null }),
    )
    issues.findNewsletter.mockResolvedValue(ok(createFakeNewsletter()))
    withIssue()
    segments.recentSentIssueIds.mockResolvedValue(ok([]))
    segments.personCustomFields.mockResolvedValue(ok([FIELD]))
    segments.customFieldPersonIds.mockResolvedValue(ok([]))
    segments.count.mockResolvedValue(ok(0))
    segments.findById.mockResolvedValue(ok(createFakeNewsletterSegment()))
  })

  it('lists saved segments for members who can view e-mail', async () => {
    segments.list.mockResolvedValue(ok([createFakeNewsletterSegment()]))
    const list = expectOk(await Service.list(...A))
    expect(list[0]).toMatchObject({ id: 'seg1', valid: true })
    expect(authz).toHaveBeenCalledWith('u1', 'ws1', 'CRM', {
      resource: 'email',
      action: 'VIEW',
    })
    segments.list.mockResolvedValueOnce(err(databaseError()))
    expectErr(await Service.list(...A), 'DATABASE_ERROR')
  })

  it('denies non-members, unknown newsletters and missing permission', async () => {
    authz.mockResolvedValueOnce(err(forbidden()))
    expectErr(await Service.list(...A), 'FORBIDDEN')
    issues.findNewsletter.mockResolvedValueOnce(ok(null))
    expectErr(await Service.list(...A), 'CRM_NEWSLETTER_NOT_FOUND')
    authz.mockResolvedValueOnce(err(forbidden()))
    expectErr(
      await Service.create(...A, { name: 'X', definition: SAMPLE_SEGMENT }),
      'FORBIDDEN',
    )
    expect(segments.create).not.toHaveBeenCalled()
  })

  it('creates a segment, audited, within the per-newsletter limit', async () => {
    segments.create.mockResolvedValue(ok(createFakeNewsletterSegment()))
    const created = expectOk(
      await Service.create(...A, {
        name: 'Engajados',
        definition: SAMPLE_SEGMENT,
      }),
    )
    expect(created.name).toBe('Engajados')
    expect(segments.create).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws1',
        newsletterId: 'nl1',
        createdById: 'u1',
      }),
    )
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'crm_newsletter_segment',
        action: 'create',
        meta: expect.objectContaining({ conditions: 3 }),
      }),
    )

    segments.count.mockResolvedValueOnce(ok(50))
    expectErr(
      await Service.create(...A, { name: 'X', definition: SAMPLE_SEGMENT }),
      'CRM_NEWSLETTER_SEGMENT_LIMIT_REACHED',
    )
    segments.count.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await Service.create(...A, { name: 'X', definition: SAMPLE_SEGMENT }),
    )
    segments.personCustomFields.mockResolvedValueOnce(ok([]))
    expectErr(
      await Service.create(...A, { name: 'X', definition: WITH_FIELD }),
      'CRM_NEWSLETTER_SEGMENT_INVALID',
    )
    segments.create.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await Service.create(...A, { name: 'X', definition: SAMPLE_SEGMENT }),
    )
  })

  it('updates name and conditions', async () => {
    segments.update.mockResolvedValue(
      ok(createFakeNewsletterSegment({ name: 'Novo' })),
    )
    expect(
      expectOk(await Service.update(...A, 'seg1', { name: 'Novo' })).name,
    ).toBe('Novo')
    expect(segments.update).toHaveBeenCalledWith('seg1', {
      name: 'Novo',
      updatedById: 'u1',
    })
    expectOk(await Service.update(...A, 'seg1', { definition: WITH_FIELD }))
    expect(segments.update).toHaveBeenLastCalledWith('seg1', {
      definition: WITH_FIELD,
      updatedById: 'u1',
    })
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'update', targetId: 'seg1' }),
    )

    segments.findById.mockResolvedValueOnce(ok(null))
    expectErr(
      await Service.update(...A, 'seg1', { name: 'X' }),
      'CRM_NEWSLETTER_SEGMENT_NOT_FOUND',
    )
    segments.findById.mockResolvedValueOnce(err(databaseError()))
    expectErr(await Service.update(...A, 'seg1', { name: 'X' }))
    segments.personCustomFields.mockResolvedValueOnce(ok([]))
    expectErr(
      await Service.update(...A, 'seg1', { definition: WITH_FIELD }),
      'CRM_NEWSLETTER_SEGMENT_INVALID',
    )
    segments.update.mockResolvedValueOnce(err(databaseError()))
    expectErr(await Service.update(...A, 'seg1', { name: 'X' }))
    authz.mockResolvedValueOnce(err(forbidden()))
    expectErr(await Service.update(...A, 'seg1', { name: 'X' }), 'FORBIDDEN')
  })

  it('deletes a segment, audited', async () => {
    segments.delete.mockResolvedValue(ok(undefined))
    expectOk(await Service.remove(...A, 'seg1'))
    expect(segments.delete).toHaveBeenCalledWith('seg1')
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'delete', targetId: 'seg1' }),
    )
    segments.findById.mockResolvedValueOnce(ok(null))
    expectErr(
      await Service.remove(...A, 'seg1'),
      'CRM_NEWSLETTER_SEGMENT_NOT_FOUND',
    )
    segments.findById.mockResolvedValueOnce(err(databaseError()))
    expectErr(await Service.remove(...A, 'seg1'))
    segments.delete.mockResolvedValueOnce(err(databaseError()))
    expectErr(await Service.remove(...A, 'seg1'))
    authz.mockResolvedValueOnce(err(forbidden()))
    expectErr(await Service.remove(...A, 'seg1'), 'FORBIDDEN')
  })

  it("reads the issue's audience with the saved segment name", async () => {
    expect(expectOk(await Service.getIssueSegment(...A, 'is1'))).toEqual({
      segment: { conditions: [], groups: [] },
      savedSegmentId: null,
      savedSegmentName: null,
      everyone: true,
    })
    withIssue({ segment: { ...SAMPLE_SEGMENT, savedSegmentId: 'seg1' } })
    expect(expectOk(await Service.getIssueSegment(...A, 'is1'))).toMatchObject({
      savedSegmentName: 'Engajados',
      everyone: false,
    })
    segments.findById.mockResolvedValueOnce(ok(null))
    expect(
      expectOk(await Service.getIssueSegment(...A, 'is1')).savedSegmentName,
    ).toBeNull()
    segments.findById.mockResolvedValueOnce(err(databaseError()))
    expectErr(await Service.getIssueSegment(...A, 'is1'))
    withIssue({ segment: { conditions: 'x' } })
    expectErr(
      await Service.getIssueSegment(...A, 'is1'),
      'CRM_NEWSLETTER_SEGMENT_INVALID',
    )
    issues.findById.mockResolvedValueOnce(ok(null))
    expectErr(
      await Service.getIssueSegment(...A, 'is1'),
      'CRM_NEWSLETTER_ISSUE_NOT_FOUND',
    )
    authz.mockResolvedValueOnce(err(forbidden()))
    expectErr(await Service.getIssueSegment(...A, 'is1'), 'FORBIDDEN')
  })

  it("sets the issue's audience while it is editable", async () => {
    segments.setIssueSegment.mockResolvedValue(ok(createFakeNewsletterIssue()))
    const result = expectOk(
      await Service.setIssueSegment(...A, 'is1', {
        segment: SAMPLE_SEGMENT,
        savedSegmentId: 'seg1',
      }),
    )
    expect(result).toMatchObject({
      savedSegmentId: 'seg1',
      savedSegmentName: 'Engajados',
      everyone: false,
    })
    expect(segments.setIssueSegment).toHaveBeenCalledWith(
      'is1',
      { ...SAMPLE_SEGMENT, savedSegmentId: 'seg1' },
      'u1',
    )
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'crm_newsletter_issue',
        meta: expect.objectContaining({ audience: 'segment' }),
      }),
    )

    // Everyone: stored as `{}` like phase 1.
    expect(
      expectOk(
        await Service.setIssueSegment(...A, 'is1', {
          segment: { conditions: [], groups: [] },
        }),
      ).everyone,
    ).toBe(true)
    expect(segments.setIssueSegment).toHaveBeenLastCalledWith('is1', {}, 'u1')

    segments.setIssueSegment.mockResolvedValueOnce(ok(null))
    expectErr(
      await Service.setIssueSegment(...A, 'is1', { segment: SAMPLE_SEGMENT }),
      'CRM_NEWSLETTER_ISSUE_LOCKED',
    )
    segments.setIssueSegment.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await Service.setIssueSegment(...A, 'is1', { segment: SAMPLE_SEGMENT }),
    )
    segments.personCustomFields.mockResolvedValueOnce(ok([]))
    expectErr(
      await Service.setIssueSegment(...A, 'is1', { segment: WITH_FIELD }),
      'CRM_NEWSLETTER_SEGMENT_INVALID',
    )
    segments.findById.mockResolvedValueOnce(ok(null))
    expectErr(
      await Service.setIssueSegment(...A, 'is1', {
        segment: SAMPLE_SEGMENT,
        savedSegmentId: 'gone',
      }),
      'CRM_NEWSLETTER_SEGMENT_NOT_FOUND',
    )
    segments.findById.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await Service.setIssueSegment(...A, 'is1', {
        segment: SAMPLE_SEGMENT,
        savedSegmentId: 'seg1',
      }),
    )
    withIssue({ status: 'SENT' })
    expectErr(
      await Service.setIssueSegment(...A, 'is1', { segment: SAMPLE_SEGMENT }),
      'CRM_NEWSLETTER_ISSUE_LOCKED',
    )
    issues.findById.mockResolvedValueOnce(ok(null))
    expectErr(
      await Service.setIssueSegment(...A, 'is1', { segment: SAMPLE_SEGMENT }),
    )
    authz.mockResolvedValueOnce(err(forbidden()))
    expectErr(
      await Service.setIssueSegment(...A, 'is1', { segment: SAMPLE_SEGMENT }),
      'FORBIDDEN',
    )
  })

  it('previews the posted segment or the stored one', async () => {
    const preview = { count: 2, total: 5, sample: [] }
    segments.previewAudience.mockResolvedValue(ok(preview))
    expect(
      expectOk(
        await Service.previewAudience(...A, 'is1', { segment: SAMPLE_SEGMENT }),
      ),
    ).toEqual(preview)
    expect(segments.previewAudience).toHaveBeenCalledWith(
      'ws1',
      'nl1',
      expect.objectContaining({ AND: expect.any(Array) }),
      10,
    )
    expectOk(await Service.previewAudience(...A, 'is1', {}))
    expect(segments.previewAudience).toHaveBeenLastCalledWith(
      'ws1',
      'nl1',
      null,
      10,
    )
    withIssue({ segment: { conditions: 'x' } })
    expectErr(
      await Service.previewAudience(...A, 'is1', {}),
      'CRM_NEWSLETTER_SEGMENT_INVALID',
    )
    segments.personCustomFields.mockResolvedValueOnce(ok([]))
    expectErr(
      await Service.previewAudience(...A, 'is1', { segment: WITH_FIELD }),
      'CRM_NEWSLETTER_SEGMENT_INVALID',
    )
    issues.findById.mockResolvedValueOnce(ok(null))
    expectErr(await Service.previewAudience(...A, 'is1', {}))
    authz.mockResolvedValueOnce(err(forbidden()))
    expectErr(await Service.previewAudience(...A, 'is1', {}), 'FORBIDDEN')
  })

  it('returns the builder options', async () => {
    segments.companies.mockResolvedValue(ok([{ id: 'c1', name: 'Acme' }]))
    expect(
      expectOk(
        await Service.options(...A, { companyQuery: 'ac', companyIds: ['c1'] }),
      ),
    ).toEqual({
      companies: [{ id: 'c1', name: 'Acme' }],
      customFields: [{ id: 'd1', label: 'Plano', type: 'TEXT', options: [] }],
    })
    expect(segments.companies).toHaveBeenCalledWith(
      'ws1',
      'ac',
      SEGMENT_COMPANY_OPTIONS,
      ['c1'],
    )
    expectOk(await Service.options(...A, {}))
    expect(segments.companies).toHaveBeenLastCalledWith(
      'ws1',
      undefined,
      SEGMENT_COMPANY_OPTIONS,
      [],
    )
    segments.companies.mockResolvedValueOnce(err(databaseError()))
    expectErr(await Service.options(...A, {}))
    segments.personCustomFields.mockResolvedValueOnce(err(databaseError()))
    expectErr(await Service.options(...A, {}))
    authz.mockResolvedValueOnce(err(forbidden()))
    expectErr(await Service.options(...A, {}), 'FORBIDDEN')
  })
})
