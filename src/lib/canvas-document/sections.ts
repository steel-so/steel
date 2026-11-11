import type { CanvasDocument, CanvasNode } from '@/src/lib/canvas/types'
import { DOCUMENT_SECTION_TYPE } from './constants'

export interface DocumentSectionInfo {
  /** Canvas node id (the analytics key). */
  id: string
  /** Layer name, else the first heading text, else "Seção N". */
  name: string
  /** 0-based position among the sections. */
  index: number
}

function plainText(value: unknown): string {
  if (typeof value !== 'string') return ''
  const noTags = value.replace(/<[^>]*>/g, ' ')
  return noTags.replace(/\s+/g, ' ').trim()
}

function firstHeading(
  doc: CanvasDocument,
  node: CanvasNode,
  depth = 0,
): string {
  if (depth > 8) return ''
  for (const childId of node.children ?? []) {
    const child = doc.nodes[childId]
    if (!child) continue
    if (child.type === 'heading') {
      const text = plainText(child.props.text)
      if (text) return text
    }
    const nested = firstHeading(doc, child, depth + 1)
    if (nested) return nested
  }
  return ''
}

/**
 * Sections of a document in reading order (direct children of the root of
 * type `section`, hidden ones skipped). Shared by the analytics panel, the
 * TOC element, the PDF bookmarks and the AI import.
 */
export function documentSections(doc: CanvasDocument): DocumentSectionInfo[] {
  const root = doc.nodes[doc.rootId]
  if (!root) return []
  const sections: DocumentSectionInfo[] = []
  for (const id of root.children ?? []) {
    const node = doc.nodes[id]
    if (!node || node.type !== DOCUMENT_SECTION_TYPE || node.meta?.hidden) {
      continue
    }
    const index = sections.length
    const label = node.meta?.name?.trim() || firstHeading(doc, node)
    const name = label || `Seção ${index + 1}`
    sections.push({ id, name: name.slice(0, 120), index })
  }
  return sections
}
