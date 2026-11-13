import { BETTER_AUTH_URL } from '@/lib/env/server'
import {
  type CRM_SOCIAL_PLATFORMS,
  crmPlatformToSlug,
} from '@/src/schemas/crm-social.schema'

/**
 * URL de callback OAuth registrada nos painéis dos provedores. É um path
 * FIXO (sem workspaceId) porque os provedores exigem redirect URIs exatas e
 * pré-cadastradas — o workspace viaja no `state`. Precisa ser idêntica entre
 * a autorização e a troca do code, por isso é derivada de um único ponto.
 */
export function socialCallbackUrl(
  platform: (typeof CRM_SOCIAL_PLATFORMS)[number],
): string {
  const base = BETTER_AUTH_URL.replace(/\/$/, '')
  return `${base}/api/social/callback/${crmPlatformToSlug(platform)}`
}
