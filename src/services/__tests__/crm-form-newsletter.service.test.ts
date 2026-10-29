import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeCrmForm,
  createFakeCrmFormSubmission,
} from '@/src/__tests__/factories/crm-form.factory'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeCrmNewsletter } from '@/src/__tests__/factories/newsletter-nl-core.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { crmNewsletterNotFound, databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/services/crm-notifications')
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/crm-form.repository')
vi.mock('@/src/repositories/crm-person.repository')
vi.mock('@/src/repositories/crm-newsletter.repository')
vi.mock('@/src/services/crm-newsletter-public.service')
vi.mock('@/src/services/crm-campaign-tracking.service')
vi.mock('@/lib/axiom/logger')
vi.mock('@/lib/axiom/audit')

import { logger } from '@/lib/axiom/logger'
import {
  CrmFormRepository,
  CrmFormSubmissionRepository,
} from '@/src/repositories/crm-form.repository'
import { CrmNewsletterRepository } from '@/src/repositories/crm-newsletter.repository'
import { CrmPersonRepository } from '@/src/repositories/crm-person.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { crmFormNewsletterConsentText } from '@/src/schemas/crm-newsletter.schema'
import { CrmFormService, formContact } from '../crm-form.service'
import { CrmNewsletterPublicService } from '../crm-newsletter-public.service'

const formRepo = vi.mocked(CrmFormRepository)
const submissionRepo = vi.mocked(CrmFormSubmissionRepository)
const personRepo = vi.mocked(CrmPersonRepository)
const newsletterRepo = vi.mocked(CrmNewsletterRepository)
const publicService = vi.mocked(CrmNewsletterPublicService)
const membershipRepo = vi.mocked(MembershipRepository)

const field = (
  key: string,
  type: 'text' | 'email',
  attribute: string,
  target: 'person' | 'lead' = 'person',
) => ({
  key,
  label: key,
  type,
  required: false,
  mapping: { target, attribute },
})

const newsletter = createFakeCrmNewsletter({
  id: 'nl1',
  workspaceId: 'ws1',
  name: 'Novidades',
})

const personForm = (overrides = {}) =>
  createFakeCrmForm({
    id: 'f1',
    workspaceId: 'ws1',
    status: 'PUBLISHED',
    action: 'PERSON',
    newsletterId: 'nl1',
    fields: [
      field('nome', 'text', 'name'),
      field('mail', 'email', 'email'),
    ] as never,
    ...overrides,
  })

beforeEach(() => {
  vi.clearAllMocks()
  membershipRepo.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role: 'OWNER' })),
  )
  newsletterRepo.findById.mockResolvedValue(ok(newsletter))
  personRepo.create.mockResolvedValue(ok({ id: 'p1' } as never))
  submissionRepo.create.mockResolvedValue(ok(createFakeCrmFormSubmission()))
  publicService.subscribeFromForm.mockResolvedValue(ok(true))
})

describe('formContact', () => {
  it('takes the first e-mail field and the first name-mapped field', () => {
    const fields = [
      field('empty', 'email', 'email'),
      field('lead_mail', 'text', 'email', 'lead'),
      field('n', 'text', 'name'),
    ]
    expect(
      formContact(fields, { empty: ' ', lead_mail: 'a@b.com', n: ' Ana ' }),
    ).toEqual({ email: 'a@b.com', name: 'Ana' })
    expect(formContact(fields, { empty: true })).toEqual({
      email: null,
      name: null,
    })
  })
})

describe('CrmFormService.update — newsletterId', () => {
  beforeEach(() => {
    formRepo.findById.mockResolvedValue(ok(personForm()))
    formRepo.update.mockResolvedValue(ok(personForm()))
  })

  it('accepts a newsletter of the workspace', async () => {
    expectOk(
      await CrmFormService.update('u1', 'ws1', 'f1', { newsletterId: 'nl1' }),
    )
    expect(newsletterRepo.findById).toHaveBeenCalledWith('nl1', 'ws1')
    expect(formRepo.update).toHaveBeenCalledWith(
      'f1',
      expect.objectContaining({ newsletterId: 'nl1' }),
    )
  })

  it('clears it with null without a lookup', async () => {
    expectOk(
      await CrmFormService.update('u1', 'ws1', 'f1', { newsletterId: null }),
    )
    expect(newsletterRepo.findById).not.toHaveBeenCalled()
  })

  it('refuses a newsletter from elsewhere', async () => {
    newsletterRepo.findById.mockResolvedValue(err(crmNewsletterNotFound()))
    expectErr(
      await CrmFormService.update('u1', 'ws1', 'f1', { newsletterId: 'x' }),
      'CRM_NEWSLETTER_NOT_FOUND',
    )
    expect(formRepo.update).not.toHaveBeenCalled()
  })
})

describe('CrmFormService.getPublicByToken — consent box', () => {
  it('shows the box for an ACTIVE newsletter', async () => {
    formRepo.findPublishedByPublicToken.mockResolvedValue(ok(personForm()))
    const dto = expectOk(await CrmFormService.getPublicByToken('tok'))
    expect(dto.newsletter).toEqual({
      name: 'Novidades',
      consentText: crmFormNewsletterConsentText('Novidades'),
    })
  })

  it.each([
    [
      'archived',
      () =>
        newsletterRepo.findById.mockResolvedValue(
          ok({ ...newsletter, status: 'ARCHIVED' }),
        ),
    ],
    [
      'gone',
      () =>
        newsletterRepo.findById.mockResolvedValue(err(crmNewsletterNotFound())),
    ],
  ])('hides it when the newsletter is %s', async (_n, arrange) => {
    arrange()
    formRepo.findPublishedByPublicToken.mockResolvedValue(ok(personForm()))
    expect(
      expectOk(await CrmFormService.getPublicByToken('tok')).newsletter,
    ).toBeNull()
  })

  it('has no box when the form does not subscribe', async () => {
    formRepo.findPublishedByPublicToken.mockResolvedValue(
      ok(personForm({ newsletterId: null })),
    )
    const dto = expectOk(await CrmFormService.getPublicByToken('tok'))
    expect(dto).not.toHaveProperty('newsletter')
  })
})

describe('CrmFormService.submit — newsletter consent', () => {
  beforeEach(() => {
    formRepo.findPublishedByPublicToken.mockResolvedValue(ok(personForm()))
  })

  it('subscribes the visitor who ticked the box', async () => {
    expectOk(
      await CrmFormService.submit(
        'tok',
        '9.9.9.9',
        undefined,
        { values: { nome: 'Ana', mail: 'ana@x.com' }, newsletterConsent: true },
        'UA',
      ),
    )
    expect(publicService.subscribeFromForm).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws1',
        newsletterId: 'nl1',
        formId: 'f1',
        email: 'ana@x.com',
        name: 'Ana',
        consentText: crmFormNewsletterConsentText('Novidades'),
        context: expect.objectContaining({ ip: '9.9.9.9', userAgent: 'UA' }),
      }),
    )
  })

  it('logs and still answers when subscribing fails', async () => {
    publicService.subscribeFromForm.mockResolvedValue(err(databaseError()))
    expectOk(
      await CrmFormService.submit('tok', 'unknown', undefined, {
        values: { mail: 'ana@x.com' },
        newsletterConsent: true,
      }),
    )
    expect(publicService.subscribeFromForm).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ ip: null, userAgent: null }),
      }),
    )
    expect(vi.mocked(logger.warn)).toHaveBeenCalled()
  })

  it.each([
    ['no consent', { values: { mail: 'ana@x.com' } }, () => {}],
    [
      'no e-mail',
      { values: { nome: 'Ana' }, newsletterConsent: true },
      () => {},
    ],
    [
      'newsletter gone',
      { values: { mail: 'ana@x.com' }, newsletterConsent: true },
      () =>
        newsletterRepo.findById.mockResolvedValue(err(crmNewsletterNotFound())),
    ],
    [
      'form without newsletter',
      { values: { mail: 'ana@x.com' }, newsletterConsent: true },
      () =>
        formRepo.findPublishedByPublicToken.mockResolvedValue(
          ok(personForm({ newsletterId: null })),
        ),
    ],
  ])('subscribes nobody with %s', async (_n, dto, arrange) => {
    arrange()
    expectOk(await CrmFormService.submit('tok', '1.1.1.1', undefined, dto))
    expect(publicService.subscribeFromForm).not.toHaveBeenCalled()
  })
})
