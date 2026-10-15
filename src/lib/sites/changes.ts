import type { SiteSnapshot } from './snapshot'

/**
 * What a publish would change on the live site: the draft snapshot compared
 * with the published one, item by item. Shown in the "Publicar" dialog so
 * the user sees what goes live before confirming.
 */

export type SiteChangeKind = 'added' | 'changed' | 'removed'

export interface SiteChangeItem {
  id: string
  name: string
  change: SiteChangeKind
}

export interface SiteChangesDTO {
  /** Nothing published yet: everything in the draft goes live. */
  firstPublish: boolean
  /** When the live version was published (ISO), `null` before the first. */
  publishedAt: string | null
  pages: SiteChangeItem[]
  /** Header and footer. */
  globals: SiteChangeItem[]
  /** Order, nesting or home page of the pages changed. */
  structure: boolean
  theme: boolean
  /** Site name, SEO defaults, icons, tracking or cookie banner. */
  settings: boolean
  /** Number of listed changes (0 = the draft equals the live site). */
  total: number
}

/** JSON with object keys sorted, so equal values compare equal no matter
 * how the database ordered their keys. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

const same = (a: unknown, b: unknown) =>
  stableStringify(a) === stableStringify(b)

function diffItems<T extends { id: string }>(
  live: T[],
  draft: T[],
  name: (item: T) => string,
  content: (item: T) => unknown,
): SiteChangeItem[] {
  const byId = new Map(live.map((item) => [item.id, item]))
  const changes: SiteChangeItem[] = []
  for (const item of draft) {
    const before = byId.get(item.id)
    if (!before) {
      changes.push({ id: item.id, name: name(item), change: 'added' })
    } else if (!same(content(before), content(item))) {
      changes.push({ id: item.id, name: name(item), change: 'changed' })
    }
    byId.delete(item.id)
  }
  for (const item of byId.values()) {
    changes.push({ id: item.id, name: name(item), change: 'removed' })
  }
  return changes
}

const GLOBAL_NAMES = { HEADER: 'Cabeçalho', FOOTER: 'Rodapé' } as const

function globalName(global: SiteSnapshot['globals'][number]): string {
  return global.kind === 'SYMBOL' ? global.name : GLOBAL_NAMES[global.kind]
}

/** Order, parent and home of each page, in draft order. */
function structureOf(snapshot: SiteSnapshot) {
  return {
    home: snapshot.homePageId,
    pages: snapshot.pages.map((page) => [page.id, page.parentId]),
  }
}

export function diffSiteSnapshots(
  live: SiteSnapshot | null,
  draft: SiteSnapshot,
  publishedAt: string | null = null,
): SiteChangesDTO {
  if (!live) {
    const pages = draft.pages.map((page) => ({
      id: page.id,
      name: page.title,
      change: 'added' as const,
    }))
    const globals = draft.globals.map((global) => ({
      id: global.id,
      name: globalName(global),
      change: 'added' as const,
    }))
    return {
      firstPublish: true,
      publishedAt: null,
      pages,
      globals,
      structure: false,
      theme: false,
      settings: false,
      total: pages.length + globals.length,
    }
  }

  const pages = diffItems(
    live.pages,
    draft.pages,
    (page) => page.title,
    (page) => [page.title, page.slug, page.path, page.seo, page.document],
  )
  const globals = diffItems(live.globals, draft.globals, globalName, (item) => [
    item.name,
    item.document,
  ])
  // Additions and removals already explain a different page list.
  const sameIds = same(
    live.pages.map((page) => page.id).sort(),
    draft.pages.map((page) => page.id).sort(),
  )
  const structure = sameIds && !same(structureOf(live), structureOf(draft))
  const theme = !same(live.theme, draft.theme)
  const settings =
    live.name !== draft.name || !same(live.settings, draft.settings)
  return {
    firstPublish: false,
    publishedAt,
    pages,
    globals,
    structure,
    theme,
    settings,
    total:
      pages.length +
      globals.length +
      Number(structure) +
      Number(theme) +
      Number(settings),
  }
}
