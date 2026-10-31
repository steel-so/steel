import type { CrmScheduledPostStatus, Role } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeCrmScheduledPost,
  createFakeCrmScheduledPostTarget,
} from '@/src/__tests__/factories/crm-social.factory'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, notFound } from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import type { CrmScheduledPostWithRelations } from '@/src/repositories/crm-social.repository'
import type { CreateCrmScheduledPostDTO } from '@/src/schemas/crm-social.schema'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/crm-social.repository')
vi.mock('@/src/services/feature-flag.service')
vi.mock('@/lib/axiom/audit', () => ({
  auditMutation: vi.fn(),
  auditAuth: vi.fn(),
  auditAccess: vi.fn(),
}))
vi.mock('@/src/lib/storage/s3', () => ({
  ensureBucket: vi.fn(async () => undefined),
  putObject: vi.fn(async () => undefined),
}))
vi.mock('../crm-social-scheduler', () => ({
  CRM_SCHEDULED_POST_BUCKET: 'crm-scheduled-posts',
  publishScheduledPost: vi.fn(async () => undefined),
}))

import { auditMutation } from '@/lib/axiom/audit'
import { ensureBucket, putObject } from '@/src/lib/storage/s3'
import {
  CrmScheduledPostMediaRepository,
  CrmScheduledPostRepository,
  CrmScheduledPostTargetRepository,
} from '@/src/repositories/crm-social.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { CrmScheduledPostService } from '../crm-social.service'
import { publishScheduledPost } from '../crm-social-scheduler'
import { assertFeature } from '../feature-flag.service'

const mockedPostRepo = vi.mocked(CrmScheduledPostRepository)
const mockedTargetRepo = vi.mocked(CrmScheduledPostTargetRepository)
const mockedMediaRepo = vi.mocked(CrmScheduledPostMediaRepository)
const mockedPublish = vi.mocked(publishScheduledPost)
const mockedAudit = vi.mocked(auditMutation)

function asMember(role: Role = 'MEMBER') {
  vi.mocked(MembershipRepository.findByUserAndWorkspace).mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
}

function withRelations(
  overrides: Partial<CrmScheduledPostWithRelations> = {},
): CrmScheduledPostWithRelations {
  return {
    ...createFakeCrmScheduledPost({ id: 'p1', workspaceId: 'ws1' }),
    targets: [createFakeCrmScheduledPostTarget({ postId: 'p1' })],
    media: [],
    ...overrides,
  }
}

function dto(
  overrides: Partial<CreateCrmScheduledPostDTO> = {},
): CreateCrmScheduledPostDTO {
  return {
    platforms: ['FACEBOOK'],
    content: 'Novidade!',
    mode: 'schedule',
    scheduledFor: new Date('2026-10-01T12:00:00Z'),
    options: {},
    ...overrides,
  }
}

const IMAGE = {
  kind: 'IMAGE' as const,
  bytes: new Uint8Array([1, 2, 3]).buffer,
  contentType: 'image/png',
}
const VIDEO = {
  kind: 'VIDEO' as const,
  bytes: new Uint8Array([4, 5]).buffer,
  contentType: 'video/mp4',
}

beforeEach(() => {
  asMember('MEMBER')
  vi.mocked(assertFeature).mockResolvedValue(ok(true))
})

describe('CrmScheduledPostService.list()', () => {
  it('should map the workspace posts to DTOs', async () => {
    asMember('VIEWER')
    mockedPostRepo.listByWorkspace.mockResolvedValue(ok([withRelations()]))

    const [post] = expectOk(await CrmScheduledPostService.list('u1', 'ws1'))

    expect(post.id).toBe('p1')
    expect(post.targets).toHaveLength(1)
    expect(mockedPostRepo.listByWorkspace).toHaveBeenCalledWith('ws1')
  })

  it('should propagate a repository error', async () => {
    mockedPostRepo.listByWorkspace.mockResolvedValue(err(databaseError()))
    expectErr(await CrmScheduledPostService.list('u1', 'ws1'), 'DATABASE_ERROR')
  })

  it('should return FORBIDDEN for a non-member', async () => {
    vi.mocked(MembershipRepository.findByUserAndWorkspace).mockResolvedValue(
      ok(null),
    )
    expectErr(await CrmScheduledPostService.list('x', 'ws1'), 'FORBIDDEN')
  })
})

describe('CrmScheduledPostService.getById()', () => {
  it('should return the post scoped to the workspace', async () => {
    mockedPostRepo.findById.mockResolvedValue(ok(withRelations()))

    expect(
      expectOk(await CrmScheduledPostService.getById('u1', 'ws1', 'p1')).id,
    ).toBe('p1')
    expect(mockedPostRepo.findById).toHaveBeenCalledWith('p1', 'ws1')
  })

  it('should propagate CRM_SCHEDULED_POST_NOT_FOUND', async () => {
    mockedPostRepo.findById.mockResolvedValue(
      err({ code: 'CRM_SCHEDULED_POST_NOT_FOUND', message: 'x' }),
    )
    expectErr(
      await CrmScheduledPostService.getById('u1', 'ws1', 'nope'),
      'CRM_SCHEDULED_POST_NOT_FOUND',
    )
  })
})

describe('CrmScheduledPostService.create()', () => {
  beforeEach(() => {
    mockedPostRepo.create.mockResolvedValue(
      ok(createFakeCrmScheduledPost({ id: 'p1' })),
    )
    mockedTargetRepo.createMany.mockResolvedValue(ok(undefined as never))
    mockedMediaRepo.createMany.mockResolvedValue(ok(undefined as never))
    mockedPostRepo.findById.mockResolvedValue(ok(withRelations()))
  })

  describe('platform requirements', () => {
    it.each([
      [
        'an Instagram FEED without an image',
        dto({ platforms: ['INSTAGRAM'] }),
        [VIDEO],
        'Publicação no Instagram exige uma imagem.',
      ],
      [
        'Instagram REELS without a video',
        dto({
          platforms: ['INSTAGRAM'],
          options: { instagram: { postType: 'REELS' } },
        }),
        [IMAGE],
        'Reels do Instagram exige um vídeo.',
      ],
      [
        'Instagram STORIES without media',
        dto({
          platforms: ['INSTAGRAM'],
          options: { instagram: { postType: 'STORIES' } },
        }),
        [],
        'Stories do Instagram exige uma imagem ou vídeo.',
      ],
      [
        'an Instagram caption over 2200 chars',
        dto({ platforms: ['INSTAGRAM'], content: 'a'.repeat(2201) }),
        [IMAGE],
        'O texto excede o limite de 2200 caracteres do INSTAGRAM.',
      ],
      [
        'TikTok without a video',
        dto({ platforms: ['TIKTOK'] }),
        [IMAGE],
        'TIKTOK exige um vídeo.',
      ],
      [
        'a Facebook post over 5000 chars',
        dto({ platforms: ['FACEBOOK'], content: 'a'.repeat(5001) }),
        [],
        'O texto excede o limite de 5000 caracteres do FACEBOOK.',
      ],
      [
        'an empty Facebook post without media',
        dto({ platforms: ['FACEBOOK'], content: '' }),
        [],
        'Facebook exige um texto, uma imagem ou um vídeo.',
      ],
      [
        'a YouTube video without title nor text',
        dto({ platforms: ['YOUTUBE'], content: ' ', title: '   ' }),
        [VIDEO],
        'YouTube exige um título (ou ao menos um texto para usar como título).',
      ],
    ])('should reject %s', async (_, input, media, message) => {
      const error = expectErr(
        await CrmScheduledPostService.create('u1', 'ws1', input, media),
        'CRM_SCHEDULED_POST_INVALID',
      )
      expect(error.message).toBe(message)
      expect(ensureBucket).not.toHaveBeenCalled()
      expect(mockedPostRepo.create).not.toHaveBeenCalled()
    })

    it.each([
      ['an image-only Facebook post', dto({ content: '' }), [IMAGE]],
      ['a video-only Facebook post', dto({ content: '' }), [VIDEO]],
      [
        'Instagram STORIES with a video',
        dto({
          platforms: ['INSTAGRAM'],
          options: { instagram: { postType: 'STORIES' } },
        }),
        [VIDEO],
      ],
      [
        'a YouTube video titled but without text',
        dto({ platforms: ['YOUTUBE'], content: '', title: 'Título' }),
        [VIDEO],
      ],
      [
        'every platform at once',
        dto({
          platforms: [
            'INSTAGRAM',
            'FACEBOOK',
            'TIKTOK',
            'YOUTUBE',
          ],
        }),
        [IMAGE, VIDEO],
      ],
    ])('should accept %s', async (_, input, media) => {
      expectOk(await CrmScheduledPostService.create('u1', 'ws1', input, media))
    })
  })

  it('should schedule a text post without touching storage', async () => {
    const scheduledFor = new Date('2026-10-01T12:00:00Z')

    const result = expectOk(
      await CrmScheduledPostService.create(
        'u1',
        'ws1',
        dto({ title: '  Meu título  ', scheduledFor }),
      ),
    )

    expect(result.id).toBe('p1')
    expect(mockedPostRepo.create).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      createdById: 'u1',
      content: 'Novidade!',
      title: 'Meu título',
      options: {},
      status: 'SCHEDULED',
      scheduledFor,
    })
    expect(mockedTargetRepo.createMany).toHaveBeenCalledWith('p1', ['FACEBOOK'])
    expect(ensureBucket).not.toHaveBeenCalled()
    expect(mockedMediaRepo.createMany).not.toHaveBeenCalled()
    expect(mockedPublish).not.toHaveBeenCalled()
    expect(mockedAudit).toHaveBeenCalledWith({
      entity: 'crm_scheduled_post',
      action: 'create',
      actorId: 'u1',
      targetId: 'p1',
      meta: { platforms: ['FACEBOOK'], mode: 'schedule' },
    })
  })

  it('should drop a blank title', async () => {
    expectOk(
      await CrmScheduledPostService.create('u1', 'ws1', dto({ title: '   ' })),
    )
    expect(mockedPostRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: undefined }),
    )
  })

  it('should upload each media to MinIO under the workspace prefix and record it', async () => {
    const weird = {
      kind: 'IMAGE' as const,
      bytes: new Uint8Array([9]).buffer,
      contentType: 'octet',
    }

    expectOk(
      await CrmScheduledPostService.create('u1', 'ws1', dto(), [
        IMAGE,
        VIDEO,
        weird,
      ]),
    )

    expect(ensureBucket).toHaveBeenCalledWith('crm-scheduled-posts')
    const puts = vi.mocked(putObject).mock.calls.map(([input]) => input)
    expect(puts).toHaveLength(3)
    expect(puts[0].key).toMatch(/^ws1\/scheduled\/[0-9a-f]{32}\.png$/)
    expect(puts[1].key).toMatch(/\.mp4$/)
    expect(puts[2].key).toMatch(/\.bin$/)
    expect(puts[0]).toMatchObject({
      bucket: 'crm-scheduled-posts',
      contentType: 'image/png',
    })
    expect([...(puts[0].body as Buffer)]).toEqual([1, 2, 3])
    expect(mockedMediaRepo.createMany).toHaveBeenCalledWith('p1', [
      {
        kind: 'IMAGE',
        storageKey: puts[0].key,
        contentType: 'image/png',
        sizeBytes: 3,
        order: 0,
      },
      {
        kind: 'VIDEO',
        storageKey: puts[1].key,
        contentType: 'video/mp4',
        sizeBytes: 2,
        order: 1,
      },
      {
        kind: 'IMAGE',
        storageKey: puts[2].key,
        contentType: 'octet',
        sizeBytes: 1,
        order: 2,
      },
    ])
  })

  it('should publish right away in "now" mode', async () => {
    const reloaded = withRelations({ status: 'PUBLISHING' })
    const final = withRelations({ status: 'PUBLISHED' })
    mockedPostRepo.findById
      .mockResolvedValueOnce(ok(reloaded))
      .mockResolvedValueOnce(ok(final))

    const result = expectOk(
      await CrmScheduledPostService.create(
        'u1',
        'ws1',
        dto({ mode: 'now', scheduledFor: undefined }),
      ),
    )

    expect(result.status).toBe('PUBLISHED')
    expect(mockedPostRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'PUBLISHING',
        scheduledFor: expect.any(Date),
      }),
    )
    expect(mockedPublish).toHaveBeenCalledWith(reloaded)
  })

  it('should not publish when the reload fails in "now" mode', async () => {
    mockedPostRepo.findById.mockResolvedValueOnce(err(databaseError()))

    expectErr(
      await CrmScheduledPostService.create('u1', 'ws1', dto({ mode: 'now' })),
      'DATABASE_ERROR',
    )
    expect(mockedPublish).not.toHaveBeenCalled()
  })

  it.each([
    [
      'the post insert',
      () => mockedPostRepo.create.mockResolvedValue(err(databaseError())),
    ],
    [
      'the targets insert',
      () => mockedTargetRepo.createMany.mockResolvedValue(err(databaseError())),
    ],
    [
      'the media insert',
      () => mockedMediaRepo.createMany.mockResolvedValue(err(databaseError())),
    ],
    [
      'the final reload',
      () => mockedPostRepo.findById.mockResolvedValue(err(databaseError())),
    ],
  ])('should propagate a failure in %s', async (_, arrange) => {
    arrange()
    expectErr(
      await CrmScheduledPostService.create('u1', 'ws1', dto(), [IMAGE]),
      'DATABASE_ERROR',
    )
  })

  it('should return FORBIDDEN for a VIEWER', async () => {
    asMember('VIEWER')
    expectErr(
      await CrmScheduledPostService.create('u1', 'ws1', dto()),
      'FORBIDDEN',
    )
    expect(assertFeature).not.toHaveBeenCalled()
  })
})

describe('CrmScheduledPostService.update()', () => {
  const changes = { content: 'Novo texto', title: 'T' }

  it.each(['PUBLISHED', 'PUBLISHING'] as CrmScheduledPostStatus[])(
    'should refuse to edit a %s post',
    async (status) => {
      mockedPostRepo.findById.mockResolvedValue(ok(withRelations({ status })))
      expectErr(
        await CrmScheduledPostService.update('u1', 'ws1', 'p1', changes),
        'CRM_SCHEDULED_POST_ALREADY_PUBLISHED',
      )
      expect(mockedPostRepo.update).not.toHaveBeenCalled()
    },
  )

  it('should update a scheduled post and audit the changed fields', async () => {
    mockedPostRepo.findById.mockResolvedValue(
      ok(withRelations({ status: 'SCHEDULED' })),
    )
    mockedPostRepo.update.mockResolvedValue(
      ok(withRelations({ content: 'Novo texto' })),
    )

    const result = expectOk(
      await CrmScheduledPostService.update('u1', 'ws1', 'p1', changes),
    )

    expect(result.content).toBe('Novo texto')
    expect(mockedPostRepo.update).toHaveBeenCalledWith('p1', {
      content: 'Novo texto',
      title: 'T',
      scheduledFor: undefined,
    })
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'update',
        meta: { fields: ['content', 'title'] },
      }),
    )
  })

  it('should propagate a lookup error', async () => {
    mockedPostRepo.findById.mockResolvedValue(err(notFound('Post')))
    expectErr(
      await CrmScheduledPostService.update('u1', 'ws1', 'p1', changes),
      'RESOURCE_NOT_FOUND',
    )
  })

  it('should propagate an update error', async () => {
    mockedPostRepo.findById.mockResolvedValue(ok(withRelations()))
    mockedPostRepo.update.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmScheduledPostService.update('u1', 'ws1', 'p1', changes),
      'DATABASE_ERROR',
    )
  })

  it('should return FORBIDDEN for a VIEWER', async () => {
    asMember('VIEWER')
    expectErr(
      await CrmScheduledPostService.update('u1', 'ws1', 'p1', changes),
      'FORBIDDEN',
    )
  })
})

describe('CrmScheduledPostService.remove()', () => {
  beforeEach(() => {
    asMember('OWNER')
  })

  it('should soft delete the post and audit it', async () => {
    mockedPostRepo.findById.mockResolvedValue(ok(withRelations()))
    mockedPostRepo.softDelete.mockResolvedValue(ok(undefined as never))

    expectOk(await CrmScheduledPostService.remove('u1', 'ws1', 'p1'))

    expect(mockedPostRepo.softDelete).toHaveBeenCalledWith('p1')
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'delete', targetId: 'p1' }),
    )
  })

  it('should propagate a lookup error', async () => {
    mockedPostRepo.findById.mockResolvedValue(err(notFound('Post')))
    expectErr(
      await CrmScheduledPostService.remove('u1', 'ws1', 'p1'),
      'RESOURCE_NOT_FOUND',
    )
    expect(mockedPostRepo.softDelete).not.toHaveBeenCalled()
  })

  it('should propagate a delete error', async () => {
    mockedPostRepo.findById.mockResolvedValue(ok(withRelations()))
    mockedPostRepo.softDelete.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmScheduledPostService.remove('u1', 'ws1', 'p1'),
      'DATABASE_ERROR',
    )
  })

  it('should return FORBIDDEN for a MEMBER (no DELETE on social)', async () => {
    asMember('MEMBER')
    expectErr(
      await CrmScheduledPostService.remove('u1', 'ws1', 'p1'),
      'FORBIDDEN',
    )
  })
})

describe('CrmScheduledPostService.cancel()', () => {
  it.each([
    'SCHEDULED',
    'FAILED',
    'PARTIALLY_FAILED',
  ] as CrmScheduledPostStatus[])('should cancel a %s post', async (status) => {
    mockedPostRepo.findById
      .mockResolvedValueOnce(ok(withRelations({ status })))
      .mockResolvedValueOnce(ok(withRelations({ status: 'CANCELED' })))
    mockedPostRepo.cancel.mockResolvedValue(ok(undefined as never))

    expect(
      expectOk(await CrmScheduledPostService.cancel('u1', 'ws1', 'p1')).status,
    ).toBe('CANCELED')
    expect(mockedPostRepo.cancel).toHaveBeenCalledWith('p1')
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({ meta: { canceled: true } }),
    )
  })

  it.each([
    'DRAFT',
    'PUBLISHED',
    'PUBLISHING',
    'CANCELED',
  ] as CrmScheduledPostStatus[])(
    'should refuse to cancel a %s post',
    async (status) => {
      mockedPostRepo.findById.mockResolvedValue(ok(withRelations({ status })))
      expectErr(
        await CrmScheduledPostService.cancel('u1', 'ws1', 'p1'),
        'CRM_SCHEDULED_POST_INVALID',
      )
      expect(mockedPostRepo.cancel).not.toHaveBeenCalled()
    },
  )

  it('should propagate a lookup error', async () => {
    mockedPostRepo.findById.mockResolvedValue(err(notFound('Post')))
    expectErr(
      await CrmScheduledPostService.cancel('u1', 'ws1', 'p1'),
      'RESOURCE_NOT_FOUND',
    )
  })

  it('should propagate a cancel error', async () => {
    mockedPostRepo.findById.mockResolvedValue(
      ok(withRelations({ status: 'SCHEDULED' })),
    )
    mockedPostRepo.cancel.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmScheduledPostService.cancel('u1', 'ws1', 'p1'),
      'DATABASE_ERROR',
    )
  })

  it('should propagate a reload error', async () => {
    mockedPostRepo.findById
      .mockResolvedValueOnce(ok(withRelations({ status: 'SCHEDULED' })))
      .mockResolvedValueOnce(err(databaseError()))
    mockedPostRepo.cancel.mockResolvedValue(ok(undefined as never))
    expectErr(
      await CrmScheduledPostService.cancel('u1', 'ws1', 'p1'),
      'DATABASE_ERROR',
    )
  })
})

describe('CrmScheduledPostService.reschedule()', () => {
  const when = new Date('2026-11-01T09:00:00Z')

  it.each(['PUBLISHED', 'PUBLISHING'] as CrmScheduledPostStatus[])(
    'should refuse to reschedule a %s post',
    async (status) => {
      mockedPostRepo.findById.mockResolvedValue(ok(withRelations({ status })))
      expectErr(
        await CrmScheduledPostService.reschedule('u1', 'ws1', 'p1', when),
        'CRM_SCHEDULED_POST_INVALID',
      )
      expect(mockedPostRepo.reschedule).not.toHaveBeenCalled()
    },
  )

  it('should move a failed post to the new date', async () => {
    mockedPostRepo.findById
      .mockResolvedValueOnce(ok(withRelations({ status: 'FAILED' })))
      .mockResolvedValueOnce(
        ok(withRelations({ status: 'SCHEDULED', scheduledFor: when })),
      )
    mockedPostRepo.reschedule.mockResolvedValue(ok(undefined as never))

    const result = expectOk(
      await CrmScheduledPostService.reschedule('u1', 'ws1', 'p1', when),
    )

    expect(result.scheduledFor).toBe(when.toISOString())
    expect(mockedPostRepo.reschedule).toHaveBeenCalledWith('p1', when)
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({ meta: { rescheduled: true } }),
    )
  })

  it('should propagate a lookup error', async () => {
    mockedPostRepo.findById.mockResolvedValue(err(notFound('Post')))
    expectErr(
      await CrmScheduledPostService.reschedule('u1', 'ws1', 'p1', when),
      'RESOURCE_NOT_FOUND',
    )
  })

  it('should propagate a reschedule error', async () => {
    mockedPostRepo.findById.mockResolvedValue(ok(withRelations()))
    mockedPostRepo.reschedule.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmScheduledPostService.reschedule('u1', 'ws1', 'p1', when),
      'DATABASE_ERROR',
    )
  })

  it('should propagate a reload error', async () => {
    mockedPostRepo.findById
      .mockResolvedValueOnce(ok(withRelations()))
      .mockResolvedValueOnce(err(databaseError()))
    mockedPostRepo.reschedule.mockResolvedValue(ok(undefined as never))
    expectErr(
      await CrmScheduledPostService.reschedule('u1', 'ws1', 'p1', when),
      'DATABASE_ERROR',
    )
  })

  it('should return FORBIDDEN for a VIEWER', async () => {
    asMember('VIEWER')
    expectErr(
      await CrmScheduledPostService.reschedule('u1', 'ws1', 'p1', when),
      'FORBIDDEN',
    )
  })
})

describe('CrmScheduledPostService.publish()', () => {
  it('should run the scheduler for the post and return its fresh state', async () => {
    const existing = withRelations({ status: 'FAILED' })
    mockedPostRepo.findById
      .mockResolvedValueOnce(ok(existing))
      .mockResolvedValueOnce(ok(withRelations({ status: 'PUBLISHED' })))

    const result = expectOk(
      await CrmScheduledPostService.publish('u1', 'ws1', 'p1'),
    )

    expect(result.status).toBe('PUBLISHED')
    expect(mockedPublish).toHaveBeenCalledWith(existing)
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({ meta: { publishTriggeredManually: true } }),
    )
  })

  it('should propagate a lookup error', async () => {
    mockedPostRepo.findById.mockResolvedValue(err(notFound('Post')))
    expectErr(
      await CrmScheduledPostService.publish('u1', 'ws1', 'p1'),
      'RESOURCE_NOT_FOUND',
    )
    expect(mockedPublish).not.toHaveBeenCalled()
  })

  it('should propagate a reload error', async () => {
    mockedPostRepo.findById
      .mockResolvedValueOnce(ok(withRelations()))
      .mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await CrmScheduledPostService.publish('u1', 'ws1', 'p1'),
      'DATABASE_ERROR',
    )
  })

  it('should return FORBIDDEN for a VIEWER', async () => {
    asMember('VIEWER')
    expectErr(
      await CrmScheduledPostService.publish('u1', 'ws1', 'p1'),
      'FORBIDDEN',
    )
    expect(mockedPublish).not.toHaveBeenCalled()
  })
})
