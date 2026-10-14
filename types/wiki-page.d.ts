import type { Value } from 'platejs'

/** Who created / last edited a page, for the side panel's Info tab. */
export interface WikiPagePersonDTO {
  id: string
  name: string
  image: string | null
}

/** Inline AI actions on a block (and `summarize` for the whole page). */
export type WikiAiAction =
  | 'paraphrase'
  | 'simplify'
  | 'elaborate'
  | 'summarize'
  | 'title'

export interface WikiPageDTO {
  id: string
  workspaceId: string
  parentId: string | null
  title: string
  icon: string | null
  coverImage: string | null
  content: Value
  position: number
  /** Labels from Ajustes > Wiki applied to this page. */
  labelIds: string[]
  createdById: string | null
  updatedById: string | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
  /** Set while the page has a public read-only link at `/w/<publicToken>`. */
  publishedAt: string | null
  publicToken: string | null
  /**
   * Set while editing is locked; the page is read-only for everyone who
   * cannot manage the lock (`lockedAt !== null && !canManageLock`).
   */
  lockedAt: string | null
  lockedById: string | null
  /** Viewer-relative: the page's author or a workspace owner/admin. */
  canManageLock: boolean
  /** Viewer-relative. */
  isFavorite: boolean
  createdBy: WikiPagePersonDTO | null
  updatedBy: WikiPagePersonDTO | null
}

/** What `/w/<token>` renders: the published page, nothing internal. */
export interface WikiPublicPageDTO {
  title: string
  icon: string | null
  coverImage: string | null
  /** Media URLs rewritten to the public media proxy of this token. */
  content: Value
  publishedAt: string
  updatedAt: string
}
