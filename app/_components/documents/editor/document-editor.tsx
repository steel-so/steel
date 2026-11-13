'use client'

import { SentIcon, ViewIcon } from '@hugeicons-pro/core-stroke-rounded'
import { useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { CanvasEditor } from '@/app/_components/canvas/canvas-editor'
import { useCanvasEditor } from '@/app/_components/canvas/editor-context'
import type { CanvasImageBlock } from '@/app/_components/canvas/types'
import { DocumentExportButton } from '@/app/_components/documents/export/document-export-button'
import { FocusedBackLink } from '@/app/_components/layout/focused-screen'
import { useEmailMediaProvider } from '@/app/_components/media/use-email-media'
import { useCan } from '@/app/_components/workspace/workspace-permissions'
import { SteelIcon } from '@/components/icon/icon'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import { ApiError } from '@/src/hooks/_fetch'
import { uploadCrmEmailImage } from '@/src/hooks/use-crm-email-builder'
import {
  documentsApi,
  documentsKeys,
  isDocumentSaveConflict,
  type UpdateDocumentBody,
  useDocument,
} from '@/src/hooks/use-documents'
import type { CanvasCatalog } from '@/src/lib/canvas/registry'
import { type CanvasStore, createCanvasStore } from '@/src/lib/canvas/store'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import {
  createDocumentCatalog,
  DOCUMENT_SECTION_PRESETS,
  DocumentStyles,
  documentColorTokens,
  documentViewportWidths,
  parseDocumentTheme,
  validateDocumentContent,
} from '@/src/lib/canvas-document'
import { documentVariablesTab } from '@/src/lib/canvas-document/variables-tab'
import {
  DEFAULT_DOCUMENT_SETTINGS,
  type DocumentSettingsDTO,
} from '@/src/schemas/document.schema'
import type { DocumentDTO } from '@/types/document'
import { DocumentKindChip, DocumentStatusChip } from '../document-chips'
import { SendDocumentDialog } from '../send-document-dialog'
import {
  type DocumentEditorContextValue,
  type DocumentEditorMeta,
  DocumentEditorProvider,
  useDocumentEditor,
} from './document-editor-context'
import {
  DocumentPreviewDialog,
  SAMPLE_VARIABLES,
} from './document-preview-dialog'
import { documentMediaTab } from './document-media-tab'
import { DocumentSettingsPanel } from './document-settings-panel'
import { EDITOR_FONTS } from './editor-theme'

/** "Variáveis" (merge tags into the selected text) and "Mídia" tabs. */
const EXTRA_TABS = [documentVariablesTab(), documentMediaTab()]

/** The document image block (drop or paste a picture on the canvas). */
const DOCUMENT_IMAGE_BLOCK: CanvasImageBlock = {
  type: 'image',
  toProps: (src, current) => ({
    src,
    alt: typeof current?.alt === 'string' ? current.alt : '',
    decorative: current?.decorative === true ? true : undefined,
  }),
}

/** Row changes (settings, theme, title…) are saved this long after the
 * last one. */
export const DOCUMENT_META_SAVE_MS = 800

/** Runs `task` after every task queued before it: the content autosave and
 * the row PATCH never race, so `baseUpdatedAt` always matches this tab. */
function chain<T>(
  queue: { current: Promise<unknown> },
  task: () => Promise<T>,
): Promise<T> {
  const run = queue.current.then(task, task)
  queue.current = run.catch(() => undefined)
  return run
}

function withSettings(doc: DocumentDTO): DocumentSettingsDTO {
  return { ...DEFAULT_DOCUMENT_SETTINGS, ...doc.settings }
}

function EditorSkeleton() {
  return (
    <div className='flex h-full flex-col' aria-busy='true'>
      <Skeleton className='h-12 w-full rounded-none' />
      <div className='flex min-h-0 flex-1 gap-px'>
        <Skeleton className='hidden w-80 rounded-none lg:block' />
        <Skeleton className='min-h-0 flex-1 rounded-none opacity-60' />
        <Skeleton className='hidden w-80 rounded-none lg:block' />
      </div>
    </div>
  )
}

function EditorMessage({
  href,
  label,
  children,
}: {
  href: string
  label: string
  children: ReactNode
}) {
  return (
    <div className='flex h-full flex-col items-center justify-center gap-3 p-6 text-center'>
      <p className='max-w-sm text-muted-foreground text-sm'>{children}</p>
      <Button
        variant='outline'
        size='sm'
        nativeButton={false}
        render={<Link href={href} />}
      >
        {label}
      </Button>
    </div>
  )
}

/** Left of the top bar: back to the document page, title, kind, status. */
function DocumentEditorTitle() {
  const { slug, document, updateMeta, canEdit } = useDocumentEditor()
  const [draft, setDraft] = useState(document.title)

  useEffect(() => {
    setDraft(document.title)
  }, [document.title])

  function commit() {
    const title = draft.trim()
    if (!title) {
      setDraft(document.title)
      return
    }
    if (title !== document.title) updateMeta({ title })
  }

  return (
    <div className='flex min-w-0 items-center gap-1.5'>
      <FocusedBackLink
        href={`/${slug}/crm/documents/${document.id}`}
        label='Voltar para o documento'
      />
      <input
        aria-label='Título do documento'
        data-testid='document-editor-title'
        value={draft}
        maxLength={200}
        disabled={!canEdit}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            setDraft(document.title)
            event.currentTarget.blur()
          }
        }}
        className='h-8 w-40 min-w-0 truncate rounded-md bg-transparent px-2 font-medium text-sm outline-none transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 xl:w-64'
      />
      <DocumentKindChip
        kind={document.kind}
        className='hidden xl:inline-flex'
      />
      <DocumentStatusChip
        status={document.status}
        className='hidden xl:inline-flex'
      />
      {document.currentVersion && document.hasUnsentChanges ? (
        <span className='hidden truncate text-muted-foreground text-xs 2xl:inline'>
          Alterações ainda não enviadas
        </span>
      ) : null}
    </div>
  )
}

/** Right of the top bar: Pré-visualizar, Exportar PDF and Enviar. */
function DocumentEditorActions({ store }: { store: CanvasStore }) {
  const { workspaceId, document, settings, theme, flushMeta, setDocument } =
    useDocumentEditor()
  const { save } = useCanvasEditor()
  const [preview, setPreview] = useState<CanvasDocument | null>(null)
  const [sending, setSending] = useState(false)
  const sent = Boolean(document.currentVersion)

  return (
    <div className='flex items-center gap-1'>
      <Button
        size='sm'
        variant='ghost'
        onClick={() => setPreview(store.getState().doc)}
        data-testid='document-preview-open'
        aria-label='Pré-visualizar'
        title='Pré-visualizar'
      >
        <SteelIcon icon={ViewIcon} data-icon='inline-start' />
        <span className='hidden xl:inline'>Pré-visualizar</span>
      </Button>
      {/* Pending edits are saved as the export starts: the worker renders
          the stored draft a moment later. */}
      <span className='contents' onClickCapture={() => void save()}>
        <DocumentExportButton
          workspaceId={workspaceId}
          documentId={document.id}
          hasVersion={sent}
          variant='ghost'
        />
      </span>
      <Button
        size='sm'
        className='ml-1'
        onClick={() => setSending(true)}
        data-testid='document-send-open'
      >
        <SteelIcon icon={SentIcon} data-icon='inline-start' />
        {sent ? 'Atualizar versão' : 'Enviar'}
      </Button>
      <DocumentPreviewDialog
        open={preview !== null}
        onOpenChange={(open) => !open && setPreview(null)}
        content={preview}
        theme={theme}
        settings={settings}
        validUntil={document.validUntil}
        title={document.title}
      />
      <SendDocumentDialog
        workspaceId={workspaceId}
        document={document}
        open={sending}
        onOpenChange={setSending}
        beforeSend={async () => (await flushMeta()) && (await save())}
        onSent={setDocument}
      />
    </div>
  )
}

type DocumentCatalogFactory = (
  settings: DocumentSettingsDTO,
  validUntil: string | null,
) => CanvasCatalog

interface PendingRow {
  meta: DocumentEditorMeta
  settings: boolean
  theme: boolean
}

const NOTHING_PENDING: PendingRow = { meta: {}, settings: false, theme: false }

function hasPending(pending: PendingRow): boolean {
  return (
    pending.settings || pending.theme || Object.keys(pending.meta).length > 0
  )
}

/** The canvas of one document (remounted per document). */
function DocumentCanvasEditor({
  workspaceId,
  slug,
  initial,
  content,
  catalog,
}: {
  workspaceId: string
  slug: string
  initial: DocumentDTO
  content: CanvasDocument
  catalog: DocumentCatalogFactory
}) {
  const queryClient = useQueryClient()
  const api = useMemo(() => documentsApi(workspaceId), [workspaceId])
  const canEdit = useCan('documents', 'EDIT')
  const documentId = initial.id

  const [document, setDocumentState] = useState(initial)
  const [settings, setSettingsState] = useState(() => withSettings(initial))
  const [theme, setThemeState] = useState<Record<string, unknown>>(
    () => initial.theme ?? {},
  )
  const settingsRef = useRef(settings)
  const themeRef = useRef(theme)
  const lastUpdatedAt = useRef(initial.updatedAt)
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const pending = useRef<PendingRow>(NOTHING_PENDING)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const conflictRef = useRef(false)
  const [conflict, setConflict] = useState(false)
  const [resolving, setResolving] = useState(false)

  const liveCatalog = useMemo(
    () => catalog(settings, document.validUntil),
    [catalog, settings, document.validUntil],
  )
  const [store] = useState(() => createCanvasStore(liveCatalog, content))

  // ── row (PATCH) ─────────────────────────────────────────────────────────
  const flushMeta = useCallback(async (): Promise<boolean> => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const current = pending.current
    if (!hasPending(current)) return true
    pending.current = NOTHING_PENDING
    const body: UpdateDocumentBody = {
      ...current.meta,
      ...(current.settings ? { settings: settingsRef.current } : {}),
      ...(current.theme ? { theme: themeRef.current } : {}),
    }
    try {
      const saved = await chain(queue, () => api.update(documentId, body))
      lastUpdatedAt.current = saved.updatedAt
      // Newer edits typed during the save win over the saved row.
      setDocumentState((local) =>
        hasPending(pending.current)
          ? {
              ...saved,
              title: local.title,
              kind: local.kind,
              validUntil: local.validUntil,
            }
          : saved,
      )
      return true
    } catch (error) {
      const next = pending.current
      pending.current = {
        meta: { ...current.meta, ...next.meta },
        settings: current.settings || next.settings,
        theme: current.theme || next.theme,
      }
      notify.error(error, 'Não foi possível salvar as configurações')
      return false
    }
  }, [api, documentId])

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void flushMeta(), DOCUMENT_META_SAVE_MS)
  }, [flushMeta])

  // Pending row changes are saved on the way out; the list and the
  // document page read the saved row next time.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (hasPending(pending.current)) event.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      void flushMeta().finally(() =>
        queryClient.invalidateQueries({
          queryKey: documentsKeys.all(workspaceId),
        }),
      )
    }
  }, [flushMeta, queryClient, workspaceId])

  // ── content (PUT, autosave of the shell) ────────────────────────────────
  const onSave = useCallback(
    async (doc: CanvasDocument): Promise<boolean> => {
      if (conflictRef.current) return false
      try {
        const result = await chain(queue, () =>
          api.saveContent(documentId, {
            content: doc as unknown as Record<string, unknown>,
            baseUpdatedAt: lastUpdatedAt.current,
          }),
        )
        lastUpdatedAt.current = result.updatedAt
        setDocumentState((local) =>
          local.currentVersion && !local.hasUnsentChanges
            ? { ...local, hasUnsentChanges: true }
            : local,
        )
        return true
      } catch (error) {
        if (isDocumentSaveConflict(error)) {
          conflictRef.current = true
          setConflict(true)
          return false
        }
        notify.error(error, 'Não foi possível salvar o documento')
        return false
      }
    },
    [api, documentId],
  )

  /** Drops local changes and opens the saved version. */
  async function reloadSaved() {
    setResolving(true)
    try {
      const fresh = await api.get(documentId)
      const opened = validateDocumentContent(fresh.content)
      if (!opened.ok) {
        notify.error(opened.error)
        return
      }
      if (timer.current) clearTimeout(timer.current)
      pending.current = NOTHING_PENDING
      store.reset(opened.value)
      store.markSaved(opened.value)
      lastUpdatedAt.current = fresh.updatedAt
      settingsRef.current = withSettings(fresh)
      themeRef.current = fresh.theme ?? {}
      setSettingsState(settingsRef.current)
      setThemeState(themeRef.current)
      setDocumentState(fresh)
      conflictRef.current = false
      setConflict(false)
      notify.success('Versão salva carregada.')
    } catch (error) {
      notify.error(error, 'Não foi possível carregar o documento')
    } finally {
      setResolving(false)
    }
  }

  /** Keeps this tab's version, replacing the newer save. */
  async function overwrite() {
    setResolving(true)
    const { doc } = store.getState()
    try {
      const result = await chain(queue, () =>
        api.saveContent(documentId, {
          content: doc as unknown as Record<string, unknown>,
        }),
      )
      lastUpdatedAt.current = result.updatedAt
      store.markSaved(doc)
      conflictRef.current = false
      setConflict(false)
      notify.success('Suas alterações foram salvas.')
    } catch (error) {
      notify.error(error, 'Não foi possível salvar o documento')
    } finally {
      setResolving(false)
    }
  }

  const mediaProvider = useEmailMediaProvider(workspaceId)
  const onUploadImage = useCallback(
    async (file: File) => {
      try {
        const { url } = await uploadCrmEmailImage(workspaceId, file)
        return url
      } catch (error) {
        notify.error(error, 'Não foi possível enviar a imagem')
        return null
      }
    },
    [workspaceId],
  )

  const value = useMemo<DocumentEditorContextValue>(
    () => ({
      workspaceId,
      slug,
      document,
      settings,
      theme,
      canEdit,
      updateSettings: (patch) => {
        settingsRef.current = { ...settingsRef.current, ...patch }
        setSettingsState(settingsRef.current)
        pending.current = { ...pending.current, settings: true }
        schedule()
      },
      updateTheme: (next) => {
        themeRef.current = next
        setThemeState(next)
        pending.current = { ...pending.current, theme: true }
        schedule()
      },
      updateMeta: (patch) => {
        setDocumentState((local) => ({ ...local, ...patch }) as DocumentDTO)
        pending.current = {
          ...pending.current,
          meta: { ...pending.current.meta, ...patch },
        }
        schedule()
      },
      flushMeta,
      setDocument: (next) => {
        lastUpdatedAt.current = next.updatedAt
        setDocumentState(next)
      },
    }),
    [
      workspaceId,
      slug,
      document,
      settings,
      theme,
      canEdit,
      schedule,
      flushMeta,
    ],
  )

  const viewportWidths = useMemo(
    () => documentViewportWidths(settings),
    [settings],
  )
  const colorTokens = useMemo(
    () => documentColorTokens(parseDocumentTheme(theme)),
    [theme],
  )
  const frameHead = useMemo(
    () => <DocumentStyles theme={theme} settings={settings} mode='editor' />,
    [theme, settings],
  )

  return (
    <DocumentEditorProvider value={value}>
      <CanvasEditor
        catalog={liveCatalog}
        store={store}
        initialDocument={content}
        viewportWidths={viewportWidths}
        colorTokens={colorTokens}
        fonts={EDITOR_FONTS}
        frameHead={frameHead}
        presets={DOCUMENT_SECTION_PRESETS}
        extraTabs={EXTRA_TABS}
        title={<DocumentEditorTitle />}
        actions={({ store: canvasStore }) => (
          <DocumentEditorActions store={canvasStore} />
        )}
        documentSettings={() => <DocumentSettingsPanel />}
        onSave={onSave}
        onUploadImage={onUploadImage}
        mediaProvider={mediaProvider}
        imageBlock={DOCUMENT_IMAGE_BLOCK}
      />
      <AlertDialog open={conflict}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              O documento mudou em outro lugar
            </AlertDialogTitle>
            <AlertDialogDescription>
              Alguém — ou você em outra aba — salvou este documento depois que
              ele foi aberto aqui. Carregue a versão salva (o que você mudou
              desde então se perde) ou mantenha a sua e substitua a outra.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={resolving}
              onClick={() => void overwrite()}
            >
              Manter a minha
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={resolving}
              onClick={() => void reloadSaved()}
            >
              Carregar a versão salva
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DocumentEditorProvider>
  )
}

/**
 * Editor of a document (`/crm/documents/[id]/edit`): Steel Canvas with the
 * `document` catalog, autosave through `PUT content` (409 → reload or keep
 * mine), the document settings in the inspector without selection, and
 * Pré-visualizar, Exportar PDF and Enviar in the top bar.
 */
export function DocumentEditor({
  workspaceId,
  slug,
  documentId,
}: {
  workspaceId: string
  slug: string
  documentId: string
}) {
  const query = useDocument(workspaceId, documentId)
  const canEdit = useCan('documents', 'EDIT')
  const data = query.data
  const pageHref = `/${slug}/crm/documents/${documentId}`
  // Opened once per document (the editor keeps its own state afterwards).
  const opened = useMemo(
    () => (data ? validateDocumentContent(data.content) : null),
    [data?.id],
  )
  const catalog = useCallback(
    (settings: DocumentSettingsDTO, validUntil: string | null) =>
      createDocumentCatalog({
        mode: 'editor',
        settings,
        variables: SAMPLE_VARIABLES,
        validUntil,
      }),
    [],
  )
  const available = useMemo(() => {
    try {
      catalog(DEFAULT_DOCUMENT_SETTINGS, null)
      return true
    } catch {
      return false
    }
  }, [catalog])

  if (query.error) {
    const missing =
      query.error instanceof ApiError &&
      (query.error.status === 404 || query.error.status === 403)
    return (
      <EditorMessage
        href={`/${slug}/crm/documents`}
        label='Voltar para a lista'
      >
        {missing
          ? 'Este documento não existe mais ou você não tem acesso a ele.'
          : 'Não foi possível abrir o documento. Tente novamente em instantes.'}
      </EditorMessage>
    )
  }
  if (!canEdit) {
    return (
      <EditorMessage href={pageHref} label='Ver o documento'>
        Seu perfil pode ver os documentos, mas não editá-los.
      </EditorMessage>
    )
  }
  if (!data || !opened) return <EditorSkeleton />
  if (!available) {
    return (
      <EditorMessage href={pageHref} label='Ver o documento'>
        O editor de documentos ainda está sendo preparado. Tente de novo em
        alguns minutos.
      </EditorMessage>
    )
  }
  if (!opened.ok) {
    return (
      <EditorMessage href={pageHref} label='Ver o documento'>
        Não foi possível abrir o conteúdo deste documento ({opened.error}).
      </EditorMessage>
    )
  }
  return (
    <DocumentCanvasEditor
      key={data.id}
      workspaceId={workspaceId}
      slug={slug}
      initial={data}
      content={opened.value}
      catalog={catalog}
    />
  )
}
