/** Filtering of the banner library (search, folder and tag). */

export interface LibraryFilterable {
  name: string
  folder: string
  tags: string[]
}

/** Sentinel for "banners without a folder". */
export const NO_FOLDER = '__none__'

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/**
 * Banners whose name, folder or tags contain every word of `search`
 * (accent-insensitive), narrowed by folder and tag when given.
 */
export function filterBanners<T extends LibraryFilterable>(
  banners: T[],
  filters: { search: string; folder: string | null; tag: string | null },
): T[] {
  const words = normalize(filters.search).split(/\s+/).filter(Boolean)
  return banners.filter((banner) => {
    if (filters.folder === NO_FOLDER && banner.folder) return false
    if (
      filters.folder &&
      filters.folder !== NO_FOLDER &&
      banner.folder !== filters.folder
    ) {
      return false
    }
    if (filters.tag && !banner.tags.includes(filters.tag)) return false
    if (words.length === 0) return true
    const haystack = normalize(
      `${banner.name} ${banner.folder} ${banner.tags.join(' ')}`,
    )
    return words.every((word) => haystack.includes(word))
  })
}
