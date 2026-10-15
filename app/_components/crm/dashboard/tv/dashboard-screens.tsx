'use client'

import { Add01Icon, Settings02Icon } from '@hugeicons-pro/core-stroke-rounded'
import * as React from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import {
  type CrmDashboardSettings,
  MAX_DASHBOARD_PAGES,
} from '@/src/schemas/crm-dashboard.schema'

/** Rotation choices of the TV (seconds; 0 = fixed on the first screen). */
export const ROTATION_CHOICES = [0, 15, 30, 45, 60, 120] as const

export function rotationLabel(seconds: number): string {
  if (seconds === 0) return 'Sem rotação'
  if (seconds < 60) return `A cada ${seconds} s`
  return `A cada ${seconds / 60} min`
}

/**
 * Abas das telas do painel (1 a 3) e ajustes do modo TV: nome da tela,
 * remover a tela atual e o intervalo da rotação.
 */
export function DashboardScreens({
  settings,
  current,
  counts,
  onSelect,
  onChange,
  onRemove,
}: {
  settings: CrmDashboardSettings
  current: number
  /** Widgets por tela (para avisar o que some ao remover). */
  counts: number[]
  onSelect: (page: number) => void
  onChange: (settings: CrmDashboardSettings) => void
  onRemove: (page: number) => void
}) {
  const [title, setTitle] = React.useState(settings.pages[current] ?? '')
  const titleId = React.useId()

  React.useEffect(() => {
    setTitle(settings.pages[current] ?? '')
  }, [settings.pages, current])

  function rename() {
    const next = title.trim().slice(0, 60)
    if (!next || next === settings.pages[current]) return
    const pages = settings.pages.map((page, index) =>
      index === current ? next : page,
    )
    onChange({ ...settings, pages })
  }

  function addScreen() {
    if (settings.pages.length >= MAX_DASHBOARD_PAGES) return
    const pages = [...settings.pages, `Tela ${settings.pages.length + 1}`]
    onChange({
      ...settings,
      pages,
      // A second screen is pointless on a TV without rotation.
      rotateSeconds: settings.rotateSeconds || 30,
    })
    onSelect(pages.length - 1)
  }

  return (
    <div className='flex min-w-0 items-center gap-1'>
      <div
        role='tablist'
        aria-label='Telas do painel'
        className='flex min-w-0 items-center gap-1 overflow-x-auto'
      >
        {settings.pages.map((page, index) => (
          <button
            key={`${index}-${page}`}
            type='button'
            role='tab'
            aria-selected={index === current}
            onClick={() => onSelect(index)}
            className={cn(
              'shrink-0 rounded-md px-2.5 py-1 text-sm transition-colors',
              index === current
                ? 'bg-accent font-medium text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
            )}
          >
            {page}
            <span className='ml-1 text-muted-foreground text-xs tabular-nums'>
              {counts[index] ?? 0}
            </span>
          </button>
        ))}
      </div>
      {settings.pages.length < MAX_DASHBOARD_PAGES ? (
        <Button
          variant='ghost'
          size='icon-sm'
          aria-label='Adicionar tela'
          title='Adicionar tela'
          onClick={addScreen}
        >
          <SteelIcon icon={Add01Icon} strokeWidth={2} />
        </Button>
      ) : null}
      <Popover>
        <PopoverTrigger
          render={
            <Button
              variant='ghost'
              size='icon-sm'
              aria-label='Telas e modo TV'
              title='Telas e modo TV'
            >
              <SteelIcon icon={Settings02Icon} strokeWidth={2} />
            </Button>
          }
        />
        <PopoverContent align='start' className='w-80'>
          <div className='space-y-1.5'>
            <Label htmlFor={titleId}>Nome da tela</Label>
            <Input
              id={titleId}
              value={title}
              maxLength={60}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={rename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') rename()
              }}
            />
          </div>
          <div className='space-y-1.5'>
            <span className='block text-sm'>Rotação no modo TV</span>
            <Select
              value={String(settings.rotateSeconds)}
              onValueChange={(value) =>
                onChange({ ...settings, rotateSeconds: Number(value) })
              }
            >
              <SelectTrigger className='w-full' aria-label='Rotação no modo TV'>
                <span>{rotationLabel(settings.rotateSeconds)}</span>
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                {ROTATION_CHOICES.map((seconds) => (
                  <SelectItem key={seconds} value={String(seconds)}>
                    {rotationLabel(seconds)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className='text-muted-foreground text-xs'>
              A TV alterna entre as telas com widgets. Até 8 blocos por tela
              leem bem a distância.
            </p>
          </div>
          {settings.pages.length > 1 ? (
            <Button
              variant='outline'
              size='sm'
              className='text-destructive'
              onClick={() => onRemove(current)}
            >
              Remover esta tela
              {counts[current] ? ` e ${counts[current]} widget(s)` : ''}
            </Button>
          ) : null}
        </PopoverContent>
      </Popover>
    </div>
  )
}
