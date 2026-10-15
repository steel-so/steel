import type { CrmCampaign } from '@prisma/client'
import { BETTER_AUTH_URL } from '@/lib/env/server'
import { campaignDestinationUrl } from '@/src/lib/crm-campaign/campaign-url'
import {
  type CampaignSitePage,
  findPublishedSitePage,
} from '@/src/lib/crm-campaign/site-destination'
import { ok, type Result } from '@/src/lib/result'
import { publicSiteUrl } from '@/src/lib/sites/public-url'
import { parseSiteSnapshot } from '@/src/lib/sites/snapshot'
import {
  type CampaignSiteRecord,
  CrmCampaignLookupRepository,
} from '@/src/repositories/crm-campaign-lookup.repository'
import type { CrmCampaignDestinationDTO } from '@/types/crm-campaign'

/**
 * Where a campaign link goes (ADR 0025): a legacy landing page, a CRM form
 * or — since Sites — a page of a published site. Shared by the wizard
 * (links, summary, launch issues) and the click redirect.
 */

export type CampaignDestinationFields = Pick<
  CrmCampaign,
  | 'workspaceId'
  | 'destinationType'
  | 'landingPageId'
  | 'formId'
  | 'siteId'
  | 'sitePageId'
>

export interface ResolvedCampaignDestination {
  /** Input of `toCrmCampaignLinks`: the landing/form token or the site
   * page URL; `null` when there is nothing a contact could open. */
  ref: string | { url: string } | null
  summary: CrmCampaignDestinationDTO
  /** pt-BR reason the campaign cannot be sent to it yet. */
  issue: string | null
}

/** A site page destination from the site row (pure). */
export function siteDestination(
  site: CampaignSiteRecord,
  pageId: string | null,
): ResolvedCampaignDestination {
  const snapshot = site.snapshot ? parseSiteSnapshot(site.snapshot) : null
  const live = snapshot?.ok ? snapshot.value : null
  const page: CampaignSitePage | null =
    live && pageId
      ? findPublishedSitePage(live, publicSiteUrl(site.slug), pageId)
      : null
  const draftPage = site.pages.find((item) => item.id === pageId)
  const summary: CrmCampaignDestinationDTO = {
    type: 'SITE_PAGE',
    name: site.name,
    pageTitle: page?.title ?? draftPage?.title ?? null,
    url: page?.url ?? null,
    published: page !== null,
  }

  let issue: string | null = null
  if (!pageId) issue = 'Escolha a página do site'
  else if (!live) issue = 'Publique o site antes de enviar a campanha'
  else if (!page) {
    issue = draftPage
      ? 'A página escolhida ainda não está no ar: publique o site de novo'
      : 'A página escolhida não existe mais'
  }
  return { ref: page ? { url: page.url } : null, summary, issue }
}

/** The campaign's destination, or `null` when none is chosen (or it was
 * deleted). */
export async function resolveCampaignDestination(
  campaign: CampaignDestinationFields,
): Promise<Result<ResolvedCampaignDestination | null>> {
  const { workspaceId } = campaign

  if (campaign.destinationType === 'SITE_PAGE') {
    if (!campaign.siteId) return ok(null)
    const site = await CrmCampaignLookupRepository.findSite(
      workspaceId,
      campaign.siteId,
    )
    if (!site.ok) return site
    return ok(
      site.value ? siteDestination(site.value, campaign.sitePageId) : null,
    )
  }

  const isForm = campaign.destinationType === 'FORM'
  const id = isForm ? campaign.formId : campaign.landingPageId
  if (!campaign.destinationType || !id) return ok(null)
  const record = isForm
    ? await CrmCampaignLookupRepository.findForm(workspaceId, id)
    : await CrmCampaignLookupRepository.findLandingPage(workspaceId, id)
  if (!record.ok) return record
  if (!record.value) return ok(null)

  const type = isForm ? 'FORM' : 'LANDING_PAGE'
  return ok({
    ref: record.value.token,
    summary: {
      type,
      name: record.value.name ?? '',
      pageTitle: null,
      url: campaignDestinationUrl(BETTER_AUTH_URL, {
        type,
        token: record.value.token,
      }),
      published: record.value.published,
    },
    issue: record.value.published
      ? null
      : 'Publique o destino antes de enviar a campanha',
  })
}
