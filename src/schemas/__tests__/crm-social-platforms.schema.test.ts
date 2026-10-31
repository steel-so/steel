import { describe, expect, it } from 'vitest'
import {
  CRM_FB_INSIGHTS_RANGE_DAYS,
  CrmFacebookInsightsRangeSchema,
  CrmFacebookInsightsSchema,
  CrmFacebookPageOverviewSchema,
  CrmFacebookPostsSchema,
  CrmPublishFacebookPostResultSchema,
  CrmPublishFacebookPostSchema,
} from '../crm-social-facebook.schema'
import { TrendingItemSchema } from '../crm-social-trending.schema'

describe('Facebook contracts', () => {
  it('should default the insights range to 28 days', () => {
    expect(CrmFacebookInsightsRangeSchema.parse(undefined)).toBe('28d')
    expect(CRM_FB_INSIGHTS_RANGE_DAYS).toEqual({
      '7d': 7,
      '28d': 28,
      '90d': 90,
    })
    expect(CrmFacebookInsightsRangeSchema.safeParse('1y').success).toBe(false)
  })

  it('should require a message or a link to publish', () => {
    expect(CrmPublishFacebookPostSchema.safeParse({}).success).toBe(false)
    expect(
      CrmPublishFacebookPostSchema.safeParse({ message: '   ' }).success,
    ).toBe(false)
    expect(CrmPublishFacebookPostSchema.parse({ message: ' Olá ' })).toEqual({
      message: 'Olá',
      link: null,
    })
    expect(
      CrmPublishFacebookPostSchema.parse({ link: 'https://stratus.com.br' }),
    ).toEqual({ message: '', link: 'https://stratus.com.br' })
  })

  it('should reject an invalid link', () => {
    const result = CrmPublishFacebookPostSchema.safeParse({
      message: 'Oi',
      link: 'not-a-url',
    })
    expect(result.success).toBe(false)
  })

  it('should validate page overview, insights and posts payloads', () => {
    expect(
      CrmFacebookPageOverviewSchema.safeParse({
        pageId: 'p1',
        name: 'Stratus',
        about: null,
        link: null,
        pictureUrl: null,
        fanCount: 10,
        followersCount: -1,
      }).success,
    ).toBe(false)
    expect(
      CrmFacebookInsightsSchema.parse({
        startDate: '2026-09-01',
        endDate: '2026-09-28',
        totals: { impressions: 5, engagements: 2, fanAdds: -1 },
        series: [
          { date: '2026-09-01', impressions: 5, engagements: 2, fanAdds: -1 },
        ],
      }).range,
    ).toBe('28d')
    expect(
      CrmFacebookPostsSchema.safeParse({
        posts: [
          {
            id: 'x',
            message: null,
            story: null,
            fullPicture: null,
            permalinkUrl: null,
            createdTime: '2026-09-01',
            isVideo: false,
          },
        ],
      }).success,
    ).toBe(true)
    expect(
      CrmPublishFacebookPostResultSchema.safeParse({ postId: '1', url: 'u' })
        .success,
    ).toBe(true)
  })
})

describe('TrendingItemSchema', () => {
  const item = {
    id: 't1',
    platform: 'INSTAGRAM',
    thumbnailUrl: null,
    caption: null,
    permalink: null,
    postedAt: '2026-09-01',
    views: null,
    likes: 3,
    comments: 1,
    shares: null,
    saved: null,
    score: 4.5,
  }

  it('should accept a known platform', () => {
    expect(TrendingItemSchema.safeParse(item).success).toBe(true)
  })

  it('should reject unknown platforms and negative counters', () => {
    expect(
      TrendingItemSchema.safeParse({ ...item, platform: 'ORKUT' }).success,
    ).toBe(false)
    expect(TrendingItemSchema.safeParse({ ...item, likes: -1 }).success).toBe(
      false,
    )
  })
})
