import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeCrmForm } from '@/src/__tests__/factories/crm-form.factory'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeMeetingPage } from '@/src/__tests__/factories/nov-crm-ops.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/workspace-module-access.repository')
vi.mock('@/src/repositories/crm-form.repository')
vi.mock('@/src/repositories/crm-meeting.repository')
vi.mock('@/src/repositories/crm-newsletter.repository')
vi.mock('@/src/repositories/crm-company.repository')
vi.mock('@/src/repositories/crm-person.repository')
vi.mock('@/src/services/crm-duplicate.service', () => ({
  CrmDuplicateService: { flagOnArrival: vi.fn() },
}))
vi.mock('@/src/services/crm-notifications')
vi.mock('@/src/services/crm-workflow-dispatcher')
vi.mock('@/src/services/crm-campaign-tracking.service')
vi.mock('@/src/services/webhook-emitter')

import { CrmCompanyRepository } from '@/src/repositories/crm-company.repository'
import {
  CrmFormRepository,
  CrmFormSubmissionRepository,
} from '@/src/repositories/crm-form.repository'
import { CrmMeetingRepository } from '@/src/repositories/crm-meeting.repository'
import { CrmNewsletterRepository } from '@/src/repositories/crm-newsletter.repository'
import { CrmPersonRepository } from '@/src/repositories/crm-person.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { CrmDuplicateService } from '../crm-duplicate.service'
import { CrmFormService } from '../crm-form.service'

const members = vi.mocked(MembershipRepository)
const moduleAccess = vi.mocked(WorkspaceModuleAccessRepository)
const formRepo = vi.mocked(CrmFormRepository)
const submissions = vi.mocked(CrmFormSubmissionRepository)
const meetings = vi.mocked(CrmMeetingRepository)
const newsletters = vi.mocked(CrmNewsletterRepository)
const companies = vi.mocked(CrmCompanyRepository)
const people = vi.mocked(CrmPersonRepository)
const flag = vi.mocked(CrmDuplicateService.flagOnArrival)

const form = (over = {}) =>
  createFakeCrmForm({ id: 'f1', workspaceId: 'ws1', ...over })
const livePage = (over = {}) => ({
  ...createFakeMeetingPage(over),
  workspace: { name: 'Acme' },
})

beforeEach(() => {
  vi.resetAllMocks()
  moduleAccess.isEnabled.mockResolvedValue(ok(true))
  members.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role: 'MEMBER' })),
  )
})

describe('update() booking page', () => {
  beforeEach(() => {
    formRepo.findById.mockResolvedValue(ok(form()))
    formRepo.update.mockResolvedValue(ok(form({ bookingPageId: 'page1' })))
  })

  it('should link a booking page of the same workspace', async () => {
    meetings.findPage.mockResolvedValue(ok(createFakeMeetingPage()))

    const dto = expectOk(
      await CrmFormService.update('u1', 'ws1', 'f1', {
        bookingPageId: 'page1',
      }),
    )

    expect(meetings.findPage).toHaveBeenCalledWith('ws1', 'page1')
    expect(formRepo.update.mock.calls[0][1]).toMatchObject({
      bookingPageId: 'page1',
    })
    expect(dto.bookingPageId).toBe('page1')
  })

  it('should reject a page of another workspace', async () => {
    meetings.findPage.mockResolvedValue(ok(null))

    expectErr(
      await CrmFormService.update('u1', 'ws1', 'f1', {
        bookingPageId: 'other',
      }),
      'VALIDATION_ERROR',
    )
    expect(formRepo.update).not.toHaveBeenCalled()
  })

  it('should propagate a page lookup error', async () => {
    meetings.findPage.mockResolvedValue(err(databaseError('x')))

    expectErr(
      await CrmFormService.update('u1', 'ws1', 'f1', {
        bookingPageId: 'page1',
      }),
      'DATABASE_ERROR',
    )
  })

  it('should not look the page up when unlinking', async () => {
    expectOk(
      await CrmFormService.update('u1', 'ws1', 'f1', { bookingPageId: null }),
    )

    expect(meetings.findPage).not.toHaveBeenCalled()
    expect(formRepo.update.mock.calls[0][1]).toMatchObject({
      bookingPageId: null,
    })
  })
})

describe('getPublicByToken() booking offer', () => {
  it('should offer the live booking page after the form', async () => {
    formRepo.findPublishedByPublicToken.mockResolvedValue(
      ok(form({ bookingPageId: 'page1' })),
    )
    meetings.findPageWithWorkspace.mockResolvedValue(ok(livePage()))

    const dto = expectOk(await CrmFormService.getPublicByToken('tok'))

    expect(dto.booking).toEqual({
      slug: 'vendas',
      title: 'Conversa com vendas',
      description: null,
      durationMinutes: 30,
      timezone: 'America/Sao_Paulo',
      format: 'ONLINE',
      workspaceName: 'Acme',
    })
  })

  it('should not offer anything without a linked page', async () => {
    formRepo.findPublishedByPublicToken.mockResolvedValue(ok(form()))

    const dto = expectOk(await CrmFormService.getPublicByToken('tok'))

    expect(dto).not.toHaveProperty('booking')
    expect(meetings.findPageWithWorkspace).not.toHaveBeenCalled()
  })

  it.each([
    ['inactive', ok(livePage({ active: false }))],
    ['deleted', ok(livePage({ deletedAt: new Date() }))],
    ['missing', ok(null)],
    ['failing', err(databaseError('x'))],
  ])('should not offer a %s page', async (_name, found) => {
    formRepo.findPublishedByPublicToken.mockResolvedValue(
      ok(form({ bookingPageId: 'page1' })),
    )
    meetings.findPageWithWorkspace.mockResolvedValue(found as never)

    const dto = expectOk(await CrmFormService.getPublicByToken('tok'))

    expect(dto).not.toHaveProperty('booking')
  })

  it('should offer the booking together with an active newsletter', async () => {
    formRepo.findPublishedByPublicToken.mockResolvedValue(
      ok(form({ bookingPageId: 'page1', newsletterId: 'nl1' })),
    )
    meetings.findPageWithWorkspace.mockResolvedValue(ok(livePage()))
    newsletters.findById.mockResolvedValue(
      ok({ name: 'Novidades', status: 'ACTIVE' } as never),
    )

    const dto = expectOk(await CrmFormService.getPublicByToken('tok'))

    expect(dto.booking?.slug).toBe('vendas')
    expect(dto.newsletter?.name).toBe('Novidades')
  })

  it('should drop an inactive newsletter but keep the booking', async () => {
    formRepo.findPublishedByPublicToken.mockResolvedValue(
      ok(form({ bookingPageId: 'page1', newsletterId: 'nl1' })),
    )
    meetings.findPageWithWorkspace.mockResolvedValue(ok(livePage()))
    newsletters.findById.mockResolvedValue(err(databaseError('x')))

    const dto = expectOk(await CrmFormService.getPublicByToken('tok'))

    expect(dto.booking?.slug).toBe('vendas')
    expect(dto.newsletter).toBeNull()
  })
})

describe('submit() duplicate flag', () => {
  beforeEach(() => {
    submissions.create.mockImplementation(async (data) =>
      ok({
        id: 's1',
        formId: data.formId,
        values: {},
        action: data.action,
        createdPersonId: data.createdPersonId ?? null,
        createdCompanyId: data.createdCompanyId ?? null,
        createdLeadId: data.createdLeadId ?? null,
        ipHash: null,
        referrer: null,
        createdAt: new Date(),
      } as never),
    )
  })

  it('should flag a company created by a form', async () => {
    formRepo.findPublishedByPublicToken.mockResolvedValue(
      ok(form({ action: 'COMPANY', createdById: 'owner1', fields: [] })),
    )
    companies.create.mockResolvedValue(ok({ id: 'co1' } as never))

    expectOk(
      await CrmFormService.submit('tok', '1.1.1.1', undefined, { values: {} }),
    )

    expect(flag).toHaveBeenCalledWith('ws1', 'COMPANY', 'co1')
  })

  it('should flag a person created by a form', async () => {
    formRepo.findPublishedByPublicToken.mockResolvedValue(
      ok(form({ action: 'PERSON', createdById: 'owner1', fields: [] })),
    )
    people.create.mockResolvedValue(ok({ id: 'pe1' } as never))

    expectOk(
      await CrmFormService.submit('tok', '1.1.1.1', undefined, { values: {} }),
    )

    expect(flag).toHaveBeenCalledWith('ws1', 'PERSON', 'pe1')
  })

  it('should not flag anything when the creation fails', async () => {
    formRepo.findPublishedByPublicToken.mockResolvedValue(
      ok(form({ action: 'PERSON', createdById: 'owner1', fields: [] })),
    )
    people.create.mockResolvedValue(err(databaseError('x')))

    expectErr(
      await CrmFormService.submit('tok', '1.1.1.1', undefined, { values: {} }),
      'DATABASE_ERROR',
    )

    expect(flag).not.toHaveBeenCalled()
  })
})
