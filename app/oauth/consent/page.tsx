import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { IntegrationGrantService } from '@/src/services/integration-grant.service'
import { OAuthConsentError, OAuthConsentForm } from './consent-form'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

/** Rebuilds the signed query, keeping repeated keys (`ba_param`). */
function toQueryString(params: Record<string, string | string[] | undefined>) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue
    for (const item of Array.isArray(value) ? value : [value]) {
      search.append(key, item)
    }
  }
  return search.toString()
}

/**
 * OAuth consent of the Steel provider (ADR 0033). The provider redirects
 * here with a signed query; the user picks the workspace, the modules and
 * the access level. The proxy already guarantees a session cookie; an
 * expired one still sends the user to sign in and back.
 */
export default async function OAuthConsentPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  await connection()
  const oauthQuery = toQueryString(await searchParams)

  const session = await getAuthSession()
  if (!session.ok) {
    redirect(
      `/sign-in?redirect=${encodeURIComponent(`/oauth/consent?${oauthQuery}`)}`,
    )
  }

  const context = await IntegrationGrantService.getConsentContext(
    session.value.user.id,
    oauthQuery,
  )
  if (!context.ok) return <OAuthConsentError message={context.error.message} />

  return (
    <OAuthConsentForm
      context={context.value}
      oauthQuery={oauthQuery}
      userEmail={session.value.user.email}
    />
  )
}
