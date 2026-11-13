import type { PublishCheckItem } from '@/src/lib/canvas/checklist'
import { siteChecklist, sitePageChecks } from '@/src/lib/canvas-site/checklist'
import { globalName } from './changes'
import type { SiteSnapshot } from './snapshot'

/**
 * Pre-publish checks of a whole site draft: every page and global through
 * `siteChecklist`, plus the per-page SEO title. Items carry the page or
 * global they belong to, so the dialog can open it.
 */
export function siteSnapshotChecks(snapshot: SiteSnapshot): PublishCheckItem[] {
  const items: PublishCheckItem[] = []
  for (const page of snapshot.pages) {
    items.push(...sitePageChecks(page))
    for (const item of siteChecklist(page.document)) {
      items.push({ ...item, documentId: page.id, documentName: page.title })
    }
  }
  for (const global of snapshot.globals) {
    for (const item of siteChecklist(global.document)) {
      items.push({ ...item, documentId: global.id, documentName: globalName(global) })
    }
  }
  return items
}
