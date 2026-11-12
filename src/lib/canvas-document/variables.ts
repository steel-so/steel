import { getNode } from '@/src/lib/canvas/nodes'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import { DOCUMENT_VARIABLES, type DocumentVariableKey } from './constants'
import type { DocumentRenderMode, DocumentVariableValues } from './context'

/**
 * Merge tags of the `document` catalog (`{{contato.nome}}`). Any text of a
 * document may carry them: the editor shows the sample of each one, the
 * public link and the PDF the values resolved for the recipient. Unknown
 * tags are left as typed, so a literal `{{...}}` in a contract survives.
 */

const PATTERN = /\{\{\s*([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*)\s*\}\}/

const KEYS: ReadonlySet<string> = new Set(
  DOCUMENT_VARIABLES.map((variable) => variable.key),
)

export function isDocumentVariableKey(key: string): key is DocumentVariableKey {
  return KEYS.has(key)
}

/** `{{key}}` as typed in a text. */
export function variableTag(key: DocumentVariableKey): string {
  return `{{${key}}}`
}

/** The editor preview values (`sample` of each variable). */
export function documentVariableSamples(): DocumentVariableValues {
  const values: DocumentVariableValues = {}
  for (const variable of DOCUMENT_VARIABLES) {
    values[variable.key] = variable.sample
  }
  return values
}

/** Values a render mode shows: samples in the editor, the resolved values
 * (missing ones empty) on the public link and in the PDF. */
export function variablesForMode(
  mode: DocumentRenderMode,
  values: DocumentVariableValues | undefined,
): DocumentVariableValues {
  return mode === 'editor' ? documentVariableSamples() : { ...values }
}

export type VariablePart =
  | { kind: 'text'; text: string }
  | { kind: 'variable'; key: DocumentVariableKey; tag: string }

/** A text split into literal runs and known merge tags, in order. */
export function splitVariables(text: string): VariablePart[] {
  const parts: VariablePart[] = []
  let last = 0
  for (const match of text.matchAll(new RegExp(PATTERN.source, 'g'))) {
    const key = match[1]
    if (!isDocumentVariableKey(key)) continue
    const start = match.index ?? 0
    if (start > last) {
      parts.push({ kind: 'text', text: text.slice(last, start) })
    }
    parts.push({ kind: 'variable', key, tag: match[0] })
    last = start + match[0].length
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) })
  return parts
}

/**
 * Replaces the known merge tags of `text` by their values (missing = empty).
 * `format` receives each value and its key: escape it for HTML, wrap it in
 * a highlight for the editor…
 */
export function substituteVariables(
  text: string,
  values: DocumentVariableValues,
  format?: (value: string, key: DocumentVariableKey) => string,
): string {
  if (!text.includes('{{')) return text
  const apply = format ?? ((value: string) => value)
  let emptied = false
  const replace = (tag: string, key: string) => {
    if (!isDocumentVariableKey(key)) return tag
    const value = values[key] ?? ''
    if (value) return apply(value, key)
    emptied = true
    return EMPTY_MARK
  }
  const out = text.replace(new RegExp(PATTERN.source, 'g'), replace)
  if (!emptied) return out
  // "Proposta para {{empresa.nome}}" without a company reads "Proposta".
  const bare = out.replace(DANGLING_WORD, '').replaceAll(EMPTY_MARK, '')
  return tidySeparators(bare)
}

const EMPTY_MARK = '\u0000'
const DANGLING_WORD =
  /\s+(?:para|de|da|do|das|dos|por|com|ao|à|em|no|na)\s*(?=\u0000)/gi

const LEADING_SEPARATORS = /(^|>)(\s*[·•|,]\s*)+/g
const TRAILING_SEPARATORS = /(\s*[·•|,]\s*)+(<|$)/g

/**
 * A tag that resolved to nothing leaves its separator behind
 * ("· preparada por…"): drop separators left at the edges of a text or of
 * an HTML text run, and the double spaces.
 */
export function tidySeparators(text: string): string {
  return text
    .replace(LEADING_SEPARATORS, '$1')
    .replace(TRAILING_SEPARATORS, '$2')
    .replace(/ {2,}/g, ' ')
}

function collectStrings(value: unknown, out: string[], depth = 0): void {
  if (depth > 6) return
  if (typeof value === 'string') {
    if (value.includes('{{')) out.push(value)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out, depth + 1)
    return
  }
  if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) {
      collectStrings(item, out, depth + 1)
    }
  }
}

/** Merge tags a document uses (visible nodes only), in catalog order. Lets
 * the send dialog warn about values a recipient lacks. */
export function documentVariablesUsed(
  doc: CanvasDocument,
): DocumentVariableKey[] {
  const used = new Set<string>()
  const stack = [doc.rootId]
  while (stack.length > 0) {
    const node = getNode(doc, stack.pop() as string)
    if (!node || node.meta?.hidden) continue
    const strings: string[] = []
    collectStrings(node.props, strings)
    for (const text of strings) {
      for (const part of splitVariables(text)) {
        if (part.kind === 'variable') used.add(part.key)
      }
    }
    stack.push(...(node.children ?? []))
  }
  const keys = DOCUMENT_VARIABLES.map((variable) => variable.key)
  return keys.filter((key) => used.has(key))
}
