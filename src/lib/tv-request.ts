/**
 * Set by proxy.ts on requests to the public TV pages (`/tv/<token>`) and the
 * public "Link da bio" pages (`/b/<slug>`): a TV nobody can click must not get
 * Steel's cookie banner, and a bio page is the customer's own page (no cookies
 * and no trackers, so there is nothing to consent to). Neither loads trackers.
 */
export const TV_REQUEST_HEADER = 'x-steel-tv'

export function isPublicTvPath(pathname: string): boolean {
  return pathname === '/tv' || pathname.startsWith('/tv/')
}

export function isPublicBioPath(pathname: string): boolean {
  return pathname.startsWith('/b/') && pathname.length > 3
}
