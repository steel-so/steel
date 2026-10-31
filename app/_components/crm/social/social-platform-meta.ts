import {
  Facebook01Icon,
  GoogleIcon,
  InstagramIcon,
  Megaphone01Icon,
  TiktokIcon,
  YoutubeIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import {
  CRM_SOCIAL_PLATFORM_LABELS,
  CRM_SOCIAL_PLATFORMS,
  crmPlatformToSlug,
} from '@/src/schemas/crm-social.schema'

type IconType = typeof InstagramIcon

export type CrmSocialPlatformMeta = {
  platform: (typeof CRM_SOCIAL_PLATFORMS)[number]
  slug: string
  label: string
  icon: IconType
  color: string
}

const ICONS: Record<(typeof CRM_SOCIAL_PLATFORMS)[number], IconType> = {
  INSTAGRAM: InstagramIcon,
  FACEBOOK: Facebook01Icon,
  TIKTOK: TiktokIcon,
  YOUTUBE: YoutubeIcon,
  GOOGLE_ANALYTICS: GoogleIcon,
  GOOGLE_ADS: Megaphone01Icon,
}

const COLORS: Record<(typeof CRM_SOCIAL_PLATFORMS)[number], string> = {
  INSTAGRAM: 'bg-pink-500',
  FACEBOOK: 'bg-blue-600',
  TIKTOK: 'bg-neutral-900',
  YOUTUBE: 'bg-red-600',
  GOOGLE_ANALYTICS: 'bg-orange-500',
  GOOGLE_ADS: 'bg-blue-500',
}

/** Metadados das plataformas suportadas — fonte única para os studios/nav. */
export const CRM_SOCIAL_PLATFORM_META: CrmSocialPlatformMeta[] =
  CRM_SOCIAL_PLATFORMS.map((platform) => ({
    platform,
    slug: crmPlatformToSlug(platform),
    label: CRM_SOCIAL_PLATFORM_LABELS[platform],
    icon: ICONS[platform],
    color: COLORS[platform],
  }))
