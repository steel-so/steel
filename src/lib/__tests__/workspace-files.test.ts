import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listObjectKeys: vi.fn(),
  listObjects: vi.fn(),
  deleteObjects: vi.fn(),
}))
vi.mock('@/src/lib/storage/s3', () => mocks)

import type { PrismaClient } from '@prisma/client'
import {
  collectWorkspaceFileRefs,
  isPublicBucket,
  purgeWorkspaceFiles,
  WORKSPACE_BUCKETS,
  WORKSPACE_PREFIXED_BUCKETS,
} from '@/src/lib/storage/workspace-files'

describe('purgeWorkspaceFiles()', () => {
  it('deletes every object under the workspace prefix plus AI attachments', async () => {
    mocks.listObjectKeys.mockImplementation(async (bucket: string) =>
      bucket === 'whatsapp-media' ? ['ws1/a.jpg', 'ws1/b.ogg'] : [],
    )
    mocks.deleteObjects.mockImplementation(
      async (_bucket: string, keys: string[]) => keys.length,
    )

    const result = await purgeWorkspaceFiles('ws1', ['conv1/x.pdf'])

    for (const bucket of WORKSPACE_PREFIXED_BUCKETS) {
      expect(mocks.listObjectKeys).toHaveBeenCalledWith(bucket, 'ws1/')
    }
    expect(mocks.deleteObjects).toHaveBeenCalledWith('whatsapp-media', [
      'ws1/a.jpg',
      'ws1/b.ogg',
    ])
    expect(mocks.deleteObjects).toHaveBeenCalledWith('crm-ai-attachments', [
      'conv1/x.pdf',
    ])
    expect(result.deleted).toBe(3)
    expect(result.byBucket['whatsapp-media']).toBe(2)
  })

  it('never lists with an empty prefix (would match other workspaces)', async () => {
    mocks.listObjectKeys.mockResolvedValue([])
    await purgeWorkspaceFiles('ws1', [])
    for (const [, prefix] of mocks.listObjectKeys.mock.calls) {
      expect(prefix).toBe('ws1/')
    }
  })
})

describe('isPublicBucket()', () => {
  it('matches the registry and defaults unknown buckets to private', () => {
    expect(isPublicBucket('crm-landing-page-images')).toBe(true)
    expect(isPublicBucket('whatsapp-media')).toBe(false)
    expect(isPublicBucket('crm-ai-attachments')).toBe(false)
    expect(isPublicBucket('something-else')).toBe(false)
  })

  it('documents where every workspace bucket is written', () => {
    for (const bucket of WORKSPACE_BUCKETS) {
      expect(bucket.writtenBy).toMatch(/\.ts$/)
    }
  })
})

function prismaStub(overrides: {
  attachments?: { storageKey: string }[]
  proposalSections?: { content: unknown }[]
  templateSections?: { defaultContent: unknown }[]
}): PrismaClient {
  return {
    crmAiAttachment: {
      findMany: vi.fn().mockResolvedValue(overrides.attachments ?? []),
    },
    crmProposalSection: {
      findMany: vi.fn().mockResolvedValue(overrides.proposalSections ?? []),
    },
    crmProposalTemplateSection: {
      findMany: vi.fn().mockResolvedValue(overrides.templateSections ?? []),
    },
  } as unknown as PrismaClient
}

describe('collectWorkspaceFileRefs()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listObjects.mockResolvedValue([])
  })

  it('lists every prefixed bucket by workspace prefix', async () => {
    mocks.listObjects.mockImplementation(async (bucket: string) =>
      bucket === 'projects-covers' ? [{ key: 'ws1/cover.png', size: 10 }] : [],
    )

    const result = await collectWorkspaceFileRefs(prismaStub({}), 'ws1')

    expect(result.files).toEqual([
      {
        bucket: 'projects-covers',
        key: 'ws1/cover.png',
        sizeBytes: 10,
        legacy: false,
      },
    ])
    for (const bucket of WORKSPACE_PREFIXED_BUCKETS) {
      expect(mocks.listObjects).toHaveBeenCalledWith(bucket, 'ws1/')
    }
  })

  it('resolves AI attachments by their row, ignoring other conversations', async () => {
    mocks.listObjects.mockImplementation(
      async (bucket: string, prefix: string) =>
        bucket === 'crm-ai-attachments' && prefix === 'conv1/'
          ? [
              { key: 'conv1/mine.pdf', size: 7 },
              { key: 'conv1/someone-else.pdf', size: 9 },
            ]
          : [],
    )

    const result = await collectWorkspaceFileRefs(
      prismaStub({ attachments: [{ storageKey: 'conv1/mine.pdf' }] }),
      'ws1',
    )

    expect(result.files).toEqual([
      {
        bucket: 'crm-ai-attachments',
        key: 'conv1/mine.pdf',
        sizeBytes: 7,
        legacy: false,
      },
    ])
  })

  it('finds legacy flat media referenced in proposal content', async () => {
    mocks.listObjects.mockImplementation(
      async (bucket: string, prefix: string) => {
        if (bucket === 'crm-proposal-images' && prefix === '') {
          return [
            { key: 'old-hero.png', size: 42 },
            { key: 'unreferenced.png', size: 99 },
          ]
        }
        return []
      },
    )

    const result = await collectWorkspaceFileRefs(
      prismaStub({
        proposalSections: [
          {
            content: {
              image: 'https://cdn.example/crm-proposal-images/old-hero.png',
            },
          },
        ],
      }),
      'ws1',
    )

    expect(result.files).toEqual([
      {
        bucket: 'crm-proposal-images',
        key: 'old-hero.png',
        sizeBytes: 42,
        legacy: true,
      },
    ])
    expect(mocks.listObjects).toHaveBeenCalledWith('crm-proposal-images', '', {
      delimiter: '/',
    })
  })

  it('ignores already-prefixed URLs in the legacy scan (the prefix listing has them)', async () => {
    const result = await collectWorkspaceFileRefs(
      prismaStub({
        proposalSections: [
          {
            content: {
              image: 'https://cdn.example/crm-proposal-images/ws1/new.png',
            },
          },
        ],
      }),
      'ws1',
    )

    expect(result.files).toEqual([])
    expect(mocks.listObjects).not.toHaveBeenCalledWith(
      'crm-proposal-images',
      '',
      { delimiter: '/' },
    )
  })

  it('counts legacy references whose object no longer exists', async () => {
    const result = await collectWorkspaceFileRefs(
      prismaStub({
        templateSections: [
          {
            defaultContent: {
              image: 'https://cdn.example/crm-proposal-images/vanished.png',
            },
          },
        ],
      }),
      'ws1',
    )

    expect(result.files).toEqual([])
    expect(result.missingLegacyKeys).toBe(1)
  })
})
