/**
 * Reading tracker of the public link (owned by the documents analytics
 * slice). Scans the `data-doc-section` elements rendered by the catalog,
 * measures active time per section and posts `DocumentTrackSchema` beacons
 * to `POST /api/documents/<token>/track`.
 *
 * CONTRACT STUB: the analytics slice replaces the body; the signature stays.
 */
export interface DocumentTrackerOptions {
  token: string
  versionId?: string
  /** Defaults to `/api/documents/<token>/track`. */
  endpoint?: string
  /** Element holding the rendered document; defaults to `document.body`. */
  root?: HTMLElement
}

/** Starts tracking; returns a stop function (flushes the last beacon). */
export function startDocumentTracker(
  _options: DocumentTrackerOptions,
): () => void {
  return () => {}
}
