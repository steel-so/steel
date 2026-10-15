export type {
  SiteChangeItem,
  SiteChangeKind,
  SiteChangesDTO,
} from '@/src/lib/sites/changes'

/** An image of the workspace's site media library. */
export interface SiteMediaItemDTO {
  /** File name; only `source: 'site'` items can be deleted. */
  id: string
  url: string
  size: number
  /** `site`: uploaded in the site editor; `landing`: from the old landing
   * page builder (kept so migrated sites can reuse them). */
  source: 'site' | 'landing'
  uploadedAt: string | null
}
