import type { TourDefinition } from './types'

const split = (path: string): string[] => path.split('/').filter(Boolean)

/** Routes of a tour as a list. */
export function tourRoutes(tour: TourDefinition): readonly string[] {
  return typeof tour.route === 'string' ? [tour.route] : tour.route
}

/** Does `pattern` (`/crm/sites/:siteId`) match `path` (both after the slug)? */
export function matchesRoute(pattern: string, path: string): boolean {
  const want = split(pattern)
  const got = split(path)
  if (want.length !== got.length) return false
  return want.every((part, i) => part.startsWith(':') || part === got[i])
}

/** Static segments of a pattern: `/a/new` (2) beats `/a/:id` (1). */
function specificity(pattern: string): number {
  return split(pattern).filter((part) => !part.startsWith(':')).length
}

/** Path after `/<slug>`, without query or hash (`''` for the home). */
export function pathAfterSlug(pathname: string, slug: string): string | null {
  const clean = pathname.split(/[?#]/)[0]
  const prefix = `/${slug}`
  if (clean === prefix) return ''
  return clean.startsWith(`${prefix}/`) ? clean.slice(prefix.length) : null
}

/** The tour of a screen: the most specific route that matches, if any. */
export function findTourForPath(
  tours: readonly TourDefinition[],
  path: string,
): TourDefinition | null {
  let best: TourDefinition | null = null
  let bestScore = -1
  for (const tour of tours) {
    for (const pattern of tourRoutes(tour)) {
      if (!matchesRoute(pattern, path)) continue
      const score = specificity(pattern)
      if (score > bestScore) {
        best = tour
        bestScore = score
      }
    }
  }
  return best
}

/**
 * Where the tours list sends the user: the first route without a parameter,
 * else `openFrom`, else nowhere (the entry only explains where to find it).
 */
export function tourEntryPath(tour: TourDefinition): {
  path: string
  /** `true` when the path is the screen of the tour itself. */
  direct: boolean
} | null {
  const direct = tourRoutes(tour).find((route) => !route.includes(':'))
  if (direct !== undefined) return { path: direct, direct: true }
  if (tour.openFrom !== undefined) return { path: tour.openFrom, direct: false }
  return null
}
