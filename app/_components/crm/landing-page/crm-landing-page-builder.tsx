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
  Delete02Icon,
  DragDropVerticalIcon,
  Globe02Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { CrmLandingPageMetrics } from '@/app/_components/crm/crm-landing-page-metrics'
import { sectionAnchors } from '@/app/_components/crm/landing-page/section-anchors'
import {
  getSectionDefinition,
  SECTION_REGISTRY,
} from '@/app/_components/crm/landing-page/sections/registry'

import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
  const [sections, setSections] = React.useState<SectionItem[]>(() =>
    toSectionItems(initial),
  )
  const [metricsOpen, setMetricsOpen] = React.useState(false)
  const publicUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/l/${initial.shareToken}`
      : ''

  const online = status === 'PUBLISHED'
  const linkTargets = React.useMemo(
    () => sectionAnchors(sections.filter((s) => s.enabled)),
    [sections],
  )
  const keyCounter = React.useRef(sections.length)

  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  React.useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [])

  function scheduleSectionsSave(next: SectionItem[]) {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      updatePage.mutate(
        {
          sections: next.map((s, index) => ({
            type: s.type,
            order: index,
            enabled: s.enabled,
            content: s.content,
          })),
        },
        {
          onError: () => notify.error('Não foi possível salvar a página.'),
        },
      )
    }, 600)
  }

  function updateSection(key: string, content: CrmLandingPageSectionContent) {
    setSections((cur) => {
      const next = cur.map((s) => (s.key === key ? { ...s, content } : s))
      scheduleSectionsSave(next)
      return next
    })
  }

  function removeSection(key: string) {
    setSections((cur) => {
      const next = cur.filter((s) => s.key !== key)
      scheduleSectionsSave(next)
      return next
    })
  }

  function addSection(type: keyof typeof SECTION_REGISTRY) {
    keyCounter.current += 1
    const definition = getSectionDefinition(initial.templateKey, type)
    setSections((cur) => {
      const next = [
        ...cur,
        {
          key: `new-${keyCounter.current}`,
          type,
          enabled: true,
          content: definition.createDefaultContent(),
        },
      ]
      scheduleSectionsSave(next)
      return next
    })
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
    setSections((cur) => {
      const oldIndex = cur.findIndex((s) => s.key === active.id)
      const newIndex = cur.findIndex((s) => s.key === over.id)
      if (oldIndex === -1 || newIndex === -1) return cur
      const next = arrayMove(cur, oldIndex, newIndex)
      scheduleSectionsSave(next)
      return next
    })
  }

  function onTitleChange(next: string) {
    setTitle(next)
    if (!next.trim()) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      updatePage.mutate(
        { title: next.trim() },
        { onError: () => notify.error('Não foi possível salvar o título.') },
      )
    }, 600)
  }

  async function onToggleStatus(next: boolean) {
    setStatus(next ? 'PUBLISHED' : 'DRAFT')
    try {
      await setPublished.mutateAsync(next)
      notify.success(next ? 'Página publicada' : 'Página despublicada')
    } catch {
      setStatus(next ? 'DRAFT' : 'PUBLISHED')
      notify.error('Não foi possível alterar a publicação.')
    }
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
                {sections.map((section) => (
                  <SortableSection
                    key={section.key}
                    section={section}
                    templateKey={initial.templateKey}
                    workspaceId={workspaceId}
                    onChange={(content) => updateSection(section.key, content)}
                    onRemove={() => removeSection(section.key)}
                  />
                ))}

                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button variant='outline' className='self-center'>
                        <SteelIcon icon={Add01Icon} strokeWidth={2} />
                        Adicionar seção
                      </Button>
                    }
                  />
                  <DropdownMenuContent>
                    {Object.values(SECTION_REGISTRY).map((definition) => (
                      <DropdownMenuItem
                        key={definition.type}
                        onClick={() => addSection(definition.type)}
                      >
                        {definition.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </SortableContext>
          </DndContext>
        </GhostLinkTargetsProvider>
      </div>

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
  onRemove,
}: {
  section: SectionItem
  templateKey: string
  workspaceId: string
  onChange: (content: CrmLandingPageSectionContent) => void
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
      <div className='flex items-center gap-1 border-b px-2 py-1 opacity-0 transition-opacity group-hover/section:opacity-100'>
        <button
          type='button'
          aria-label='Reordenar seção'
          className='cursor-grab rounded p-1 text-muted-foreground hover:bg-muted active:cursor-grabbing'
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
          className='ml-auto'
          aria-label='Remover seção'
          onClick={onRemove}
        >
          <SteelIcon icon={Delete02Icon} strokeWidth={2} size={14} />
        </Button>
      </div>
      <Component
        content={section.content}
        onChange={onChange}
        workspaceId={workspaceId}
      />
    </div>
  )
}
