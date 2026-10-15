import type {
  CanvasCatalog,
  CanvasComponentDefinition,
} from '@/src/lib/canvas/registry'

/** Lower-case, accent-free text for search ("Botão" → "botao"). */
export function normalizeSearch(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

export function matchesSearch(
  definition: Pick<CanvasComponentDefinition, 'label' | 'keywords' | 'type'>,
  query: string,
): boolean {
  const terms = normalizeSearch(query).split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true
  const haystack = normalizeSearch(
    [definition.label, definition.type, ...(definition.keywords ?? [])].join(
      ' ',
    ),
  )
  return terms.every((term) => haystack.includes(term))
}

export interface PaletteGroup {
  category: string
  items: CanvasComponentDefinition[]
}

/** Palette groups in the catalog's category order (unknown categories
 * last), filtered by `query`. Types without a category are hidden. */
export function paletteGroups(
  catalog: CanvasCatalog,
  query = '',
): PaletteGroup[] {
  const byCategory = new Map<string, CanvasComponentDefinition[]>()
  for (const definition of Object.values(catalog.components)) {
    if (!definition.category || !matchesSearch(definition, query)) continue
    const list = byCategory.get(definition.category) ?? []
    list.push(definition)
    byCategory.set(definition.category, list)
  }
  const order = [
    ...catalog.categories,
    ...[...byCategory.keys()].filter((c) => !catalog.categories.includes(c)),
  ]
  return order
    .filter((category) => byCategory.has(category))
    .map((category) => ({
      category,
      items: byCategory.get(category) as CanvasComponentDefinition[],
    }))
}
