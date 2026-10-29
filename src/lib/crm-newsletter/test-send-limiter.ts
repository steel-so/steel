import { RateLimiterRedis } from 'rate-limiter-flexible'
import { redis } from '@/src/lib/redis'
import { CRM_NEWSLETTER_TEST_SENDS_PER_HOUR } from '@/src/schemas/crm-newsletter-issue.schema'

/**
 * Test sends of a newsletter issue: 10 per hour per issue (ADR 0054). Kept
 * out of `src/lib/rate-limit.ts` so the slice does not touch the shared
 * limiter list; consumed through `consume()` like every other limiter.
 */
export const newsletterTestSendLimiter = new RateLimiterRedis({
  storeClient: redis,
  storeType: 'redis',
  useRedisPackage: true,
  keyPrefix: 'rl:crm-newsletter:test',
  points: CRM_NEWSLETTER_TEST_SENDS_PER_HOUR,
  duration: 60 * 60,
})
