import type { ComponentType } from 'react'
import type { CustomControlProps } from '@/src/lib/canvas/registry'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import { type CanvasLink, linkHref } from '@/src/lib/canvas/values'
import { safeHref } from './sanitize'
import type { SiteFormField } from './schemas'

/**
 * What the site components need from outside the document: the site's
 * pages (menus, page links), live CRM forms and who is editing. The editor
 * and the public runtime build one per render; every field is optional so
 * a bare `createSiteCatalog()` validates and renders on its own.
 */

export interface SitePageLink {
  id: string
  title: string
  /** Public path (`/`, `/sobre`). */
  path: string
  parentId?: string | null
  /** Listed by `site.menu` with `source: pages` (default true). */
  showInMenu?: boolean
}

/** Live data of a published CRM form (preferred over the snapshot the
 * `site.form` node keeps). */
export interface SiteLiveForm {
  fields: SiteFormField[]
  successMessage?: string | null
  redirectUrl?: string | null
}

export interface SiteRenderContext {
  pages?: SitePageLink[]
  /** Page being rendered (`aria-current` in menus). */
  currentPageId?: string
  /** Public URL of a page id; defaults to its `path` in `pages`. */
  pageHref?: (pageId: string) => string | undefined
  /** Live forms by public token. */
  forms?: Record<string, SiteLiveForm>
  /** Endpoint a form posts to; defaults to the CRM forms submit route. */
  formAction?: (token: string) => string
  /** Workspace admin: `site.embed` shows in the palette. */
  canEmbed?: boolean
  /** Inspector control that picks a CRM form (site-ui provides it);
   * without it the token is typed in a text field. */
  formPicker?: ComponentType<CustomControlProps>
  /** Reusable components (SYMBOL globals) by id: what a `site.symbol`
   * instance renders. */
  symbols?: Record<string, CanvasDocument>
  /** Symbols being rendered around this one (internal: stops a symbol
   * from rendering inside itself). */
  symbolStack?: string[]
  /** Inspector control of an instance's text overrides (site-ui). */
  symbolControl?: ComponentType<CustomControlProps>
  /** Inspector control that picks an anchor of the document (interaction
   * targets); without it the anchor is typed. */
  anchorPicker?: ComponentType<CustomControlProps>
  /** Inspector control that picks a Comunicação (WhatsApp) connection and
   * fills the number of `site.whatsapp`; without it the number is typed. */
  whatsappPicker?: ComponentType<CustomControlProps>
  /** Inspector control of carousels, tabs and accordions that adds a
   * slide/tab/item (it needs the editor store). */
  childAdder?: ComponentType<CustomControlProps>
}

export function defaultFormAction(token: string): string {
  return `/api/crm/forms/${encodeURIComponent(token)}/submit`
}

/** Safe `href` of a link value in this site (pages resolve through the
 * context) and the attributes of a new-tab link. */
export function siteLink(
  link: CanvasLink | undefined,
  ctx: SiteRenderContext,
): { href?: string; target?: '_blank'; rel?: string } {
  const pageHref = (id: string) =>
    ctx.pageHref?.(id) ?? ctx.pages?.find((page) => page.id === id)?.path ?? '#'
  const href = safeHref(linkHref(link, pageHref))
  if (!href) return {}
  return link?.newTab
    ? { href, target: '_blank', rel: 'noopener noreferrer' }
    : { href }
}
