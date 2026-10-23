import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  asMember,
  describeSocialAuthz,
  withToken,
} from '@/src/__tests__/helpers/crm-social.helpers'
import {
  headerOf,
  jsonResponse,
  mockFetch,
  textResponse,
} from '@/src/__tests__/helpers/fetch.helpers'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/services/crm-social-token')

import {
  deletePost,
  getInsights,
  getOverview,
  getRecentPosts,
  publishPost,
} from '../crm-social-facebook.service'
import { getFreshAccessToken } from '../crm-social-token'

const GRAPH = 'https://graph.facebook.com/v26.0'
const PAGE = 'page-1'
const ALL_SCOPES = 'pages_read_engagement,read_insights,pages_manage_posts'
const NOW = new Date('2026-09-18T12:00:00.000Z')

let fetchMock: ReturnType<typeof mockFetch>

function media(kind: 'IMAGE' | 'VIDEO') {
  return {
    bytes: new Uint8Array([1, 2, 3]).buffer,
    contentType: kind === 'IMAGE' ? 'image/png' : 'video/mp4',
    kind,
  }
}

beforeEach(() => {
  fetchMock = mockFetch(() => {
    throw new Error('unexpected fetch')
  })
  asMember('MEMBER')
  withToken({ scope: ALL_SCOPES, externalAccountId: PAGE }, 'page-token')
})

afterEach(() => {
  vi.useRealTimers()
})

describeSocialAuthz(
  [
    {
      name: 'getOverview()',
      action: 'VIEW',
      scope: 'pages_read_engagement',
      call: () => getOverview('u1', 'ws1'),
    },
    {
      name: 'getInsights()',
      action: 'VIEW',
      scope: 'read_insights',
      call: () => getInsights('u1', 'ws1', '7d'),
    },
    {
      name: 'getRecentPosts()',
      action: 'VIEW',
      scope: 'pages_read_engagement',
      call: () => getRecentPosts('u1', 'ws1'),
    },
    {
      name: 'publishPost()',
      action: 'CREATE',
      scope: 'pages_manage_posts',
      call: () => publishPost('u1', 'ws1', { message: 'Oi', link: null }, null),
    },
    {
      name: 'deletePost()',
      action: 'DELETE',
      scope: 'pages_manage_posts',
      call: () => deletePost('u1', 'ws1', 'p1'),
    },
  ],
  () => fetchMock.spy,
)

describe('getOverview()', () => {
  it('should fetch the page with its token and map it to the DTO', async () => {
    fetchMock = mockFetch(() =>
      jsonResponse({
        id: PAGE,
        name: 'Acme',
        about: 'Sobre',
        link: 'https://facebook.com/acme',
        fan_count: '1200',
        followers_count: 1300,
        picture: { data: { url: 'https://cdn/pic.jpg' } },
      }),
    )

    const overview = expectOk(await getOverview('u1', 'ws1', 'conn-1'))

    expect(overview).toEqual({
      pageId: PAGE,
      name: 'Acme',
      about: 'Sobre',
      link: 'https://facebook.com/acme',
      pictureUrl: 'https://cdn/pic.jpg',
      fanCount: 1200,
      followersCount: 1300,
    })
    expect(getFreshAccessToken).toHaveBeenCalledWith(
      'ws1',
      'FACEBOOK',
      'conn-1',
    )
    const [call] = fetchMock.calls()
    const url = new URL(call.url)
    expect(`${url.origin}${url.pathname}`).toBe(`${GRAPH}/${PAGE}`)
    expect(url.searchParams.get('fields')).toContain('picture.type(large)')
    expect(headerOf(call, 'Authorization')).toBe('Bearer page-token')
  })

  it('should fill defaults for a sparse page payload', async () => {
    fetchMock = mockFetch(() => jsonResponse({ id: PAGE }))

    expect(expectOk(await getOverview('u1', 'ws1'))).toEqual({
      pageId: PAGE,
      name: 'Página',
      about: null,
      link: null,
      pictureUrl: null,
      fanCount: 0,
      followersCount: 0,
    })
  })

  it('should map a 401 to CRM_SOCIAL_OAUTH_FAILED with the Graph message', async () => {
    fetchMock = mockFetch(() =>
      jsonResponse(
        { error: { message: 'Error validating access token' } },
        { status: 401 },
      ),
    )
    const error = expectErr(
      await getOverview('u1', 'ws1'),
      'CRM_SOCIAL_OAUTH_FAILED',
    )
    expect(error.message).toBe('Error validating access token')
  })
})

describe('getInsights()', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })

  it('should fetch each page metric separately and merge them by day', async () => {
    fetchMock = mockFetch((url) => {
      const metric = new URL(url).searchParams.get('metric')
      if (metric === 'page_total_media_view_unique') {
        return jsonResponse({
          data: [
            {
              values: [
                { value: 30, end_time: '2026-09-17T07:00:00+0000' },
                { value: 20, end_time: '2026-09-15T07:00:00+0000' },
                { value: 1 },
              ],
            },
          ],
        })
      }
      if (metric === 'page_post_engagements') {
        return jsonResponse({
          data: [{ values: [{ value: 4, end_time: '2026-09-17T07:00' }] }, {}],
        })
      }
      return textResponse('deprecated metric', { status: 400 })
    })

    const insights = expectOk(await getInsights('u1', 'ws1', '28d'))

    expect(insights).toEqual({
      range: '28d',
      startDate: '2026-08-21',
      endDate: '2026-09-18',
      totals: { impressions: 50, engagements: 4, fanAdds: 0 },
      series: [
        { date: '2026-09-15', impressions: 20, engagements: 0, fanAdds: 0 },
        { date: '2026-09-17', impressions: 30, engagements: 4, fanAdds: 0 },
      ],
    })
    const calls = fetchMock.calls()
    expect(calls.map((c) => new URL(c.url).searchParams.get('metric'))).toEqual(
      [
        'page_total_media_view_unique',
        'page_post_engagements',
        'page_daily_follows',
      ],
    )
    const params = new URL(calls[0].url).searchParams
    expect(new URL(calls[0].url).pathname).toBe(`/v26.0/${PAGE}/insights`)
    expect(params.get('period')).toBe('day')
    expect(params.get('since')).toBe('2026-08-21')
    expect(params.get('until')).toBe('2026-09-18')
  })

  it('should return zeroed totals when there is no data at all', async () => {
    fetchMock = mockFetch(() => jsonResponse({}))

    const insights = expectOk(await getInsights('u1', 'ws1', '7d'))
    expect(insights.startDate).toBe('2026-09-11')
    expect(insights.series).toEqual([])
    expect(insights.totals).toEqual({
      impressions: 0,
      engagements: 0,
      fanAdds: 0,
    })
  })
})

describe('getRecentPosts()', () => {
  it('should list the latest posts flagging video attachments', async () => {
    fetchMock = mockFetch(() =>
      jsonResponse({
        data: [
          {
            id: 'p1',
            message: 'Olá',
            story: 'Acme atualizou',
            full_picture: 'https://cdn/p1.jpg',
            permalink_url: 'https://facebook.com/p1',
            created_time: '2026-09-17T10:00:00+0000',
            attachments: { data: [{ media_type: 'video' }] },
          },
          { attachments: { data: [{ media_type: 'photo' }] } },
          {},
        ],
      }),
    )

    const { posts } = expectOk(await getRecentPosts('u1', 'ws1'))

    expect(posts).toEqual([
      {
        id: 'p1',
        message: 'Olá',
        story: 'Acme atualizou',
        fullPicture: 'https://cdn/p1.jpg',
        permalinkUrl: 'https://facebook.com/p1',
        createdTime: '2026-09-17T10:00:00+0000',
        isVideo: true,
      },
      {
        id: '',
        message: null,
        story: null,
        fullPicture: null,
        permalinkUrl: null,
        createdTime: '',
        isVideo: false,
      },
      {
        id: '',
        message: null,
        story: null,
        fullPicture: null,
        permalinkUrl: null,
        createdTime: '',
        isVideo: false,
      },
    ])
    const url = new URL(fetchMock.calls()[0].url)
    expect(url.pathname).toBe(`/v26.0/${PAGE}/posts`)
    expect(url.searchParams.get('limit')).toBe('20')
  })

  it('should return an empty list when data is absent', async () => {
    fetchMock = mockFetch(() => jsonResponse({}))
    expect(expectOk(await getRecentPosts('u1', 'ws1')).posts).toEqual([])
  })

  it('should propagate a rate limit (429)', async () => {
    fetchMock = mockFetch(() => textResponse('too many', { status: 429 }))
    expectErr(await getRecentPosts('u1', 'ws1'), 'CRM_SOCIAL_OAUTH_FAILED')
  })
})

describe('publishPost()', () => {
  it('should post text + link to /feed as a form', async () => {
    fetchMock = mockFetch(() => jsonResponse({ id: 'page-1_post-1' }))

    const result = expectOk(
      await publishPost(
        'u1',
        'ws1',
        { message: 'Novidade', link: 'https://acme.test' },
        null,
      ),
    )

    expect(result).toEqual({
      postId: 'page-1_post-1',
      url: 'https://www.facebook.com/page-1_post-1',
    })
    const [call] = fetchMock.calls()
    expect(call.url).toBe(`${GRAPH}/${PAGE}/feed`)
    expect(call.init?.method).toBe('POST')
    expect(
      Object.fromEntries(new URLSearchParams(String(call.init?.body))),
    ).toEqual({
      access_token: 'page-token',
      message: 'Novidade',
      link: 'https://acme.test',
    })
  })

  it('should omit the link field when there is no link', async () => {
    fetchMock = mockFetch(() => jsonResponse({ id: 'x' }))

    expectOk(
      await publishPost('u1', 'ws1', { message: 'Só texto', link: null }, null),
    )

    const body = new URLSearchParams(String(fetchMock.calls()[0].init?.body))
    expect(body.has('link')).toBe(false)
  })

  it('should fail when /feed returns no id', async () => {
    fetchMock = mockFetch(() => jsonResponse({}))
    expectErr(
      await publishPost('u1', 'ws1', { message: 'x', link: null }, null),
      'CRM_SOCIAL_OAUTH_FAILED',
    )
  })

  it('should propagate a /feed failure', async () => {
    fetchMock = mockFetch(() =>
      jsonResponse(
        { error: { error_user_msg: 'Conteúdo duplicado' } },
        { status: 400 },
      ),
    )
    const error = expectErr(
      await publishPost('u1', 'ws1', { message: 'x', link: null }, null),
      'CRM_SOCIAL_OAUTH_FAILED',
    )
    expect(error.message).toBe('Conteúdo duplicado')
  })

  it('should upload an image to /photos preferring post_id', async () => {
    fetchMock = mockFetch(() =>
      jsonResponse({ id: 'photo-1', post_id: 'page-1_post-2' }),
    )

    const result = expectOk(
      await publishPost(
        'u1',
        'ws1',
        { message: 'Legenda', link: 'https://ignored.test' },
        media('IMAGE'),
      ),
    )

    expect(result.postId).toBe('page-1_post-2')
    const [call] = fetchMock.calls()
    expect(call.url).toBe(`${GRAPH}/${PAGE}/photos`)
    const form = call.init?.body as FormData
    expect(form.get('access_token')).toBe('page-token')
    expect(form.get('message')).toBe('Legenda')
    const source = form.get('source') as File
    expect(source.type).toBe('image/png')
    expect(source.size).toBe(3)
  })

  it('should fall back to the photo id and skip an empty caption', async () => {
    fetchMock = mockFetch(() => jsonResponse({ id: 'photo-1' }))

    const result = expectOk(
      await publishPost(
        'u1',
        'ws1',
        { message: '', link: null },
        media('IMAGE'),
      ),
    )

    expect(result.postId).toBe('photo-1')
    const form = fetchMock.calls()[0].init?.body as FormData
    expect(form.has('message')).toBe(false)
  })

  it('should fail when /photos returns no id', async () => {
    fetchMock = mockFetch(() => jsonResponse({}))
    expectErr(
      await publishPost(
        'u1',
        'ws1',
        { message: 'x', link: null },
        media('IMAGE'),
      ),
      'CRM_SOCIAL_OAUTH_FAILED',
    )
  })

  it('should propagate a /photos network failure', async () => {
    fetchMock = mockFetch(() => {
      throw new TypeError('socket hang up')
    })
    expectErr(
      await publishPost(
        'u1',
        'ws1',
        { message: 'x', link: null },
        media('IMAGE'),
      ),
      'CRM_SOCIAL_OAUTH_FAILED',
    )
  })

  it('should upload a video to /videos with the message as description', async () => {
    fetchMock = mockFetch(() => jsonResponse({ id: 'video-1' }))

    const result = expectOk(
      await publishPost(
        'u1',
        'ws1',
        { message: 'Assista', link: null },
        media('VIDEO'),
      ),
    )

    expect(result).toEqual({
      postId: 'video-1',
      url: 'https://www.facebook.com/video-1',
    })
    const [call] = fetchMock.calls()
    expect(call.url).toBe(`${GRAPH}/${PAGE}/videos`)
    const form = call.init?.body as FormData
    expect(form.get('description')).toBe('Assista')
    expect((form.get('source') as File).type).toBe('video/mp4')
  })

  it('should skip an empty video description', async () => {
    fetchMock = mockFetch(() => jsonResponse({ id: 'video-1' }))

    expectOk(
      await publishPost(
        'u1',
        'ws1',
        { message: '', link: null },
        media('VIDEO'),
      ),
    )

    const form = fetchMock.calls()[0].init?.body as FormData
    expect(form.has('description')).toBe(false)
  })

  it('should fail when /videos returns no id', async () => {
    fetchMock = mockFetch(() => jsonResponse({}))
    expectErr(
      await publishPost(
        'u1',
        'ws1',
        { message: 'x', link: null },
        media('VIDEO'),
      ),
      'CRM_SOCIAL_OAUTH_FAILED',
    )
  })

  it('should propagate a /videos 5xx', async () => {
    fetchMock = mockFetch(() => textResponse('oops', { status: 502 }))
    expectErr(
      await publishPost(
        'u1',
        'ws1',
        { message: 'x', link: null },
        media('VIDEO'),
      ),
      'CRM_SOCIAL_OAUTH_FAILED',
    )
  })
})

describe('deletePost()', () => {
  beforeEach(() => {
    asMember('ADMIN')
  })

  it('should DELETE the post with the page token', async () => {
    fetchMock = mockFetch(() => jsonResponse({ success: true }))

    expect(expectOk(await deletePost('u1', 'ws1', 'p1', 'conn-1'))).toEqual({
      deletedId: 'p1',
    })
    const [call] = fetchMock.calls()
    expect(call.url).toBe(`${GRAPH}/p1`)
    expect(call.init?.method).toBe('DELETE')
    expect(headerOf(call, 'Authorization')).toBe('Bearer page-token')
  })

  it('should fail when the Graph answers success=false', async () => {
    fetchMock = mockFetch(() => jsonResponse({ success: false }))
    expectErr(await deletePost('u1', 'ws1', 'p1'), 'CRM_SOCIAL_OAUTH_FAILED')
  })

  it('should fail on a malformed JSON body', async () => {
    fetchMock = mockFetch(() => textResponse('{oops'))
    expectErr(await deletePost('u1', 'ws1', 'p1'), 'CRM_SOCIAL_OAUTH_FAILED')
  })

  it('should propagate a 404 from the Graph', async () => {
    fetchMock = mockFetch(() => textResponse('', { status: 404 }))
    expectErr(await deletePost('u1', 'ws1', 'p1'), 'CRM_SOCIAL_OAUTH_FAILED')
  })
})
