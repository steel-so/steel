'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CanvasEditor } from '@/app/_components/canvas/canvas-editor'
import type {
  CanvasPresetItem,
  CanvasSidebarTab,
} from '@/app/_components/canvas/types'
import { notify } from '@/lib/notify'
import {
  emailTemplateKey,
  type SaveCrmEmailTemplateInput,
  saveCrmEmailTemplate,
  uploadCrmEmailImage,
  useSaveCrmEmailBrand,
} from '@/src/hooks/use-crm-email-builder'
import { useCrmResourceList } from '@/src/hooks/use-crm-resource-list'
import { createCanvasStore } from '@/src/lib/canvas/store'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import { openEmailDocument } from '@/src/lib/canvas-email/convert-v1'
import { EMAIL_PRESETS } from '@/src/lib/canvas-email/presets'
import {
  createEmailRenderContext,
  EMAIL_TYPOGRAPHY_FONTS,
  emailColorTokens,
} from '@/src/lib/canvas-email/theme'
import type { EmailBrand } from '@/src/lib/crm-email-builder/brand'
import type { EmailCanvasDocument } from '@/src/schemas/crm-email-builder.schema'
import type {
  CrmEmailBrandDTO,
  CrmEmailTemplateDTO,
} from '@/types/crm-email-marketing'
import type { CrmProductDTO } from '@/types/crm-product'
import { AiSectionPanel } from './ai-section-panel'
import { createEditorEmailCatalog } from './editor-catalog'
import {
  type EmailEditorData,
  EmailEditorDataProvider,
  toEmailBrand,
  toProductData,
} from './editor-data'
import { ChecklistButton } from './email-checklist'
import { PreviewButton } from './email-preview-dialog'
import { EnvelopeFields } from './envelope-fields'
import { EMAIL_EDITOR_FRAME_CSS } from './frame-styles'
import { GlobalStylesPanel } from './global-styles-panel'
import { ProductPickerControl } from './product-picker-control'
import { SavedBlocksPanel } from './saved-blocks-panel'
import { SendTestButton } from './send-test-dialog'
import { createTemplateMetaStore, type TemplateMeta } from './template-meta'
import { UseInCampaignButton } from './use-in-campaign-button'
import { VariablesPanel } from './variables-panel'
import { VersionHistoryButton } from './version-history'

/** Delay before name/subject edits are saved. */
export const META_AUTOSAVE_MS = 1000
/** Canvas width per breakpoint: the 600 px e-mail plus its outer margin. */
export const EMAIL_VIEWPORTS = { base: 680, mobile: 375 }

export const EMAIL_EDITOR_PRESETS: CanvasPresetItem[] = EMAIL_PRESETS.map(
  (preset) => ({ ...preset }),
)

const TITLE = <EnvelopeFields />

/** Editor-only CSS in the canvas iframe ("Mostrar se" badge). */
const FRAME_HEAD = <style>{EMAIL_EDITOR_FRAME_CSS}</style>

function renderActions() {
  return (
    <div className='flex items-center gap-1'>
      <ChecklistButton />
      <VersionHistoryButton />
      <PreviewButton />
      <SendTestButton />
      <UseInCampaignButton />
    </div>
  )
}

const validMeta = (meta: TemplateMeta) =>
  meta.name.trim().length > 0 && meta.subject.trim().length > 0

const trimmed = (meta: TemplateMeta) => ({
  name: meta.name.trim(),
  subject: meta.subject.trim(),
})

/**
 * The CRM e-mail editor (Steel Canvas + e-mail catalog): drag-and-drop
 * canvas, envelope (name, subject, preheader) in the top bar, checklist,
 * preview with a real contact and test send. Saves through the template
 * PATCH as a v2 `builderDocument`.
 */
export function EmailCanvasEditor({
  workspaceId,
  slug,
  template,
  brand: savedBrand,
  initialDocument,
  allowHtml,
  returnTo = null,
}: {
  workspaceId: string
  slug: string
  template: CrmEmailTemplateDTO
  brand: CrmEmailBrandDTO
  /** The v2 document to open (stored or just converted from v1). */
  initialDocument: CanvasDocument
  /** Workspace OWNER/ADMIN: the HTML block is offered in the palette. */
  allowHtml: boolean
  /** Campaign wizard to go back to with this template selected. */
  returnTo?: string | null
}) {
  const queryClient = useQueryClient()
  // A plain call, not useMutation: the editor must not re-render (and redraw
  // the canvas) when a save starts or ends.
  const save = useCallback(
    (data: SaveCrmEmailTemplateInput) =>
      saveCrmEmailTemplate(workspaceId, template.id, data),
    [workspaceId, template.id],
  )
  const saveBrand = useSaveCrmEmailBrand(workspaceId)
  const { items: products, isLoading: productsLoading } =
    useCrmResourceList<CrmProductDTO>(workspaceId, 'products')

  const [brand, setBrand] = useState<EmailBrand>(() => toEmailBrand(savedBrand))
  const productData = useMemo(() => toProductData(products), [products])
  const [meta] = useState(() =>
    createTemplateMetaStore({ name: template.name, subject: template.subject }),
  )

  // The catalog reads the render context on every render: brand and products
  // from the latest state, the document from the store.
  const live = useRef({ brand, productData })
  live.current = { brand, productData }
  const storeRef = useRef<ReturnType<typeof createCanvasStore> | null>(null)
  const [catalog] = useState(() =>
    createEditorEmailCatalog({
      allowHtml,
      productPicker: ProductPickerControl,
      context: () =>
        createEmailRenderContext({
          brand: live.current.brand,
          products: live.current.productData,
          doc: () =>
            storeRef.current?.getState().doc ?? (initialDocument as never),
        }),
    }),
  )
  const [store] = useState(() => {
    const created = createCanvasStore(catalog, initialDocument)
    storeRef.current = created
    return created
  })

  // ── saving ──────────────────────────────────────────────────────────────
  const savedMeta = useRef(trimmed(meta.get()))
  // The loader's cached template goes stale with every save; drop it when
  // the editor closes so the next visit loads the saved version. (Updating
  // the cache instead would re-render the editor after every save.)
  useEffect(
    () => () => {
      queryClient.removeQueries({
        queryKey: emailTemplateKey(workspaceId, template.id),
      })
    },
    [queryClient, workspaceId, template.id],
  )

  const onSave = useCallback(
    async (doc: CanvasDocument) => {
      const current = meta.get()
      const withMeta = validMeta(current) ? trimmed(current) : {}
      try {
        await save({
          ...withMeta,
          builderDocument: doc as unknown as EmailCanvasDocument,
        })
        if (validMeta(current)) savedMeta.current = trimmed(current)
        return true
      } catch (error) {
        notify.error(error)
        return false
      }
    },
    [meta, save],
  )

  const flushMeta = useCallback(async () => {
    const current = meta.get()
    const next = trimmed(current)
    if (
      next.name === savedMeta.current.name &&
      next.subject === savedMeta.current.subject
    ) {
      return true
    }
    if (!validMeta(current)) {
      notify.error(
        next.name
          ? 'Informe o assunto do e-mail'
          : 'Informe o nome do template',
      )
      return false
    }
    try {
      await save(next)
      savedMeta.current = next
      return true
    } catch (error) {
      notify.error(error)
      return false
    }
  }, [meta, save])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsubscribe = meta.subscribe(() => {
      if (timer) clearTimeout(timer)
      if (!validMeta(meta.get())) return
      timer = setTimeout(() => void flushMeta(), META_AUTOSAVE_MS)
    })
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      const next = trimmed(meta.get())
      if (
        next.name !== savedMeta.current.name ||
        next.subject !== savedMeta.current.subject
      ) {
        event.preventDefault()
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      unsubscribe()
      if (timer) clearTimeout(timer)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [meta, flushMeta])

  // Pending document edits, saved now (before recording a version).
  const flushDocument = useCallback(async () => {
    const { doc, dirty } = store.getState()
    if (!dirty) return true
    const saved = await onSave(doc)
    if (saved) store.markSaved(doc)
    return saved
  }, [store, onSave])

  // A restored version: the server already saved it — load it as saved.
  const applyTemplate = useCallback(
    (next: CrmEmailTemplateDTO) => {
      const doc = openEmailDocument(next.builderDocument)
      if (doc) {
        store.reset(doc)
        store.markSaved(doc)
      }
      savedMeta.current = { name: next.name, subject: next.subject }
      meta.set({ name: next.name, subject: next.subject })
    },
    [store, meta],
  )

  // ── brand ───────────────────────────────────────────────────────────────
  const brandTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previewBrand = useCallback((next: EmailBrand) => {
    if (brandTimer.current) clearTimeout(brandTimer.current)
    brandTimer.current = setTimeout(() => setBrand(next), 120)
  }, [])
  useEffect(
    () => () => {
      if (brandTimer.current) clearTimeout(brandTimer.current)
    },
    [],
  )
  const handleBrandSave = useCallback(
    async (next: EmailBrand) => {
      try {
        const saved = await saveBrand.mutateAsync(next)
        if (brandTimer.current) clearTimeout(brandTimer.current)
        setBrand(toEmailBrand(saved))
        notify.success('Marca salva para todos os templates')
      } catch (error) {
        notify.error(error)
      }
    },
    [saveBrand],
  )

  const onUploadImage = useCallback(
    async (file: File) => {
      try {
        const { url } = await uploadCrmEmailImage(workspaceId, file)
        return url
      } catch (error) {
        notify.error(error)
        return null
      }
    },
    [workspaceId],
  )

  // ── shell props ─────────────────────────────────────────────────────────
  const brandSaving = saveBrand.isPending
  const extraTabs = useMemo<CanvasSidebarTab[]>(
    () => [
      {
        id: 'global-styles',
        label: 'Estilos globais',
        icon: 'global-styles',
        render: () => (
          <GlobalStylesPanel
            brandSaving={brandSaving}
            onBrandPreview={previewBrand}
            onBrandSave={handleBrandSave}
          />
        ),
      },
      {
        id: 'variables',
        label: 'Variáveis',
        icon: 'variables',
        render: ({ store: canvasStore }) => (
          <VariablesPanel store={canvasStore} />
        ),
      },
      {
        id: 'saved',
        label: 'Salvos',
        icon: 'saved',
        render: ({ store: canvasStore }) => (
          <SavedBlocksPanel store={canvasStore} />
        ),
      },
      {
        id: 'ai',
        label: 'IA',
        icon: 'ai',
        render: ({ store: canvasStore }) => (
          <AiSectionPanel store={canvasStore} />
        ),
      },
    ],
    [brandSaving, previewBrand, handleBrandSave],
  )
  const colorTokens = useMemo(() => emailColorTokens(brand), [brand])

  const data = useMemo<EmailEditorData>(
    () => ({
      workspaceId,
      slug,
      templateId: template.id,
      products,
      productsLoading,
      brand,
      meta,
      flushMeta,
      flushDocument,
      applyTemplate,
      returnTo,
    }),
    [
      workspaceId,
      slug,
      template.id,
      products,
      productsLoading,
      brand,
      meta,
      flushMeta,
      flushDocument,
      applyTemplate,
      returnTo,
    ],
  )

  return (
    <EmailEditorDataProvider value={data}>
      <CanvasEditor
        catalog={catalog}
        store={store}
        initialDocument={initialDocument}
        viewportWidths={EMAIL_VIEWPORTS}
        frameHead={FRAME_HEAD}
        presets={EMAIL_EDITOR_PRESETS}
        extraTabs={extraTabs}
        title={TITLE}
        actions={renderActions}
        onSave={onSave}
        darkPreview
        onUploadImage={onUploadImage}
        colorTokens={colorTokens}
        fonts={EMAIL_TYPOGRAPHY_FONTS}
      />
    </EmailEditorDataProvider>
  )
}
