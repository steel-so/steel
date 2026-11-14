'use client'

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Add01Icon,
  Analytics01Icon,
  ArrowLeft02Icon,
  BrowserIcon,
  Copy01Icon,
  Delete02Icon,
  DragDropVerticalIcon,
  Globe02Icon,
  Redo02Icon,
  Undo02Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { SaveStatus } from '@/app/_components/canvas/save-status'
import { CrmLandingPageMetrics } from '@/app/_components/crm/crm-landing-page-metrics'
import { LandingImageAlt } from '@/app/_components/crm/landing-page/image-alt'
import { sectionAnchors } from '@/app/_components/crm/landing-page/section-anchors'
import { withText } from '@/app/_components/crm/landing-page/sections/overrides'
import {
  getSectionDefinition,
  SECTION_REGISTRY,
} from '@/app/_components/crm/landing-page/sections/registry'

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
import { ConfirmAction } from '@/components/ui/confirm-action'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { GhostAiProvider, GhostAiSection } from '@/components/ui/ghost-ai'
import { GhostLinkTargetsProvider } from '@/components/ui/ghost-link'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import {
  useCrmLandingPage,
  useSetCrmLandingPagePublished,
  useUpdateCrmLandingPage,
} from '@/src/hooks/use-crm-landing-page'
import { useCrmTextAi } from '@/src/hooks/use-crm-text-ai'
import { useEditorHistory } from '@/src/hooks/use-editor-history'
import { getLandingPageTemplate } from '@/src/lib/landing-page-templates'
import type { CrmLandingPageSectionContent } from '@/src/schemas/crm-landing-page-section.schema'
import type {
  CrmLandingPageDTO,
  CrmLandingPageStatusDTO,
} from '@/types/crm-landing-page'

export function CrmLandingPageBuilder({
  workspaceId,
  slug,
  pageId,
}: {
  workspaceId: string
  slug: string
  pageId: string
}) {
  const {
    data: page,
    isLoading,
    error,
  } = useCrmLandingPage(workspaceId, pageId)

  if (isLoading) {
    return (
      <div className='flex h-full flex-col'>
        <div className='flex h-14 items-center gap-2 border-b px-4'>
          <Skeleton className='h-6 w-48' />
          <Skeleton className='ml-auto h-8 w-24' />
        </div>
        <Skeleton className='m-3 h-full flex-1' />
      </div>
    )
  }

  if (error || !page) {
    return (
      <div className='flex h-full items-center justify-center text-muted-foreground text-sm'>
        {error instanceof Error ? error.message : 'Página não encontrada.'}
      </div>
    )
  }

  return (
    <CrmLandingPageBuilderInner
      workspaceId={workspaceId}
      slug={slug}
      initial={page}
    />
  )
}

type SectionItem = {
  key: string
  type: keyof typeof SECTION_REGISTRY
  enabled: boolean
  content: CrmLandingPageSectionContent
}

function toSectionItems(page: CrmLandingPageDTO): SectionItem[] {
  return page.sections.map((s) => ({
    key: s.id,
    type: s.type,
    enabled: s.enabled,
    content: s.content,
  }))
}

function CrmLandingPageBuilderInner({
  workspaceId,
  slug,
  initial,
}: {
  workspaceId: string
  slug: string
  initial: CrmLandingPageDTO
}) {
  const router = useRouter()
  const updatePage = useUpdateCrmLandingPage(workspaceId, initial.id)
  const setPublished = useSetCrmLandingPagePublished(workspaceId, initial.id)

  const [title, setTitle] = React.useState(initial.title)
  const [status, setStatus] = React.useState<CrmLandingPageStatusDTO>(
    initial.status,
  )
  const history = useEditorHistory<SectionItem[]>(toSectionItems(initial))
  const sections = history.state
  // Always the latest list, even between a set() and the next render.
  const sectionsRef = React.useRef(sections)
  sectionsRef.current = sections
  const lastQueued = React.useRef(sections)
  const [metricsOpen, setMetricsOpen] = React.useState(false)
  const publicUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/l/${initial.shareToken}`
      : ''

  const online = status === 'PUBLISHED'
  const assist = useCrmTextAi(workspaceId, 'LANDING_PAGE', () => ({ title }))
  const linkTargets = React.useMemo(
    () => sectionAnchors(sections.filter((s) => s.enabled)),
    [sections],
  )
  const keyCounter = React.useRef(sections.length)

  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  // What is waiting for the debounce. Kept so leaving the page never drops it.
  const pendingSave = React.useRef<
    Parameters<typeof updatePage.mutate>[0] | null
  >(null)
  const [saveState, setSaveState] = React.useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle')
  const mutateRef = React.useRef(updatePage.mutate)
  mutateRef.current = updatePage.mutate

  function flushSave() {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = null
    const payload = pendingSave.current
    if (!payload) return
    pendingSave.current = null
    setSaveState('saving')
    updatePage.mutate(payload, {
      onSuccess: () => setSaveState('saved'),
      onError: (error) => {
        pendingSave.current = { ...payload, ...pendingSave.current }
        setSaveState('error')
        notify.error(
          error,
          'Não foi possível salvar as alterações. Confira a conexão e tente de novo.',
        )
      },
    })
  }

  function queueSave(payload: NonNullable<typeof pendingSave.current>) {
    pendingSave.current = { ...pendingSave.current, ...payload }
    setSaveState('saving')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(flushSave, 600)
  }

  React.useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      // Leaving the editor with an edit still waiting: save it now.
      const payload = pendingSave.current
      if (payload) mutateRef.current(payload)
    }
  }, [])

  // Warns the browser tab close while an edit has not reached the server.
  React.useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (pendingSave.current) event.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  function scheduleSectionsSave(next: SectionItem[]) {
    queueSave({
      sections: next.map((s, index) => ({
        type: s.type,
        order: index,
        enabled: s.enabled,
        content: s.content,
      })),
    })
  }

  const scheduleSectionsRef = React.useRef(scheduleSectionsSave)
  scheduleSectionsRef.current = scheduleSectionsSave

  // Every change to the section list (edit, undo, redo) reaches the server
  // through this one effect.
  React.useEffect(() => {
    if (sections === lastQueued.current) return
    lastQueued.current = sections
    scheduleSectionsRef.current(sections)
  }, [sections])

  function commit(next: SectionItem[], group?: string) {
    sectionsRef.current = next
    history.set(next, group)
  }

  function updateSection(key: string, content: CrmLandingPageSectionContent) {
    commit(
      sectionsRef.current.map((s) => (s.key === key ? { ...s, content } : s)),
      `content:${key}`,
    )
  }

  function removeSection(key: string) {
    commit(sectionsRef.current.filter((s) => s.key !== key))
  }

  function newSection(type: keyof typeof SECTION_REGISTRY): SectionItem {
    keyCounter.current += 1
    const definition = getSectionDefinition(initial.templateKey, type)
    return {
      key: `new-${keyCounter.current}`,
      type,
      enabled: true,
      content: definition.createDefaultContent(),
    }
  }

  function insertSection(type: keyof typeof SECTION_REGISTRY, index: number) {
    const cur = sectionsRef.current
    const at = Math.min(Math.max(index, 0), cur.length)
    commit([...cur.slice(0, at), newSection(type), ...cur.slice(at)])
  }

  function duplicateSection(key: string) {
    const cur = sectionsRef.current
    const index = cur.findIndex((s) => s.key === key)
    const source = cur[index]
    if (!source) return
    keyCounter.current += 1
    const copy: SectionItem = {
      ...source,
      key: `new-${keyCounter.current}`,
      content: structuredClone(source.content),
    }
    commit([...cur.slice(0, index + 1), copy, ...cur.slice(index + 1)])
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const cur = sectionsRef.current
    const oldIndex = cur.findIndex((s) => s.key === active.id)
    const newIndex = cur.findIndex((s) => s.key === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    commit(arrayMove(cur, oldIndex, newIndex))
  }

  // Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z and Ctrl+Y. Text fields keep their own
  // native undo, so the shortcut only acts outside them.
  const { undo, redo } = history
  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey)) return
      const target = event.target as HTMLElement | null
      if (
        target?.closest('input, textarea, select, [contenteditable="true"]')
      ) {
        return
      }
      const key = event.key.toLowerCase()
      if (key === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
      } else if (key === 'y') {
        event.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undo, redo])

  function onTitleChange(next: string) {
    setTitle(next)
    if (!next.trim()) return
    queueSave({ title: next.trim() })
  }

  // Publishing checks: a page with no connected form collects nothing, and
  // untouched template copy would go live as-is.
  const publishWarnings = React.useMemo(() => {
    const warnings: string[] = []
    const hasForm = sections.some(
      (s) =>
        s.enabled &&
        (s.content as { formId?: string }).formId !== undefined &&
        (s.content as { formId?: string }).formId !== '',
    )
    if (!hasForm) {
      warnings.push(
        'Nenhum formulário está conectado: quem visitar a página não conseguirá deixar o contato.',
      )
    }
    const original = getLandingPageTemplate(initial.templateKey)?.sections ?? []
    const untouched = sections.filter(
      (s) =>
        s.enabled &&
        original.some(
          (o) =>
            o.type === s.type &&
            JSON.stringify(o.content) === JSON.stringify(s.content),
        ),
    ).length
    if (untouched > 0) {
      warnings.push(
        `${untouched} ${untouched === 1 ? 'seção ainda tem' : 'seções ainda têm'} o texto de exemplo do modelo.`,
      )
    }
    return warnings
  }, [sections, initial.templateKey])
  const [confirmPublish, setConfirmPublish] = React.useState(false)

  async function applyStatus(next: boolean) {
    setStatus(next ? 'PUBLISHED' : 'DRAFT')
    try {
      await setPublished.mutateAsync(next)
      notify.success(next ? 'Página publicada' : 'Página despublicada')
    } catch (error) {
      setStatus(next ? 'DRAFT' : 'PUBLISHED')
      notify.error(
        error,
        'Não foi possível alterar a publicação. Tente de novo.',
      )
    }
  }

  async function onToggleStatus(next: boolean) {
    // Make sure the server has the latest content before it goes live.
    flushSave()
    if (next && publishWarnings.length > 0) {
      setConfirmPublish(true)
      return
    }
    await applyStatus(next)
  }

  return (
    <div className='flex h-full flex-col'>
      <header className='flex h-14 shrink-0 items-center gap-2 border-b px-3'>
        <Button
          variant='ghost'
          size='icon-sm'
          aria-label='Voltar'
          onClick={() => router.push(`/${slug}/crm/landing-pages`)}
        >
          <SteelIcon icon={ArrowLeft02Icon} strokeWidth={2} />
        </Button>
        <SteelIcon
          icon={BrowserIcon}
          strokeWidth={2}
          className='size-4 shrink-0 text-muted-foreground'
        />
        <input
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder='Página sem título'
          aria-label='Título da página'
          className='min-w-0 flex-1 bg-transparent font-semibold text-sm outline-none placeholder:text-muted-foreground/60'
        />

        <div className='flex items-center'>
          <Button
            variant='ghost'
            size='icon-sm'
            aria-label='Desfazer'
            title='Desfazer (Ctrl+Z)'
            disabled={!history.canUndo}
            onClick={history.undo}
          >
            <SteelIcon icon={Undo02Icon} strokeWidth={2} />
          </Button>
          <Button
            variant='ghost'
            size='icon-sm'
            aria-label='Refazer'
            title='Refazer (Ctrl+Shift+Z)'
            disabled={!history.canRedo}
            onClick={history.redo}
          >
            <SteelIcon icon={Redo02Icon} strokeWidth={2} />
          </Button>
        </div>

        <SaveStatus status={saveState} onRetry={flushSave} />

        <Button variant='ghost' size='sm' onClick={() => setMetricsOpen(true)}>
          <SteelIcon icon={Analytics01Icon} strokeWidth={2} />
          Métricas
        </Button>

        {online ? (
          <Button
            variant='ghost'
            size='sm'
            nativeButton={false}
            render={
              <a href={publicUrl} target='_blank' rel='noopener noreferrer'>
                <SteelIcon icon={Globe02Icon} strokeWidth={2} />
                Visualizar
              </a>
            }
          />
        ) : null}

        <div className='flex items-center gap-2 pl-1'>
          <span
            className={cn(
              'rounded-full border px-2 py-0.5 text-xs',
              online
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600'
                : 'border-border bg-muted text-muted-foreground',
            )}
          >
            {online ? 'Online' : 'Offline'}
          </span>
          <Switch
            checked={online}
            disabled={setPublished.isPending}
            onCheckedChange={onToggleStatus}
            aria-label='Publicar página'
          />
        </div>
      </header>

      <div className='min-h-0 flex-1 overflow-y-auto bg-muted/30'>
        <GhostAiProvider assist={assist}>
          <GhostLinkTargetsProvider value={linkTargets}>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={onDragEnd}
            >
              <SortableContext
                items={sections.map((s) => s.key)}
                strategy={verticalListSortingStrategy}
              >
                <div className='landing-page-light-scope mx-auto flex flex-col gap-4 p-4'>
                  {sections.map((section, index) => (
                    <React.Fragment key={section.key}>
                      {index === 0 ? null : (
                        <SectionInserter
                          onPick={(type) => insertSection(type, index)}
                        />
                      )}
                      <SortableSection
                        section={section}
                        templateKey={initial.templateKey}
                        workspaceId={workspaceId}
                        onChange={(content) =>
                          updateSection(section.key, content)
                        }
                        onDuplicate={() => duplicateSection(section.key)}
                        onRemove={() => removeSection(section.key)}
                      />
                    </React.Fragment>
                  ))}

                  <AddSectionMenu
                    onPick={(type) => insertSection(type, sections.length)}
                  />
                </div>
              </SortableContext>
            </DndContext>
          </GhostLinkTargetsProvider>
        </GhostAiProvider>
      </div>

      <AlertDialog open={confirmPublish} onOpenChange={setConfirmPublish}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publicar mesmo assim?</AlertDialogTitle>
            <AlertDialogDescription>
              Antes de colocar a página no ar, confira:
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className='list-disc space-y-1 pl-5 text-sm'>
            {publishWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
          <p className='text-muted-foreground text-xs'>
            Para receber contatos, conecte um formulário na seção de newsletter.
            Ainda não tem um?{' '}
            <Link
              href={`/${slug}/crm/forms`}
              className='text-primary underline underline-offset-2'
            >
              Criar um formulário
            </Link>
            .
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar e ajustar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmPublish(false)
                applyStatus(true)
              }}
            >
              Publicar assim mesmo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {metricsOpen ? (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4'>
          <div className='max-h-[80vh] w-full max-w-lg overflow-auto rounded-lg border bg-background p-4 shadow-lg'>
            <div className='mb-3 flex items-center justify-between'>
              <h2 className='font-semibold text-sm'>Métricas de acesso</h2>
              <Button
                variant='ghost'
                size='sm'
                onClick={() => setMetricsOpen(false)}
              >
                Fechar
              </Button>
            </div>
            <CrmLandingPageMetrics
              workspaceId={workspaceId}
              pageId={initial.id}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}

function SortableSection({
  section,
  templateKey,
  workspaceId,
  onChange,
  onDuplicate,
  onRemove,
}: {
  section: SectionItem
  templateKey: string
  workspaceId: string
  onChange: (content: CrmLandingPageSectionContent) => void
  onDuplicate: () => void
  onRemove: () => void
}) {
  const {
    setNodeRef,
    transform,
    transition,
    attributes,
    listeners,
    isDragging,
  } = useSortable({ id: section.key })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const definition = getSectionDefinition(templateKey, section.type)
  const { Component } = definition

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group/section relative rounded-xl border bg-background',
        isDragging && 'z-10 opacity-70',
      )}
    >
      <div className='flex items-center gap-1 border-b px-2 py-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover/section:opacity-100 pointer-coarse:opacity-100'>
        <button
          type='button'
          aria-label='Reordenar seção'
          className='cursor-grab touch-none rounded p-1 text-muted-foreground hover:bg-muted active:cursor-grabbing pointer-coarse:p-2.5'
          {...attributes}
          {...listeners}
        >
          <SteelIcon icon={DragDropVerticalIcon} strokeWidth={2} size={16} />
        </button>
        <span className='text-muted-foreground text-xs'>
          {definition.label}
        </span>
        <Button
          variant='ghost'
          size='icon-xs'
          className='ml-auto pointer-coarse:size-9'
          aria-label={`Duplicar a seção ${definition.label}`}
          title='Duplicar seção'
          onClick={onDuplicate}
        >
          <SteelIcon icon={Copy01Icon} strokeWidth={2} size={14} />
        </Button>
        <ConfirmAction
          trigger={
            <Button
              variant='ghost'
              size='icon-xs'
              className='pointer-coarse:size-9'
              aria-label={`Remover a seção ${definition.label}`}
            >
              <SteelIcon icon={Delete02Icon} strokeWidth={2} size={14} />
            </Button>
          }
          title={`Remover a seção "${definition.label}"?`}
          description='A seção sai da página. Se mudar de ideia, use Desfazer logo em seguida.'
          confirmLabel='Remover seção'
          onConfirm={onRemove}
        />
      </div>
      <GhostAiSection value={definition.label}>
        <LandingImageAlt
          texts={section.content.texts}
          onEdit={(key, alt) => onChange(withText(section.content, key, alt))}
        >
          <Component
            content={section.content}
            onChange={onChange}
            workspaceId={workspaceId}
          />
        </LandingImageAlt>
      </GhostAiSection>
    </div>
  )
}

function SectionPicker({
  onPick,
}: {
  onPick: (type: keyof typeof SECTION_REGISTRY) => void
}) {
  return (
    <DropdownMenuContent>
      {Object.values(SECTION_REGISTRY).map((definition) => (
        <DropdownMenuItem
          key={definition.type}
          onClick={() => onPick(definition.type)}
        >
          {definition.label}
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  )
}

function AddSectionMenu({
  onPick,
}: {
  onPick: (type: keyof typeof SECTION_REGISTRY) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant='outline' className='self-center'>
            <SteelIcon icon={Add01Icon} strokeWidth={2} />
            Adicionar seção
          </Button>
        }
      />
      <SectionPicker onPick={onPick} />
    </DropdownMenu>
  )
}

/** Thin "+" between two sections; always visible on touch, on hover/focus elsewhere. */
function SectionInserter({
  onPick,
}: {
  onPick: (type: keyof typeof SECTION_REGISTRY) => void
}) {
  return (
    <div className='-my-2 flex h-4 items-center justify-center opacity-0 transition-opacity focus-within:opacity-100 hover:opacity-100 pointer-coarse:opacity-100'>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant='outline'
              size='icon-xs'
              className='rounded-full bg-background'
              aria-label='Inserir seção aqui'
              title='Inserir seção aqui'
            >
              <SteelIcon icon={Add01Icon} strokeWidth={2} size={14} />
            </Button>
          }
        />
        <SectionPicker onPick={onPick} />
      </DropdownMenu>
    </div>
  )
}
