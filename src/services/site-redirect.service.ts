import { auditMutation } from '@/lib/axiom/audit'
import { appError } from '@/src/errors/app-error'
import { err, ok, type Result } from '@/src/lib/result'
import { revalidateSites } from '@/src/lib/sites/cache'
import {
  createsRedirectLoop,
  type SiteRedirectRule,
} from '@/src/lib/sites/redirects'
import { toSiteRedirectDTO } from '@/src/mappers/site-redirect.mapper'
import { SiteRedirectRepository } from '@/src/repositories/site-redirect.repository'
import type {
  CreateSiteRedirectDTO,
  UpdateSiteRedirectDTO,
} from '@/src/schemas/site-redirect.schema'
import type { SiteRedirectDTO } from '@/types/site-platform'
import { authorizeSite } from './site-access'

/** Abuse guard per site. */
export const MAX_REDIRECTS_PER_SITE = 500

const loop = () =>
  appError(
    'SITE_REDIRECT_LOOP',
    'Este redirecionamento leva de volta ao endereço de origem',
  )

function toRule(redirect: SiteRedirectRule): SiteRedirectRule {
  return {
    fromPath: redirect.fromPath,
    toPath: redirect.toPath,
    permanent: redirect.permanent,
  }
}

/**
 * Redirects manager of a site ("Redirecionamentos"). Unlike pages, a
 * redirect is live as soon as it is saved: the runtime reads the table
 * (cached under the site's tag, expired on every change), so moving a page
 * never leaves its old address broken while the draft waits to be
 * published.
 */
export const SiteRedirectService = {
  async list(
    actorId: string,
    workspaceId: string,
    siteId: string,
  ): Promise<Result<SiteRedirectDTO[]>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'VIEW')
    if (!site.ok) return site
    const redirects = await SiteRedirectRepository.listBySite(siteId)
    if (!redirects.ok) return redirects
    return ok(redirects.value.map(toSiteRedirectDTO))
  },

  async create(
    actorId: string,
    workspaceId: string,
    siteId: string,
    dto: CreateSiteRedirectDTO,
  ): Promise<Result<SiteRedirectDTO>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'EDIT')
    if (!site.ok) return site

    const existing = await SiteRedirectRepository.listBySite(siteId)
    if (!existing.ok) return existing
    if (existing.value.length >= MAX_REDIRECTS_PER_SITE) {
      return err(
        appError(
          'SITE_LIMIT_REACHED',
          `Um site pode ter até ${MAX_REDIRECTS_PER_SITE} redirecionamentos`,
        ),
      )
    }
    if (createsRedirectLoop(existing.value.map(toRule), dto)) return err(loop())

    const created = await SiteRedirectRepository.create({ siteId, ...dto })
    if (!created.ok) return created

    revalidateSites(site.value.slug)
    auditMutation({
      entity: 'site_redirect',
      action: 'create',
      actorId,
      targetId: created.value.id,
      meta: { siteId, fromPath: dto.fromPath, permanent: dto.permanent },
    })
    return ok(toSiteRedirectDTO(created.value))
  },

  async update(
    actorId: string,
    workspaceId: string,
    siteId: string,
    redirectId: string,
    dto: UpdateSiteRedirectDTO,
  ): Promise<Result<SiteRedirectDTO>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'EDIT')
    if (!site.ok) return site

    const current = await SiteRedirectRepository.findById(redirectId, siteId)
    if (!current.ok) return current
    const others = await SiteRedirectRepository.listBySite(siteId)
    if (!others.ok) return others

    const next: SiteRedirectRule = {
      fromPath: dto.fromPath ?? current.value.fromPath,
      toPath: dto.toPath ?? current.value.toPath,
      permanent: dto.permanent ?? current.value.permanent,
    }
    const rest = others.value
      .filter((redirect) => redirect.id !== redirectId)
      .map(toRule)
    if (createsRedirectLoop(rest, next)) return err(loop())

    const updated = await SiteRedirectRepository.update(redirectId, dto)
    if (!updated.ok) return updated

    revalidateSites(site.value.slug)
    auditMutation({
      entity: 'site_redirect',
      action: 'update',
      actorId,
      targetId: redirectId,
      meta: { siteId, fields: Object.keys(dto) },
    })
    return ok(toSiteRedirectDTO(updated.value))
  },

  async remove(
    actorId: string,
    workspaceId: string,
    siteId: string,
    redirectId: string,
  ): Promise<Result<void>> {
    const site = await authorizeSite(actorId, workspaceId, siteId, 'EDIT')
    if (!site.ok) return site

    const current = await SiteRedirectRepository.findById(redirectId, siteId)
    if (!current.ok) return current
    const removed = await SiteRedirectRepository.delete(redirectId)
    if (!removed.ok) return removed

    revalidateSites(site.value.slug)
    auditMutation({
      entity: 'site_redirect',
      action: 'delete',
      actorId,
      targetId: redirectId,
      meta: { siteId, fromPath: current.value.fromPath },
    })
    return ok(undefined)
  },

  /** Redirect rules of a site by slug, for the public runtime (no
   * session). An unknown or deleted site has none. */
  async rulesForSlug(slug: string): Promise<Result<SiteRedirectRule[]>> {
    const redirects = await SiteRedirectRepository.listBySiteSlug(slug)
    if (!redirects.ok) return redirects
    return ok(redirects.value.map(toRule))
  },
}
