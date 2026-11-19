'use client'

import {
  Add01Icon,
  AiMagicIcon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowUp01Icon,
  Copy01Icon,
  Delete02Icon,
  Download04Icon,
  Image01Icon,
  LockIcon,
  Redo02Icon,
  SquareIcon,
  SquareUnlock01Icon,
  TextFontIcon,
  Undo02Icon,
  ViewIcon,
  ViewOffIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  SaveStatus,
  type SaveStatusValue,
} from '@/app/_components/canvas/save-status'
import { MediaLibraryPicker } from '@/app/_components/media/media-library-picker'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { ConfirmAction } from '@/components/ui/confirm-action'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import {
  crmBannersApi,
  crmBannersKeys,
  useCrmBanner,
} from '@/src/hooks/use-crm-banners'
import {
  crmEmailMediaProvider,
  useCrmEmailBrand,
} from '@/src/hooks/use-crm-email-builder'
import {
  applyCopy,
  duplicateElement,
  findFormat,
  moveElementOrder,
  readCopy,
  removeElement,
  replaceFormat,
  updateElement,
} from '@/src/lib/banners/document'
import {
  createElementFor,
  NEW_ELEMENT_LABELS,
  type NewElementKind,
} from '@/src/lib/banners/elements'
import {
  BANNER_FORMATS,
  findBannerFormat,
  formatSize,
} from '@/src/lib/banners/formats'
import { reflowDocument } from '@/src/lib/banners/reflow'
import type {
  BannerAiCopy,
  BannerDocument,
  BannerElement,
  BannerFormat,
} from '@/src/schemas/crm-banner.schema'
import type { CrmBannerDTO, CrmBannerListItemDTO } from '@/types/crm-banner'
import { BannerAiDialog } from './banner-ai-dialog'
import { BannerExportDialog } from './banner-export-dialog'
import { Field } from './banner-fields'
import { BannerFormatsPicker } from './banner-formats-picker'
import {
  BackgroundEditor,
  type BannerMeta,
  BannerMetaFields,
  ElementInspector,
  InspectorSection,
} from './banner-inspector'
import { BannerStage } from './banner-stage'
import { useBannerImageCache, useBannerImages } from './use-banner-images'
import { useHistory } from './use-history'

const SAVE_DELAY_MS = 1200

const ADD_ICONS: Record<NewElementKind, typeof Add01Icon> = {
  text: TextFontIcon,
  button: SquareIcon,
  image: Image01Icon,
  logo: Image01Icon,
  shape: SquareIcon,
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
  )
}

function elementLabel(element: BannerElement): string {
  if (element.type === 'text' || element.type === 'button') {
    return element.text.trim().slice(0, 28) || element.name || 'Texto'
  }
  return element.name || (element.type === 'logo' ? 'Logo' : 'Imagem')
}

export function BannerEditor({
  workspaceId,
  slug,
  bannerId,
}: {
  workspaceId: string
  slug: string
  bannerId: string
}) {
  const query = useCrmBanner(workspaceId, bannerId)

  if (query.isLoading) {
    return (
      <div className='grid h-full gap-3 p-6' aria-busy='true'>
        <Skeleton className='h-10 w-full' />
        <Skeleton className='h-full w-full' />
      </div>
    )
  }
  if (query.isError || !query.data) {
    return (
      <div className='grid h-full place-content-center justify-items-center gap-3 p-6 text-center'>
        <p className='font-medium'>Não foi possível abrir este banner.</p>
        <p className='text-muted-foreground text-sm'>
          {query.error instanceof Error
            ? query.error.message
            : 'Ele pode ter sido excluído.'}
        </p>
        <div className='flex gap-2'>
          <Button variant='outline' onClick={() => void query.refetch()}>
            Tentar de novo
          </Button>
          <Button
            nativeButton={false}
            render={<Link href={`/${slug}/crm/banners`} />}
          >
            Voltar para os banners
          </Button>
        </div>
      </div>
    )
  }
  return (
    <LoadedBannerEditor
      key={query.data.id}
      workspaceId={workspaceId}
      slug={slug}
      banner={query.data}
    />
  )
}

function LoadedBannerEditor({
  workspaceId,
  slug,
  banner,
}: {
  workspaceId: string
  slug: string
  banner: CrmBannerDTO
}) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const history = useHistory<BannerDocument>(banner.document)
  const doc = history.value
  const { data: brand } = useCrmEmailBrand(workspaceId)

  const [meta, setMeta] = useState<BannerMeta>({
    name: banner.name,
    folder: banner.folder,
    tags: banner.tags,
    objective: banner.objective,
  })
  const [activeId, setActiveId] = useState(
    banner.document.formats[0]?.formatId ?? '',
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [status, setStatus] = useState<SaveStatusValue>('idle')
  const [pickerApply, setPickerApply] = useState<{
    apply: (url: string) => void
  } | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [formatsOpen, setFormatsOpen] = useState(false)
  const [formatSelection, setFormatSelection] = useState<string[]>([])
  const [refreshExisting, setRefreshExisting] = useState(false)
  const [saveTick, setSaveTick] = useState(0)

  const cache = useBannerImageCache(workspaceId)
  const { images, fontsReady } = useBannerImages(cache, doc.formats)
  const mediaProvider = useMemo(
    () => crmEmailMediaProvider(workspaceId),
    [workspaceId],
  )

  const format: BannerFormat =
    findFormat(doc, activeId) ?? (doc.formats[0] as BannerFormat)
  const selected = format.elements.find((element) => element.id === selectedId)
  const brandColor = brand?.primaryColor

  /* ------------------------------- saving ------------------------------- */

  const saved = useRef({
    doc: banner.document,
    meta: JSON.stringify({
      name: banner.name,
      folder: banner.folder,
      tags: banner.tags,
      objective: banner.objective,
    }),
  })
  const saving = useRef(false)
  const latest = useRef({ doc, meta })
  latest.current = { doc, meta }

  const save = useCallback(async () => {
    const { doc: current, meta: currentMeta } = latest.current
    const metaKey = JSON.stringify(currentMeta)
    if (saved.current.doc === current && saved.current.meta === metaKey) {
      return
    }
    if (!currentMeta.name.trim()) {
      setStatus('dirty')
      return
    }
    if (saving.current) return
    saving.current = true
    setStatus('saving')
    try {
      await crmBannersApi(workspaceId).update(banner.id, {
        name: currentMeta.name.trim(),
        folder: currentMeta.folder.trim(),
        tags: currentMeta.tags,
        objective: currentMeta.objective,
        document: current,
      })
      saved.current = { doc: current, meta: metaKey }
      queryClient.setQueryData(crmBannersKeys.detail(workspaceId, banner.id), {
        ...banner,
        ...currentMeta,
        document: current,
      })
      void queryClient.invalidateQueries({
        queryKey: crmBannersKeys.list(workspaceId),
      })
      saving.current = false
      const after = latest.current
      const changed =
        after.doc !== current || JSON.stringify(after.meta) !== metaKey
      setStatus(changed ? 'dirty' : 'saved')
      if (changed) setSaveTick((tick) => tick + 1)
    } catch {
      saving.current = false
      setStatus('error')
    }
  }, [banner, queryClient, workspaceId])

  useEffect(() => {
    void saveTick // re-arms the timer after a save that raced with new edits
    const unchanged =
      saved.current.doc === doc && saved.current.meta === JSON.stringify(meta)
    if (unchanged) return
    setStatus((current) => (current === 'saving' ? current : 'dirty'))
    const timer = setTimeout(() => void save(), SAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [doc, meta, save, saveTick])

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (status === 'dirty' || status === 'saving' || status === 'error') {
        event.preventDefault()
      }
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [status])

  /* ------------------------------- editing ------------------------------- */

  const patchFormat = useCallback(
    (
      change: (current: BannerFormat) => BannerFormat,
      options?: { silent?: boolean; coalesceKey?: string },
    ) => {
      history.set((previous) => {
        const current = findFormat(previous, activeId) ?? previous.formats[0]
        if (!current) return previous
        return replaceFormat(previous, change(current))
      }, options)
    },
    [history, activeId],
  )

  function patchElement(
    id: string,
    patch: Record<string, unknown>,
    options?: { silent?: boolean; coalesceKey?: string },
  ) {
    patchFormat((current) => updateElement(current, id, patch), options)
  }

  function addElement(kind: NewElementKind) {
    const element = createElementFor(format, kind, {
      brandColor,
      src: kind === 'logo' ? brand?.logoUrl : undefined,
    })
    patchFormat((current) => ({
      ...current,
      elements: [...current.elements, element],
    }))
    setSelectedId(element.id)
    if (kind === 'image' || (kind === 'logo' && !brand?.logoUrl)) {
      setPickerApply({
        apply: (url) => patchElement(element.id, { src: url }),
      })
    }
  }

  function removeSelected() {
    if (!selected || selected.locked) return
    patchFormat((current) => removeElement(current, selected.id))
    setSelectedId(null)
  }

  function duplicateSelected() {
    if (!selected) return
    const result = duplicateElement(format, selected.id)
    if (!result.id) return
    patchFormat(() => result.format)
    setSelectedId(result.id)
  }

  // Keyboard: undo/redo, delete, duplicate, nudge, save.
  const shortcuts = useRef<(event: KeyboardEvent) => void>(() => {})
  shortcuts.current = (event) => {
    if (isTypingTarget(event.target)) return
    const mod = event.ctrlKey || event.metaKey
    const key = event.key.toLowerCase()
    if (mod && key === 'z') {
      event.preventDefault()
      if (event.shiftKey) history.redo()
      else history.undo()
    } else if (mod && key === 'y') {
      event.preventDefault()
      history.redo()
    } else if (mod && key === 's') {
      event.preventDefault()
      void save()
    } else if (mod && key === 'd' && selected) {
      event.preventDefault()
      duplicateSelected()
    } else if ((key === 'delete' || key === 'backspace') && selected) {
      event.preventDefault()
      removeSelected()
    } else if (key === 'escape') {
      setSelectedId(null)
    } else if (selected && !selected.locked && key.startsWith('arrow')) {
      event.preventDefault()
      const step = event.shiftKey ? 10 : 1
      const dx = key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0
      const dy = key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0
      patchElement(
        selected.id,
        { x: selected.x + dx, y: selected.y + dy },
        { coalesceKey: `nudge:${selected.id}` },
      )
    }
  }
  useEffect(() => {
    const handler = (event: KeyboardEvent) => shortcuts.current(event)
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  /* ------------------------------- formats ------------------------------- */

  function openFormats() {
    setFormatSelection(doc.formats.map((item) => item.formatId))
    setRefreshExisting(false)
    setFormatsOpen(true)
  }

  function applyFormats() {
    const wanted = new Set([...formatSelection, activeId])
    const existing = new Set(doc.formats.map((item) => item.formatId))
    const specs = BANNER_FORMATS.filter((spec) => wanted.has(spec.id))
    const toGenerate = specs.filter(
      (spec) =>
        spec.id !== activeId && (refreshExisting || !existing.has(spec.id)),
    )
    history.set((previous) => {
      const reflowed = reflowDocument(previous, activeId, toGenerate)
      const order = new Map(
        BANNER_FORMATS.map((spec, index) => [spec.id, index]),
      )
      return {
        ...reflowed,
        formats: reflowed.formats
          .filter((item) => wanted.has(item.formatId))
          .sort(
            (a, b) =>
              (order.get(a.formatId) ?? 999) - (order.get(b.formatId) ?? 999),
          ),
      }
    })
    setFormatsOpen(false)
  }

  function reflowToOthers() {
    const specs = doc.formats
      .filter((item) => item.formatId !== activeId)
      .map((item) => findBannerFormat(item.formatId))
      .filter((spec) => spec !== undefined)
    history.set((previous) => reflowDocument(previous, activeId, specs))
  }

  /* --------------------------------- copy -------------------------------- */

  const copy = readCopy(format)

  function setCopy(patch: Partial<typeof copy>, key: string) {
    history.set((previous) => applyCopy(previous, patch), { coalesceKey: key })
  }

  async function createVersion(variant: BannerAiCopy) {
    try {
      const created = await crmBannersApi(workspaceId).create({
        name: `${meta.name} — B`.slice(0, 120),
        folder: meta.folder,
        tags: meta.tags,
        objective: meta.objective,
        document: applyCopy(doc, variant),
      })
      void queryClient.invalidateQueries({
        queryKey: crmBannersKeys.list(workspaceId),
      })
      router.push(`/${slug}/crm/banners/${created.id}`)
    } catch (error) {
      notify.error(error, 'Não foi possível criar a versão B')
    }
  }

  const folders = useMemo(() => {
    const list = queryClient.getQueryData<CrmBannerListItemDTO[]>(
      crmBannersKeys.list(workspaceId),
    )
    return [...new Set((list ?? []).map((item) => item.folder).filter(Boolean))]
  }, [queryClient, workspaceId])

  /* --------------------------------- view --------------------------------- */

  const layers = [...format.elements].reverse()

  return (
    <div className='flex h-full min-h-0 flex-col' data-testid='banner-editor'>
      <header className='flex flex-wrap items-center gap-2 border-b px-3 py-2'>
        <Button
          variant='ghost'
          size='icon'
          aria-label='Voltar para os banners'
          nativeButton={false}
          render={<Link href={`/${slug}/crm/banners`} />}
          className='hidden lg:inline-flex'
        >
          <SteelIcon icon={ArrowLeft01Icon} />
        </Button>
        <Input
          aria-label='Nome do banner'
          value={meta.name}
          maxLength={120}
          aria-invalid={!meta.name.trim()}
          onChange={(event) =>
            setMeta((current) => ({ ...current, name: event.target.value }))
          }
          className='h-8 w-48 min-w-0 flex-1 sm:max-w-xs sm:flex-none'
        />
        <SaveStatus status={status} onRetry={() => void save()} />
        <div className='ml-auto flex flex-wrap items-center gap-1.5'>
          <Button
            variant='ghost'
            size='icon-sm'
            aria-label='Desfazer'
            disabled={!history.canUndo}
            onClick={history.undo}
          >
            <SteelIcon icon={Undo02Icon} />
          </Button>
          <Button
            variant='ghost'
            size='icon-sm'
            aria-label='Refazer'
            disabled={!history.canRedo}
            onClick={history.redo}
          >
            <SteelIcon icon={Redo02Icon} />
          </Button>
          <Button variant='outline' size='sm' onClick={() => setAiOpen(true)}>
            <SteelIcon icon={AiMagicIcon} />
            Variações com IA
          </Button>
          <Button size='sm' onClick={() => setExportOpen(true)}>
            <SteelIcon icon={Download04Icon} />
            Exportar
          </Button>
        </div>
      </header>

      <div className='flex min-h-0 flex-1 flex-col lg:flex-row'>
        {/* Left: add + layers */}
        <aside className='order-2 flex shrink-0 flex-col border-b lg:order-1 lg:w-60 lg:border-r lg:border-b-0'>
          <div className='grid gap-2 border-b p-3'>
            <h2 className='font-medium text-muted-foreground text-xs uppercase tracking-wide'>
              Adicionar
            </h2>
            <div className='flex flex-wrap gap-1.5'>
              {(Object.keys(NEW_ELEMENT_LABELS) as NewElementKind[]).map(
                (kind) => (
                  <Button
                    key={kind}
                    variant='outline'
                    size='sm'
                    onClick={() => addElement(kind)}
                  >
                    <SteelIcon icon={ADD_ICONS[kind]} />
                    {NEW_ELEMENT_LABELS[kind]}
                  </Button>
                ),
              )}
            </div>
          </div>
          <div className='hidden min-h-0 flex-1 overflow-y-auto p-3 lg:block'>
            <h2 className='mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wide'>
              Camadas
            </h2>
            {layers.length === 0 ? (
              <p className='text-muted-foreground text-sm'>
                Nada neste formato ainda. Use “Adicionar”.
              </p>
            ) : (
              <ul className='grid gap-0.5'>
                {layers.map((element) => (
                  <li
                    key={element.id}
                    className={cn(
                      'group flex items-center gap-1 rounded-md pr-1 text-sm',
                      element.id === selectedId
                        ? 'bg-primary/10'
                        : 'hover:bg-muted',
                    )}
                  >
                    <button
                      type='button'
                      onClick={() => setSelectedId(element.id)}
                      className={cn(
                        'min-w-0 flex-1 truncate px-2 py-1.5 text-left',
                        element.hidden && 'text-muted-foreground line-through',
                      )}
                    >
                      {elementLabel(element)}
                    </button>
                    <Button
                      variant='ghost'
                      size='icon-xs'
                      aria-label={element.hidden ? 'Mostrar' : 'Ocultar'}
                      onClick={() => {
                        setSelectedId(element.id)
                        patchElement(element.id, { hidden: !element.hidden })
                      }}
                    >
                      <SteelIcon
                        icon={element.hidden ? ViewOffIcon : ViewIcon}
                      />
                    </Button>
                    <Button
                      variant='ghost'
                      size='icon-xs'
                      aria-label={element.locked ? 'Destravar' : 'Travar'}
                      onClick={() =>
                        patchElement(element.id, { locked: !element.locked })
                      }
                    >
                      <SteelIcon
                        icon={element.locked ? LockIcon : SquareUnlock01Icon}
                      />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* Center: formats + stage */}
        <main className='order-1 flex min-h-[18rem] min-w-0 flex-1 flex-col lg:order-2'>
          <nav
            aria-label='Formatos'
            className='flex items-center gap-1.5 overflow-x-auto border-b px-3 py-2'
          >
            {doc.formats.map((item) => {
              const spec = findBannerFormat(item.formatId)
              const active = item.formatId === activeId
              return (
                <button
                  key={item.formatId}
                  type='button'
                  aria-pressed={active}
                  onClick={() => {
                    setActiveId(item.formatId)
                    setSelectedId(null)
                  }}
                  className={cn(
                    'shrink-0 rounded-md border px-2.5 py-1 text-left text-xs transition-colors',
                    active
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'text-muted-foreground hover:bg-muted',
                  )}
                >
                  <span className='block font-medium'>
                    {spec?.label ?? 'Formato'}
                  </span>
                  <span className='tabular-nums'>{formatSize(item)}</span>
                </button>
              )
            })}
            <Button
              variant='ghost'
              size='sm'
              onClick={openFormats}
              className='shrink-0'
            >
              <SteelIcon icon={Add01Icon} />
              Formatos
            </Button>
            {doc.formats.length > 1 ? (
              <ConfirmAction
                destructive={false}
                trigger={
                  <Button variant='ghost' size='sm' className='shrink-0'>
                    <SteelIcon icon={Copy01Icon} />
                    Refazer nos outros
                  </Button>
                }
                title='Refazer os outros formatos a partir deste?'
                description='O layout deste formato é reaproveitado nos demais, e os ajustes manuais feitos neles são substituídos. Dá para desfazer.'
                confirmLabel='Refazer'
                onConfirm={reflowToOthers}
              />
            ) : null}
          </nav>

          <BannerStage
            format={format}
            images={images}
            fontsReady={fontsReady}
            selectedId={selectedId}
            zoom={zoom}
            onSelect={setSelectedId}
            onGestureStart={history.checkpoint}
            onPatch={(id, patch) => patchElement(id, patch, { silent: true })}
          />

          <div className='flex items-center justify-between gap-3 border-t px-3 py-1.5 text-muted-foreground text-xs'>
            <span>
              {formatSize(format)} px · arraste para mover, Alt desliga o ímã
            </span>
            <label className='flex items-center gap-2'>
              Zoom
              <input
                type='range'
                min={0.25}
                max={2}
                step={0.05}
                value={zoom}
                onChange={(event) => setZoom(Number(event.target.value))}
                aria-label='Zoom'
                className='w-28 accent-primary'
              />
            </label>
          </div>
        </main>

        {/* Right: inspector */}
        <aside className='order-3 max-h-[45vh] shrink-0 overflow-y-auto border-t lg:max-h-none lg:w-80 lg:border-t-0 lg:border-l'>
          {selected ? (
            <>
              <div className='flex items-center justify-between gap-2 border-b p-3'>
                <span className='min-w-0 truncate font-medium text-sm'>
                  {elementLabel(selected)}
                </span>
                <div className='flex shrink-0 gap-0.5'>
                  <Button
                    variant='ghost'
                    size='icon-sm'
                    aria-label='Trazer para frente'
                    onClick={() =>
                      patchFormat((current) =>
                        moveElementOrder(current, selected.id, 1),
                      )
                    }
                  >
                    <SteelIcon icon={ArrowUp01Icon} />
                  </Button>
                  <Button
                    variant='ghost'
                    size='icon-sm'
                    aria-label='Enviar para trás'
                    onClick={() =>
                      patchFormat((current) =>
                        moveElementOrder(current, selected.id, -1),
                      )
                    }
                  >
                    <SteelIcon icon={ArrowDown01Icon} />
                  </Button>
                  <Button
                    variant='ghost'
                    size='icon-sm'
                    aria-label='Duplicar'
                    onClick={duplicateSelected}
                  >
                    <SteelIcon icon={Copy01Icon} />
                  </Button>
                  <Button
                    variant='ghost'
                    size='icon-sm'
                    aria-label='Excluir elemento'
                    disabled={selected.locked}
                    onClick={removeSelected}
                  >
                    <SteelIcon icon={Delete02Icon} />
                  </Button>
                </div>
              </div>
              {selected.locked ? (
                <p className='border-b bg-muted/50 p-3 text-muted-foreground text-xs'>
                  Este elemento está travado. Destrave nas camadas para mover ou
                  excluir.
                </p>
              ) : null}
              <ElementInspector
                key={selected.id}
                element={selected}
                onPatch={(patch, key) =>
                  patchElement(selected.id, patch, {
                    coalesceKey: `${selected.id}:${key}`,
                  })
                }
                onPickImage={(apply) => setPickerApply({ apply })}
              />
            </>
          ) : (
            <>
              <InspectorSection title='Textos (todos os formatos)'>
                <CopyField
                  label='Título'
                  value={copy.headline}
                  disabled={!format.elements.some((e) => e.role === 'headline')}
                  onChange={(headline) =>
                    setCopy({ headline }, 'copy:headline')
                  }
                />
                <CopyField
                  label='Subtítulo'
                  value={copy.subheadline}
                  disabled={
                    !format.elements.some((e) => e.role === 'subheadline')
                  }
                  onChange={(subheadline) =>
                    setCopy({ subheadline }, 'copy:sub')
                  }
                />
                <CopyField
                  label='Botão'
                  value={copy.cta}
                  disabled={!format.elements.some((e) => e.role === 'cta')}
                  onChange={(cta) => setCopy({ cta }, 'copy:cta')}
                />
              </InspectorSection>
              <InspectorSection title={`Fundo de ${formatSize(format)}`}>
                <BackgroundEditor
                  background={format.background}
                  onChange={(background) =>
                    patchFormat((current) => ({ ...current, background }), {
                      coalesceKey: 'background',
                    })
                  }
                  onPickImage={(apply) => setPickerApply({ apply })}
                />
              </InspectorSection>
              <BannerMetaFields
                meta={meta}
                folders={folders}
                onChange={(patch) =>
                  setMeta((current) => ({ ...current, ...patch }))
                }
              />
            </>
          )}
        </aside>
      </div>

      <MediaLibraryPicker
        open={pickerApply !== null}
        onOpenChange={(open) => {
          if (!open) setPickerApply(null)
        }}
        provider={mediaProvider}
        onSelect={(item) => {
          pickerApply?.apply(item.url)
          setPickerApply(null)
        }}
      />

      <BannerExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        workspaceId={workspaceId}
        bannerName={meta.name}
        formats={doc.formats}
        activeFormatId={activeId}
        cache={cache}
      />

      <BannerAiDialog
        open={aiOpen}
        onOpenChange={setAiOpen}
        workspaceId={workspaceId}
        companyName={brand?.companyName ?? ''}
        objective={meta.objective}
        current={{ ...copy }}
        onUse={(variant) => {
          history.set((previous) => applyCopy(previous, variant))
        }}
        onCreateVersion={createVersion}
      />

      <Dialog open={formatsOpen} onOpenChange={setFormatsOpen}>
        <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-2xl'>
          <DialogHeader>
            <DialogTitle>Formatos do banner</DialogTitle>
            <DialogDescription>
              Os formatos novos nascem do que está aberto agora (
              {formatSize(format)}
              ), com o layout adaptado a cada proporção. Depois dá para ajustar
              cada um à mão.
            </DialogDescription>
          </DialogHeader>
          <BannerFormatsPicker
            selected={formatSelection}
            disabledIds={[activeId]}
            onChange={setFormatSelection}
          />
          <label className='flex items-center gap-2 text-sm'>
            <input
              type='checkbox'
              checked={refreshExisting}
              onChange={(event) => setRefreshExisting(event.target.checked)}
              className='accent-primary'
            />
            Refazer também os formatos que já existem (substitui os ajustes
            manuais)
          </label>
          <DialogFooter>
            <Button variant='ghost' onClick={() => setFormatsOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={applyFormats}>Aplicar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function CopyField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string
  value: string
  disabled: boolean
  onChange: (value: string) => void
}) {
  return (
    <Field label={label}>
      {(id) => (
        <Input
          id={id}
          value={value}
          disabled={disabled}
          maxLength={200}
          placeholder={disabled ? 'Não há este elemento no banner' : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  )
}
