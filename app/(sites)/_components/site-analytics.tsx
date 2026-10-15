'use client'

import { useEffect, useState } from 'react'

/**
 * Page-view beacon and cookie banner of a published site. Without a banner
 * the view is sent right away (anonymous: nothing is stored on the device,
 * the server keeps only a daily hash). With the banner on, nothing is sent
 * until the visitor accepts; the choice lives in localStorage per site.
 */

const UTM_KEYS = ['source', 'medium', 'campaign', 'term', 'content'] as const

type Choice = 'accepted' | 'rejected'

function storageKey(slug: string) {
  return `steel-site-consent:${slug}`
}

function readChoice(slug: string): Choice | null {
  try {
    const value = window.localStorage.getItem(storageKey(slug))
    return value === 'accepted' || value === 'rejected' ? value : null
  } catch {
    return null
  }
}

function sendView(slug: string, pageId: string, path: string) {
  const params = new URLSearchParams(window.location.search)
  const body: Record<string, string> = { pageId, path }
  if (document.referrer) body.referrer = document.referrer
  for (const key of UTM_KEYS) {
    const value = params.get(`utm_${key}`)
    if (value) body[`utm${key[0].toUpperCase()}${key.slice(1)}`] = value
  }
  void fetch(`/api/sites/${encodeURIComponent(slug)}/views`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => {})
}

export function SiteAnalytics({
  slug,
  pageId,
  path,
  banner,
}: {
  slug: string
  pageId: string
  path: string
  banner: { enabled: boolean; message?: string; policyUrl?: string } | null
}) {
  const [choice, setChoice] = useState<Choice | null | 'unknown'>('unknown')

  useEffect(() => {
    setChoice(banner?.enabled ? readChoice(slug) : 'accepted')
  }, [banner?.enabled, slug])

  useEffect(() => {
    if (choice === 'accepted') sendView(slug, pageId, path)
  }, [choice, slug, pageId, path])

  if (!banner?.enabled || choice !== null) return null

  const decide = (next: Choice) => {
    try {
      window.localStorage.setItem(storageKey(slug), next)
    } catch {
      // Private mode: the choice lasts for this page only.
    }
    setChoice(next)
  }

  return (
    <section className='ss-cookie' aria-label='Aviso de cookies'>
      <p>
        {banner.message ||
          'Usamos dados de navegação anônimos para entender como este site é usado.'}
        {banner.policyUrl ? (
          <>
            {' '}
            <a href={banner.policyUrl}>Política de privacidade</a>
          </>
        ) : null}
      </p>
      <div className='ss-cookie-actions'>
        <button type='button' onClick={() => decide('rejected')}>
          Rejeitar
        </button>
        <button type='button' data-primary onClick={() => decide('accepted')}>
          Aceitar
        </button>
      </div>
    </section>
  )
}
