/**
 * Guided tours: a short walkthrough of a screen, opened by itself on the
 * user's first visit and again on demand ("Ver tour" in the header or the
 * list in the help menu). Definitions are plain data; the runtime lives in
 * `app/_components/tours`.
 */

export type TourModule = 'platform' | 'ai' | 'crm' | 'zap' | 'servicedesk'

export type TourPlacement = 'top' | 'bottom' | 'left' | 'right'

export interface TourStep {
  /**
   * Value of the `data-tour` attribute of the element to highlight. Omit for
   * a card centered on the screen (intro or wrap-up). A step whose element is
   * not on the page (hidden by permission, empty list) is skipped.
   */
  target?: string
  title: string
  body: string
  /** Preferred side of the card; the runtime flips it when it does not fit. */
  placement?: TourPlacement
}

export interface TourDefinition {
  /** Stable id: `<module>.<area>[.<screen>]`, lower case, dots and dashes. */
  key: string
  /**
   * Bump when the screen changes enough for the tour to be worth seeing
   * again: users who saw a lower version get it once more.
   */
  version: number
  module: TourModule
  /** Name in the tours list, e.g. "Editor de site". */
  title: string
  /** One sentence for the tours list. */
  description: string
  /**
   * Path(s) after `/<workspace-slug>` where the tour lives. `:name` matches
   * one segment (`/crm/sites/:siteId`); `''` is the workspace home.
   */
  route: string | readonly string[]
  /**
   * Static path (after the slug) the tours list links to when `route` has a
   * parameter, i.e. where the user picks the item to open.
   */
  openFrom?: string
  /** `admin` hides the tour from members who are not OWNER/ADMIN. */
  audience?: 'all' | 'admin'
  /** Skips the step-by-step below 768 px and shows `mobileSummary` instead. */
  desktopOnly?: boolean
  mobileSummary?: string
  /** Manual page linked from the last step, e.g. `/docs/crm/sites`. */
  docsHref?: string
  steps: readonly TourStep[]
}

export const TOUR_MODULE_LABELS: Record<TourModule, string> = {
  platform: 'Plataforma',
  ai: 'Steel AI',
  crm: 'CRM',
  zap: 'Comunicação',
  servicedesk: 'ServiceDesk',
}

export const TOUR_MODULE_ORDER: readonly TourModule[] = [
  'platform',
  'ai',
  'crm',
  'zap',
  'servicedesk',
]
