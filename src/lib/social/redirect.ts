import { BETTER_AUTH_URL, META_PUBLIC_URL } from '@/lib/env/server'
import {
  type CRM_SOCIAL_PLATFORMS,
  crmPlatformToSlug,
} from '@/src/schemas/crm-social.schema'

type SocialPlatform = (typeof CRM_SOCIAL_PLATFORMS)[number]

/** Plataformas cujo app vive no painel da Meta (host fixo em META_PUBLIC_URL). */
const META_PLATFORMS: readonly SocialPlatform[] = ['FACEBOOK', 'INSTAGRAM']

/**
 * URL de callback OAuth registrada nos painéis dos provedores. É um path
 * FIXO (sem workspaceId) porque os provedores exigem redirect URIs exatas e
 * pré-cadastradas — o workspace viaja no `state`. Precisa ser idêntica entre
 * a autorização e a troca do code, por isso é derivada de um único ponto.
 *
 * Facebook e Instagram usam o host da Meta (`META_PUBLIC_URL`); o callback
 * recebido nesse host é repassado ao host canônico pela própria rota.
 */
export function socialCallbackUrl(platform: SocialPlatform): string {
  const origin = META_PLATFORMS.includes(platform)
    ? (META_PUBLIC_URL ?? BETTER_AUTH_URL)
    : BETTER_AUTH_URL
  return `${origin.replace(/\/$/, '')}/api/social/callback/${crmPlatformToSlug(platform)}`
}
