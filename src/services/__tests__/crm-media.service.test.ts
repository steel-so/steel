import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'

vi.mock('@/src/lib/storage/s3')
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { logger } from '@/lib/axiom/logger'
import {
  ensurePublicBucket,
  listObjects,
  putObject,
} from '@/src/lib/storage/s3'
import {
  listCrmEmailImages,
  persistCrmEmailImage,
} from '../media/crm-email-media.service'
import { persistCrmProposalImage } from '../media/crm-proposal-media.service'

const s3Put = vi.mocked(putObject)
const s3Bucket = vi.mocked(ensurePublicBucket)

const MB = 1024 * 1024

beforeEach(() => {
  vi.clearAllMocks()
  s3Bucket.mockResolvedValue()
  s3Put.mockResolvedValue()
})

function upload(contentType: string, byteSize = 1024) {
  return {
    workspaceId: 'ws1',
    contentType,
    byteSize,
    readBody: vi.fn(async () => Buffer.from('bytes')),
  }
}

describe.each([
  [
    'persistCrmProposalImage',
    persistCrmProposalImage,
    'crm-proposal-images',
    'crm_proposal_media.persist_failed',
  ],
  [
    'persistCrmEmailImage',
    persistCrmEmailImage,
    'crm-email-images',
    'crm_email_media.persist_failed',
  ],
] as const)('%s()', (_name, persist, bucket, failureEvent) => {
  it('should store a supported image in its public bucket', async () => {
    const input = upload('image/webp')

    const { url } = expectOk(await persist(input))

    expect(url).toMatch(new RegExp(`/${bucket}/ws1/[\\w-]+\\.webp$`))
    expect(s3Bucket).toHaveBeenCalledWith(bucket)
    expect(s3Put).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket,
        contentType: 'image/webp',
        key: expect.stringMatching(/^ws1\//),
      }),
    )
  })

  it('should reject an unsupported format before reading the body', async () => {
    const input = upload('image/gif')

    const error = expectErr(await persist(input), 'VALIDATION_ERROR')

    expect(error.message).toMatch(/JPEG, PNG ou WebP/)
    expect(input.readBody).not.toHaveBeenCalled()
  })

  it('should reject an image above 5 MB', async () => {
    const input = upload('image/png', 5 * MB + 1)

    expectErr(await persist(input), 'VALIDATION_ERROR')
    expect(s3Put).not.toHaveBeenCalled()
  })

  it('should log and map a storage failure', async () => {
    s3Put.mockRejectedValue(new Error('minio down'))

    expectErr(await persist(upload('image/jpeg')), 'STORAGE_ERROR')
    expect(logger.error).toHaveBeenCalledWith(
      failureEvent,
      expect.objectContaining({ bucket, message: 'minio down' }),
    )
  })
})

describe('listCrmEmailImages()', () => {
  it('lists the workspace images newest first', async () => {
    vi.mocked(listObjects).mockResolvedValueOnce([
      {
        key: 'ws1/old.png',
        size: 1,
        lastModified: new Date('2026-01-01T00:00:00Z'),
      },
      {
        key: 'ws1/new.png',
        size: 2,
        lastModified: new Date('2026-02-01T00:00:00Z'),
      },
      { key: 'ws1/none.png', size: 3 },
    ])

    const items = expectOk(await listCrmEmailImages('ws1'))

    expect(listObjects).toHaveBeenCalledWith('crm-email-images', 'ws1/')
    expect(items.map((item) => item.id)).toEqual([
      'new.png',
      'old.png',
      'none.png',
    ])
    expect(items[0]).toMatchObject({
      size: 2,
      uploadedAt: '2026-02-01T00:00:00.000Z',
    })
    expect(items[0].url).toMatch(/\/crm-email-images\/ws1\/new\.png$/)
    expect(items[2].uploadedAt).toBeNull()
  })

  it('maps a storage failure to a STORAGE_ERROR', async () => {
    vi.mocked(listObjects).mockRejectedValueOnce(new Error('boom'))

    expectErr(await listCrmEmailImages('ws1'), 'STORAGE_ERROR')
    expect(logger.error).toHaveBeenCalledWith(
      'crm_email_media.list_failed',
      expect.objectContaining({ message: 'boom' }),
    )
  })

  it('stringifies a non-Error failure', async () => {
    vi.mocked(listObjects).mockRejectedValueOnce('nope')

    expectErr(await listCrmEmailImages('ws1'), 'STORAGE_ERROR')
    expect(logger.error).toHaveBeenCalledWith(
      'crm_email_media.list_failed',
      expect.objectContaining({ message: 'nope' }),
    )
  })
})
