import {
  DOCUMENT_CONTENT_TYPES,
  DOCUMENT_FIELD_TYPES,
  DOCUMENT_FUNCTIONAL_TYPES,
} from './constants'

/** Types that only live inside a specific parent. */
const NESTED_ONLY = new Set(['column', 'accordion-item'])

const ALL_TYPES: readonly string[] = [
  ...DOCUMENT_CONTENT_TYPES,
  ...DOCUMENT_FUNCTIONAL_TYPES,
  ...DOCUMENT_FIELD_TYPES,
]

/** Every type that may sit in a section, a container, a column or an
 * accordion item. */
export const BLOCK_TYPES = ALL_TYPES.filter((type) => !NESTED_ONLY.has(type))

export const BLOCK_TYPE_SET: ReadonlySet<string> = new Set(BLOCK_TYPES)
