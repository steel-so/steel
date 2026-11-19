import { BETTER_AUTH_SECRET } from '@/lib/env/server'
import { appError } from '@/src/errors/app-error'
import { parseUserAgent } from '@/src/lib/analytics/user-agent'
import {
  bioBlockTitle,
  bioClickDestination,
  utmFromUrl,
} from '@/src/lib/bio-link/visibility'
import { err, ok, type Result } from '@/src/lib/result'
import { referrerHost, siteVisitorHash } from '@/src/lib/sites/visitor'
import { toBioLinkPublicDTO } from '@/src/mappers/bio-link.mapper'
import {
  BioLinkEventRepository,
  BioLinkRepository,
} from '@/src/repositories/bio-link.repository'
import type { RecordBioViewDTO } from '@/src/schemas/bio-link.schema'
import type { BioLinkPublicDTO } from '@/types/bio-link'
import { assertModuleEnabled } from './authz'

/** Who is asking, as the proxy and the route see it (never stored raw). */
export interface BioVisitor {
  ip: string
  userAgent: string
  host: string | null
  /** ISO 3166-1 alpha-2 from the IP, when located. */
  country?: string | null
  now?: Date
}

const notFound = () =>
  appError('BIO_LINK_NOT_FOUND', 'Link da bio não encontrado')

/** The anonymous record of one event: no cookie, no IP. */
function eventBase(
  bioLinkId: string,
  visitor: BioVisitor,
  device: string,
  now: Date,
) {
  return {
    bioLinkId,
    device,
    country: visitor.country ?? null,
    visitorHash: siteVisitorHash({
      ip: visitor.ip,
      userAgent: visitor.userAgent,
      siteId: bioLinkId,
      secret: BETTER_AUTH_SECRET,
      now,
    }),
  }
}

export const BioLinkPublicService = {
  /** The published page behind a slug. No session: the CRM module must be
   * enabled and the page published. */
  async getPublished(slug: string): Promise<Result<BioLinkPublicDTO>> {
    const row = await BioLinkRepository.findPublishedBySlug(slug)
    if (!row.ok) return row
    const enabled = await assertModuleEnabled(row.value.workspaceId, 'CRM')
    if (!enabled.ok) return err(notFound())
    return ok(toBioLinkPublicDTO(row.value))
  },

  /** Page-view beacon. Bots and unknown pages record nothing. */
  async recordView(
    slug: string,
    visitor: BioVisitor,
    dto: RecordBioViewDTO,
  ): Promise<Result<void>> {
    const page = await BioLinkPublicService.getPublished(slug)
    if (!page.ok) return page

    const client = parseUserAgent(visitor.userAgent)
    if (client.device === 'bot') return ok(undefined)

    const now = visitor.now ?? new Date()
    return BioLinkEventRepository.record({
      ...eventBase(page.value.id, visitor, client.device, now),
      kind: 'VIEW',
      referrer: referrerHost(dto.referrer, visitor.host),
      utmSource: dto.utmSource ?? null,
      utmMedium: dto.utmMedium ?? null,
      utmCampaign: dto.utmCampaign ?? null,
    })
  },

  /**
   * Tracked redirect of `/b/<slug>/l/<id>`: where the button leads right now
   * (schedule and active flag checked at click time) and, best-effort, the
   * click. `null` when the block is gone, hidden or not clickable. The UTM of
   * the bio page the visitor came from rides in the `Referer` query.
   */
  async resolveClick(
    slug: string,
    linkId: string,
    visitor: BioVisitor & {
      pageUrl?: string | null
      /** `false` when the caller is rate limited: redirect, record nothing. */
      record?: boolean
    },
  ): Promise<Result<string | null>> {
    const page = await BioLinkPublicService.getPublished(slug)
    if (!page.ok) return page

    const now = visitor.now ?? new Date()
    const block = page.value.blocks.find((item) => item.id === linkId)
    const destination = block ? bioClickDestination(block, now) : null
    if (!block || !destination) return ok(null)

    const client = parseUserAgent(visitor.userAgent)
    if (visitor.record !== false && client.device !== 'bot') {
      const recorded = await BioLinkEventRepository.record({
        ...eventBase(page.value.id, visitor, client.device, now),
        kind: 'CLICK',
        linkId: block.id,
        linkTitle: bioBlockTitle(block).slice(0, 80),
        referrer: referrerHost(visitor.pageUrl, visitor.host),
        ...utmFromUrl(visitor.pageUrl, visitor.host),
      })
      // A failed record never blocks the visitor from reaching the link.
      void recorded
    }
    return ok(destination)
  },
}
