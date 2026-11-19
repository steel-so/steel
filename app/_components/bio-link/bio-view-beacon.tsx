'use client'

import { useEffect } from 'react'

/**
 * Anonymous page-view beacon of a bio page. Sends only the referrer and the
 * UTM of the address; the server turns the visit into a daily hash (no cookie,
 * no storage on the device, no third party).
 */
export function BioViewBeacon({ slug }: { slug: string }) {
  useEffect(() => {
    const query = new URLSearchParams(window.location.search)
    const pick = (key: string) => query.get(key)?.slice(0, 120) || undefined
    void fetch(`/api/b/${encodeURIComponent(slug)}/view`, {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        referrer: document.referrer || undefined,
        utmSource: pick('utm_source'),
        utmMedium: pick('utm_medium'),
        utmCampaign: pick('utm_campaign'),
      }),
    }).catch(() => undefined)
  }, [slug])
  return null
}
