import type { Role } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeSite } from '@/src/__tests__/factories/site.factory'
import {
  createFakeBlogCategory,
  createFakeBlogTag,
  createFakeSiteAuthor,
} from '@/src/__tests__/factories/site-blog.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { appError } from '@/src/errors/app-error'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/site.repository')
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
import {
  MAX_AUTHORS_PER_SITE,
  MAX_CATEGORIES_PER_SITE,
  MAX_TAGS_PER_SITE,
  SiteBlogTaxonomyService as Svc,
} from '../site-blog-taxonomy.service'

const membership = vi.mocked(MembershipRepository)
const sites = vi.mocked(SiteRepository)
const terms = vi.mocked(SiteBlogTermRepository)
const authors = vi.mocked(SiteAuthorRepository)
const audit = vi.mocked(auditMutation)
const revalidate = vi.mocked(revalidateSites)

const WS = 'ws1'
const SITE = 'site1'
const site = createFakeSite({ id: SITE, workspaceId: WS, slug: 'clinica' })
const category = createFakeBlogCategory({
  id: 'c1',
  siteId: SITE,
  _count: { posts: 3 },
})
const tag = createFakeBlogTag({ id: 't1', siteId: SITE })
const author = createFakeSiteAuthor({ id: 'a1', siteId: SITE })

function asRole(role: Role) {
  membership.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
}

beforeEach(() => {
  asRole('MEMBER')
  sites.findById.mockResolvedValue(ok(site))
  terms.listCategories.mockResolvedValue(ok([category]))
  terms.countCategories.mockResolvedValue(ok(2))
  terms.createCategory.mockImplementation(async (data) =>
    ok(createFakeBlogCategory({ ...data, id: 'c2' })),
  )
  terms.findCategory.mockResolvedValue(ok(category))
  terms.updateCategory.mockResolvedValue(ok({ ...category, name: 'Novo' }))
  terms.deleteCategory.mockResolvedValue(ok(undefined))
  terms.listTags.mockResolvedValue(ok([tag]))
  terms.countTags.mockResolvedValue(ok(0))
  terms.createTag.mockImplementation(async (data) =>
    ok(createFakeBlogTag({ ...data, id: 't2' })),
  )
  terms.findTag.mockResolvedValue(ok(tag))
  terms.updateTag.mockResolvedValue(ok({ ...tag, name: 'novo' }))
  terms.deleteTag.mockResolvedValue(ok(undefined))
  authors.list.mockResolvedValue(ok([author]))
  authors.count.mockResolvedValue(ok(0))
  authors.slugsLike.mockResolvedValue(ok(['ana-souza']))
  authors.create.mockImplementation(async (data) =>
    ok(createFakeSiteAuthor({ ...data, id: 'a2' } as never)),
  )
  authors.findById.mockResolvedValue(ok(author))
  authors.update.mockResolvedValue(ok({ ...author, bio: 'Bio' }))
  authors.delete.mockResolvedValue(ok(undefined))
})

describe('authorization', () => {
  it('blocks viewers from changes and other workspaces from everything', async () => {
    asRole('VIEWER')
    expectOk(await Svc.listCategories('u1', WS, SITE))
    expectOk(await Svc.listTags('u1', WS, SITE))
    expectOk(await Svc.listAuthors('u1', WS, SITE))
    expectErr(
      await Svc.createCategory('u1', WS, SITE, { name: 'X' }),
      'FORBIDDEN',
    )
    expectErr(
      await Svc.updateCategory('u1', WS, SITE, 'c1', { name: 'X' }),
      'FORBIDDEN',
    )
    expectErr(await Svc.removeCategory('u1', WS, SITE, 'c1'), 'FORBIDDEN')
    expectErr(await Svc.createTag('u1', WS, SITE, { name: 'X' }), 'FORBIDDEN')
    expectErr(
      await Svc.updateTag('u1', WS, SITE, 't1', { name: 'X' }),
      'FORBIDDEN',
    )
    expectErr(await Svc.removeTag('u1', WS, SITE, 't1'), 'FORBIDDEN')
    expectErr(
      await Svc.createAuthor('u1', WS, SITE, { name: 'X' }),
      'FORBIDDEN',
    )
    expectErr(
      await Svc.updateAuthor('u1', WS, SITE, 'a1', { name: 'X' }),
      'FORBIDDEN',
    )
    expectErr(await Svc.removeAuthor('u1', WS, SITE, 'a1'), 'FORBIDDEN')
    membership.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(await Svc.listCategories('u1', WS, SITE), 'FORBIDDEN')
    expectErr(await Svc.listTags('u1', WS, SITE), 'FORBIDDEN')
    expectErr(await Svc.listAuthors('u1', WS, SITE), 'FORBIDDEN')
  })
})

describe('categories', () => {
  it('lists, creates, renames and removes', async () => {
    expect(expectOk(await Svc.listCategories('u1', WS, SITE))[0]).toMatchObject(
      { id: 'c1', postCount: 3 },
    )
    const created = expectOk(
      await Svc.createCategory('u1', WS, SITE, { name: 'Notícias da Semana' }),
    )
    expect(terms.createCategory).toHaveBeenCalledWith({
      siteId: SITE,
      name: 'Notícias da Semana',
      slug: 'noticias-da-semana',
      description: null,
      position: 2,
    })
    expect(created.id).toBe('c2')
    expectOk(
      await Svc.createCategory('u1', WS, SITE, {
        name: '!!!',
        slug: 'x',
        description: 'D',
      }),
    )
    expect(terms.createCategory).toHaveBeenLastCalledWith(
      expect.objectContaining({ slug: 'x', description: 'D' }),
    )
    expectOk(await Svc.createCategory('u1', WS, SITE, { name: '!!!' }))
    expect(terms.createCategory).toHaveBeenLastCalledWith(
      expect.objectContaining({ slug: 'categoria' }),
    )
    expectOk(await Svc.updateCategory('u1', WS, SITE, 'c1', { name: 'Novo' }))
    expectOk(await Svc.removeCategory('u1', WS, SITE, 'c1'))
    expect(revalidate).toHaveBeenCalledWith('clinica')
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'site_blog_term', action: 'delete' }),
    )
  })

  it('enforces the limit and propagates errors', async () => {
    terms.countCategories.mockResolvedValueOnce(ok(MAX_CATEGORIES_PER_SITE))
    expectErr(
      await Svc.createCategory('u1', WS, SITE, { name: 'X' }),
      'SITE_LIMIT_REACHED',
    )
    terms.countCategories.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await Svc.createCategory('u1', WS, SITE, { name: 'X' }),
      'DATABASE_ERROR',
    )
    terms.createCategory.mockResolvedValueOnce(
      err(appError('SITE_BLOG_TERM_SLUG_TAKEN', 'x')),
    )
    expectErr(
      await Svc.createCategory('u1', WS, SITE, { name: 'X' }),
      'SITE_BLOG_TERM_SLUG_TAKEN',
    )
    terms.listCategories.mockResolvedValueOnce(err(databaseError()))
    expectErr(await Svc.listCategories('u1', WS, SITE), 'DATABASE_ERROR')
    terms.findCategory.mockResolvedValueOnce(
      err(appError('SITE_BLOG_TERM_NOT_FOUND', 'x')),
    )
    expectErr(
      await Svc.updateCategory('u1', WS, SITE, 'x', { name: 'a' }),
      'SITE_BLOG_TERM_NOT_FOUND',
    )
    terms.updateCategory.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await Svc.updateCategory('u1', WS, SITE, 'c1', { name: 'a' }),
      'DATABASE_ERROR',
    )
    terms.findCategory.mockResolvedValueOnce(
      err(appError('SITE_BLOG_TERM_NOT_FOUND', 'x')),
    )
    expectErr(
      await Svc.removeCategory('u1', WS, SITE, 'x'),
      'SITE_BLOG_TERM_NOT_FOUND',
    )
    terms.deleteCategory.mockResolvedValueOnce(err(databaseError()))
    expectErr(await Svc.removeCategory('u1', WS, SITE, 'c1'), 'DATABASE_ERROR')
  })
})

describe('tags', () => {
  it('lists, creates, renames and removes', async () => {
    expect(expectOk(await Svc.listTags('u1', WS, SITE))).toHaveLength(1)
    expectOk(await Svc.createTag('u1', WS, SITE, { name: 'Marketing Digital' }))
    expect(terms.createTag).toHaveBeenCalledWith({
      siteId: SITE,
      name: 'Marketing Digital',
      slug: 'marketing-digital',
    })
    expectOk(await Svc.createTag('u1', WS, SITE, { name: '#', slug: 'y' }))
    expectOk(await Svc.createTag('u1', WS, SITE, { name: '#' }))
    expect(terms.createTag).toHaveBeenLastCalledWith(
      expect.objectContaining({ slug: 'tag' }),
    )
    expectOk(await Svc.updateTag('u1', WS, SITE, 't1', { name: 'novo' }))
    expectOk(await Svc.removeTag('u1', WS, SITE, 't1'))
    expect(revalidate).toHaveBeenCalledTimes(2)
  })

  it('enforces the limit and propagates errors', async () => {
    terms.countTags.mockResolvedValueOnce(ok(MAX_TAGS_PER_SITE))
    expectErr(
      await Svc.createTag('u1', WS, SITE, { name: 'X' }),
      'SITE_LIMIT_REACHED',
    )
    terms.countTags.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await Svc.createTag('u1', WS, SITE, { name: 'X' }),
      'DATABASE_ERROR',
    )
    terms.createTag.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await Svc.createTag('u1', WS, SITE, { name: 'X' }),
      'DATABASE_ERROR',
    )
    terms.listTags.mockResolvedValueOnce(err(databaseError()))
    expectErr(await Svc.listTags('u1', WS, SITE), 'DATABASE_ERROR')
    terms.findTag.mockResolvedValueOnce(
      err(appError('SITE_BLOG_TERM_NOT_FOUND', 'x')),
    )
    expectErr(
      await Svc.updateTag('u1', WS, SITE, 'x', { name: 'a' }),
      'SITE_BLOG_TERM_NOT_FOUND',
    )
    terms.updateTag.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await Svc.updateTag('u1', WS, SITE, 't1', { name: 'a' }),
      'DATABASE_ERROR',
    )
    terms.findTag.mockResolvedValueOnce(
      err(appError('SITE_BLOG_TERM_NOT_FOUND', 'x')),
    )
    expectErr(
      await Svc.removeTag('u1', WS, SITE, 'x'),
      'SITE_BLOG_TERM_NOT_FOUND',
    )
    terms.deleteTag.mockResolvedValueOnce(err(databaseError()))
    expectErr(await Svc.removeTag('u1', WS, SITE, 't1'), 'DATABASE_ERROR')
  })
})

describe('authors', () => {
  it('creates a guest or member author with a free slug', async () => {
    const created = expectOk(
      await Svc.createAuthor('u1', WS, SITE, { name: 'Ana Souza' }),
    )
    expect(created.id).toBe('a2')
    expect(authors.create).toHaveBeenCalledWith({
      siteId: SITE,
      userId: null,
      name: 'Ana Souza',
      slug: 'ana-souza-2',
      bio: null,
      avatarUrl: null,
      links: [],
    })
    expectOk(
      await Svc.createAuthor('u1', WS, SITE, {
        name: '!!!',
        userId: 'u2',
        slug: 'bia',
        bio: 'B',
        avatarUrl: '/media/a.png',
        links: [{ network: 'x', url: 'https://x.com/bia' }],
      }),
    )
    expect(authors.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ slug: 'bia', userId: 'u2' }),
    )
    authors.slugsLike.mockResolvedValueOnce(ok([]))
    expectOk(await Svc.createAuthor('u1', WS, SITE, { name: '!!!' }))
    expect(authors.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ slug: 'autor' }),
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'site_author', action: 'create' }),
    )
  })

  it('requires the linked user to be a workspace member', async () => {
    membership.findByUserAndWorkspace
      .mockResolvedValueOnce(ok(createFakeMembership({ role: 'MEMBER' })))
      .mockResolvedValueOnce(ok(null))
    expectErr(
      await Svc.createAuthor('u1', WS, SITE, { name: 'X', userId: 'stranger' }),
      'VALIDATION_ERROR',
    )
    membership.findByUserAndWorkspace
      .mockResolvedValueOnce(ok(createFakeMembership({ role: 'MEMBER' })))
      .mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await Svc.createAuthor('u1', WS, SITE, { name: 'X', userId: 'u3' }),
      'DATABASE_ERROR',
    )
    membership.findByUserAndWorkspace
      .mockResolvedValueOnce(ok(createFakeMembership({ role: 'MEMBER' })))
      .mockResolvedValueOnce(ok(null))
    expectErr(
      await Svc.updateAuthor('u1', WS, SITE, 'a1', { userId: 'stranger' }),
      'VALIDATION_ERROR',
    )
    membership.findByUserAndWorkspace
      .mockResolvedValueOnce(ok(createFakeMembership({ role: 'MEMBER' })))
      .mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await Svc.updateAuthor('u1', WS, SITE, 'a1', { userId: 'u3' }),
      'DATABASE_ERROR',
    )
  })

  it('updates and removes authors', async () => {
    expect(expectOk(await Svc.listAuthors('u1', WS, SITE))[0].name).toBe(
      'Ana Souza',
    )
    expectOk(
      await Svc.updateAuthor('u1', WS, SITE, 'a1', {
        bio: 'Bio',
        userId: 'u2',
      }),
    )
    expectOk(await Svc.removeAuthor('u1', WS, SITE, 'a1'))
    expect(revalidate).toHaveBeenCalledTimes(2)
  })

  it('enforces the limit and propagates errors', async () => {
    authors.count.mockResolvedValueOnce(ok(MAX_AUTHORS_PER_SITE))
    expectErr(
      await Svc.createAuthor('u1', WS, SITE, { name: 'X' }),
      'SITE_LIMIT_REACHED',
    )
    authors.count.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await Svc.createAuthor('u1', WS, SITE, { name: 'X' }),
      'DATABASE_ERROR',
    )
    authors.slugsLike.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await Svc.createAuthor('u1', WS, SITE, { name: 'X' }),
      'DATABASE_ERROR',
    )
    authors.create.mockResolvedValueOnce(
      err(appError('SITE_AUTHOR_TAKEN', 'x')),
    )
    expectErr(
      await Svc.createAuthor('u1', WS, SITE, { name: 'X' }),
      'SITE_AUTHOR_TAKEN',
    )
    authors.list.mockResolvedValueOnce(err(databaseError()))
    expectErr(await Svc.listAuthors('u1', WS, SITE), 'DATABASE_ERROR')
    authors.findById.mockResolvedValueOnce(
      err(appError('SITE_AUTHOR_NOT_FOUND', 'x')),
    )
    expectErr(
      await Svc.updateAuthor('u1', WS, SITE, 'x', { name: 'a' }),
      'SITE_AUTHOR_NOT_FOUND',
    )
    authors.update.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await Svc.updateAuthor('u1', WS, SITE, 'a1', { name: 'a' }),
      'DATABASE_ERROR',
    )
    authors.findById.mockResolvedValueOnce(
      err(appError('SITE_AUTHOR_NOT_FOUND', 'x')),
    )
    expectErr(
      await Svc.removeAuthor('u1', WS, SITE, 'x'),
      'SITE_AUTHOR_NOT_FOUND',
    )
    authors.delete.mockResolvedValueOnce(err(databaseError()))
    expectErr(await Svc.removeAuthor('u1', WS, SITE, 'a1'), 'DATABASE_ERROR')
  })
})
