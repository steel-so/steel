/**
 * Destination of a "Link da bio" button. Users type what they know — a
 * handle, a phone number, a plain address — and the page turns it into a
 * safe URL. Pure: the same function validates on save and resolves on the
 * click redirect, so nothing that passes validation can resolve to `null`.
 *
 * Only `https:`, `http:`, `mailto:` and `tel:` ever come out (no
 * `javascript:` or `data:`), and relative `/f/<token>` for CRM forms.
 */

export const BIO_NETWORKS = [
  'custom',
  'whatsapp',
  'instagram',
  'facebook',
  'site',
  'youtube',
  'tiktok',
  'email',
  'phone',
] as const

export type BioNetwork = (typeof BIO_NETWORKS)[number]

export const BIO_NETWORK_LABELS: Record<BioNetwork, string> = {
  custom: 'Link',
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  facebook: 'Facebook',
  site: 'Site',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  email: 'E-mail',
  phone: 'Telefone',
}

export interface BioDestinationInput {
  network: BioNetwork
  value: string
  message?: string | null
}

const HANDLE = /^@?[A-Za-z0-9._-]{1,60}$/
const EMAIL =
  /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]+$/

/** `https://` added to a bare address; `null` for anything but http(s). */
export function normalizeWebUrl(raw: string): string | null {
  const text = raw.trim()
  if (!text || /\s/.test(text)) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text)
    ? text
    : `https://${text}`
  try {
    const url = new URL(withScheme)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (!url.hostname.includes('.')) return null
    return url.toString()
  } catch {
    return null
  }
}

/** Digits of a Brazilian phone, with the `55` country code added when the
 * number has the 10–11 digits of a national one. `null` outside 10–15. */
export function normalizePhoneDigits(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10 || digits.length === 11) return `55${digits}`
  if (digits.length >= 12 && digits.length <= 15) return digits
  return null
}

function handleOf(raw: string): string | null {
  const text = raw.trim()
  if (!HANDLE.test(text)) return null
  return text.replace(/^@/, '')
}

function socialUrl(
  raw: string,
  hosts: string[],
  build: (handle: string) => string,
): string | null {
  const text = raw.trim()
  if (/^https?:\/\//i.test(text) || hosts.some((host) => text.includes(host))) {
    return normalizeWebUrl(text)
  }
  const handle = handleOf(text)
  return handle ? build(handle) : null
}

/** The URL a button leads to, or `null` when the value does not fit the
 * network. */
export function resolveBioDestination(
  input: BioDestinationInput,
): string | null {
  const value = input.value.trim()
  if (!value) return null
  switch (input.network) {
    case 'custom':
    case 'site':
      return normalizeWebUrl(value)
    case 'whatsapp': {
      const digits = normalizePhoneDigits(value)
      if (!digits) return null
      const message = input.message?.trim()
      return message
        ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}`
        : `https://wa.me/${digits}`
    }
    case 'instagram':
      return socialUrl(
        value,
        ['instagram.com'],
        (handle) => `https://www.instagram.com/${handle}/`,
      )
    case 'facebook':
      return socialUrl(
        value,
        ['facebook.com', 'fb.com', 'fb.me'],
        (handle) => `https://www.facebook.com/${handle}`,
      )
    case 'tiktok':
      return socialUrl(
        value,
        ['tiktok.com'],
        (handle) => `https://www.tiktok.com/@${handle}`,
      )
    case 'youtube':
      return socialUrl(
        value,
        ['youtube.com', 'youtu.be'],
        (handle) => `https://www.youtube.com/@${handle}`,
      )
    case 'email':
      return EMAIL.test(value) ? `mailto:${value}` : null
    case 'phone': {
      const digits = normalizePhoneDigits(value)
      return digits ? `tel:+${digits}` : null
    }
    default:
      return null
  }
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/

function parseUrl(text: string): URL | null {
  try {
    return new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`)
  } catch {
    return null
  }
}

/** Video id of a YouTube watch, short, embed, shorts or live address. */
export function youtubeVideoId(raw: string): string | null {
  const text = raw.trim()
  if (YOUTUBE_ID.test(text)) return text
  const url = parseUrl(text)
  if (!url) return null
  const host = url.hostname.replace(/^www\.|^m\./, '')
  let id: string | null = null
  if (host === 'youtu.be') {
    id = url.pathname.slice(1).split('/')[0] ?? null
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') {
      id = url.searchParams.get('v')
    } else {
      const [kind, value] = url.pathname.split('/').filter(Boolean)
      if (kind === 'embed' || kind === 'shorts' || kind === 'live') {
        id = value ?? null
      }
    }
  }
  return id && YOUTUBE_ID.test(id) ? id : null
}
