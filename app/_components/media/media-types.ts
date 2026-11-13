import type { QueryKey } from '@tanstack/react-query'

/** One image of a media library, whatever bucket it lives in. */
export interface MediaItem {
  /** Stable id inside its library (the file name). */
  id: string
  url: string
  /** Display name; the id when the bucket does not keep a friendly one. */
  name?: string
  /** Default alt text suggested when the image is placed. */
  alt?: string
  size?: number
  uploadedAt?: string | null
  /** Only some items can be deleted (e.g. images of the old landing pages
   * are read-only). Defaults to `true` when the provider has `remove`. */
  removable?: boolean
}

/**
 * How a library talks to its bucket. Each builder keeps its own bucket
 * (sites, e-mail/documents, landing pages) and exposes it through this one
 * contract, so the picker, the drop zone and the Media tab are shared.
 * Methods throw on failure: the UI shows the server's message.
 */
export interface MediaProvider {
  /** React Query key of the listing (invalidated after upload/remove). */
  key: QueryKey
  list: () => Promise<MediaItem[]>
  upload: (file: File) => Promise<MediaItem>
  remove?: (item: MediaItem) => Promise<void>
  /** Saves metadata that outlives the placement (the alt suggestion). */
  update?: (item: MediaItem, patch: { alt?: string }) => Promise<MediaItem>
}
