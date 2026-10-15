import type { ReactNode } from 'react'
import type { CanvasCatalog } from '@/src/lib/canvas/registry'
import type { CanvasStore } from '@/src/lib/canvas/store'
import type { CanvasDocument, CanvasFragment } from '@/src/lib/canvas/types'
import type { CanvasColorToken } from '@/src/lib/canvas/values'

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
  /** A store created by the caller (`createCanvasStore(catalog, doc)`),
   * for catalogs whose render context reads the live document (the e-mail
   * column splits widths with its siblings). Read once, on mount; without it
   * the editor creates its own from `initialDocument`. */
  store?: CanvasStore
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
  /** Uploads a file picked in an image control and resolves its public URL
   * (`null` when it failed — the caller already told the user). Without it
   * image controls accept URLs only. */
  onUploadImage?: (file: File) => Promise<string | null>
  /** Theme colors offered by color controls (`token:<id>`). */
  colorTokens?: CanvasColorToken[]
  /** Font families offered by the typography control (CSS `font-family`
   * values with fallbacks). Defaults to a safe system/web list. */
  fonts?: Array<{ label: string; value: string }>
}
