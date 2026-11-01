import type { CRM_SOCIAL_PLATFORMS } from '@/src/schemas/crm-social.schema'
import { facebookProvider } from './facebook'
import { googleAdsProvider } from './google-ads'
import { googleAnalyticsProvider } from './google-analytics'
import { instagramProvider } from './instagram'
import { tiktokProvider } from './tiktok'
import type { SocialProvider } from './types'
import { youtubeProvider } from './youtube'

/** Registry plataforma → provedor OAuth. */
const PROVIDERS: Record<(typeof CRM_SOCIAL_PLATFORMS)[number], SocialProvider> =
  {
    INSTAGRAM: instagramProvider,
    FACEBOOK: facebookProvider,
    TIKTOK: tiktokProvider,
    YOUTUBE: youtubeProvider,
    GOOGLE_ANALYTICS: googleAnalyticsProvider,
    GOOGLE_ADS: googleAdsProvider,
  }

/** Provedor de uma plataforma (sempre existe — o enum é fechado). */
export function getProvider(
  platform: (typeof CRM_SOCIAL_PLATFORMS)[number],
): SocialProvider {
  return PROVIDERS[platform]
}

export type { SocialAccount, SocialProvider, TokenSet } from './types'
