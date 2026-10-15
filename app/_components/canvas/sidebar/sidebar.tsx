'use client'

import type { IconSvgElement } from '@hugeicons/react'
import {
  Add01Icon,
  DashboardSquare01Icon,
  Layers01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { cn } from '@/lib/utils'
import { resolveIcon, useCanvasEditor } from '../editor-context'
import { LayersPanel } from './layers'
import { Palette } from './palette'
import { PresetsPanel } from './presets'

interface SidebarTab {
  id: string
  label: string
  icon: IconSvgElement
  render: () => ReactNode
}

/**
 * Left sidebar: a narrow rail of tabs (Adicionar, Camadas, Seções prontas
 * and the catalog's own tabs) and the active panel.
 */
export function CanvasSidebar() {
  const { catalog, props, store } = useCanvasEditor()
  const tabs: SidebarTab[] = [
    {
      id: 'add',
      label: 'Adicionar',
      icon: Add01Icon,
      render: () => <Palette />,
    },
    {
      id: 'layers',
      label: 'Camadas',
      icon: Layers01Icon,
      render: () => <LayersPanel />,
    },
  ]
  if (props.presets?.length) {
    tabs.push({
      id: 'presets',
      label: 'Seções prontas',
      icon: DashboardSquare01Icon,
      render: () => <PresetsPanel presets={props.presets ?? []} />,
    })
  }
  for (const tab of props.extraTabs ?? []) {
    tabs.push({
      id: tab.id,
      label: tab.label,
      icon: resolveIcon(catalog, tab.icon),
      render: () => tab.render({ store }),
    })
  }
  const [active, setActive] = useState('add')
  const current = tabs.find((tab) => tab.id === active) ?? tabs[0]

  return (
    <aside
      aria-label='Barra lateral do editor'
      className='flex h-full min-h-0 shrink-0 border-r bg-background'
    >
      <div
        role='tablist'
        aria-orientation='vertical'
        aria-label='Painéis'
        className='flex w-16 shrink-0 flex-col items-center gap-1 border-r py-2'
      >
        {tabs.map((tab) => {
          const selected = tab.id === current.id
          return (
            <button
              key={tab.id}
              type='button'
              role='tab'
              id={`canvas-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls='canvas-sidebar-panel'
              onClick={() => setActive(tab.id)}
              className={cn(
                'flex w-14 flex-col items-center gap-1 rounded-md px-1 py-1.5 text-[10px] leading-tight font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
                selected &&
                  'bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary',
              )}
            >
              <SteelIcon icon={tab.icon} className='size-5' />
              <span className='line-clamp-2 text-center'>{tab.label}</span>
            </button>
          )
        })}
      </div>
      <div
        id='canvas-sidebar-panel'
        role='tabpanel'
        aria-labelledby={`canvas-tab-${current.id}`}
        className='flex w-64 min-w-0 flex-col xl:w-72'
      >
        <h2 className='flex h-11 shrink-0 items-center border-b px-4 text-sm font-semibold'>
          {current.label}
        </h2>
        {current.render()}
      </div>
    </aside>
  )
}
