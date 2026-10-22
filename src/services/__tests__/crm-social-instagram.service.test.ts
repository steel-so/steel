import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  asMember,
  describeSocialAuthz,
  withToken,
} from '@/src/__tests__/helpers/crm-social.helpers'
import {
  type FetchCall,
  headerOf,
  jsonResponse,
  mockFetch,
  textResponse,
} from '@/src/__tests__/helpers/fetch.helpers'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/services/crm-social-token')
vi.mock('@/src/lib/social/blob-store', () => ({
  putBlob: vi.fn(),
  removeBlob: vi.fn(async () => undefined),
}))
vi.mock('@/lib/env/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/env/server')>()),
  BETTER_AUTH_URL: 'https://app.test/',
}))

import { putBlob, removeBlob } from '@/src/lib/social/blob-store'
import {
  deleteMedia,
  getInsights,
  getOverview,
  getRecentMedia,
  getStories,
  getWeeklyEngagement,
  publishPost,
} from '../crm-social-instagram.service'

const GRAPH = 'https://graph.facebook.com/v26.0'
const ALL_SCOPES =
  'instagram_basic,instagram_manage_insights,instagram_content_publish,instagram_manage_contents'
const IG = 'ig-1'
const NOW = new Date('2026-09-18T12:00:00.000Z')

const mockedPutBlob = vi.mocked(putBlob)
const mockedRemoveBlob = vi.mocked(removeBlob)

let fetchMock: ReturnType<typeof mockFetch>

function image() {
  return {
    bytes: new Uint8Array([1, 2, 3]).buffer,
    contentType: 'image/jpeg',
    kind: 'IMAGE' as const,
  }
}

function video() {
  return {
    bytes: new Uint8Array([4, 5, 6, 7]).buffer,
    contentType: 'video/mp4',
    kind: 'VIDEO' as const,
  }
}

function formBody(call: FetchCall): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(String(call.init?.body)))
}

function pathOf(url: string): string {
  return new URL(url).pathname.replace('/v26.0', '')
}

beforeEach(() => {
  fetchMock = mockFetch(() => {
    throw new Error('unexpected fetch')
  })
  asMember('MEMBER')
  withToken({ scope: ALL_SCOPES, externalAccountId: IG }, 'page-token')
})

afterEach(() => {
  vi.useRealTimers()
})

describeSocialAuthz(
  [
    {
      name: 'getOverview()',
      action: 'VIEW',
      scope: 'instagram_basic',
      call: () => getOverview('u1', 'ws1'),
    },
    {
      name: 'getInsights()',
      action: 'VIEW',
      scope: 'instagram_manage_insights',
      call: () => getInsights('u1', 'ws1', '7d'),
    },
    {
      name: 'getRecentMedia()',
      action: 'VIEW',
      scope: 'instagram_basic',
      call: () => getRecentMedia('u1', 'ws1'),
    },
    {
      name: 'getWeeklyEngagement()',
      action: 'VIEW',
      scope: 'instagram_manage_insights',
      call: () => getWeeklyEngagement('u1', 'ws1'),
    },
    {
      name: 'getStories()',
      action: 'VIEW',
      scope: 'instagram_basic',
      call: () => getStories('u1', 'ws1'),
    },
    {
      name: 'publishPost()',
      action: 'CREATE',
      scope: 'instagram_content_publish',
      call: () =>
        publishPost('u1', 'ws1', { caption: 'Oi', postType: 'FEED' }, image()),
    },
    {
      name: 'deleteMedia()',
      action: 'DELETE',
      scope: 'instagram_manage_contents',
      call: () => deleteMedia('u1', 'ws1', 'm1'),
    },
  ],
  () => fetchMock.spy,
)

describe('getOverview()', () => {
  it('should fetch the IG profile with the page token and map it to the DTO', async () => {
    fetchMock = mockFetch(() =>
      jsonResponse({
        id: IG,
        username: 'acme',
        name: 'Acme',
        biography: 'Bio',
        profile_picture_url: 'https://cdn/p.jpg',
        media_count: 12,
        followers_count: '3400',
        follows_count: 'n/a',
      }),
    )

    const overview = expectOk(await getOverview('u1', 'ws1', 'conn-9'))

    expect(overview).toEqual({
      igAccountId: IG,
      username: 'acme',
      name: 'Acme',
      biography: 'Bio',
      profilePictureUrl: 'https://cdn/p.jpg',
      mediaCount: 12,
      followersCount: 3400,
      followsCount: 0,
    })
    const [call] = fetchMock.calls()
    const url = new URL(call.url)
    expect(`${url.origin}${url.pathname}`).toBe(`${GRAPH}/${IG}`)
    expect(url.searchParams.get('fields')).toContain('followers_count')
    expect(headerOf(call, 'Authorization')).toBe('Bearer page-token')
  })

  it('should pass the explicit connectionId down to the token resolver', async () => {
    const { getFreshAccessToken } = await import('../crm-social-token')
    fetchMock = mockFetch(() => jsonResponse({ id: IG }))

    const overview = expectOk(await getOverview('u1', 'ws1', 'conn-9'))

    expect(getFreshAccessToken).toHaveBeenCalledWith(
      'ws1',
      'INSTAGRAM',
      'conn-9',
    )
    expect(overview).toMatchObject({
      username: '',
      name: null,
      biography: null,
      profilePictureUrl: null,
      mediaCount: 0,
    })
  })

  it('should surface the Graph error_user_msg on a 401', async () => {
    fetchMock = mockFetch(() =>
      jsonResponse(
        { error: { error_user_msg: 'Sessão expirada', message: 'raw' } },
        { status: 401 },
      ),
    )

    const error = expectErr(
      await getOverview('u1', 'ws1'),
      'CRM_SOCIAL_OAUTH_FAILED',
    )
    expect(error.message).toBe('Sessão expirada')
  })

  it('should map a network failure to CRM_SOCIAL_OAUTH_FAILED', async () => {
    fetchMock = mockFetch(() => {
      throw new TypeError('fetch failed')
    })

    expectErr(await getOverview('u1', 'ws1'), 'CRM_SOCIAL_OAUTH_FAILED')
  })
})

describe('getInsights()', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })

  it('should query views per day and the others as a series, merging by day', async () => {
    fetchMock = mockFetch((url) => {
      const params = new URL(url).searchParams
      const metric = params.get('metric')
      if (metric === 'views') {
        const day = params.get('since')
        const value = day === '2026-09-16' ? 5 : day === '2026-09-17' ? 10 : 0
        return jsonResponse({ data: [{ total_value: { value } }] })
      }
      if (metric === 'reach') {
        return jsonResponse({
          data: [{ values: [{ value: '7', end_time: '2026-09-17T07:00' }] }],
        })
      }
      // profile_views: refused by Meta → contributes nothing.
      return jsonResponse({ error: { message: 'dead' } }, { status: 400 })
    })

    const insights = expectOk(await getInsights('u1', 'ws1', '7d'))

    expect(insights.totals).toEqual({
      impressions: 15,
      reach: 7,
      profileViews: 0,
    })
    expect(insights.series).toEqual([
      { date: '2026-09-16', impressions: 5, reach: 0, profileViews: 0 },
      { date: '2026-09-17', impressions: 10, reach: 7, profileViews: 0 },
    ])
    const calls = fetchMock.calls().map((c) => new URL(c.url).searchParams)
    // `impressions` is gone from the API: it must never be requested.
    expect(calls.some((p) => p.get('metric') === 'impressions')).toBe(false)
    const day = calls.find((p) => p.get('metric') === 'views')
    expect(day?.get('metric_type')).toBe('total_value')
    expect(day?.get('until')).toBe(
      new Date(Date.parse(`${day?.get('since')}T00:00:00Z`) + 86_400_000)
        .toISOString()
        .slice(0, 10),
    )
    const reach = calls.find((p) => p.get('metric') === 'reach')
    expect(reach?.get('since')).toBe('2026-09-11')
    expect(reach?.get('until')).toBe('2026-09-18')
  })

  it('should return an empty series when every metric payload is empty', async () => {
    fetchMock = mockFetch(() => jsonResponse({ data: [{}] }))

    const insights = expectOk(await getInsights('u1', 'ws1', '7d'))

    expect(insights.startDate).toBe('2026-09-11')
    expect(insights.series).toEqual([])
    expect(insights.totals).toEqual({
      impressions: 0,
      reach: 0,
      profileViews: 0,
    })
  })

  it('should tolerate a payload without data', async () => {
    fetchMock = mockFetch(() => jsonResponse({}))

    const insights = expectOk(await getInsights('u1', 'ws1', '7d'))
    expect(insights.series).toEqual([])
  })
})

describe('getRecentMedia()', () => {
  it('should list the 20 latest feed items with defaults for missing fields', async () => {
    fetchMock = mockFetch(() =>
      jsonResponse({
        data: [
          {
            id: 'm1',
            media_type: 'VIDEO',
            media_url: 'https://cdn/v.mp4',
            thumbnail_url: 'https://cdn/t.jpg',
            caption: 'Olá',
            timestamp: '2026-09-17T10:00:00+0000',
            permalink: 'https://instagram.com/p/m1',
            like_count: 4,
            comments_count: '2',
          },
          {},
        ],
      }),
    )

    const { media } = expectOk(await getRecentMedia('u1', 'ws1'))

    expect(media).toEqual([
      {
        id: 'm1',
        mediaType: 'VIDEO',
        mediaUrl: 'https://cdn/v.mp4',
        thumbnailUrl: 'https://cdn/t.jpg',
        caption: 'Olá',
        timestamp: '2026-09-17T10:00:00+0000',
        permalink: 'https://instagram.com/p/m1',
        likeCount: 4,
        commentsCount: 2,
      },
      {
        id: '',
        mediaType: 'IMAGE',
        mediaUrl: null,
        thumbnailUrl: null,
        caption: null,
        timestamp: '',
        permalink: null,
        likeCount: 0,
        commentsCount: 0,
      },
    ])
    const url = new URL(fetchMock.calls()[0].url)
    expect(pathOf(url.toString())).toBe(`/${IG}/media`)
    expect(url.searchParams.get('limit')).toBe('20')
  })

  it('should return an empty list when data is absent', async () => {
    fetchMock = mockFetch(() => jsonResponse({}))
    expect(expectOk(await getRecentMedia('u1', 'ws1')).media).toEqual([])
  })

  it('should propagate a 5xx as CRM_SOCIAL_OAUTH_FAILED', async () => {
    fetchMock = mockFetch(() => textResponse('upstream', { status: 503 }))
    expectErr(await getRecentMedia('u1', 'ws1'), 'CRM_SOCIAL_OAUTH_FAILED')
  })
})

describe('getWeeklyEngagement()', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })

  function recent(id: string, daysAgo: number, likes: number, comments = 0) {
    return {
      id,
      media_type: 'IMAGE',
      timestamp: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(),
      like_count: likes,
      comments_count: comments,
    }
  }

  it('should sum saves, keep only 7d media and rank the top 5 by engagement', async () => {
    const savedById: Record<string, number | 'fail'> = {
      a: 1,
      b: 2,
      c: 'fail',
      d: 0,
      e: 3,
      f: 1,
    }
    fetchMock = mockFetch((url) => {
      const path = pathOf(url)
      const metric = new URL(url).searchParams.get('metric')
      if (path === `/${IG}/insights`) {
        const value = metric === 'views' ? 100 : 7
        const day = new URL(url).searchParams.get('since')
        // `views`/`profile_views` are total_value per day; the other metrics are series.
        if (metric === 'views' || metric === 'profile_views') {
          return jsonResponse({
            data: [
              { total_value: { value: day === '2026-09-17' ? value : 0 } },
            ],
          })
        }
        return jsonResponse({
          data: [{ values: [{ value, end_time: '2026-09-17T07:00' }] }],
        })
      }
      if (path === `/${IG}/media`) {
        return jsonResponse({
          data: [
            recent('a', 1, 10),
            recent('b', 2, 50, 5),
            recent('c', 3, 1),
            recent('d', 4, 30),
            recent('e', 5, 20),
            recent('f', 6, 40),
            recent('old', 10, 999),
            { id: 'bad-date', timestamp: 'not-a-date', like_count: 500 },
          ],
        })
      }
      const mediaId = path.split('/')[1]
      const saved = savedById[mediaId]
      if (saved === 'fail') {
        return jsonResponse({ error: { message: 'x' } }, { status: 400 })
      }
      expect(metric).toBe('saved')
      return jsonResponse({ data: [{ values: [{ value: saved }] }] })
    })

    const weekly = expectOk(await getWeeklyEngagement('u1', 'ws1'))

    expect(weekly.views7d).toBe(100)
    expect(weekly.profileViews7d).toBe(7)
    expect(weekly.saves7d).toBe(1 + 2 + 0 + 0 + 3 + 1)
    expect(weekly.top5.map((m) => [m.id, m.engagementScore])).toEqual([
      ['b', 57],
      ['f', 41],
      ['d', 30],
      ['e', 23],
      ['a', 11],
    ])
    expect(fetchMock.calls().some((c) => c.url.includes('/old/insights'))).toBe(
      false,
    )
  })

  it('should treat an empty saved insight as zero', async () => {
    fetchMock = mockFetch((url) => {
      const path = pathOf(url)
      if (path === `/${IG}/insights`) return jsonResponse({ data: [] })
      if (path === `/${IG}/media`) {
        return jsonResponse({ data: [recent('a', 1, 3)] })
      }
      return jsonResponse({})
    })

    const weekly = expectOk(await getWeeklyEngagement('u1', 'ws1'))
    expect(weekly.saves7d).toBe(0)
    expect(weekly.top5[0]).toMatchObject({ id: 'a', saved: 0 })
  })

  it('should fail when the media listing fails', async () => {
    fetchMock = mockFetch((url) => {
      if (pathOf(url) === `/${IG}/media`) {
        return textResponse('rate limited', { status: 429 })
      }
      return jsonResponse({ data: [] })
    })

    expectErr(await getWeeklyEngagement('u1', 'ws1'), 'CRM_SOCIAL_OAUTH_FAILED')
  })
})

describe('getStories()', () => {
  it('should list active stories enriched with their reach', async () => {
    fetchMock = mockFetch((url) => {
      const path = pathOf(url)
      if (path === `/${IG}/stories`) {
        return jsonResponse({
          data: [
            {
              id: 's1',
              media_url: 'https://cdn/s1.jpg',
              timestamp: '2026-09-18T08:00:00+0000',
              permalink: 'https://instagram.com/s/s1',
            },
            { id: 's2' },
            {},
          ],
        })
      }
      if (path === '/s1/insights') {
        expect(new URL(url).searchParams.get('metric')).toBe('reach')
        return jsonResponse({ data: [{ values: [{ value: 42 }] }] })
      }
      return textResponse('boom', { status: 500 })
    })

    const { stories } = expectOk(await getStories('u1', 'ws1'))

    expect(stories).toEqual([
      {
        id: 's1',
        mediaUrl: 'https://cdn/s1.jpg',
        timestamp: '2026-09-18T08:00:00+0000',
        permalink: 'https://instagram.com/s/s1',
        reach: 42,
      },
      { id: 's2', mediaUrl: null, timestamp: '', permalink: null, reach: 0 },
      { id: '', mediaUrl: null, timestamp: '', permalink: null, reach: 0 },
    ])
  })

  it('should return an empty list when there are no active stories', async () => {
    fetchMock = mockFetch(() => jsonResponse({}))
    expect(expectOk(await getStories('u1', 'ws1')).stories).toEqual([])
  })

  it('should propagate a stories listing failure', async () => {
    fetchMock = mockFetch(() => textResponse('{not json', { status: 403 }))
    const error = expectErr(
      await getStories('u1', 'ws1'),
      'CRM_SOCIAL_OAUTH_FAILED',
    )
    expect(error.message).toBe('Falha ao conectar com a plataforma')
  })
})

describe('publishPost()', () => {
  beforeEach(() => {
    let n = 0
    mockedPutBlob.mockImplementation(async () => `blob-${++n}`)
  })

  /** Roteador do fluxo container → status → publish → permalink. */
  function graphFlow(
    overrides: {
      container?: () => Response
      status?: () => Response
      publish?: () => Response
      permalink?: () => Response
    } = {},
  ) {
    return mockFetch((url, init) => {
      const path = pathOf(url)
      if (path === `/${IG}/media` && init?.method === 'POST') {
        return overrides.container?.() ?? jsonResponse({ id: 'container-1' })
      }
      if (path === '/container-1') {
        return overrides.status?.() ?? jsonResponse({ status_code: 'FINISHED' })
      }
      if (path === `/${IG}/media_publish`) {
        return overrides.publish?.() ?? jsonResponse({ id: 'post-1' })
      }
      if (path === '/post-1') {
        return (
          overrides.permalink?.() ??
          jsonResponse({ permalink: 'https://instagram.com/p/post-1' })
        )
      }
      throw new Error(`unexpected ${url}`)
    })
  }

  it('should host the image, create a FEED container, wait and publish it', async () => {
    fetchMock = graphFlow()
    const media = image()

    const result = expectOk(
      await publishPost(
        'u1',
        'ws1',
        { caption: 'Novidade', postType: 'FEED' },
        media,
      ),
    )

    expect(result).toEqual({
      postId: 'post-1',
      permalink: 'https://instagram.com/p/post-1',
    })
    expect(mockedPutBlob).toHaveBeenCalledWith(media.bytes, 'image/jpeg')
    const [container, status, publish, permalink] = fetchMock.calls()
    expect(container.url).toBe(`${GRAPH}/${IG}/media`)
    expect(headerOf(container, 'Content-Type')).toBe(
      'application/x-www-form-urlencoded',
    )
    expect(formBody(container)).toEqual({
      image_url: 'https://app.test/api/social/blob/blob-1',
      caption: 'Novidade',
      access_token: 'page-token',
    })
    expect(new URL(status.url).searchParams.get('fields')).toBe(
      'status_code,status',
    )
    expect(formBody(publish)).toEqual({
      creation_id: 'container-1',
      access_token: 'page-token',
    })
    expect(headerOf(permalink, 'Authorization')).toBe('Bearer page-token')
    expect(mockedRemoveBlob).toHaveBeenCalledWith('blob-1')
    expect(mockedRemoveBlob).toHaveBeenCalledTimes(1)
  })

  it('should publish a REELS with video, cover and share_to_feed', async () => {
    fetchMock = graphFlow()

    expectOk(
      await publishPost(
        'u1',
        'ws1',
        { caption: 'Reel', postType: 'REELS' },
        video(),
        'conn-2',
        { bytes: new Uint8Array([9]).buffer, contentType: 'image/png' },
      ),
    )

    expect(formBody(fetchMock.calls()[0])).toEqual({
      media_type: 'REELS',
      video_url: 'https://app.test/api/social/blob/blob-1',
      share_to_feed: 'true',
      caption: 'Reel',
      cover_url: 'https://app.test/api/social/blob/blob-2',
      access_token: 'page-token',
    })
    expect(mockedRemoveBlob).toHaveBeenCalledWith('blob-1')
    expect(mockedRemoveBlob).toHaveBeenCalledWith('blob-2')
  })

  it('should omit caption and cover when they are empty', async () => {
    fetchMock = graphFlow()

    expectOk(
      await publishPost(
        'u1',
        'ws1',
        { caption: '', postType: 'REELS' },
        video(),
        undefined,
        null,
      ),
    )
    expectOk(
      await publishPost(
        'u1',
        'ws1',
        { caption: '', postType: 'FEED' },
        image(),
      ),
    )

    const [reels, , , , feed] = fetchMock.calls()
    expect(formBody(reels)).not.toHaveProperty('caption')
    expect(formBody(reels)).not.toHaveProperty('cover_url')
    expect(formBody(feed)).not.toHaveProperty('caption')
  })

  it.each([
    ['image', image(), 'image_url'],
    ['video', video(), 'video_url'],
  ])(
    'should publish a STORIES with an %s (no caption)',
    async (_, media, field) => {
      fetchMock = graphFlow()

      expectOk(
        await publishPost(
          'u1',
          'ws1',
          { caption: 'ignorada', postType: 'STORIES' },
          media,
        ),
      )

      const body = formBody(fetchMock.calls()[0])
      expect(body.media_type).toBe('STORIES')
      expect(body[field]).toBe('https://app.test/api/social/blob/blob-1')
      expect(body).not.toHaveProperty('caption')
    },
  )

  it.each([
    ['REELS without a video', 'REELS' as const, image()],
    ['FEED without an image', 'FEED' as const, video()],
  ])(
    'should reject %s and still release the blob',
    async (_, postType, media) => {
      expectErr(
        await publishPost('u1', 'ws1', { caption: 'x', postType }, media),
        'CRM_SOCIAL_OAUTH_FAILED',
      )
      expect(fetchMock.spy).not.toHaveBeenCalled()
      expect(mockedRemoveBlob).toHaveBeenCalledWith('blob-1')
    },
  )

  it('should surface the Graph message when the container is rejected', async () => {
    fetchMock = graphFlow({
      container: () =>
        jsonResponse(
          { error: { error_user_msg: 'Proporção inválida' } },
          { status: 400 },
        ),
    })

    const error = expectErr(
      await publishPost(
        'u1',
        'ws1',
        { caption: 'x', postType: 'FEED' },
        image(),
      ),
      'CRM_SOCIAL_OAUTH_FAILED',
    )
    expect(error.message).toBe('Proporção inválida')
    expect(mockedRemoveBlob).toHaveBeenCalledWith('blob-1')
  })

  it('should fail when the container response has no id', async () => {
    fetchMock = graphFlow({ container: () => jsonResponse({}) })
    expectErr(
      await publishPost(
        'u1',
        'ws1',
        { caption: 'x', postType: 'FEED' },
        image(),
      ),
      'CRM_SOCIAL_OAUTH_FAILED',
    )
    expect(fetchMock.calls()).toHaveLength(1)
  })

  it('should poll the container until it is FINISHED', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    const statuses = ['IN_PROGRESS', 'IN_PROGRESS', 'FINISHED']
    fetchMock = graphFlow({
      status: () => jsonResponse({ status_code: statuses.shift() }),
    })

    const pending = publishPost(
      'u1',
      'ws1',
      { caption: 'x', postType: 'REELS' },
      video(),
    )
    await vi.runAllTimersAsync()

    expect(expectOk(await pending).postId).toBe('post-1')
    expect(
      fetchMock.calls().filter((c) => pathOf(c.url) === '/container-1'),
    ).toHaveLength(3)
  })

  it('should fail with the Meta status when the container errors', async () => {
    fetchMock = graphFlow({
      status: () =>
        jsonResponse({ status_code: 'ERROR', status: 'Vídeo muito longo' }),
    })

    const error = expectErr(
      await publishPost(
        'u1',
        'ws1',
        { caption: 'x', postType: 'REELS' },
        video(),
      ),
      'CRM_SOCIAL_OAUTH_FAILED',
    )
    expect(error.message).toBe('Vídeo muito longo')
    expect(
      fetchMock.calls().some((c) => pathOf(c.url) === `/${IG}/media_publish`),
    ).toBe(false)
  })

  it('should fail with the default message when the container EXPIRED', async () => {
    fetchMock = graphFlow({
      status: () => jsonResponse({ status_code: 'EXPIRED' }),
    })

    const error = expectErr(
      await publishPost(
        'u1',
        'ws1',
        { caption: 'x', postType: 'REELS' },
        video(),
      ),
      'CRM_SOCIAL_OAUTH_FAILED',
    )
    expect(error.message).toBe('Falha ao conectar com a plataforma')
  })

  it('should fail when the container status request fails', async () => {
    fetchMock = graphFlow({
      status: () => textResponse('nope', { status: 500 }),
    })
    expectErr(
      await publishPost(
        'u1',
        'ws1',
        { caption: 'x', postType: 'FEED' },
        image(),
      ),
      'CRM_SOCIAL_OAUTH_FAILED',
    )
  })

  it('should give up after the polling ceiling (~5 min)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    fetchMock = graphFlow({
      status: () => jsonResponse({ status_code: 'IN_PROGRESS' }),
    })

    const pending = publishPost(
      'u1',
      'ws1',
      { caption: 'x', postType: 'REELS' },
      video(),
    )
    await vi.runAllTimersAsync()

    const error = expectErr(await pending, 'CRM_SOCIAL_OAUTH_FAILED')
    expect(error.message).toBe(
      'A Instagram demorou demais para processar a mídia',
    )
    expect(
      fetchMock.calls().filter((c) => pathOf(c.url) === '/container-1'),
    ).toHaveLength(100)
    expect(mockedRemoveBlob).toHaveBeenCalledWith('blob-1')
  })

  it('should fail when media_publish is rejected', async () => {
    fetchMock = graphFlow({
      publish: () => textResponse('rate', { status: 429 }),
    })
    expectErr(
      await publishPost(
        'u1',
        'ws1',
        { caption: 'x', postType: 'FEED' },
        image(),
      ),
      'CRM_SOCIAL_OAUTH_FAILED',
    )
  })

  it('should fail when media_publish returns no id', async () => {
    fetchMock = graphFlow({ publish: () => jsonResponse({}) })
    expectErr(
      await publishPost(
        'u1',
        'ws1',
        { caption: 'x', postType: 'FEED' },
        image(),
      ),
      'CRM_SOCIAL_OAUTH_FAILED',
    )
  })

  it.each([
    ['fails', () => textResponse('x', { status: 500 })],
    ['has no permalink', () => jsonResponse({})],
  ])(
    'should still succeed with a null permalink when the lookup %s',
    async (_, permalink) => {
      fetchMock = graphFlow({ permalink })

      const result = expectOk(
        await publishPost(
          'u1',
          'ws1',
          { caption: 'x', postType: 'FEED' },
          image(),
        ),
      )
      expect(result).toEqual({ postId: 'post-1', permalink: null })
    },
  )
})

describe('deleteMedia()', () => {
  beforeEach(() => {
    asMember('ADMIN')
  })

  it('should DELETE the media with the page token', async () => {
    fetchMock = mockFetch(() => jsonResponse({ success: true }))

    expect(expectOk(await deleteMedia('u1', 'ws1', 'm1', 'conn-1'))).toEqual({
      deletedId: 'm1',
    })
    const [call] = fetchMock.calls()
    expect(call.url).toBe(`${GRAPH}/m1`)
    expect(call.init?.method).toBe('DELETE')
    expect(headerOf(call, 'Authorization')).toBe('Bearer page-token')
  })

  it('should fail when the Graph answers success=false', async () => {
    fetchMock = mockFetch(() => jsonResponse({ success: false }))
    expectErr(await deleteMedia('u1', 'ws1', 'm1'), 'CRM_SOCIAL_OAUTH_FAILED')
  })

  it('should fail on a 403 from the Graph', async () => {
    fetchMock = mockFetch(() =>
      jsonResponse({ error: { message: 'Permissão negada' } }, { status: 403 }),
    )
    const error = expectErr(
      await deleteMedia('u1', 'ws1', 'm1'),
      'CRM_SOCIAL_OAUTH_FAILED',
    )
    expect(error.message).toBe('Permissão negada')
  })
})
