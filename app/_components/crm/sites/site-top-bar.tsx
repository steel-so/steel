'use client'

import {
  Clock01Icon,
  LinkSquare02Icon,
  Rocket01Icon,
  Settings02Icon,
  ViewIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { FocusedBackLink } from '@/app/_components/layout/focused-screen'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { PublishDialog } from './publish-dialog'
import { orderPages, useSiteEditor } from './site-editor-context'
import { SiteSettingsDialog } from './site-settings-dialog'
import { SiteStatusBadge } from './site-status-badge'
import { useOpenTarget } from './use-open-target'
import { VersionsSheet } from './versions-sheet'

const GLOBAL_LABELS = {
  HEADER: 'Cabeçalho',
  FOOTER: 'Rodapé',
  SYMBOL: 'Símbolo',
} as const

const iconLink =
  'flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none'

/** Page/global the canvas is editing; picking another saves first. */
function TargetSwitcher() {
  const { pages, globals, target } = useSiteEditor()
  const openTarget = useOpenTarget()
  const ordered = orderPages(pages)
  const value = `${target.kind}:${target.id}`
  const labelOf = (key: string | null) => {
    if (!key) return 'Página'
    const [kind, id] = key.split(':')
    if (kind === 'page') {
      return pages.find((page) => page.id === id)?.title ?? 'Página'
    }
    const global = globals.find((item) => item.id === id)
    return global ? GLOBAL_LABELS[global.kind] : 'Global'
  }
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (typeof next !== 'string' || next === value) return
        const [kind, id] = next.split(':')
        void openTarget({ kind: kind === 'global' ? 'global' : 'page', id })
      }}
    >
      <SelectTrigger
        size='sm'
        aria-label='Página em edição'
        data-testid='site-target-switcher'
        className='h-8 w-44 min-w-0 shrink text-xs xl:w-56'
      >
        <SelectValue>
          {(current: string | null) => labelOf(current)}
        </SelectValue>
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} className='min-w-56'>
        <SelectGroup>
          <SelectLabel>Páginas</SelectLabel>
          {ordered.map((page) => (
            <SelectItem key={page.id} value={`page:${page.id}`}>
              <span
                className='truncate'
                style={{ paddingLeft: page.depth * 12 }}
              >
                {page.title}
              </span>
              {page.isHome ? (
                <span className='ml-auto text-[11px] text-muted-foreground'>
                  Inicial
                </span>
              ) : null}
            </SelectItem>
          ))}
        </SelectGroup>
        {globals.length > 0 ? (
          <>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>Globais</SelectLabel>
              {globals.map((global) => (
                <SelectItem key={global.id} value={`global:${global.id}`}>
                  {GLOBAL_LABELS[global.kind]}
                </SelectItem>
              ))}
            </SelectGroup>
          </>
        ) : null}
      </SelectContent>
    </Select>
  )
}

/** Left side of the top bar: back, site name (settings), target, status. */
export function SiteEditorTitle() {
  const { slug, site } = useSiteEditor()
  const [settingsOpen, setSettingsOpen] = useState(false)
  return (
    <div className='flex min-w-0 items-center gap-1.5'>
      <FocusedBackLink
        href={`/${slug}/crm/sites`}
        label='Voltar para os sites'
      />
      <button
        type='button'
        onClick={() => setSettingsOpen(true)}
        title='Configurações do site'
        className='group flex h-8 min-w-0 items-center gap-1.5 rounded-md px-2 font-medium text-sm transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none'
      >
        <span className='max-w-40 truncate xl:max-w-64'>{site.name}</span>
        <SteelIcon
          icon={Settings02Icon}
          className='size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground'
        />
      </button>
      <span aria-hidden='true' className='text-muted-foreground/60'>
        /
      </span>
      <TargetSwitcher />
      <SiteStatusBadge status={site.status} className='hidden xl:inline-flex' />
      <SiteSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
}

/** Right side: preview, history, live site and Publicar. */
export function SiteEditorActions() {
  const { site, target, previewHref } = useSiteEditor()
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  const live = site.status === 'PUBLISHED'
  return (
    <div className='flex items-center gap-1'>
      <a
        href={previewHref(target.kind === 'page' ? target.id : undefined)}
        target='_blank'
        rel='noopener'
        aria-label='Visualizar o rascunho'
        title='Visualizar o rascunho'
        className={iconLink}
      >
        <SteelIcon icon={ViewIcon} className='size-4' />
      </a>
      <button
        type='button'
        onClick={() => setVersionsOpen(true)}
        aria-label='Histórico de versões'
        title='Histórico de versões'
        className={iconLink}
      >
        <SteelIcon icon={Clock01Icon} className='size-4' />
      </button>
      {live ? (
        <a
          href={site.url}
          target='_blank'
          rel='noopener noreferrer'
          aria-label={`Abrir o site no ar (${site.url})`}
          title={site.url}
          data-testid='site-live-link'
          className={cn(iconLink, 'text-primary hover:text-primary')}
        >
          <SteelIcon icon={LinkSquare02Icon} className='size-4' />
        </a>
      ) : null}
      <Button
        size='sm'
        className='ml-1'
        onClick={() => setPublishOpen(true)}
        data-testid='site-publish'
      >
        <SteelIcon icon={Rocket01Icon} data-icon='inline-start' />
        Publicar
      </Button>
      <VersionsSheet open={versionsOpen} onOpenChange={setVersionsOpen} />
      <PublishDialog open={publishOpen} onOpenChange={setPublishOpen} />
    </div>
  )
}
