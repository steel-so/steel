import type { Role } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeSite } from '@/src/__tests__/factories/site.factory'
import {
  createFakeBlogCategory,
  createFakeBlogTag,
  createFakeSiteAuthor,
  createFakeSitePost,
} from '@/src/__tests__/factories/site-blog.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { appError } from '@/src/errors/app-error'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/site.repository')
vi.mock('@/src/repositories/site-post.repository')
vi.mock('@/src/repositories/site-blog-term.repository')
vi.mock('@/src/repositories/site-author.repository')
vi.mock('@/src/lib/sites/cache')
vi.mock('@/lib/axiom/audit')

import { auditMutation } from '@/lib/axiom/audit'
import { revalidateSites } from '@/src/lib/sites/cache'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { SiteRepository } from '@/src/repositories/site.repository'
import { SiteAuthorRepository } from '@/src/repositories/site-author.repository'
import { SiteBlogTermRepository } from '@/src/repositories/site-blog-term.repository'
import { SitePostRepository } from '@/src/repositories/site-post.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import {
  MAX_POSTS_PER_SITE,
  renderPostBody,
  SitePostService,
} from '../site-post.service'

const membership = vi.mocked(MembershipRepository)
const sites = vi.mocked(SiteRepository)
const posts = vi.mocked(SitePostRepository)
const terms = vi.mocked(SiteBlogTermRepository)
const authors = vi.mocked(SiteAuthorRepository)
const moduleAccess = vi.mocked(WorkspaceModuleAccessRepository)
const audit = vi.mocked(auditMutation)
const revalidate = vi.mocked(revalidateSites)

const WS = 'ws1'
const SITE = 'site1'
const NOW = new Date('2026-10-15T12:00:00Z')
const site = createFakeSite({ id: SITE, workspaceId: WS, slug: 'clinica' })
const post = createFakeSitePost({ id: 'p1', siteId: SITE, slug: 'ola' })

function asRole(role: Role) {
  membership.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
}

beforeEach(() => {
  asRole('MEMBER')
  sites.findById.mockResolvedValue(ok(site))
  posts.list.mockResolvedValue(ok({ items: [post], total: 1 }))
  posts.findById.mockResolvedValue(ok(post))
  posts.count.mockResolvedValue(ok(0))
  posts.slugsLike.mockResolvedValue(ok([]))
  posts.create.mockImplementation(async (data) =>
    ok(createFakeSitePost({ ...data, id: 'p2' } as never)),
  )
  posts.update.mockImplementation(async (id, data) =>
    ok(createFakeSitePost({ ...post, ...data, id } as never)),
  )
  posts.delete.mockResolvedValue(ok(undefined))
  posts.findManyByIds.mockResolvedValue(ok([post]))
  posts.publishMany.mockResolvedValue(ok(1))
  posts.updateMany.mockResolvedValue(ok(1))
  posts.deleteMany.mockResolvedValue(ok(1))
  posts.setCategory.mockResolvedValue(ok(1))
  terms.countOwned.mockResolvedValue(ok({ categories: 1, tags: 1 }))
  terms.upsertTags.mockResolvedValue(
    ok([createFakeBlogTag({ id: 't-new', slug: 'nova-tag' })]),
  )
  terms.findCategory.mockResolvedValue(
    ok(createFakeBlogCategory({ id: 'c1', siteId: SITE })),
  )
  authors.findById.mockResolvedValue(
    ok(createFakeSiteAuthor({ id: 'a1', siteId: SITE })),
  )
})

describe('SitePostService authorization', () => {
  it('blocks non-members, a disabled module, viewers and other workspaces', async () => {
    membership.findByUserAndWorkspace.mockResolvedValueOnce(ok(null))
    expectErr(
      await SitePostService.list('u1', WS, SITE, { page: 1, pageSize: 20 }),
      'FORBIDDEN',
    )
    moduleAccess.isEnabled.mockResolvedValueOnce(ok(false))
    expectErr(
      await SitePostService.get('u1', WS, SITE, 'p1'),
      'MODULE_DISABLED',
    )

    asRole('VIEWER')
    expectOk(await SitePostService.get('u1', WS, SITE, 'p1'))
    expectErr(
      await SitePostService.create('u1', WS, SITE, { title: 'X' }),
      'FORBIDDEN',
    )
    expectErr(
      await SitePostService.update('u1', WS, SITE, 'p1', { title: 'X' }),
      'FORBIDDEN',
    )
    expectErr(await SitePostService.remove('u1', WS, SITE, 'p1'), 'FORBIDDEN')
    expectErr(
      await SitePostService.bulk('u1', WS, SITE, {
        ids: ['p1'],
        action: 'publish',
      }),
      'FORBIDDEN',
    )

    asRole('MEMBER')
    sites.findById.mockResolvedValueOnce(err(appError('SITE_NOT_FOUND', 'x')))
    expectErr(
      await SitePostService.get('u1', 'other', SITE, 'p1'),
      'SITE_NOT_FOUND',
    )
    expect(posts.create).not.toHaveBeenCalled()
  })
})

describe('SitePostService reads', () => {
  it('lists and gets posts', async () => {
    const page = expectOk(
      await SitePostService.list('u1', WS, SITE, {
        page: 2,
        pageSize: 10,
        status: 'DRAFT',
      }),
    )
    expect(page).toMatchObject({ total: 1, page: 2, pageSize: 10 })
    expect(page.items[0]).toMatchObject({ id: 'p1', path: '/blog/ola' })
    expect(posts.list).toHaveBeenCalledWith(SITE, {
      page: 2,
      pageSize: 10,
      status: 'DRAFT',
    })
    posts.list.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SitePostService.list('u1', WS, SITE, { page: 1, pageSize: 1 }),
      'DATABASE_ERROR',
    )

    expect(
      expectOk(await SitePostService.get('u1', WS, SITE, 'p1')).content,
    ).toEqual(post.content)
    posts.findById.mockResolvedValueOnce(
      err(appError('SITE_POST_NOT_FOUND', 'x')),
    )
    expectErr(
      await SitePostService.get('u1', WS, SITE, 'x'),
      'SITE_POST_NOT_FOUND',
    )
  })
})

describe('SitePostService.create', () => {
  it('creates a draft with a slug from the title and the rendered body', async () => {
    posts.slugsLike.mockResolvedValueOnce(ok(['ola-mundo']))
    const created = expectOk(
      await SitePostService.create(
        'u1',
        WS,
        SITE,
        {
          title: 'Olá mundo',
          content: [
            { type: 'h2', children: [{ text: 'Um' }] },
            { type: 'p', children: [{ text: 'dois três' }] },
          ],
        },
        NOW,
      ),
    )
    expect(created.id).toBe('p2')
    expect(posts.create).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'ola-mundo-2',
        status: 'DRAFT',
        publishedAt: null,
        contentHtml: '<h2 id="um">Um</h2><p>dois três</p>',
        plainText: 'Um\ndois três',
        wordCount: 3,
        readingMinutes: 1,
        featured: false,
        excerpt: null,
        authorId: null,
        createdById: 'u1',
      }),
      { categoryIds: undefined, tagIds: undefined },
    )
    expect(revalidate).not.toHaveBeenCalled()
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'site_post', action: 'create' }),
    )
  })

  it('publishes now, links terms, creates new tags and expires the cache', async () => {
    expectOk(
      await SitePostService.create(
        'u1',
        WS,
        SITE,
        {
          title: '!!!',
          status: 'PUBLISHED',
          authorId: 'a1',
          categoryIds: ['c1', 'c1'],
          tagIds: ['t1'],
          newTags: ['Nova Tag', 'nova tag', '***'],
          featured: true,
          seo: { search: { focusKeyword: 'plano' } },
          coverImageUrl: '/media/a.png',
          coverImageAlt: 'A',
          excerpt: 'Resumo',
        },
        NOW,
      ),
    )
    expect(terms.upsertTags).toHaveBeenCalledWith(SITE, [
      { slug: 'nova-tag', name: 'Nova Tag' },
    ])
    expect(posts.create).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'post',
        status: 'PUBLISHED',
        publishedAt: NOW,
      }),
      { categoryIds: ['c1'], tagIds: ['t1', 't-new'] },
    )
    expect(revalidate).toHaveBeenCalledWith('clinica')
  })

  it('rejects a taken slug, foreign terms or authors and the limit', async () => {
    posts.slugsLike.mockResolvedValueOnce(ok(['ja-existe']))
    expectErr(
      await SitePostService.create('u1', WS, SITE, {
        title: 'X',
        slug: 'ja-existe',
      }),
      'SITE_POST_SLUG_TAKEN',
    )
    terms.countOwned.mockResolvedValueOnce(ok({ categories: 0, tags: 0 }))
    expectErr(
      await SitePostService.create('u1', WS, SITE, {
        title: 'X',
        categoryIds: ['c9'],
      }),
      'SITE_BLOG_TERM_NOT_FOUND',
    )
    authors.findById.mockResolvedValueOnce(
      err(appError('SITE_AUTHOR_NOT_FOUND', 'x')),
    )
    expectErr(
      await SitePostService.create('u1', WS, SITE, {
        title: 'X',
        authorId: 'a9',
      }),
      'SITE_AUTHOR_NOT_FOUND',
    )
    posts.count.mockResolvedValueOnce(ok(MAX_POSTS_PER_SITE))
    expectErr(
      await SitePostService.create('u1', WS, SITE, { title: 'X' }),
      'SITE_LIMIT_REACHED',
    )
    expectErr(
      await SitePostService.create('u1', WS, SITE, {
        title: 'X',
        status: 'SCHEDULED',
      }),
      'VALIDATION_ERROR',
    )
  })

  it('propagates database errors', async () => {
    posts.count.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SitePostService.create('u1', WS, SITE, { title: 'X' }),
      'DATABASE_ERROR',
    )
    terms.countOwned.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SitePostService.create('u1', WS, SITE, {
        title: 'X',
        tagIds: ['t1'],
      }),
      'DATABASE_ERROR',
    )
    terms.upsertTags.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SitePostService.create('u1', WS, SITE, {
        title: 'X',
        newTags: ['a'],
      }),
      'DATABASE_ERROR',
    )
    posts.slugsLike.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SitePostService.create('u1', WS, SITE, { title: 'X' }),
      'DATABASE_ERROR',
    )
    posts.create.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SitePostService.create('u1', WS, SITE, { title: 'X' }),
      'DATABASE_ERROR',
    )
  })
})

describe('SitePostService.update', () => {
  it('updates fields, re-renders the body and keeps drafts out of the cache', async () => {
    expectOk(
      await SitePostService.update(
        'u1',
        WS,
        SITE,
        'p1',
        {
          title: 'Novo',
          slug: 'novo',
          excerpt: null,
          content: [{ type: 'p', children: [{ text: 'a b' }] }],
          coverImageUrl: null,
          coverImageAlt: null,
          authorId: null,
          featured: true,
          seo: {},
          categoryIds: [],
          tagIds: [],
        },
        NOW,
      ),
    )
    expect(posts.update).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({
        title: 'Novo',
        slug: 'novo',
        contentHtml: '<p>a b</p>',
        wordCount: 2,
        updatedById: 'u1',
      }),
      { categoryIds: [], tagIds: [] },
    )
    expect(revalidate).not.toHaveBeenCalled()
  })

  it('publishes, schedules and audits the publication', async () => {
    expectOk(
      await SitePostService.update(
        'u1',
        WS,
        SITE,
        'p1',
        { status: 'PUBLISHED' },
        NOW,
      ),
    )
    expect(posts.update).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ status: 'PUBLISHED', publishedAt: NOW }),
      expect.anything(),
    )
    expect(revalidate).toHaveBeenCalledWith('clinica')
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'publish' }),
    )
    const future = new Date('2026-11-01T00:00:00Z')
    expectOk(
      await SitePostService.update(
        'u1',
        WS,
        SITE,
        'p1',
        { publishedAt: future },
        NOW,
      ),
    )
    expect(posts.update).toHaveBeenLastCalledWith(
      'p1',
      expect.objectContaining({ status: 'DRAFT', publishedAt: future }),
      expect.anything(),
    )
    expectErr(
      await SitePostService.update(
        'u1',
        WS,
        SITE,
        'p1',
        { status: 'SCHEDULED' },
        NOW,
      ),
      'VALIDATION_ERROR',
    )
  })

  it('expires the cache when a live post changes and keeps the same slug', async () => {
    posts.findById.mockResolvedValueOnce(
      ok({ ...post, status: 'PUBLISHED', publishedAt: NOW }),
    )
    expectOk(
      await SitePostService.update('u1', WS, SITE, 'p1', { slug: 'ola' }),
    )
    expect(posts.slugsLike).not.toHaveBeenCalled()
    expect(revalidate).toHaveBeenCalledWith('clinica')
  })

  it('rejects a taken slug and propagates errors', async () => {
    posts.slugsLike.mockResolvedValueOnce(ok(['taken']))
    expectErr(
      await SitePostService.update('u1', WS, SITE, 'p1', { slug: 'taken' }),
      'SITE_POST_SLUG_TAKEN',
    )
    posts.slugsLike.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SitePostService.update('u1', WS, SITE, 'p1', { slug: 'x' }),
      'DATABASE_ERROR',
    )
    posts.findById.mockResolvedValueOnce(
      err(appError('SITE_POST_NOT_FOUND', 'x')),
    )
    expectErr(
      await SitePostService.update('u1', WS, SITE, 'x', { title: 'a' }),
      'SITE_POST_NOT_FOUND',
    )
    terms.countOwned.mockResolvedValueOnce(ok({ categories: 0, tags: 1 }))
    expectErr(
      await SitePostService.update('u1', WS, SITE, 'p1', {
        categoryIds: ['c'],
      }),
      'SITE_BLOG_TERM_NOT_FOUND',
    )
    posts.update.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SitePostService.update('u1', WS, SITE, 'p1', { title: 'a' }),
      'DATABASE_ERROR',
    )
  })
})

describe('SitePostService.remove and bulk', () => {
  it('removes a post (needs DELETE) and expires a live one', async () => {
    expectErr(await SitePostService.remove('u1', WS, SITE, 'p1'), 'FORBIDDEN')
    asRole('ADMIN')
    expectOk(await SitePostService.remove('u1', WS, SITE, 'p1'))
    expect(revalidate).not.toHaveBeenCalled()
    posts.findById.mockResolvedValueOnce(ok({ ...post, status: 'PUBLISHED' }))
    expectOk(await SitePostService.remove('u1', WS, SITE, 'p1'))
    expect(revalidate).toHaveBeenCalledWith('clinica')
    posts.findById.mockResolvedValueOnce(
      err(appError('SITE_POST_NOT_FOUND', 'x')),
    )
    expectErr(
      await SitePostService.remove('u1', WS, SITE, 'x'),
      'SITE_POST_NOT_FOUND',
    )
    posts.delete.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SitePostService.remove('u1', WS, SITE, 'p1'),
      'DATABASE_ERROR',
    )
  })

  it('runs every bulk action on the site posts only', async () => {
    asRole('ADMIN')
    const run = (
      action: Parameters<typeof SitePostService.bulk>[3]['action'],
      categoryId?: string,
    ) =>
      SitePostService.bulk(
        'u1',
        WS,
        SITE,
        { ids: ['p1', 'x'], action, categoryId },
        NOW,
      )
    expect(expectOk(await run('publish'))).toEqual({ affected: 1 })
    expect(posts.publishMany).toHaveBeenCalledWith(SITE, ['p1'], NOW, 'u1')
    expectOk(await run('draft'))
    expect(posts.updateMany).toHaveBeenCalledWith(SITE, ['p1'], {
      status: 'DRAFT',
      updatedById: 'u1',
    })
    expectOk(await run('feature'))
    expect(posts.updateMany).toHaveBeenCalledWith(SITE, ['p1'], {
      featured: true,
      updatedById: 'u1',
    })
    expectOk(await run('unfeature'))
    expect(posts.updateMany).toHaveBeenCalledWith(SITE, ['p1'], {
      featured: false,
      updatedById: 'u1',
    })
    expectOk(await run('delete'))
    expect(posts.deleteMany).toHaveBeenCalledWith(SITE, ['p1'])
    expectOk(await run('addCategory', 'c1'))
    expect(posts.setCategory).toHaveBeenCalledWith(['p1'], 'c1', true)
    expectOk(await run('removeCategory', 'c1'))
    expect(posts.setCategory).toHaveBeenCalledWith(['p1'], 'c1', false)
    expect(revalidate).toHaveBeenCalledWith('clinica')
  })

  it('handles empty selections, foreign categories and errors', async () => {
    posts.findManyByIds.mockResolvedValueOnce(ok([]))
    expect(
      expectOk(
        await SitePostService.bulk('u1', WS, SITE, {
          ids: ['x'],
          action: 'publish',
        }),
      ),
    ).toEqual({ affected: 0 })
    terms.findCategory.mockResolvedValueOnce(
      err(appError('SITE_BLOG_TERM_NOT_FOUND', 'x')),
    )
    expectErr(
      await SitePostService.bulk('u1', WS, SITE, {
        ids: ['p1'],
        action: 'addCategory',
        categoryId: 'c9',
      }),
      'SITE_BLOG_TERM_NOT_FOUND',
    )
    posts.findManyByIds.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SitePostService.bulk('u1', WS, SITE, {
        ids: ['p1'],
        action: 'draft',
      }),
      'DATABASE_ERROR',
    )
    posts.updateMany.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SitePostService.bulk('u1', WS, SITE, {
        ids: ['p1'],
        action: 'draft',
      }),
      'DATABASE_ERROR',
    )
    expectErr(
      await SitePostService.bulk('u1', WS, SITE, {
        ids: ['p1'],
        action: 'delete',
      }),
      'FORBIDDEN',
    )
  })
})

describe('renderPostBody', () => {
  it('renders HTML, text, auto excerpt and reading time', () => {
    expect(renderPostBody([{ type: 'p', children: [{ text: 'Oi' }] }])).toEqual(
      {
        contentHtml: '<p>Oi</p>',
        plainText: 'Oi',
        autoExcerpt: 'Oi',
        wordCount: 1,
        readingMinutes: 1,
      },
    )
  })
})
