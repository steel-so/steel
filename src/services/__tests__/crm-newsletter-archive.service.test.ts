import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeArchiveIssueRow,
  createFakeArchiveNewsletterRow,
  createFakeSiteNewsletterRow,
} from '@/src/__tests__/factories/newsletter-archive.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  crmNewsletterIssueNotFound,
  crmNewsletterNotFound,
  databaseError,
  forbidden,
  moduleDisabled,
} from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/crm-newsletter-archive.repository')
vi.mock('../authz', () => ({ assertModuleEnabled: vi.fn() }))
vi.mock('../site-access', () => ({ assertSitesPermission: vi.fn() }))

import { CrmNewsletterArchiveRepository } from '@/src/repositories/crm-newsletter-archive.repository'
import { assertModuleEnabled } from '../authz'
import { CrmNewsletterArchiveService } from '../crm-newsletter-archive.service'
import { assertSitesPermission } from '../site-access'

const repo = vi.mocked(CrmNewsletterArchiveRepository)
const moduleGate = vi.mocked(assertModuleEnabled)
const sitesGate = vi.mocked(assertSitesPermission)

const newsletterRow = createFakeArchiveNewsletterRow({ id: 'nl1' })

beforeEach(() => {
  repo.findPublicNewsletter.mockResolvedValue(ok(newsletterRow))
  moduleGate.mockResolvedValue(ok(true))
})

describe('CrmNewsletterArchiveService', () => {
  describe('public newsletter gate', () => {
    it('should propagate NOT_FOUND from the repository', async () => {
      repo.findPublicNewsletter.mockResolvedValue(err(crmNewsletterNotFound()))
      expectErr(
        await CrmNewsletterArchiveService.getArchive('acme', 'x', 1),
        'CRM_NEWSLETTER_NOT_FOUND',
      )
    })

    it('should answer NOT_FOUND when the CRM module is off', async () => {
      moduleGate.mockResolvedValue(err(moduleDisabled()))
      expectErr(
        await CrmNewsletterArchiveService.getFeed('acme', 'novidades'),
        'CRM_NEWSLETTER_NOT_FOUND',
      )
      expect(repo.listSentIssues).not.toHaveBeenCalled()
    })

    it('should propagate a module lookup database error', async () => {
      moduleGate.mockResolvedValue(err(databaseError()))
      expectErr(
        await CrmNewsletterArchiveService.getIssue('acme', 'novidades', 'a'),
        'DATABASE_ERROR',
      )
    })
  })

  describe('getArchive()', () => {
    it('should return the newsletter and a page of issues', async () => {
      repo.listSentIssues.mockResolvedValue(
        ok({ items: [createFakeArchiveIssueRow()], total: 25 }),
      )
      const archive = expectOk(
        await CrmNewsletterArchiveService.getArchive('acme', 'novidades', 2),
      )
      expect(repo.listSentIssues).toHaveBeenCalledWith('nl1', {
        skip: 12,
        take: 12,
      })
      expect(archive.workspaceSlug).toBe('acme')
      expect(archive.newsletter.doubleOptIn).toBe(true)
      expect(archive.issues[0].slug).toBe('edicao-de-outubro')
      expect(archive.pagination).toEqual({
        page: 2,
        pageSize: 12,
        total: 25,
        totalPages: 3,
      })
    })

    it('should report one page when there is no issue', async () => {
      repo.listSentIssues.mockResolvedValue(ok({ items: [], total: 0 }))
      const archive = expectOk(
        await CrmNewsletterArchiveService.getArchive('acme', 'novidades', 1),
      )
      expect(archive.pagination.totalPages).toBe(1)
    })

    it('should propagate a listing error', async () => {
      repo.listSentIssues.mockResolvedValue(err(databaseError()))
      expectErr(
        await CrmNewsletterArchiveService.getArchive('acme', 'novidades', 1),
        'DATABASE_ERROR',
      )
    })
  })

  describe('pageExists()', () => {
    const issue = {
      ...createFakeArchiveIssueRow({ number: 2, slug: 'dois' }),
      preheader: null,
      webHtml: '<p>Oi</p>',
    }

    it('should say whether the archive home exists', async () => {
      expect(
        expectOk(await CrmNewsletterArchiveService.pageExists('acme', 'n')),
      ).toBe(true)
      repo.findPublicNewsletter.mockResolvedValue(err(crmNewsletterNotFound()))
      expect(
        expectOk(await CrmNewsletterArchiveService.pageExists('acme', 'n')),
      ).toBe(false)
      moduleGate.mockResolvedValue(err(moduleDisabled()))
      expect(
        expectOk(await CrmNewsletterArchiveService.pageExists('acme', 'n')),
      ).toBe(false)
    })

    it('should say whether a sent issue with a web version exists', async () => {
      repo.findSentIssue.mockResolvedValue(ok(issue))
      expect(
        expectOk(
          await CrmNewsletterArchiveService.pageExists('acme', 'n', 'dois'),
        ),
      ).toBe(true)
      expect(repo.findSentIssue).toHaveBeenCalledWith('nl1', 'dois')
      repo.findSentIssue.mockResolvedValue(ok({ ...issue, webHtml: '  ' }))
      expect(
        expectOk(
          await CrmNewsletterArchiveService.pageExists('acme', 'n', 'dois'),
        ),
      ).toBe(false)
      repo.findSentIssue.mockResolvedValue(err(crmNewsletterIssueNotFound()))
      expect(
        expectOk(
          await CrmNewsletterArchiveService.pageExists('acme', 'n', 'x'),
        ),
      ).toBe(false)
    })

    it('should propagate database errors (the proxy lets the page decide)', async () => {
      repo.findSentIssue.mockResolvedValue(err(databaseError()))
      expectErr(
        await CrmNewsletterArchiveService.pageExists('acme', 'n', 'x'),
        'DATABASE_ERROR',
      )
      repo.findPublicNewsletter.mockResolvedValue(err(databaseError()))
      expectErr(
        await CrmNewsletterArchiveService.pageExists('acme', 'n'),
        'DATABASE_ERROR',
      )
    })
  })

  describe('getIssue()', () => {
    const issue = {
      ...createFakeArchiveIssueRow({ number: 2, slug: 'dois' }),
      preheader: 'Prévia',
      webHtml: '<p>Oi</p>',
    }

    it('should return the issue with its neighbours', async () => {
      repo.findSentIssue.mockResolvedValue(ok(issue))
      repo.findAdjacentIssues.mockResolvedValue(
        ok({
          previous: createFakeArchiveIssueRow({ number: 1, slug: 'um' }),
          next: null,
        }),
      )
      const page = expectOk(
        await CrmNewsletterArchiveService.getIssue('acme', 'novidades', 'dois'),
      )
      expect(repo.findAdjacentIssues).toHaveBeenCalledWith('nl1', 2)
      expect(page.issue).toMatchObject({
        number: 2,
        slug: 'dois',
        preheader: 'Prévia',
        webHtml: '<p>Oi</p>',
      })
      expect(page.previous).toEqual({
        number: 1,
        subject: 'Edição de outubro',
        slug: 'um',
      })
      expect(page.next).toBeNull()
    })

    it('should 404 an issue without web HTML', async () => {
      repo.findSentIssue.mockResolvedValue(ok({ ...issue, webHtml: '  ' }))
      expectErr(
        await CrmNewsletterArchiveService.getIssue('acme', 'novidades', 'dois'),
        'CRM_NEWSLETTER_NOT_FOUND',
      )
      repo.findSentIssue.mockResolvedValue(ok({ ...issue, webHtml: null }))
      expectErr(
        await CrmNewsletterArchiveService.getIssue('acme', 'novidades', 'dois'),
        'CRM_NEWSLETTER_NOT_FOUND',
      )
    })

    it('should propagate the issue and neighbour lookups errors', async () => {
      repo.findSentIssue.mockResolvedValue(err(crmNewsletterIssueNotFound()))
      expectErr(
        await CrmNewsletterArchiveService.getIssue('acme', 'novidades', 'x'),
        'CRM_NEWSLETTER_ISSUE_NOT_FOUND',
      )
      repo.findSentIssue.mockResolvedValue(ok(issue))
      repo.findAdjacentIssues.mockResolvedValue(err(databaseError()))
      expectErr(
        await CrmNewsletterArchiveService.getIssue('acme', 'novidades', 'dois'),
        'DATABASE_ERROR',
      )
    })

    it('should propagate the newsletter gate', async () => {
      repo.findPublicNewsletter.mockResolvedValue(err(crmNewsletterNotFound()))
      expectErr(
        await CrmNewsletterArchiveService.getIssue('acme', 'x', 'dois'),
        'CRM_NEWSLETTER_NOT_FOUND',
      )
    })
  })

  describe('getFeed()', () => {
    it('should load the last 50 issues', async () => {
      repo.listSentIssues.mockResolvedValue(
        ok({ items: [createFakeArchiveIssueRow()], total: 1 }),
      )
      const feed = expectOk(
        await CrmNewsletterArchiveService.getFeed('acme', 'novidades'),
      )
      expect(repo.listSentIssues).toHaveBeenCalledWith('nl1', {
        skip: 0,
        take: 50,
      })
      expect(feed.issues).toHaveLength(1)
      expect(feed).not.toHaveProperty('pagination')
    })

    it('should propagate a listing error', async () => {
      repo.listSentIssues.mockResolvedValue(err(databaseError()))
      expectErr(
        await CrmNewsletterArchiveService.getFeed('acme', 'novidades'),
        'DATABASE_ERROR',
      )
    })
  })

  describe('siteNewsletters()', () => {
    it('should skip the database when no id is asked', async () => {
      expect(
        expectOk(await CrmNewsletterArchiveService.siteNewsletters('w', [])),
      ).toEqual({})
      expect(moduleGate).not.toHaveBeenCalled()
    })

    it('should key the live newsletters by id', async () => {
      repo.listForSites.mockResolvedValue(
        ok([createFakeSiteNewsletterRow({ id: 'n1' })]),
      )
      const byId = expectOk(
        await CrmNewsletterArchiveService.siteNewsletters('w', ['n1']),
      )
      expect(repo.listForSites).toHaveBeenCalledWith('w', {
        ids: ['n1'],
        issuesPerNewsletter: 12,
      })
      expect(Object.keys(byId)).toEqual(['n1'])
      expect(byId.n1).not.toHaveProperty('id')
      expect(byId.n1.archiveUrl).toMatch(/\/n\/acme\/novidades$/)
    })

    it('should answer empty when the CRM module is off', async () => {
      moduleGate.mockResolvedValue(err(moduleDisabled()))
      expect(
        expectOk(await CrmNewsletterArchiveService.siteNewsletters('w', ['n'])),
      ).toEqual({})
    })

    it('should propagate module and listing errors', async () => {
      moduleGate.mockResolvedValueOnce(err(databaseError()))
      expectErr(
        await CrmNewsletterArchiveService.siteNewsletters('w', ['n']),
        'DATABASE_ERROR',
      )
      repo.listForSites.mockResolvedValue(err(databaseError()))
      expectErr(
        await CrmNewsletterArchiveService.siteNewsletters('w', ['n']),
        'DATABASE_ERROR',
      )
    })
  })

  describe('listForSiteEditor()', () => {
    it('should list every ACTIVE newsletter for a Sites viewer', async () => {
      sitesGate.mockResolvedValue(ok({} as never))
      repo.listForSites.mockResolvedValue(
        ok([createFakeSiteNewsletterRow({ id: 'n1' })]),
      )
      const list = expectOk(
        await CrmNewsletterArchiveService.listForSiteEditor('u1', 'w'),
      )
      expect(sitesGate).toHaveBeenCalledWith('u1', 'w', 'VIEW')
      expect(repo.listForSites).toHaveBeenCalledWith('w', {
        issuesPerNewsletter: 12,
      })
      expect(list[0].id).toBe('n1')
    })

    it('should deny without the Sites permission', async () => {
      sitesGate.mockResolvedValue(err(forbidden()))
      expectErr(
        await CrmNewsletterArchiveService.listForSiteEditor('u1', 'w'),
        'FORBIDDEN',
      )
      expect(repo.listForSites).not.toHaveBeenCalled()
    })

    it('should propagate a listing error', async () => {
      sitesGate.mockResolvedValue(ok({} as never))
      repo.listForSites.mockResolvedValue(err(databaseError()))
      expectErr(
        await CrmNewsletterArchiveService.listForSiteEditor('u1', 'w'),
        'DATABASE_ERROR',
      )
    })
  })
})
