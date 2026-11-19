import type { BioBlockDTO } from '@/src/schemas/bio-link.schema'
import { resolveBioDestination } from './destination'

/** Is the block on the page at `now`? Active, inside its schedule window and
 * (for buttons) with a destination that resolves. */
export function isBioBlockVisible(block: BioBlockDTO, now: Date): boolean {
  if (!block.active) return false
  const time = now.getTime()
  if (block.startsAt && time < Date.parse(block.startsAt)) return false
  if (block.endsAt && time >= Date.parse(block.endsAt)) return false
  if (block.type === 'link' && !resolveBioDestination(block)) return false
  return true
}

/** The blocks a visitor sees. A section header with nothing visible below
 * it (before the next header) is dropped too. */
export function visibleBioBlocks(
  blocks: BioBlockDTO[],
  now: Date,
): BioBlockDTO[] {
  const visible = blocks.filter((block) => isBioBlockVisible(block, now))
  return visible.filter((block, index) => {
    if (block.type !== 'header') return true
    const next = visible[index + 1]
    return next !== undefined && next.type !== 'header'
  })
}

/** Where a click on `block` leads (a relative `/f/<token>` for a CRM form),
 * or `null` when the block is not clickable or not visible. */
export function bioClickDestination(
  block: BioBlockDTO,
  now: Date,
): string | null {
  if (!isBioBlockVisible(block, now)) return null
  if (block.type === 'link') return resolveBioDestination(block)
  if (block.type === 'form' && block.mode === 'link') {
    return `/f/${encodeURIComponent(block.formToken)}`
  }
  return null
}

/** Title shown for a block in the click statistics. */
export function bioBlockTitle(block: BioBlockDTO): string {
  if (block.type === 'video') return block.title?.trim() || 'Vídeo'
  return block.title
}

/** Query parameters worth keeping from the page the visitor came from. */
export function utmFromUrl(
  rawUrl: string | null | undefined,
  ownHost: string | null | undefined,
): { utmSource?: string; utmMedium?: string; utmCampaign?: string } {
  if (!rawUrl) return {}
  try {
    const url = new URL(rawUrl)
    if (ownHost && url.host.toLowerCase() !== ownHost.toLowerCase()) return {}
    const pick = (key: string) =>
      url.searchParams.get(key)?.trim().slice(0, 120) || undefined
    return {
      utmSource: pick('utm_source'),
      utmMedium: pick('utm_medium'),
      utmCampaign: pick('utm_campaign'),
    }
  } catch {
    return {}
  }
}
