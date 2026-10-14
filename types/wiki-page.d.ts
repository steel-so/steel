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
  // TODO(wiki-backend): make these required once the mapper fills them.
  /** Set while the page has a public read-only link at `/w/<publicToken>`. */
  publishedAt?: string | null
  publicToken?: string | null
  /** Set while editing is locked; the page is read-only for everyone else. */
  lockedAt?: string | null
  lockedById?: string | null
  /** Viewer-relative: the page's author or a workspace owner/admin. */
  canManageLock?: boolean
  /** Viewer-relative. */
  isFavorite?: boolean
  createdBy?: WikiPagePersonDTO | null
  updatedBy?: WikiPagePersonDTO | null
}
