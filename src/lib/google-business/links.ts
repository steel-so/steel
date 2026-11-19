import type { GoogleLinksDTO } from '@/src/schemas/crm-google-presence.schema'

/**
 * Public Google links of a location. Everything here is built from data the
 * location already exposes (place id, coordinates, Maps URI) — no API call.
 */

type LinkSource = {
  title: string
  placeId: string | null
  mapsUri: string | null
  newReviewUri: string | null
  latitude: number | null
  longitude: number | null
  address: string | null
}

/** "Avaliar" link: Google's own `newReviewUri`, else built from the place id. */
export function reviewUrlOf(source: LinkSource): string | null {
  if (source.newReviewUri) return source.newReviewUri
  return source.placeId
    ? `https://search.google.com/local/writereview?placeid=${encodeURIComponent(source.placeId)}`
    : null
}

/** "Como chegar" link (Google Maps directions to the place). */
export function directionsUrlOf(source: LinkSource): string | null {
  const destination =
    source.latitude !== null && source.longitude !== null
      ? `${source.latitude},${source.longitude}`
      : (source.address ?? source.title)
  if (!destination) return null
  const params = new URLSearchParams({
    api: '1',
    destination,
    ...(source.placeId && { destination_place_id: source.placeId }),
  })
  return `https://www.google.com/maps/dir/?${params.toString()}`
}

/** Keyless embed of the place for the card on the Maps screen. */
export function embedUrlOf(source: LinkSource): string | null {
  const query =
    source.latitude !== null && source.longitude !== null
      ? `${source.latitude},${source.longitude}`
      : (source.address ?? null)
  if (!query) return null
  return `https://www.google.com/maps?q=${encodeURIComponent(query)}&z=16&output=embed`
}

export function buildLinks(source: LinkSource): GoogleLinksDTO {
  return {
    mapsUrl: source.mapsUri,
    reviewUrl: reviewUrlOf(source),
    directionsUrl: directionsUrlOf(source),
    embedUrl: embedUrlOf(source),
    latitude: source.latitude,
    longitude: source.longitude,
    address: source.address,
    title: source.title,
  }
}
