import { describe, expect, it } from 'vitest'
import {
  createFakeCoexistenceConnection,
  createFakeCoexistenceSync,
  createFakeMetaChannelSettings,
  createFakeSocialComment,
  createFakeSocialConnection,
} from '@/src/__tests__/factories/nov-meta-channels.factory'
import {
  toCoexistenceSyncDTO,
  toMetaChannelConnectionDTO,
  toMetaChannelSettingsDTO,
  toSocialCommentDTO,
} from '../whatsapp-meta-channel.mapper'

describe('toMetaChannelSettingsDTO', () => {
  it('defaults everything to off when nothing was saved', () => {
    expect(toMetaChannelSettingsDTO('ws1', null)).toEqual({
      workspaceId: 'ws1',
      instagramEnabled: false,
      messengerEnabled: false,
      commentsEnabled: false,
      coexistenceEnabled: false,
    })
  })

  it('exposes the saved switches', () => {
    const row = createFakeMetaChannelSettings({
      instagramEnabled: true,
      commentsEnabled: true,
    })
    expect(toMetaChannelSettingsDTO('ws1', row)).toMatchObject({
      instagramEnabled: true,
      messengerEnabled: false,
      commentsEnabled: true,
    })
  })
})

describe('toMetaChannelConnectionDTO', () => {
  it('maps a social connection without leaking tokens', () => {
    const dto = toMetaChannelConnectionDTO(
      createFakeSocialConnection({
        id: 'c1',
        channel: 'INSTAGRAM',
        metaInstagramAccountId: 'IG1',
      }),
    )
    expect(dto).toMatchObject({
      id: 'c1',
      channel: 'INSTAGRAM',
      pageId: '100200',
      instagramAccountId: 'IG1',
      coexistence: false,
    })
    expect(JSON.stringify(dto)).not.toContain('enc:')
  })

  it('flags a coexistence number', () => {
    const dto = toMetaChannelConnectionDTO(createFakeCoexistenceConnection())
    expect(dto).toMatchObject({ channel: 'WHATSAPP', coexistence: true })
  })
})

describe('toCoexistenceSyncDTO', () => {
  it('maps the progress with ISO dates', () => {
    const started = new Date('2026-10-30T10:00:00Z')
    const finished = new Date('2026-10-30T10:05:00Z')
    expect(
      toCoexistenceSyncDTO(
        createFakeCoexistenceSync({
          connectionId: 'c1',
          status: 'COMPLETED',
          progress: 100,
          messagesImported: 12,
          startedAt: started,
          finishedAt: finished,
        }),
      ),
    ).toMatchObject({
      connectionId: 'c1',
      status: 'COMPLETED',
      progress: 100,
      messagesImported: 12,
      startedAt: started.toISOString(),
      finishedAt: finished.toISOString(),
    })
  })

  it('keeps an unfinished import open', () => {
    expect(
      toCoexistenceSyncDTO(createFakeCoexistenceSync()).finishedAt,
    ).toBeNull()
  })
})

describe('toSocialCommentDTO', () => {
  it('maps the comment reference', () => {
    const replied = new Date('2026-10-30T12:00:00Z')
    expect(
      toSocialCommentDTO(
        createFakeSocialComment({ messageId: 'm1', repliedAt: replied }),
      ),
    ).toEqual({
      messageId: 'm1',
      commentId: 'comment-1',
      postId: 'post-1',
      permalink: 'https://www.instagram.com/p/abc/',
      repliedAt: replied.toISOString(),
    })
    expect(toSocialCommentDTO(createFakeSocialComment()).repliedAt).toBeNull()
  })
})
