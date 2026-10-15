/**
 * Set by proxy.ts on requests to the public TV pages (`/tv/<token>`): a TV
 * nobody can click must not get Steel's cookie banner, and those pages load
 * no trackers anyway.
 */
export const TV_REQUEST_HEADER = 'x-steel-tv'

export function isPublicTvPath(pathname: string): boolean {
  return pathname === '/tv' || pathname.startsWith('/tv/')
}
