import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  seedArchiveIssue,
  seedArchiveNewsletter,
} from '@/src/__tests__/factories/newsletter-archive.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { CrmNewsletterArchiveRepository } from '../crm-newsletter-archive.repository'

async function setup() {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  const newsletter = await seedArchiveNewsletter(workspace.id, user.id)
  return { workspace, user, newsletter }
}

afterEach(() => vi.restoreAllMocks())

describe('CrmNewsletterArchiveRepository', () => {
  describe('findPublicNewsletter()', () => {
    it('should return the newsletter with workspace and brand', async () => {
      const { workspace, newsletter } = await setup()
      await prisma.crmEmailBrand.create({
        data: {
          workspaceId: workspace.id,
          companyName: 'Acme',
          primaryColor: '#112233',
          logoUrl: 'https://cdn.acme.com/l.png',
        },
      })

      const row = expectOk(
        await CrmNewsletterArchiveRepository.findPublicNewsletter(
          workspace.slug,
          newsletter.slug,
        ),
      )
      expect(row.id).toBe(newsletter.id)
      expect(row.workspace.slug).toBe(workspace.slug)
      expect(row.workspace.crmEmailBrand?.primaryColor).toBe('#112233')
    })

    it('should hide archived, archive-off, deleted and suspended-workspace newsletters', async () => {
      const [user, suspended] = await Promise.all([
        seedUser(),
        seedWorkspace({ status: 'SUSPENDED' }),
      ])
      const workspace = await seedWorkspace()
      const archived = await seedArchiveNewsletter(workspace.id, user.id, {
        status: 'ARCHIVED',
      })
      const off = await seedArchiveNewsletter(workspace.id, user.id, {
        archiveEnabled: false,
      })
      const deleted = await seedArchiveNewsletter(workspace.id, user.id, {
        deletedAt: new Date(),
      })
      const ofSuspended = await seedArchiveNewsletter(suspended.id, user.id)

      for (const [ws, slug] of [
        [workspace.slug, archived.slug],
        [workspace.slug, off.slug],
        [workspace.slug, deleted.slug],
        [suspended.slug, ofSuspended.slug],
        ['other-ws', archived.slug],
      ]) {
        expectErr(
          await CrmNewsletterArchiveRepository.findPublicNewsletter(ws, slug),
          'CRM_NEWSLETTER_NOT_FOUND',
        )
      }
    })

    it('should map a database failure to DATABASE_ERROR', async () => {
      vi.spyOn(prisma.crmNewsletter, 'findFirst').mockRejectedValueOnce(
        new Error('boom'),
      )
      expectErr(
        await CrmNewsletterArchiveRepository.findPublicNewsletter('a', 'b'),
        'DATABASE_ERROR',
      )
    })
  })

  describe('listSentIssues()', () => {
    it('should page SENT issues newest first and count them', async () => {
      const { newsletter } = await setup()
      const older = await seedArchiveIssue(newsletter, {
        number: 1,
        sentAt: new Date('2026-08-01T12:00:00Z'),
      })
      const newer = await seedArchiveIssue(newsletter, {
        number: 2,
        sentAt: new Date('2026-09-01T12:00:00Z'),
      })
      await seedArchiveIssue(newsletter, {
        number: 3,
        sentAt: new Date('2026-10-01T12:00:00Z'),
        deletedAt: new Date(),
      })
      await seedArchiveIssue(newsletter, {
        status: 'DRAFT',
        sentAt: null,
        number: null,
      })
      await seedArchiveIssue(newsletter, { status: 'SENDING', number: 4 })

      const first = expectOk(
        await CrmNewsletterArchiveRepository.listSentIssues(newsletter.id, {
          skip: 0,
          take: 1,
        }),
      )
      expect(first.total).toBe(2)
      expect(first.items.map((i) => i.slug)).toEqual([newer.slug])

      const second = expectOk(
        await CrmNewsletterArchiveRepository.listSentIssues(newsletter.id, {
          skip: 1,
          take: 1,
        }),
      )
      expect(second.items.map((i) => i.slug)).toEqual([older.slug])
    })

    it('should map a database failure to DATABASE_ERROR', async () => {
      vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('x'))
      expectErr(
        await CrmNewsletterArchiveRepository.listSentIssues('n', {
          skip: 0,
          take: 1,
        }),
        'DATABASE_ERROR',
      )
    })
  })

  describe('findSentIssue()', () => {
    it('should return a SENT issue with its web HTML', async () => {
      const { newsletter } = await setup()
      const issue = await seedArchiveIssue(newsletter, {
        number: 1,
        preheader: 'Prévia',
      })
      const row = expectOk(
        await CrmNewsletterArchiveRepository.findSentIssue(
          newsletter.id,
          issue.slug,
        ),
      )
      expect(row.webHtml).toContain('Olá')
      expect(row.preheader).toBe('Prévia')
    })

    it('should not return drafts or issues of another newsletter', async () => {
      const { newsletter, workspace, user } = await setup()
      const draft = await seedArchiveIssue(newsletter, {
        status: 'DRAFT',
        number: null,
        sentAt: null,
      })
      const other = await seedArchiveNewsletter(workspace.id, user.id)
      const sentElsewhere = await seedArchiveIssue(other, { number: 1 })

      expectErr(
        await CrmNewsletterArchiveRepository.findSentIssue(
          newsletter.id,
          draft.slug,
        ),
        'CRM_NEWSLETTER_ISSUE_NOT_FOUND',
      )
      expectErr(
        await CrmNewsletterArchiveRepository.findSentIssue(
          newsletter.id,
          sentElsewhere.slug,
        ),
        'CRM_NEWSLETTER_ISSUE_NOT_FOUND',
      )
    })

    it('should map a database failure to DATABASE_ERROR', async () => {
      vi.spyOn(prisma.crmNewsletterIssue, 'findFirst').mockRejectedValueOnce(
        new Error('x'),
      )
      expectErr(
        await CrmNewsletterArchiveRepository.findSentIssue('n', 's'),
        'DATABASE_ERROR',
      )
    })
  })

  describe('findAdjacentIssues()', () => {
    it('should return the closest older and newer SENT issues', async () => {
      const { newsletter } = await setup()
      const first = await seedArchiveIssue(newsletter, { number: 1 })
      await seedArchiveIssue(newsletter, { number: 2 })
      const third = await seedArchiveIssue(newsletter, { number: 3 })
      await seedArchiveIssue(newsletter, { number: 5, deletedAt: new Date() })

      const middle = expectOk(
        await CrmNewsletterArchiveRepository.findAdjacentIssues(
          newsletter.id,
          2,
        ),
      )
      expect(middle.previous?.slug).toBe(first.slug)
      expect(middle.next?.slug).toBe(third.slug)

      const last = expectOk(
        await CrmNewsletterArchiveRepository.findAdjacentIssues(
          newsletter.id,
          3,
        ),
      )
      expect(last.next).toBeNull()
    })

    it('should map a database failure to DATABASE_ERROR', async () => {
      vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('x'))
      expectErr(
        await CrmNewsletterArchiveRepository.findAdjacentIssues('n', 1),
        'DATABASE_ERROR',
      )
    })
  })

  describe('listForSites()', () => {
    it('should list ACTIVE newsletters with their latest SENT issues', async () => {
      const { workspace, user, newsletter } = await setup()
      await seedArchiveNewsletter(workspace.id, user.id, { status: 'ARCHIVED' })
      const other = await seedArchiveNewsletter(workspace.id, user.id, {
        name: 'Zeta',
      })
      await seedArchiveIssue(newsletter, { number: 1 })
      const latest = await seedArchiveIssue(newsletter, {
        number: 2,
        sentAt: new Date('2026-10-20T12:00:00Z'),
      })

      const all = expectOk(
        await CrmNewsletterArchiveRepository.listForSites(workspace.id, {
          issuesPerNewsletter: 1,
        }),
      )
      expect(all.map((row) => row.id)).toEqual([newsletter.id, other.id])
      expect(all[0].issues.map((i) => i.slug)).toEqual([latest.slug])

      const picked = expectOk(
        await CrmNewsletterArchiveRepository.listForSites(workspace.id, {
          ids: [other.id],
          issuesPerNewsletter: 5,
        }),
      )
      expect(picked.map((row) => row.id)).toEqual([other.id])
    })

    it('should map a database failure to DATABASE_ERROR', async () => {
      vi.spyOn(prisma.crmNewsletter, 'findMany').mockRejectedValueOnce(
        new Error('x'),
      )
      expectErr(
        await CrmNewsletterArchiveRepository.listForSites('w', {
          issuesPerNewsletter: 1,
        }),
        'DATABASE_ERROR',
      )
    })
  })
})
