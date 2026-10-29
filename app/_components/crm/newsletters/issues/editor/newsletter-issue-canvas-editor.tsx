'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CanvasEditor } from '@/app/_components/canvas/canvas-editor'
import type { CanvasSidebarTab } from '@/app/_components/canvas/types'
import { AiSectionPanel } from '@/app/_components/crm/email-editor/ai-section-panel'
import { createEditorEmailCatalog } from '@/app/_components/crm/email-editor/editor-catalog'
import {
  type EmailEditorData,
  EmailEditorDataProvider,
  toEmailBrand,
  toProductData,
} from '@/app/_components/crm/email-editor/editor-data'
import {
  EMAIL_EDITOR_PRESETS,
  EMAIL_VIEWPORTS,
  META_AUTOSAVE_MS,
} from '@/app/_components/crm/email-editor/email-canvas-editor'
import { ChecklistButton } from '@/app/_components/crm/email-editor/email-checklist'
import { PreviewButton } from '@/app/_components/crm/email-editor/email-preview-dialog'
import { EMAIL_EDITOR_FRAME_CSS } from '@/app/_components/crm/email-editor/frame-styles'
import { GlobalStylesPanel } from '@/app/_components/crm/email-editor/global-styles-panel'
import { ProductPickerControl } from '@/app/_components/crm/email-editor/product-picker-control'
import { SavedBlocksPanel } from '@/app/_components/crm/email-editor/saved-blocks-panel'
import { createTemplateMetaStore } from '@/app/_components/crm/email-editor/template-meta'
import { VariablesPanel } from '@/app/_components/crm/email-editor/variables-panel'
import { notify } from '@/lib/notify'
import {
  uploadCrmEmailImage,
  useSaveCrmEmailBrand,
} from '@/src/hooks/use-crm-email-builder'
import {
  crmNewsletterIssueKeys,
  saveCrmNewsletterIssue,
} from '@/src/hooks/use-crm-newsletter-issues'
import { useCrmResourceList } from '@/src/hooks/use-crm-resource-list'
import { createCanvasStore } from '@/src/lib/canvas/store'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import {
  createEmailRenderContext,
  EMAIL_TYPOGRAPHY_FONTS,
  emailColorTokens,
} from '@/src/lib/canvas-email/theme'
import type { EmailBrand } from '@/src/lib/crm-email-builder/brand'
import type { EmailCanvasDocument } from '@/src/schemas/crm-email-builder.schema'
import type { CrmNewsletterIssueDTO } from '@/src/schemas/crm-newsletter-issue.schema'
import type { CrmEmailBrandDTO } from '@/types/crm-email-marketing'
import type { CrmProductDTO } from '@/types/crm-product'
import { IssueAbTestButton } from './issue-ab-test-button'
import { IssueAiButton } from './issue-ai-button'
import {
  type IssueEditorContext,
  IssueEditorProvider,
} from './issue-editor-context'
import { IssueEnvelope } from './issue-envelope'
import { IssueSendButton } from './issue-send-dialog'
import { IssueTestSendButton } from './issue-test-send-dialog'
import { IssueWhatsAppButton } from './issue-whatsapp-dialog'

const FRAME_HEAD = <style>{EMAIL_EDITOR_FRAME_CSS}</style>
const TITLE = <IssueEnvelope />

function renderActions() {
  return (
    <div className='flex items-center gap-1'>
      <ChecklistButton />
      <PreviewButton />
      <IssueAiButton />
      <IssueAbTestButton />
      <IssueTestSendButton />
      <IssueWhatsAppButton />
      <IssueSendButton />
    </div>
  )
}

/**
 * Full-screen editor of a newsletter issue: the same Steel Canvas e-mail
 * editor as the templates (catalog, brand, variables, saved blocks, AI,
 * checklist, preview), with the issue's envelope (subject, preheader,
 * address) in the top bar and the test send and send/schedule dialogs.
 * Saves through the issue PATCH (DRAFT/SCHEDULED only).
 */
export function NewsletterIssueCanvasEditor({
  workspaceId,
  slug,
  newsletterId,
  newsletterName,
  issue,
  brand: savedBrand,
  initialDocument,
  allowHtml,
  senderVerified,
}: {
  workspaceId: string
  slug: string
  newsletterId: string
  /** The footer previews as the newsletter's subscription footer. */
  newsletterName: string
  issue: CrmNewsletterIssueDTO
  brand: CrmEmailBrandDTO
  initialDocument: CanvasDocument
  allowHtml: boolean
  senderVerified: boolean
}) {
  const queryClient = useQueryClient()
  const saveBrand = useSaveCrmEmailBrand(workspaceId)
  const { items: products, isLoading: productsLoading } =
    useCrmResourceList<CrmProductDTO>(workspaceId, 'products')
  const [brand, setBrand] = useState<EmailBrand>(() => toEmailBrand(savedBrand))
  const productData = useMemo(() => toProductData(products), [products])
  const [meta] = useState(() =>
    createTemplateMetaStore({ name: issue.subject, subject: issue.subject }),
  )

  const live = useRef({ brand, productData })
  live.current = { brand, productData }
  const storeRef = useRef<ReturnType<typeof createCanvasStore> | null>(null)
  const [catalog] = useState(() =>
    createEditorEmailCatalog({
      allowHtml,
      allowPoll: true,
      productPicker: ProductPickerControl,
      context: () =>
        createEmailRenderContext({
          brand: live.current.brand,
          products: live.current.productData,
          // Same footer the send renders (crm-newsletter-render.ts).
          subscription: { newsletterName },
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

  const save = useCallback(
    (data: Parameters<typeof saveCrmNewsletterIssue>[3]) =>
      saveCrmNewsletterIssue(workspaceId, newsletterId, issue.id, data),
    [workspaceId, newsletterId, issue.id],
  )

  // The list and the detail go stale with every save: refresh on close.
  useEffect(
    () => () => {
      void queryClient.invalidateQueries({
        queryKey: crmNewsletterIssueKeys.all(workspaceId, newsletterId),
      })
    },
    [queryClient, workspaceId, newsletterId],
  )

  // ── saving ──────────────────────────────────────────────────────────────
  const savedSubject = useRef(issue.subject.trim())

  const onSave = useCallback(
    async (doc: CanvasDocument) => {
      const subject = meta.get().subject.trim()
      try {
        await save({
          ...(subject ? { subject } : {}),
          builderDocument: doc as unknown as EmailCanvasDocument,
        })
        if (subject) savedSubject.current = subject
        return true
      } catch (error) {
        notify.error(error)
        return false
      }
    },
    [meta, save],
  )

  const flushMeta = useCallback(async () => {
    const subject = meta.get().subject.trim()
    if (subject === savedSubject.current) return true
    if (!subject) {
      notify.error('Informe o assunto da edição')
      return false
    }
    try {
      await save({ subject })
      savedSubject.current = subject
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
      if (!meta.get().subject.trim()) return
      timer = setTimeout(() => void flushMeta(), META_AUTOSAVE_MS)
    })
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (meta.get().subject.trim() !== savedSubject.current) {
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

  const flushDocument = useCallback(async () => {
    const { doc, dirty } = store.getState()
    if (!dirty) return true
    const saved = await onSave(doc)
    if (saved) store.markSaved(doc)
    return saved
  }, [store, onSave])

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
        notify.success('Marca salva para todos os e-mails')
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
      // The shared panels only read it as an id; no template is involved.
      templateId: issue.id,
      products,
      productsLoading,
      brand,
      meta,
      flushMeta,
      flushDocument,
      applyTemplate: () => {},
      returnTo: null,
      newsletterName,
    }),
    [
      newsletterName,
      workspaceId,
      slug,
      issue.id,
      products,
      productsLoading,
      brand,
      meta,
      flushMeta,
      flushDocument,
    ],
  )
  const issueContext = useMemo<IssueEditorContext>(
    () => ({
      workspaceId,
      slug,
      newsletterId,
      issueId: issue.id,
      initialSlug: issue.slug,
      status: issue.status,
      scheduledAt: issue.scheduledAt,
      senderVerified,
      save,
    }),
    [
      workspaceId,
      slug,
      newsletterId,
      issue.id,
      issue.slug,
      issue.status,
      issue.scheduledAt,
      senderVerified,
      save,
    ],
  )

  return (
    <EmailEditorDataProvider value={data}>
      <IssueEditorProvider value={issueContext}>
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
      </IssueEditorProvider>
    </EmailEditorDataProvider>
  )
}
