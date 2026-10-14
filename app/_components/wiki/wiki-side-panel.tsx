'use client'

import {
  Attachment01Icon,
  AudioWave01Icon,
  Video01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import type { Value } from 'platejs'
import { useEffect, useMemo, useState } from 'react'
import { useIsMobile } from '@/components/hooks/use-mobile'
import { SteelIcon } from '@/components/icon/icon'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import type { WikiLabelDTO } from '@/types/wiki-label'
import type { WikiPageDTO, WikiPagePersonDTO } from '@/types/wiki-page'
import type { WikiPanelTab } from './use-wiki-preferences'
import { WIKI_LABEL_TONE } from './wiki-label-colors'
import {
  blockSelector,
  pageOutline,
  pageResources,
  pageStats,
  readingTimeLabel,
  scrollToBlock,
  type WikiOutlineItem,
  type WikiResource,
} from './wiki-page-content'

const NUMBER = new Intl.NumberFormat('pt-BR')

/** Id of the last heading scrolled past the top of the page's scroller. */
function useActiveHeading(
  items: WikiOutlineItem[],
  scroller: HTMLElement | null,
) {
  const [active, setActive] = useState<string | null>(null)

  useEffect(() => {
    if (!scroller || items.length === 0) {
      setActive(null)
      return
    }
    function update() {
      if (!scroller) return
      const top = scroller.getBoundingClientRect().top + 96
      let current: string | null = items[0]?.id ?? null
      for (const item of items) {
        const element = scroller.querySelector(blockSelector(item.id))
        if (!element) continue
        if (element.getBoundingClientRect().top <= top) current = item.id
        else break
      }
      setActive(current)
    }
    update()
    scroller.addEventListener('scroll', update, { passive: true })
    return () => scroller.removeEventListener('scroll', update)
  }, [items, scroller])

  return active
}

function OutlineTab({
  items,
  activeId,
  onNavigate,
}: {
  items: WikiOutlineItem[]
  activeId: string | null
  onNavigate: (id: string) => void
}) {
  if (items.length === 0) {
    return (
      <p className='px-1 text-muted-foreground text-sm'>
        Os títulos da página (Título 1, 2, 3…) aparecem aqui.
      </p>
    )
  }
  const minLevel = Math.min(...items.map((item) => item.level))
  return (
    <nav aria-label='Estrutura da página'>
      <ul className='space-y-0.5'>
        {items.map((item) => (
          <li key={item.id}>
            <button
              type='button'
              onClick={() => onNavigate(item.id)}
              aria-current={item.id === activeId ? 'location' : undefined}
              style={{ paddingLeft: `${(item.level - minLevel) * 12 + 8}px` }}
              className={cn(
                'block w-full cursor-pointer truncate rounded-sm py-1 pr-2 text-left text-sm transition-colors hover:bg-accent',
                item.id === activeId
                  ? 'bg-accent font-medium text-foreground'
                  : 'text-muted-foreground',
              )}
            >
              {item.text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return `${parts[0]?.[0] ?? '?'}${parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : ''}`.toUpperCase()
}

function relative(date: string) {
  return formatDistanceToNow(new Date(date), { addSuffix: true, locale: ptBR })
}

function PersonRow({
  label,
  person,
  date,
}: {
  label: string
  person: WikiPagePersonDTO | null | undefined
  date: string
}) {
  return (
    <div className='space-y-1.5'>
      <dt className='text-muted-foreground text-xs'>{label}</dt>
      <dd className='flex items-center gap-2'>
        {person ? (
          <>
            <Avatar size='sm'>
              {person.image && <AvatarImage src={person.image} alt='' />}
              <AvatarFallback className='text-[10px]'>
                {initials(person.name)}
              </AvatarFallback>
            </Avatar>
            <span className='min-w-0 flex-1'>
              <span className='block truncate font-medium text-sm'>
                {person.name}
              </span>
              <span className='block text-muted-foreground text-xs'>
                {relative(date)}
              </span>
            </span>
          </>
        ) : (
          <span className='text-muted-foreground text-sm'>
            {relative(date)}
          </span>
        )}
      </dd>
    </div>
  )
}

function InfoTab({
  value,
  page,
  labels,
}: {
  value: Value
  page: WikiPageDTO
  labels: WikiLabelDTO[]
}) {
  const stats = useMemo(() => pageStats(value), [value])
  const applied = labels.filter((label) => page.labelIds.includes(label.id))
  const numbers = [
    { label: 'Palavras', value: stats.words },
    { label: 'Caracteres', value: stats.characters },
    { label: 'Parágrafos', value: stats.paragraphs },
  ]

  return (
    <div className='space-y-5'>
      <section aria-label='Estatísticas'>
        <dl className='grid grid-cols-3 gap-2'>
          {numbers.map((item) => (
            <div key={item.label} className='rounded-md bg-muted/60 p-2'>
              <dt className='text-muted-foreground text-xs'>{item.label}</dt>
              <dd className='font-semibold text-base tabular-nums'>
                {NUMBER.format(item.value)}
              </dd>
            </div>
          ))}
        </dl>
        <p className='mt-2 text-muted-foreground text-xs'>
          {readingTimeLabel(stats.readingMinutes)}
        </p>
      </section>

      <section aria-label='Etiquetas' className='space-y-1.5'>
        <h3 className='text-muted-foreground text-xs'>Etiquetas</h3>
        {applied.length === 0 ? (
          <p className='text-muted-foreground text-sm'>Nenhuma etiqueta</p>
        ) : (
          <ul className='flex flex-wrap gap-1.5'>
            {applied.map((label) => (
              <li
                key={label.id}
                className={cn(
                  'inline-flex h-6 items-center rounded-sm px-2 font-medium text-xs',
                  WIKI_LABEL_TONE[label.color].chip,
                )}
              >
                {label.name}
              </li>
            ))}
          </ul>
        )}
      </section>

      <dl className='space-y-4'>
        <PersonRow
          label='Editado por'
          person={page.updatedBy ?? page.createdBy}
          date={page.updatedAt}
        />
        <PersonRow
          label='Criado por'
          person={page.createdBy}
          date={page.createdAt}
        />
      </dl>
    </div>
  )
}

const RESOURCE_ICON = {
  file: Attachment01Icon,
  video: Video01Icon,
  audio: AudioWave01Icon,
} as const

function ResourcesTab({
  resources,
  onNavigate,
}: {
  resources: WikiResource[]
  onNavigate: (id: string) => void
}) {
  if (resources.length === 0) {
    return (
      <p className='px-1 text-muted-foreground text-sm'>
        Imagens e arquivos da página aparecem aqui.
      </p>
    )
  }
  return (
    <ul className='space-y-1' aria-label='Recursos da página'>
      {resources.map((resource) => (
        <li key={resource.id}>
          <button
            type='button'
            onClick={() => onNavigate(resource.id)}
            className='flex w-full cursor-pointer items-center gap-2 rounded-md p-1.5 text-left hover:bg-accent'
          >
            {resource.kind === 'image' ? (
              <img
                src={resource.url}
                alt=''
                className='size-10 shrink-0 rounded-sm border object-cover'
              />
            ) : (
              <span className='flex size-10 shrink-0 items-center justify-center rounded-sm border bg-muted text-muted-foreground'>
                <SteelIcon
                  icon={RESOURCE_ICON[resource.kind]}
                  strokeWidth={2}
                />
              </span>
            )}
            <span className='min-w-0 flex-1 truncate text-sm'>
              {resource.name}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

export interface WikiSidePanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tab: WikiPanelTab
  onTabChange: (tab: WikiPanelTab) => void
  value: Value
  page: WikiPageDTO
  labels: WikiLabelDTO[]
  /** The page's scroller, to follow the heading being read. */
  scroller: HTMLElement | null
}

function PanelTabs({
  tab,
  onTabChange,
  value,
  page,
  labels,
  scroller,
  onNavigated,
}: Omit<WikiSidePanelProps, 'open' | 'onOpenChange'> & {
  onNavigated?: () => void
}) {
  const outline = useMemo(() => pageOutline(value), [value])
  const resources = useMemo(() => pageResources(value), [value])
  const activeId = useActiveHeading(outline, scroller)

  function navigate(id: string) {
    scrollToBlock(id)
    onNavigated?.()
  }

  return (
    <Tabs
      value={tab}
      onValueChange={(next) => onTabChange(next as WikiPanelTab)}
      className='min-h-0 flex-1'
    >
      <TabsList className='w-full'>
        <TabsTrigger value='outline'>Estrutura</TabsTrigger>
        <TabsTrigger value='info'>Info</TabsTrigger>
        <TabsTrigger value='resources'>Recursos</TabsTrigger>
      </TabsList>
      <div className='min-h-0 flex-1 overflow-y-auto pt-2'>
        <TabsContent value='outline'>
          <OutlineTab
            items={outline}
            activeId={activeId}
            onNavigate={navigate}
          />
        </TabsContent>
        <TabsContent value='info'>
          <InfoTab value={value} page={page} labels={labels} />
        </TabsContent>
        <TabsContent value='resources'>
          <ResourcesTab resources={resources} onNavigate={navigate} />
        </TabsContent>
      </div>
    </Tabs>
  )
}

/**
 * The page's right-hand panel: outline, info (stats, labels, who edited) and
 * resources (images and files). A sheet on phones.
 */
export function WikiSidePanel({
  open,
  onOpenChange,
  ...props
}: WikiSidePanelProps) {
  const isMobile = useIsMobile()

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side='right' className='w-[85vw] gap-2 p-4'>
          <SheetHeader className='p-0'>
            <SheetTitle>Painel da página</SheetTitle>
            <SheetDescription className='sr-only'>
              Estrutura, informações e recursos da página.
            </SheetDescription>
          </SheetHeader>
          <PanelTabs {...props} onNavigated={() => onOpenChange(false)} />
        </SheetContent>
      </Sheet>
    )
  }

  if (!open) return null
  return (
    <aside
      aria-label='Painel da página'
      data-testid='wiki-side-panel'
      className='flex w-72 shrink-0 flex-col border-l border-secondary p-3 lg:w-80'
    >
      <PanelTabs {...props} />
    </aside>
  )
}
