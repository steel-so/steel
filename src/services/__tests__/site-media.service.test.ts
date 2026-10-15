import type { Role } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { storageError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/lib/axiom/audit')
vi.mock('@/lib/axiom/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))
vi.mock('@/src/lib/storage/s3', () => ({
  listObjects: vi.fn(),
  deleteObject: vi.fn(),
}))
vi.mock('../media/_media', async (original) => ({
  ...(await original<typeof import('../media/_media')>()),
  persistObject: vi.fn(),
}))

import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { deleteObject, listObjects } from '@/src/lib/storage/s3'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { persistObject } from '../media/_media'
import {
  SITE_MEDIA_BUCKET,
  SITE_MEDIA_LIST_LIMIT,
  SiteMediaService,
} from '../site-media.service'

const membership = vi.mocked(MembershipRepository)
const list = vi.mocked(listObjects)
const remove = vi.mocked(deleteObject)
const persist = vi.mocked(persistObject)
const audit = vi.mocked(auditMutation)

const WS = 'ws1'

function asRole(role: Role) {
  membership.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
}

beforeEach(() => {
  asRole('MEMBER')
})

describe('SiteMediaService.list', () => {
  it('merges site and landing images, newest first', async () => {
    list.mockImplementation(async (bucket) =>
      bucket === SITE_MEDIA_BUCKET
        ? [
            {
              key: 'ws1/a.png',
              size: 10,
              lastModified: new Date('2026-10-01T00:00:00Z'),
            },
            { key: 'ws1/b.png', size: 5 },
          ]
        : [
            {
              key: 'ws1/c.jpg',
              size: 7,
              lastModified: new Date('2026-10-05T00:00:00Z'),
            },
          ],
    )
    const items = expectOk(await SiteMediaService.list('u1', WS))
    expect(items.map((item) => [item.id, item.source])).toEqual([
      ['c.jpg', 'landing'],
      ['a.png', 'site'],
      ['b.png', 'site'],
    ])
    expect(items[1].url).toMatch(/\/site-media\/ws1\/a\.png$/)
    expect(items[0].url).toMatch(/\/crm-landing-page-images\/ws1\/c\.jpg$/)
    expect(items[2].uploadedAt).toBeNull()
    expect(list).toHaveBeenCalledWith(SITE_MEDIA_BUCKET, 'ws1/')
  })

  it('caps the listing', async () => {
    list.mockImplementation(async (bucket) =>
      bucket === SITE_MEDIA_BUCKET
        ? Array.from({ length: SITE_MEDIA_LIST_LIMIT + 5 }, (_, index) => ({
            key: `ws1/${index}.png`,
            size: 1,
          }))
        : [],
    )
    expect(expectOk(await SiteMediaService.list('u1', WS))).toHaveLength(
      SITE_MEDIA_LIST_LIMIT,
    )
  })

  it('maps storage failures and refuses non-members', async () => {
    list.mockRejectedValueOnce(new Error('down'))
    expectErr(await SiteMediaService.list('u1', WS), 'STORAGE_ERROR')
    list.mockRejectedValueOnce('down')
    expectErr(await SiteMediaService.list('u1', WS), 'STORAGE_ERROR')
    expect(logger.error).toHaveBeenCalled()
    membership.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(await SiteMediaService.list('u1', WS), 'FORBIDDEN')
  })
})

describe('SiteMediaService.upload', () => {
  const input = (contentType = 'image/png', byteSize = 4) => ({
    contentType,
    byteSize,
    readBody: async () => Buffer.from('test'),
  })

  it('stores the image under the workspace and audits it', async () => {
    persist.mockResolvedValueOnce(ok('https://cdn/site-media/ws1/x.png'))
    const item = expectOk(await SiteMediaService.upload('u1', WS, input()))
    expect(item).toMatchObject({
      url: 'https://cdn/site-media/ws1/x.png',
      size: 4,
      source: 'site',
    })
    expect(item.id).toMatch(/\.png$/)
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: SITE_MEDIA_BUCKET,
        key: expect.stringMatching(/^ws1\/.+\.png$/),
      }),
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'site_media', action: 'upload' }),
    )
  })

  it('validates the file and propagates storage errors', async () => {
    expectErr(
      await SiteMediaService.upload('u1', WS, input('image/gif')),
      'VALIDATION_ERROR',
    )
    persist.mockResolvedValueOnce(err(storageError('x')))
    expectErr(await SiteMediaService.upload('u1', WS, input()), 'STORAGE_ERROR')
    asRole('VIEWER')
    expectErr(await SiteMediaService.upload('u1', WS, input()), 'FORBIDDEN')
  })
})

describe('SiteMediaService.remove', () => {
  it('deletes inside the workspace folder', async () => {
    remove.mockResolvedValueOnce(undefined)
    expectOk(await SiteMediaService.remove('u1', WS, 'a.png'))
    expect(remove).toHaveBeenCalledWith({
      bucket: SITE_MEDIA_BUCKET,
      key: 'ws1/a.png',
    })
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'site_media', action: 'delete' }),
    )
  })

  it('maps failures and refuses viewers', async () => {
    remove.mockRejectedValueOnce(new Error('down'))
    expectErr(await SiteMediaService.remove('u1', WS, 'a.png'), 'STORAGE_ERROR')
    remove.mockRejectedValueOnce('down')
    expectErr(await SiteMediaService.remove('u1', WS, 'a.png'), 'STORAGE_ERROR')
    asRole('VIEWER')
    expectErr(await SiteMediaService.remove('u1', WS, 'a.png'), 'FORBIDDEN')
  })
})
