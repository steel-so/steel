import { hasTrackers } from '@/src/lib/sites/csp'
import { resolveSiteHref } from '@/src/lib/sites/host'
import {
  SITE_COOKIE_BANNER_ID,
  SITE_RUNTIME_CONFIG_ID,
  SITE_RUNTIME_SCRIPT,
  serializeRuntimeConfig,
  showsCookieBanner,
  siteRuntimeConfig,
} from '@/src/lib/sites/runtime-script'
import type { SiteSettingsDTO } from '@/src/schemas/site.schema'

/**
 * Cookie banner (rendered hidden; the script shows it when a choice is
 * needed), the page's runtime config and `SITE_RUNTIME_SCRIPT` — the
 * anonymous view/conversion beacon and the trackers loaded only after
 * consent. No React on the client.
 */
export function SiteRuntime({
  slug,
  pageId,
  path,
  settings,
  linkBase,
  nonce,
}: {
  slug: string
  pageId: string
  path: string
  settings: SiteSettingsDTO
  /** Prefix of the site's internal links (see `siteLinkBase`). */
  linkBase: string
  nonce?: string
}) {
  const banner = settings.cookieBanner
  const config = siteRuntimeConfig({
    slug,
    pageId,
    path,
    bannerEnabled: banner.enabled,
    tracking: settings.tracking,
  })
  const trackers = hasTrackers(settings.tracking)
  const message =
    banner.message ||
    (trackers
      ? 'Usamos cookies para medir o uso deste site e melhorar sua experiência. Você escolhe se aceita.'
      : 'Usamos dados de navegação anônimos para entender como este site é usado.')
  return (
    <>
      {showsCookieBanner({
        bannerEnabled: banner.enabled,
        tracking: settings.tracking,
      }) ? (
        <section
          id={SITE_COOKIE_BANNER_ID}
          className='ss-cookie'
          aria-label='Aviso de cookies'
          hidden
        >
          <p>
            {message}
            {banner.policyUrl ? (
              <>
                {' '}
                <a href={resolveSiteHref(banner.policyUrl, linkBase)}>
                  Política de privacidade
                </a>
              </>
            ) : null}
          </p>
          <div className='ss-cookie-actions'>
            <button type='button' data-consent='rejected'>
              Rejeitar
            </button>
            <button type='button' data-consent='accepted' data-primary=''>
              Aceitar
            </button>
          </div>
        </section>
      ) : null}
      <script
        id={SITE_RUNTIME_CONFIG_ID}
        type='application/json'
        dangerouslySetInnerHTML={{ __html: serializeRuntimeConfig(config) }}
      />
      <script
        nonce={nonce}
        dangerouslySetInnerHTML={{ __html: SITE_RUNTIME_SCRIPT }}
      />
    </>
  )
}
