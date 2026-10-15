/**
 * Approximate Google result snippet ("prévia no Google"): Google cuts
 * titles by pixel width (~580 px on desktop) and descriptions by length.
 * The widths below are an estimate of Arial 20px; good enough to tell the
 * user where the cut falls. Pure.
 */

export type SerpDevice = 'desktop' | 'mobile'

export const SERP_LIMITS: Record<
  SerpDevice,
  { titlePx: number; descriptionChars: number }
> = {
  desktop: { titlePx: 580, descriptionChars: 158 },
  mobile: { titlePx: 920, descriptionChars: 120 },
}

function charWidth(char: string): number {
  if (/[ijlI.,;:'!|]/.test(char)) return 5
  if (/[ftr()[\]{}\s-]/.test(char)) return 7
  if (/[mwMW]/.test(char)) return 16
  if (/[A-Z]/.test(char)) return 13
  return 10
}

export function textPixels(value: string): number {
  let total = 0
  for (const char of value) total += charWidth(char)
  return total
}

function cut(value: string, fits: (candidate: string) => boolean): string {
  if (fits(value)) return value
  let end = value.length
  while (end > 0 && !fits(`${value.slice(0, end).trimEnd()} …`)) end -= 1
  const head = value.slice(0, end)
  const space = head.lastIndexOf(' ')
  return `${(space > end * 0.6 ? head.slice(0, space) : head).trimEnd()} …`
}

export interface SerpPreview {
  title: string
  description: string
  titleCut: boolean
  descriptionCut: boolean
}

/** Title and description as the result page would show them. */
export function serpPreview(
  title: string,
  description: string,
  device: SerpDevice,
): SerpPreview {
  const limits = SERP_LIMITS[device]
  const shownTitle = cut(
    title.trim(),
    (value) => textPixels(value) <= limits.titlePx,
  )
  const shownDescription = cut(
    description.trim(),
    (value) => value.length <= limits.descriptionChars,
  )
  return {
    title: shownTitle,
    description: shownDescription,
    titleCut: shownTitle !== title.trim(),
    descriptionCut: shownDescription !== description.trim(),
  }
}

/** Breadcrumb-style URL of the snippet (`site.com › servicos › implante`). */
export function serpUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const parts = parsed.pathname.split('/').filter(Boolean)
    return [parsed.host, ...parts].join(' › ')
  } catch {
    return url
  }
}
