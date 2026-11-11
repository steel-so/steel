import type { CanvasDocument } from '@/src/lib/canvas/types'
import type { DocumentRenderContext } from './context'

/**
 * CONTRACT STUB (ADR 0063). The documents catalog slice implements it; the
 * PDF export (worker, headless Chromium) and e-mail previews call it.
 */
export interface RenderDocumentHtmlInput {
  content: CanvasDocument
  theme: Record<string, unknown>
  context: DocumentRenderContext
  title: string
}

/**
 * Full standalone HTML (`<!doctype html>`, inline CSS, print CSS with
 * `@page` size/margins and page breaks, no scripts) of a document.
 */
export function renderDocumentHtml(_input: RenderDocumentHtmlInput): string {
  throw new Error('document renderer not implemented yet')
}
