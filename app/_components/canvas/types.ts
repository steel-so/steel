import type { ReactNode } from 'react'
import type { CanvasCatalog } from '@/src/lib/canvas/registry'
import type { CanvasStore } from '@/src/lib/canvas/store'
import type { CanvasDocument, CanvasFragment } from '@/src/lib/canvas/types'

/** A tab in the left sidebar. The shell always provides "Adicionar"
 * (palette from the catalog) and "Camadas"; catalogs add the rest
 * ("Seções prontas", "Salvos", "Estilos globais", "Páginas", "Mídia"). */
export interface CanvasSidebarTab {
  id: string
  label: string
  icon: string
  render: (ctx: { store: CanvasStore }) => ReactNode
}

/** Ready-made fragment shown in "Seções prontas"/"Salvos" and draggable to
 * the canvas exactly like a palette item. */
export interface CanvasPresetItem {
  id: string
  label: string
  category: string
  /** Static thumbnail URL or a rendered preview. */
  thumbnail?: string
  fragment: () => CanvasFragment
}

export interface CanvasEditorProps {
  catalog: CanvasCatalog
  initialDocument: CanvasDocument
  /** Canvas viewport width per breakpoint, in px (e-mail: 600/375). */
  viewportWidths: Partial<Record<'base' | 'tablet' | 'mobile', number>>
  /** Extra stylesheet injected in the canvas iframe (fonts, catalog CSS). */
  frameHead?: ReactNode
  extraTabs?: CanvasSidebarTab[]
  presets?: CanvasPresetItem[]
  /** Inspector content when nothing is selected (document settings). */
  documentSettings?: (ctx: { store: CanvasStore }) => ReactNode
  /** Top bar: left title area and right actions (Visualizar, Salvar, Publicar). */
  title: ReactNode
  actions?: (ctx: { store: CanvasStore }) => ReactNode
  /** Called debounced (1.5 s) while dirty, and on Ctrl+S. */
  onSave: (doc: CanvasDocument) => Promise<boolean>
  /** Dark-mode preview toggle (e-mail). */
  darkPreview?: boolean
}
