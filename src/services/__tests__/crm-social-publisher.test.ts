import { describe, expect, it, vi } from 'vitest'
import { crmSocialOauthFailed, crmSocialScopeMissing } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('../crm-social-facebook.service', () => ({ publishPost: vi.fn() }))
vi.mock('../crm-social-instagram.service', () => ({ publishPost: vi.fn() }))
vi.mock('../crm-social-tiktok.service', () => ({ publishVideo: vi.fn() }))
vi.mock('../crm-social-youtube.service', () => ({ publishVideo: vi.fn() }))

import * as Facebook from '../crm-social-facebook.service'
import * as Instagram from '../crm-social-instagram.service'
import {
  type CrmSocialPublishContext,
  publishToSocialPlatform,
} from '../crm-social-publisher'
import * as Tiktok from '../crm-social-tiktok.service'
import * as Youtube from '../crm-social-youtube.service'

const IMAGE = { bytes: new Uint8Array([1]).buffer, contentType: 'image/png' }
const VIDEO = { bytes: new Uint8Array([2]).buffer, contentType: 'video/mp4' }

function ctx(
  overrides: Partial<CrmSocialPublishContext> = {},
): CrmSocialPublishContext {
  return {
    actorId: 'u1',
    workspaceId: 'ws1',
    content: 'Olá mundo',
    title: null,
    options: {},
    image: null,
    video: null,
    ...overrides,
  }
}

describe('publishToSocialPlatform()', () => {
  describe('FACEBOOK', () => {
    it('should prefer the video, pass the link option and return the post id', async () => {
      vi.mocked(Facebook.publishPost).mockResolvedValue(
        ok({ postId: 'fb-1', url: 'https://facebook.com/fb-1' }),
      )

      const result = await publishToSocialPlatform(
        'FACEBOOK',
        ctx({
          image: IMAGE,
          video: VIDEO,
          options: { facebook: { link: 'https://acme.test' } },
        }),
      )

      expect(result).toEqual({ ok: true, externalPostId: 'fb-1' })
      expect(Facebook.publishPost).toHaveBeenCalledWith(
        'u1',
        'ws1',
        { message: 'Olá mundo', link: 'https://acme.test' },
        { ...VIDEO, kind: 'VIDEO' },
      )
    })

    it('should send the image when there is no video', async () => {
      vi.mocked(Facebook.publishPost).mockResolvedValue(
        ok({ postId: 'fb-2', url: '' }),
      )
      await publishToSocialPlatform('FACEBOOK', ctx({ image: IMAGE }))
      expect(vi.mocked(Facebook.publishPost).mock.calls[0][3]).toEqual({
        ...IMAGE,
        kind: 'IMAGE',
      })
    })

    it('should publish text-only and ignore invalid stored options', async () => {
      vi.mocked(Facebook.publishPost).mockResolvedValue(
        ok({ postId: 'fb-3', url: '' }),
      )

      await publishToSocialPlatform(
        'FACEBOOK',
        ctx({ options: { facebook: { link: 'not a url' } } }),
      )

      expect(Facebook.publishPost).toHaveBeenCalledWith(
        'u1',
        'ws1',
        { message: 'Olá mundo', link: null },
        null,
      )
    })

    it('should treat null options as empty', async () => {
      vi.mocked(Facebook.publishPost).mockResolvedValue(
        ok({ postId: 'fb-4', url: '' }),
      )
      await publishToSocialPlatform('FACEBOOK', ctx({ options: null }))
      expect(vi.mocked(Facebook.publishPost).mock.calls[0][2]).toEqual({
        message: 'Olá mundo',
        link: null,
      })
    })

    it('should surface the service error message', async () => {
      vi.mocked(Facebook.publishPost).mockResolvedValue(
        err(crmSocialScopeMissing()),
      )
      const result = await publishToSocialPlatform('FACEBOOK', ctx())
      expect(result).toEqual({
        ok: false,
        error: crmSocialScopeMissing().message,
      })
    })
  })

  describe('INSTAGRAM', () => {
    it.each([
      ['FEED (default)', {}, { image: IMAGE, video: VIDEO }, 'FEED', 'IMAGE'],
      [
        'REELS',
        { instagram: { postType: 'REELS' } },
        { image: IMAGE, video: VIDEO },
        'REELS',
        'VIDEO',
      ],
      [
        'STORIES with an image',
        { instagram: { postType: 'STORIES' } },
        { image: IMAGE, video: VIDEO },
        'STORIES',
        'IMAGE',
      ],
      [
        'STORIES with only a video',
        { instagram: { postType: 'STORIES' } },
        { video: VIDEO },
        'STORIES',
        'VIDEO',
      ],
    ] as const)(
      'should pick the right media for %s',
      async (_, options, media, postType, kind) => {
        vi.mocked(Instagram.publishPost).mockResolvedValue(
          ok({ postId: 'ig-1', permalink: null }),
        )

        expect(
          await publishToSocialPlatform(
            'INSTAGRAM',
            ctx({ options, ...media }),
          ),
        ).toEqual({ ok: true, externalPostId: 'ig-1' })
        expect(Instagram.publishPost).toHaveBeenCalledWith(
          'u1',
          'ws1',
          { caption: 'Olá mundo', postType },
          { ...(kind === 'IMAGE' ? IMAGE : VIDEO), kind },
        )
      },
    )

    it.each([
      ['FEED', {}, { video: VIDEO }, 'imagem'],
      [
        'REELS',
        { instagram: { postType: 'REELS' } },
        { image: IMAGE },
        'vídeo',
      ],
      [
        'STORIES',
        { instagram: { postType: 'STORIES' } },
        {},
        'imagem ou vídeo',
      ],
    ] as const)(
      'should refuse a %s without the required media',
      async (_, options, media, label) => {
        const result = await publishToSocialPlatform(
          'INSTAGRAM',
          ctx({ options, ...media }),
        )

        expect(result).toEqual({
          ok: false,
          error: `INSTAGRAM exige mídia (${label}) para publicar.`,
        })
        expect(Instagram.publishPost).not.toHaveBeenCalled()
      },
    )

    it('should surface the service error message', async () => {
      vi.mocked(Instagram.publishPost).mockResolvedValue(
        err(crmSocialOauthFailed('Proporção inválida')),
      )
      expect(
        await publishToSocialPlatform('INSTAGRAM', ctx({ image: IMAGE })),
      ).toEqual({ ok: false, error: 'Proporção inválida' })
    })
  })

  describe('TIKTOK', () => {
    it('should require a video', async () => {
      expect(
        await publishToSocialPlatform('TIKTOK', ctx({ image: IMAGE })),
      ).toEqual({
        ok: false,
        error: 'TIKTOK exige mídia (vídeo) para publicar.',
      })
      expect(Tiktok.publishVideo).not.toHaveBeenCalled()
    })

    it('should default to SELF_ONLY with interactions enabled and the content as title', async () => {
      vi.mocked(Tiktok.publishVideo).mockResolvedValue(
        ok({ publishId: 'pub-1', status: 'PROCESSING_UPLOAD' }),
      )

      expect(
        await publishToSocialPlatform('TIKTOK', ctx({ video: VIDEO })),
      ).toEqual({ ok: true, externalPostId: 'pub-1' })
      expect(Tiktok.publishVideo).toHaveBeenCalledWith(
        'u1',
        'ws1',
        {
          title: 'Olá mundo',
          privacyLevel: 'SELF_ONLY',
          disableComment: false,
          disableDuet: false,
          disableStitch: false,
        },
        VIDEO,
      )
    })

    it('should honor the title and the tiktok options', async () => {
      vi.mocked(Tiktok.publishVideo).mockResolvedValue(
        ok({ publishId: 'pub-2', status: 'PROCESSING_UPLOAD' }),
      )

      await publishToSocialPlatform(
        'TIKTOK',
        ctx({
          title: 'Título',
          video: VIDEO,
          options: {
            tiktok: {
              privacy: 'PUBLIC_TO_EVERYONE',
              disableComment: true,
              disableDuet: true,
              disableStitch: true,
            },
          },
        }),
      )

      expect(vi.mocked(Tiktok.publishVideo).mock.calls[0][2]).toEqual({
        title: 'Título',
        privacyLevel: 'PUBLIC_TO_EVERYONE',
        disableComment: true,
        disableDuet: true,
        disableStitch: true,
      })
    })

    it('should surface the service error message', async () => {
      vi.mocked(Tiktok.publishVideo).mockResolvedValue(
        err(crmSocialOauthFailed('Conta pública')),
      )
      expect(
        await publishToSocialPlatform('TIKTOK', ctx({ video: VIDEO })),
      ).toEqual({ ok: false, error: 'Conta pública' })
    })
  })

  describe('YOUTUBE', () => {
    it('should require a video', async () => {
      expect(await publishToSocialPlatform('YOUTUBE', ctx())).toEqual({
        ok: false,
        error: 'YOUTUBE exige mídia (vídeo) para publicar.',
      })
    })

    it('should use the first 100 chars as title and public/no tags by default', async () => {
      vi.mocked(Youtube.publishVideo).mockResolvedValue(
        ok({
          videoId: 'yt-1',
          url: '',
          title: '',
          privacyStatus: 'public',
        }),
      )
      const content = 'a'.repeat(150)

      expect(
        await publishToSocialPlatform(
          'YOUTUBE',
          ctx({ content, video: VIDEO }),
        ),
      ).toEqual({ ok: true, externalPostId: 'yt-1' })
      expect(Youtube.publishVideo).toHaveBeenCalledWith(
        'u1',
        'ws1',
        {
          title: 'a'.repeat(100),
          description: content,
          privacyStatus: 'public',
          tags: [],
        },
        VIDEO,
      )
    })

    it('should fall back to "Sem título" and honor youtube options', async () => {
      vi.mocked(Youtube.publishVideo).mockResolvedValue(
        ok({ videoId: 'yt-2', url: '', title: '', privacyStatus: 'private' }),
      )

      await publishToSocialPlatform(
        'YOUTUBE',
        ctx({
          content: '',
          video: VIDEO,
          options: { youtube: { privacy: 'private', tags: ['crm'] } },
        }),
      )

      expect(vi.mocked(Youtube.publishVideo).mock.calls[0][2]).toEqual({
        title: 'Sem título',
        description: '',
        privacyStatus: 'private',
        tags: ['crm'],
      })
    })

    it('should prefer the explicit title', async () => {
      vi.mocked(Youtube.publishVideo).mockResolvedValue(
        ok({ videoId: 'yt-3', url: '', title: '', privacyStatus: 'public' }),
      )
      await publishToSocialPlatform(
        'YOUTUBE',
        ctx({ title: 'Meu título', video: VIDEO }),
      )
      expect(vi.mocked(Youtube.publishVideo).mock.calls[0][2].title).toBe(
        'Meu título',
      )
    })

    it('should surface the service error message', async () => {
      vi.mocked(Youtube.publishVideo).mockResolvedValue(
        err(crmSocialOauthFailed('Quota')),
      )
      expect(
        await publishToSocialPlatform('YOUTUBE', ctx({ video: VIDEO })),
      ).toEqual({ ok: false, error: 'Quota' })
    })
  })

  it.each(['GOOGLE_ADS', 'GOOGLE_ANALYTICS'] as const)(
    'should refuse read-only platform %s',
    async (platform) => {
      expect(await publishToSocialPlatform(platform, ctx())).toEqual({
        ok: false,
        error: `Publicação agendada não suportada para ${platform}.`,
      })
    },
  )
})
