import { BETTER_AUTH_URL } from '@/lib/env/server'

/** Public address of a bio page in this deployment. */
export function bioLinkPublicUrl(slug: string): string {
  return `${BETTER_AUTH_URL.replace(/\/+$/, '')}/b/${slug}`
}

/** Absolute URL of a destination: relative ones (`/f/<token>`) live on the
 * app host, never on the (possibly internal) host of the request. */
export function absoluteBioDestination(destination: string): string {
  return new URL(
    destination,
    `${BETTER_AUTH_URL.replace(/\/+$/, '')}/`,
  ).toString()
}
